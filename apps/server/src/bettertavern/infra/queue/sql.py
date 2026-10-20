"""任务队列的 SQL。单独放一个文件，方便评审和直接拿到 psql 里验证。

语义：
- 同一 ordering_key（= playthrough_id:lane）的任务严格按 id 串行：只有“该键最早的未完成任务”
  可以被领取，前一个在运行、在退避等待或者还没完成，后面的都得等；
- 不同键之间并行，靠 FOR UPDATE SKIP LOCKED 让多个 worker 互不阻塞；
- 领取、完成、失败都带 worker 标识做围栏：锁超时被回收后，原 worker 的迟到结果不会生效。

id 来自 BIGSERIAL，是在 INSERT 时分配的，不是在提交时。如果两个事务并发地给同一个键入队，
后分配 id 的那个可能先提交，worker 会先看到它、把它当成队首领走，等前一个提交后再领前一个，
同一车道就会并发、乱序。所以入队前先拿该键的事务级咨询锁，让同一个键的入队按提交顺序分配 id。

表结构见 migrations/versions/ 下的迁移。
"""

# 入队前调用；锁随事务提交或回滚释放。不同键哈希冲突只会多一点串行，不影响正确性
ENQUEUE_LOCK = "SELECT pg_advisory_xact_lock(hashtextextended(:ordering_key, 0))"

ENQUEUE = """
INSERT INTO jobs (kind, ordering_key, payload, run_after, max_attempts)
VALUES (:kind, :ordering_key, CAST(:payload AS jsonb),
        now() + make_interval(secs => :delay), :max_attempts)
RETURNING id
"""

# 同一个键上已经有一个同类、还没开始的任务时，不再入队（调用方要求时）
FIND_PENDING = """
SELECT id FROM jobs
WHERE kind = :kind AND ordering_key = :ordering_key AND status = 'pending'
ORDER BY id LIMIT 1
"""

NOTIFY = "SELECT pg_notify(:channel, :kind)"

_CLAIM_TEMPLATE = """
UPDATE jobs
SET status = 'running', locked_by = :worker, locked_at = now(), attempts = attempts + 1
WHERE id = (
    SELECT j.id
    FROM jobs AS j
    WHERE j.status = 'pending'
      AND j.run_after <= now()
      {kind_filter}
      AND NOT EXISTS (
          SELECT 1 FROM jobs AS earlier
          WHERE earlier.ordering_key = j.ordering_key
            AND earlier.status IN ('pending', 'running')
            AND earlier.id < j.id
      )
    ORDER BY j.run_after, j.id
    LIMIT 1
    FOR UPDATE SKIP LOCKED
)
RETURNING id, kind, ordering_key, payload::text AS payload, attempts, max_attempts
"""

CLAIM_ANY = _CLAIM_TEMPLATE.format(kind_filter="")
CLAIM_KINDS = _CLAIM_TEMPLATE.format(kind_filter="AND j.kind = ANY(CAST(:kinds AS text[]))")

COMPLETE = """
UPDATE jobs
SET status = 'done', finished_at = now(), locked_by = NULL, locked_at = NULL, last_error = NULL
WHERE id = :id AND status = 'running' AND locked_by = :worker
"""

# retry=true 且还有次数：回到 pending 并推迟；否则直接 failed
FAIL = """
UPDATE jobs
SET status = CASE WHEN :retry AND attempts < max_attempts THEN 'pending' ELSE 'failed' END,
    run_after = CASE WHEN :retry AND attempts < max_attempts
                     THEN now() + make_interval(secs => :delay) ELSE run_after END,
    finished_at = CASE WHEN :retry AND attempts < max_attempts THEN NULL ELSE now() END,
    locked_by = NULL,
    locked_at = NULL,
    last_error = :error
WHERE id = :id AND status = 'running' AND locked_by = :worker
RETURNING status
"""

# 优雅退出时把没跑完的任务还回去：不消耗重试次数，立即可被其他 worker 领取
RELEASE = """
UPDATE jobs
SET status = 'pending',
    attempts = GREATEST(attempts - 1, 0),
    run_after = now(),
    locked_by = NULL,
    locked_at = NULL,
    last_error = :reason
WHERE id = :id AND status = 'running' AND locked_by = :worker
"""

TOUCH = """
UPDATE jobs SET locked_at = now()
WHERE id = :id AND status = 'running' AND locked_by = :worker
"""

# 锁超时：worker 崩溃或卡死。还有次数就放回队列，否则标记失败
REAP = """
UPDATE jobs
SET status = CASE WHEN attempts < max_attempts THEN 'pending' ELSE 'failed' END,
    finished_at = CASE WHEN attempts < max_attempts THEN NULL ELSE now() END,
    locked_by = NULL,
    locked_at = NULL,
    last_error = 'lock expired: worker lost'
WHERE status = 'running' AND locked_at < now() - make_interval(secs => :lock_timeout)
RETURNING id
"""
