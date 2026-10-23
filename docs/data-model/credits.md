# 数据模型：点数

> 文档索引：[总览](../README.md) · [后端](../backend.md) · [客户端](../client.md) · [测试](../testing.md) · [数据模型](README.md) · [接口](../api/README.md)
>
> 数据模型：[说明与约定](README.md) · [账户与令牌](accounts.md) · [模型路由](models.md) · [点数](credits.md) · [外部服务](tools.md) · [角色卡与剧本](library.md) · [工作台](workbench.md) · [游玩与回合](story.md) · [世界状态](world.md) · [记忆](memory.md) · [运行基础设施](infra.md)

官方模型的点数，以及官方服务里只限次数的用量（`platform_usage`，目前是官方搜索）。

官方模型：用户不用自己配 Key，直接用运营方的 Key（服务器配置了 `PLATFORM_API_KEY` 才有，见 [models.md](models.md) 里的 `source`），
按每次调用的用量扣点数。余额在 [`users.credit_micro`](accounts.md#users)，每一笔记在 `credit_ledger`。对应的接口见 [api/auth.md 的 `GET /v1/me/credits`](../api/auth.md)。

单位：库里存**微元**（百万分之一元），界面显示**点**，1 点 = 1000 微元 = 0.001 元。显示时向下取整。

## 表

### `credit_ledger`

点数账本：每一笔加减一行，只追加不改。余额（`users.credit_micro`）和账本在同一个事务里写：先 `UPDATE users … RETURNING credit_micro` 拿到改后的余额，再插入这一行。

| 列 | 类型 | 可空 | 默认 | 说明 |
| --- | --- | --- | --- | --- |
| `id` | uuid | 否 | `gen_random_uuid()` | 主键 |
| `user_id` | uuid | 否 |  | → `users.id`，级联删除 |
| `kind` | text | 否 |  | `trial`（体验额度）、`charge`（官方模型的用量）、`adjust`（运营方手动调整） |
| `amount_micro` | bigint | 否 |  | 这一笔的金额，微元；加是正数，扣是负数 |
| `balance_micro` | bigint | 否 |  | 这一笔之后的余额，微元；可能是负数（后台整理可以让余额短暂变成负数） |
| `run_id` | uuid | 是 |  | → `agent_runs.id`，删除时置空；`charge` 才有，是哪一次 agent 运行花的 |
| `agent` | text | 是 |  | `charge`：哪个 agent（`director`、`state_keeper`、`card_maker` 等） |
| `model` | text | 是 |  | `charge`：用的模型名 |
| `input_tokens` | integer | 是 |  | `charge`：输入 token 数（含命中缓存的），一次运行里各步之和 |
| `cached_tokens` | integer | 是 |  | `charge`：其中命中缓存的 token 数 |
| `output_tokens` | integer | 是 |  | `charge`：输出 token 数（含思考） |
| `note` | text | 否 | `''` | 说明，`adjust` 时写原因；不写故事文本 |
| `created_at` | timestamptz | 否 | `now()` |  |

约束与索引：
- `kind` 的 CHECK；三个 token 列的 CHECK（不小于 0）。
- `credit_ledger_user_idx (user_id, created_at)`：按用户看流水、估计每回合花多少。
- `credit_ledger_run_uq (run_id) WHERE run_id IS NOT NULL` 唯一：同一次运行只扣一次。
- `credit_ledger_charge_idx (created_at) WHERE kind = 'charge'`：算全站最近 24 小时花了多少（每日预算）。

### `credit_grants`

领过体验额度的邮箱。存的是邮箱的 HMAC-SHA256（密钥由 `AUTH_SECRET` 派生，消息是 `users.email_norm`），不存原文。
没有外键：删号以后这一行留着，同一个邮箱重新注册不再送体验额度。

| 列 | 类型 | 可空 | 默认 | 说明 |
| --- | --- | --- | --- | --- |
| `email_hash` | text | 否 |  | 主键，邮箱的 HMAC（十六进制） |
| `granted_at` | timestamptz | 否 | `now()` | 第一次送的时间 |

### `platform_usage`

官方服务里不扣点数、只限次数的用量：每个用户每天一行一种。目前只有官方搜索（工作台 agent 查资料时用运营方的搜索 Key，只用免费额度，
见 [workbench.md 第 5 节](../workbench.md)）。每个用户每天、全站每个月的上限在设置里（`PLATFORM_SEARCH_DAILY`、`PLATFORM_SEARCH_MONTHLY`），
用完了 agent 改查维基百科。

| 列 | 类型 | 可空 | 默认 | 说明 |
| --- | --- | --- | --- | --- |
| `user_id` | uuid | 否 |  | → `users.id`，级联删除 |
| `day` | date | 否 |  | 哪一天（UTC） |
| `kind` | text | 否 |  | 用的是什么：`search`（官方搜索） |
| `count` | integer | 否 | `0` | 这一天用了几次 |

约束与索引：
- 主键 `(user_id, day, kind)`；`kind` 的 CHECK；`count >= 0`。
- `platform_usage_day_idx (kind, day)`：算全站这个月用了多少。

记一次的做法（`services/web_store.py` 的 `claim_platform_search`）：先算全站这个月（UTC）的总数，没到月上限再
`INSERT … ON CONFLICT DO UPDATE SET count = count + 1 WHERE count < 每天的上限 RETURNING`，没返回行就是今天用完了。
两步之间没有锁，几个请求同时来可能超出月上限几次（月上限本来就比免费额度少一截）。

## 计费

扣点在 `services/run_records.py` 的 `charge_run`：每次 agent 运行写进 `agent_runs` 的同一个事务里，用的是官方模型（`ResolvedRoute.prices` 不为空）时扣一笔。用户自己的 Key 不扣。

- 用量：这次运行各步（`agent_steps.usage`）之和；没有分步记录时用整次的 `agent_runs.usage`。
- 金额（微元）= 未命中缓存的输入 × 输入单价 + 命中缓存的输入 × 缓存单价 + 输出 × 输出单价，向上取整。
  单价的单位是“元 / 百万 token”，数值上等于“微元 / token”。单价来自服务器配置（`PLATFORM_PRICE_INPUT`、`PLATFORM_PRICE_CACHED`、`PLATFORM_PRICE_OUTPUT`），
  默认按 DeepSeek 白天的价格（输入 2、缓存 0.04、输出 8），不区分时段（DeepSeek 夜间半价时实际成本更低）。
- 金额是 0 的不记。

体验额度：用户邮箱验证通过（或部署不要求验证、注册完成）时，服务器有官方模型就给他配上官方模型那一行，再按邮箱的 HMAC 抢占 `credit_grants`，抢到了就记一笔 `trial`（默认 1500 点，`TRIAL_CREDITS`）。
上线前就注册的老用户用管理命令 `bettertavern credits-backfill` 补发，规则相同。

开始生成前的检查（`services/credits.py`）：开局、提交行动、工作台的 agent 动手时，用的是官方模型的话：
- 余额不大于 0：402 `CREDITS_EXHAUSTED`；
- 全站最近 24 小时 `charge` 的总额达到每日预算（`PLATFORM_DAILY_BUDGET`，元）：503 `PLATFORM_BUSY`，并记一条 error 日志（报错提醒会发邮件）。

已经开始的后台整理（世界状态、章节摘要、大纲）不检查，照常扣，余额可以短暂变成负数。

## 状态

`users.credit_micro`：注册时 0 → 邮箱验证通过后加体验额度 → 每次用官方模型减少 → 不大于 0 时不能再用官方模型开始生成（可以换成自己的 Key）。
