/** 概览：最近一段时间的几个数字、按小时的回合数、最近的问题、失败的回合 */

import { useState } from "react";
import { Link } from "react-router-dom";

import { useOverview, type ProblemGroup } from "../api.ts";
import { ErrorBox, IdChip, Loading, Notice, Pill, Seg, Stat } from "../components/common.tsx";
import { IdLink } from "../components/EntryRow.tsx";
import { errorCode, eventInfo, sentence } from "../lib/catalog.ts";
import { ago, clock, duration, percent, tokens } from "../lib/format.ts";

function ProblemRow({ group }: { group: ProblemGroup }) {
  const s = group.sample;
  const link = s.turn_id ? (
    <IdLink kind="turn_id" id={s.turn_id} />
  ) : s.request_id ? (
    <IdLink kind="request_id" id={s.request_id} />
  ) : null;
  const tone = group.level === "error" || group.level === "critical" ? "error" : "warn";
  return (
    <tr>
      <td>
        <Pill tone={tone}>{tone === "error" ? "错误" : "警告"}</Pill>
      </td>
      <td>
        <b>{eventInfo(group.event).label}</b>
        <div className="small mut">最近一次：{sentence(group.event, s)}</div>
      </td>
      <td>{group.count} 次</td>
      <td className="mut">{ago(group.last_t)}</td>
      <td>{link}</td>
    </tr>
  );
}

export function Overview() {
  const [hours, setHours] = useState("24");
  const { data, error, isLoading } = useOverview(Number(hours));
  if (isLoading) return <Loading />;
  if (error || !data) {
    return (
      <div className="page">
        <ErrorBox error={error ?? "没有数据"} />
      </div>
    );
  }
  const db = data.db;
  const turnsTotal = db ? db.turns.ok + db.turns.failed : 0;
  const failRate = db && turnsTotal ? db.turns.failed / turnsTotal : null;
  const cacheRate = db && db.director.input_tokens ? db.director.cached_tokens / db.director.input_tokens : null;
  const maxHour = Math.max(1, ...(db?.hourly ?? []).map((h) => h.ok + h.failed));
  return (
    <div className="page">
      <div className="page-head">
        <h1>概览</h1>
        <Seg
          value={hours}
          onChange={setHours}
          options={[
            { value: "1", label: "1 小时" },
            { value: "24", label: "24 小时" },
            { value: "168", label: "7 天" },
          ]}
        />
      </div>
      {data.db_error ? <Notice tone="warn">{data.db_error}：下面只有来自日志的数字</Notice> : null}
      <div className="cards">
        {db ? (
          <>
            <Stat
              label="回合"
              value={`${db.turns.ok} / ${turnsTotal}`}
              note={
                <>
                  成功 / 全部{db.turns.generating ? `，${db.turns.generating} 个生成中` : ""}
                  {failRate !== null && failRate > 0 ? `，失败率 ${percent(failRate, 1)}` : ""}
                </>
              }
              tone={failRate !== null && failRate > 0.02 ? "error" : undefined}
            />
            <Stat
              label="首字等待"
              value={duration(db.director.ttft_p50)}
              note={`一半的回合在这之内；最慢的 5% 超过 ${duration(db.director.ttft_p95)}`}
              tone={db.director.ttft_p50 !== null && db.director.ttft_p50 > 3000 ? "warn" : undefined}
            />
            <Stat label="模型总耗时" value={duration(db.director.latency_p50)} note="中位数，导演一次调用" />
            <Stat
              label="token"
              value={tokens(db.director.input_tokens + db.director.output_tokens)}
              note={`输入 ${tokens(db.director.input_tokens)}（缓存命中 ${percent(cacheRate)}），输出 ${tokens(db.director.output_tokens)}`}
            />
          </>
        ) : null}
        <Stat label="推送断线" value={data.logs.sse_drops} note="手机的推送连接中途断开（会自动续传）" />
        <Stat
          label="服务端错误"
          value={data.logs.server_errors}
          note={`共 ${data.logs.requests} 个请求`}
          tone={data.logs.server_errors > 0 ? "error" : undefined}
        />
      </div>

      {db && db.hourly.length > 0 ? (
        <>
          <h2>每小时的回合</h2>
          <div className="card">
            <div className="hourly">
              {db.hourly.map((h) => (
                <div key={h.hour} title={`${clock(h.hour)}：成功 ${h.ok}，失败 ${h.failed}`}>
                  <i style={{ height: `${(h.ok / maxHour) * 80}px`, background: "var(--c-stream)" }} />
                  <i style={{ height: `${(h.failed / maxHour) * 80}px`, background: "var(--err)" }} />
                </div>
              ))}
            </div>
            <div className="small mut">蓝：成功；红：失败。鼠标移上去看具体数字</div>
          </div>
        </>
      ) : null}

      <h2>最近的问题</h2>
      {data.problems.length === 0 ? (
        <div className="notice">这段时间日志里没有警告和错误。</div>
      ) : (
        <table className="list">
          <tbody>
            {data.problems.map((g) => (
              <ProblemRow key={g.event} group={g} />
            ))}
          </tbody>
        </table>
      )}

      {db && db.failed_turns.length > 0 ? (
        <>
          <h2>失败的回合</h2>
          <table className="list">
            <tbody>
              {db.failed_turns.map((t) => (
                <tr key={t.id}>
                  <td>
                    <Link to={`/turns/${t.id}`}>
                      {t.title} · 第 {t.seq} 回合
                    </Link>
                  </td>
                  <td>
                    {errorCode(t.code)}
                    {t.message ? <div className="small mut">{t.message}</div> : null}
                  </td>
                  <td className="mut">{ago(t.created_at)}</td>
                  <td>
                    <IdChip id={t.id} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      ) : null}
    </div>
  );
}
