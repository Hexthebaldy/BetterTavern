# 数据模型：账户与令牌

> 文档索引：[总览](../README.md) · [后端](../backend.md) · [客户端](../client.md) · [测试](../testing.md) · [数据模型](README.md) · [接口](../api/README.md)
>
> 数据模型：[说明与约定](README.md) · [账户与令牌](accounts.md) · [模型路由](models.md) · [点数](credits.md) · [外部服务](tools.md) · [角色卡与剧本](library.md) · [人设库](personas.md) · [工作台](workbench.md) · [游玩与回合](story.md) · [世界状态](world.md) · [记忆](memory.md) · [运行基础设施](infra.md)

账户、登录用的刷新令牌、邮箱验证码。对应的接口见 [api/auth.md](../api/auth.md)；各领域共用的约定、表之间的关系、删除规则见 [README.md](README.md)。

## 表

### `users`

一个账户，用邮箱加密码登录。

| 列 | 类型 | 可空 | 默认 | 说明 |
| --- | --- | --- | --- | --- |
| `id` | uuid | 否 | `gen_random_uuid()` | 主键 |
| `email` | text | 否 |  | 注册时填的邮箱，去掉首尾空白、保留大小写，用来显示 |
| `email_norm` | text | 否 |  | `email` 去掉首尾空白后转小写，唯一；登录时按它查找 |
| `password_hash` | text | 否 |  | Argon2id 的 PHC 字符串（`$argon2id$v=19$m=…,t=…,p=…$…`）。哈希参数调整后，用户下次登录成功时重新哈希 |
| `display_name` | text | 否 | `''` | 昵称，最多 40 字 |
| `locale` | text | 否 | `'zh'` | 注册时的界面语言（`zh`、`en`、`ja`），服务端发邮件用；界面语言仍然是设备上的设置（[i18n.md](../i18n.md)） |
| `settings` | jsonb | 否 | `'{}'` | 账户级设置；M1 没有用到 |
| `created_at` | timestamptz | 否 | `now()` | 注册时间。没验证的账号又注册了一次时改成那一次的时间（一天没验证就删，从这里算） |
| `updated_at` | timestamptz | 否 | `now()` | 更新密码哈希、验证邮箱时写入 |
| `email_verified_at` | timestamptz | 是 |  | 邮箱验证通过的时间；空表示还没验证。不要求验证邮箱的部署注册时直接写入；迁移 0021 之前的账号取注册时间 |
| `credit_micro` | bigint | 否 | `0` | 官方模型的点数余额，单位微元（1 点 = 1000 微元），可能短暂为负；每次增减都记在 `credit_ledger`，见 [credits.md](credits.md) |

约束与索引：
- `email_norm` 唯一（`users_email_norm_key`）。
- `users_unverified_idx (created_at) WHERE email_verified_at IS NULL`：定期清理没验证的账号时用。

`DELETE /v1/me` 删除这一行时，外键会级联删除这个用户的全部数据，见 [README.md 的“删除与清理”](README.md#删除与清理)。

### `refresh_tokens`

刷新令牌。明文只在签发时返回给客户端一次，库里只存它的 SHA-256。每次刷新都在同一个“家族”里签发新令牌，旧令牌标记为已用。

| 列 | 类型 | 可空 | 默认 | 说明 |
| --- | --- | --- | --- | --- |
| `id` | uuid | 否 | `gen_random_uuid()` | 主键 |
| `user_id` | uuid | 否 |  | → `users.id`，级联删除 |
| `family_id` | uuid | 否 |  | 令牌家族。每次注册或登录开一个新家族，之后轮换出的令牌都在这个家族里 |
| `token_hash` | text | 否 |  | 令牌的 SHA-256（十六进制），唯一。令牌本身是 `rt_` 加 43 个 URL 安全字符 |
| `expires_at` | timestamptz | 否 |  | 签发时间加 `REFRESH_TOKEN_TTL_S`（默认 30 天） |
| `created_at` | timestamptz | 否 | `now()` |  |
| `used_at` | timestamptz | 是 |  | 第一次用来刷新的时间（用应用的时钟）。之后 30 秒内再次出现仍然可以换新令牌，因为手机网络下常有响应丢失后的重试；超过 30 秒再出现视为被盗用，整个家族吊销 |
| `revoked_at` | timestamptz | 是 |  | 吊销时间。退出登录或发现盗用时，整个家族一起写入 |
| `user_agent` | text | 是 |  | 签发请求的 User-Agent，排错用 |

约束与索引：
- `token_hash` 唯一（`refresh_tokens_token_hash_key`）。
- `refresh_tokens_family_idx (family_id)`：吊销整个家族时用。
- `refresh_tokens_user_idx (user_id)`。

维护任务大约每 10 分钟删除一次过期超过 7 天的行。

### `email_codes`

发出去的邮箱验证码（注册验证邮箱、找回密码）。明文只在邮件里，库里只存 HMAC-SHA256（密钥由 `AUTH_SECRET` 派生，
消息是 `用户 ID:用途:验证码`）。每个账号每种用途只有一行：重发时覆盖，旧验证码随之作废。

| 列 | 类型 | 可空 | 默认 | 说明 |
| --- | --- | --- | --- | --- |
| `id` | uuid | 否 | `gen_random_uuid()` | 主键 |
| `user_id` | uuid | 否 |  | → `users.id`，级联删除 |
| `purpose` | text | 否 |  | `verify`（验证邮箱）或 `reset`（找回密码） |
| `code_hash` | text | 否 |  | 验证码的 HMAC（十六进制）。验证码是 6 位数字 |
| `attempts` | integer | 否 | `0` | 填错了几次；第 5 次填错时删掉这一行 |
| `expires_at` | timestamptz | 否 |  | 发出时间加 15 分钟（用应用的时钟） |
| `created_at` | timestamptz | 否 | `now()` | 发出时间（重发时更新） |

约束与索引：
- `purpose` 只能是 `verify` 或 `reset`；`attempts >= 0`。
- `email_codes_user_purpose_uq (user_id, purpose)` 唯一：每个账号每种用途一行。
- `email_codes_expires_idx (expires_at)`：定期清理过期的验证码时用。

填对、填错 5 次、过期后再来填时删掉这一行；维护任务大约每 10 分钟删一次过期的。

## 状态

`users`：要求验证邮箱时，注册后 `email_verified_at` 为空 → 填对注册验证码，或者用找回密码设了新密码以后写入。
一直为空的账号注册一天后被删掉（只在要求验证邮箱时删，关掉验证以后这些账号可以直接登录）。

`refresh_tokens`：签发时 `used_at`、`revoked_at` 为空 → 用于刷新后写 `used_at` → 退出登录、发现盗用时写 `revoked_at`（整个家族）。
可以用来刷新的条件：未吊销、未过期，并且没用过，或者用过但不超过 30 秒。
