# 接口：认证与账户

> 文档索引：[总览](../README.md) · [后端](../backend.md) · [客户端](../client.md) · [测试](../testing.md) · [数据模型](../data-model/README.md) · [接口](README.md)
>
> 接口：[说明与约定](README.md) · [认证与账户](auth.md) · [模型路由](models.md) · [外部服务](tools.md) · [角色卡与剧本](library.md) · [工作台](workbench.md) · [游玩与回合](play.md) · [回合事件流](events.md) · [运维与开发](ops.md)

注册、邮箱验证码、登录、令牌刷新与退出、找回密码，以及当前账户、修改密码。鉴权方式和令牌的规则见 [README.md 的“鉴权”](README.md#鉴权)；
相关的表见 [数据模型：账户与令牌](../data-model/accounts.md)。

## 邮箱验证

服务端配了发信服务（`RESEND_API_KEY`）时默认要求验证邮箱（`EMAIL_VERIFICATION` 可以单独打开或关掉）：

1. 注册：账号建好，但不登录（[`RegisterOut`](#registerout) 的 `verification_required` 为 `true`，令牌字段都是 `null`），
   验证码发到邮箱；
2. 用户在验证页填验证码：`POST /v1/auth/verify-email`，填对了标成已验证并登录；
3. 没收到可以重发：`POST /v1/auth/send-code`（`purpose: "verify"`）；
4. 还没验证就登录：密码对了返回 403 `EMAIL_NOT_VERIFIED`（带 `email`），同时自动再发一封验证码，客户端跳到验证页。

验证码的规则：6 位数字，15 分钟内有效，填错 5 次作废，用过作废；每个账号每种用途只有最新的一个有效（重发以后旧的作废）。
同一个邮箱 1 分钟最多发 1 封、1 小时最多 5 封；同一个 IP 1 小时最多发 20 封。
注册了一天还没验证的账号会被删掉，别人可以重新用这个邮箱注册；在这之前用同一个邮箱再注册，会换成新填的密码和昵称（谁能收到验证码谁算数）。

不要求验证邮箱时（自己部署、没配发信服务），注册直接登录，和以前一样；这时找回密码不可用（`MAIL_UNAVAILABLE`），
开发环境例外：验证码写进 api 的日志（`mail.dev_outbox`）。

找回密码同样用验证码（`purpose: "reset"`）。重发验证码、找回密码这两个接口不透露邮箱是否注册过：没注册过时什么都不发，也返回 204。

## 两种登录方式

会发令牌的接口（注册、验证邮箱、登录、刷新、找回密码、修改密码）和退出都有两种用法，由请求头 `X-Auth-Mode` 决定：

- **请求体模式**（不带这个请求头，手机 App）：刷新令牌在响应体的 `refresh_token` 里，客户端自己保存（例如放进 Keychain）；
  刷新和退出时放在请求体里发回来。
- **Cookie 模式**（`X-Auth-Mode: cookie`，网页）：刷新令牌不进响应体（`refresh_token` 是 `null`），只在响应头里设置成 Cookie，
  页面脚本读不到它；刷新和退出不带请求体，凭浏览器自动带上的 Cookie。访问令牌两种模式一样，在响应体里，网页只放在内存中。

Cookie 的样子：

```
Set-Cookie: bt_refresh=rt_…; HttpOnly; Max-Age=2591999; Path=/v1/auth; SameSite=strict; Secure
```

- `Path=/v1/auth`：只发往 `/v1/auth/` 下的接口，其他请求不带；`Max-Age` 是刷新令牌剩下的秒数，每次刷新随新令牌更新。
- `Secure` 由 `AUTH_COOKIE_SECURE` 决定，不设置时开发环境（`ENV=dev`）不带（Safari 在 http://localhost 上不保存带 Secure 的 Cookie），其他环境带。
- 退出、刷新被拒（401）时，响应里带一个 `Max-Age=0` 的同名 Cookie，让浏览器删掉它。
- 防跨站：Cookie 是 `SameSite=strict`；`X-Auth-Mode` 是自定义请求头，跨域请求要先过 CORS 预检；
  浏览器带的 `Sec-Fetch-Site` 不是 `same-origin`（或 `none`）时，`Origin` 必须在 `CORS_ORIGINS` 里，否则返回 403 `CROSS_SITE`。
  网页和接口同源部署（同一个域名，`/v1` 由反向代理转给 api）时什么都不用配。

## 接口

### `POST /v1/auth/register`

注册新账户。要求验证邮箱时不登录，验证码发到邮箱（见上文“邮箱验证”）；不要求时直接登录。

- 鉴权：不需要；按 IP 限流。
- 请求头：`X-Auth-Mode: cookie` 时刷新令牌放进 Cookie（见上文“两种登录方式”）。
- 请求体：[`RegisterIn`](#registerin)
- 成功：`201`，返回 [`RegisterOut`](#registerout)。验证码邮件没发出去时注册照样成功，用户可以在验证页重发。

| HTTP | code | 情形 |
| --- | --- | --- |
| 422 | `VALIDATION_ERROR` | 邮箱格式不对（`field: "email"`）；密码长度不在 8 到 128 之间（`field: "password"`）；字段超过 `RegisterIn` 的长度限制（带 `errors`）；`X-Auth-Mode` 不是 `cookie`（`field: "X-Auth-Mode"`） |
| 403 | `CROSS_SITE` | Cookie 模式下，请求来自别的网站 |
| 403 | `REGISTRATION_CLOSED` | 服务端暂停了注册（`REGISTRATION_OPEN=false`） |
| 409 | `EMAIL_TAKEN` | 邮箱已经注册过（不区分大小写，忽略首尾空白）。要求验证邮箱时，只有已经验证过的才算 |
| 429 | `RATE_LIMITED` | 同一个 IP 每分钟注册超过 5 次 |

#### `RegisterIn`

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `email` | string | 是 | 邮箱，最长 254 个字符，格式为 `名字@域名.后缀` |
| `password` | string | 是 | 8 到 128 个字符（请求模型的上限是 1024，超过 128 的由业务校验拒绝） |
| `display_name` | string | 否 | 昵称，最多 40 个字符，默认空串 |
| `locale` | string 或 null | 否 | 界面语言 `zh`、`en`、`ja`，验证码邮件用这种语言；不认识的当作 `zh` |

### `POST /v1/auth/send-code`

发一封验证码邮件：重发注册的验证码（`purpose: "verify"`），或者找回密码（`purpose: "reset"`）。

- 鉴权：不需要；同一个 IP 1 小时最多 20 封，同一个邮箱 1 分钟 1 封、1 小时 5 封。
- 请求体：[`SendCodeIn`](#sendcodein)
- 成功：`204`，没有响应体。邮箱没注册过、注册验证码但邮箱已经验证过时什么都不发，也返回 204。

| HTTP | code | 情形 |
| --- | --- | --- |
| 422 | `VALIDATION_ERROR` | 邮箱格式不对（`field: "email"`）；`purpose` 不是 `verify` 或 `reset` |
| 429 | `RATE_LIMITED` | 发得太频繁（按 IP 或按邮箱），带 `retry_after` |
| 503 | `MAIL_UNAVAILABLE` | 服务端没配发信服务，或者这次没发出去（`retryable` 为真时可以稍后再试） |

#### `SendCodeIn`

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `email` | string | 是 | 注册时的邮箱，不区分大小写 |
| `purpose` | string | 是 | `verify`（注册验证码）或 `reset`（找回密码） |
| `locale` | string 或 null | 否 | 邮件的语言 `zh`、`en`、`ja`；不填用账号注册时的语言 |

### `POST /v1/auth/verify-email`

填注册验证码：填对了标成已验证，并且登录。

- 鉴权：不需要；按 IP 限流，和找回密码共用一个计数。
- 请求头：`X-Auth-Mode: cookie` 时刷新令牌放进 Cookie。
- 请求体：[`VerifyEmailIn`](#verifyemailin)
- 成功：`200`，返回 [`AuthOut`](#authout)。

| HTTP | code | 情形 |
| --- | --- | --- |
| 400 | `CODE_INVALID` | 验证码不对，带 `attempts_left`（还能试几次，到 0 时这个验证码已经作废） |
| 400 | `CODE_EXPIRED` | 验证码过期、错太多次作废、已经用过，或者这个邮箱没有待验证的验证码（也包括邮箱没注册过） |
| 403 | `CROSS_SITE` | Cookie 模式下，请求来自别的网站 |
| 422 | `VALIDATION_ERROR` | 验证码不是 6 位数字（`field: "code"`）；`X-Auth-Mode` 不是 `cookie` |
| 429 | `RATE_LIMITED` | 同一个 IP 每分钟超过 5 次 |

#### `VerifyEmailIn`

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `email` | string | 是 | 注册时的邮箱 |
| `code` | string | 是 | 邮件里的 6 位数字 |

### `POST /v1/auth/reset-password`

找回密码：用邮件里的验证码（先调 `POST /v1/auth/send-code`，`purpose: "reset"`）设新密码。
成功后这个账号在所有设备上的登录都退出，这台设备用新密码登录；没验证过的邮箱也同时算作验证过。

- 鉴权：不需要；按 IP 限流，和验证邮箱共用一个计数。
- 请求头：`X-Auth-Mode: cookie` 时刷新令牌放进 Cookie。
- 请求体：[`ResetPasswordIn`](#resetpasswordin)
- 成功：`200`，返回 [`AuthOut`](#authout)。

| HTTP | code | 情形 |
| --- | --- | --- |
| 400 | `CODE_INVALID` | 验证码不对，带 `attempts_left` |
| 400 | `CODE_EXPIRED` | 验证码过期、作废、用过，或者没有找回密码的验证码 |
| 403 | `CROSS_SITE` | Cookie 模式下，请求来自别的网站 |
| 422 | `VALIDATION_ERROR` | 验证码不是 6 位数字（`field: "code"`）；新密码长度不在 8 到 128 之间（`field: "new_password"`）；`X-Auth-Mode` 不是 `cookie` |
| 429 | `RATE_LIMITED` | 同一个 IP 每分钟超过 5 次 |

#### `ResetPasswordIn`

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `email` | string | 是 | 注册时的邮箱 |
| `code` | string | 是 | 邮件里的 6 位数字 |
| `new_password` | string | 是 | 新密码，8 到 128 个字符 |

### `POST /v1/auth/login`

登录。每次登录都开一个新的刷新令牌家族，所以多台设备的登录互不影响。

- 鉴权：不需要；按 IP 限流，和注册分开计数。
- 请求头：`X-Auth-Mode: cookie` 时刷新令牌放进 Cookie。
- 请求体：[`LoginIn`](#loginin)
- 成功：`200`，返回 [`AuthOut`](#authout)。

| HTTP | code | 情形 |
| --- | --- | --- |
| 401 | `INVALID_CREDENTIALS` | 邮箱不存在或密码不对（不区分这两种情况） |
| 403 | `CROSS_SITE` | Cookie 模式下，请求来自别的网站 |
| 403 | `EMAIL_NOT_VERIFIED` | 密码对了，但邮箱还没验证（只在要求验证邮箱时出现）；带 `email`（注册时的写法），同时又发了一封验证码 |
| 422 | `VALIDATION_ERROR` | `X-Auth-Mode` 不是 `cookie`（`field: "X-Auth-Mode"`） |
| 429 | `RATE_LIMITED` | 同一个 IP 每分钟登录超过 5 次 |

#### `LoginIn`

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `email` | string | 是 | 不区分大小写，忽略首尾空白 |
| `password` | string | 是 |  |

### `POST /v1/auth/refresh`

用刷新令牌换一组新的令牌。

- 鉴权：不需要（凭刷新令牌）；不限流。
- 请求头：`X-Auth-Mode: cookie` 时不带请求体，刷新令牌取自 Cookie `bt_refresh`，请求体里的令牌不算数；不带这个请求头时 Cookie 不算数。
- 请求体：[`RefreshIn`](#refreshin)（Cookie 模式下不带）
- 成功：`200`，返回 [`AuthOut`](#authout)。返回的 `refresh_token` 是新的（属于同一个家族），客户端必须保存它，旧令牌随即作废；
  Cookie 模式下新令牌在 `Set-Cookie` 里，浏览器自动替换。
- 宽限期：旧令牌用过之后的 30 秒内再次提交，仍然会成功（再签一个新的）。这是为了应对“服务端已经换了新令牌、响应却在网络上丢了”的重试。
  超过 30 秒之后再出现，视为令牌被盗用：吊销整个家族，返回 `REFRESH_REUSED`。

| HTTP | code | 情形 |
| --- | --- | --- |
| 401 | `REFRESH_INVALID` | 令牌不存在、已吊销、已过期，或者账户已删除；Cookie 模式下没有 Cookie。Cookie 模式下同时删掉 Cookie |
| 401 | `REFRESH_REUSED` | 用过的令牌超过 30 秒后又出现，整个家族已被吊销，需要重新登录。Cookie 模式下同时删掉 Cookie |
| 403 | `CROSS_SITE` | Cookie 模式下，请求来自别的网站 |
| 422 | `VALIDATION_ERROR` | 请求体模式下没有请求体（`field: "refresh_token"`）；`X-Auth-Mode` 不是 `cookie` |

#### `RefreshIn`

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `refresh_token` | string | 是 | 刷新令牌，最长 200 个字符 |

### `POST /v1/auth/logout`

退出这台设备的登录：吊销这个刷新令牌所在的整个家族。

- 鉴权：不需要（凭刷新令牌）。
- 请求头：`X-Auth-Mode: cookie` 时不带请求体，吊销 Cookie `bt_refresh` 里的令牌，并让浏览器删掉这个 Cookie（没有 Cookie 也照样删）。
- 请求体：[`RefreshIn`](#refreshin)（Cookie 模式下不带）
- 成功：`204`，没有响应体。令牌不存在时也返回 204。访问令牌不会被吊销，过期前（最长 15 分钟）仍然有效。

| HTTP | code | 情形 |
| --- | --- | --- |
| 403 | `CROSS_SITE` | Cookie 模式下，请求来自别的网站 |
| 422 | `VALIDATION_ERROR` | 请求体模式下没有请求体（`field: "refresh_token"`）；`X-Auth-Mode` 不是 `cookie` |

### `GET /v1/me`

当前账户。

- 鉴权：需要
- 成功：`200`，返回 [`UserOut`](#userout)。

| HTTP | code | 情形 |
| --- | --- | --- |
| 404 | `NOT_FOUND` | 账户已删除，但访问令牌还没过期 |

### `DELETE /v1/me`

删除账户和全部数据，需要再输一次密码。删除是同步完成的，涉及的数据见 [数据模型的“删除与清理”](../data-model/README.md#删除与清理)。

- 鉴权：需要
- 请求体：[`DeleteAccountIn`](#deleteaccountin)
- 成功：`204`，没有响应体。

| HTTP | code | 情形 |
| --- | --- | --- |
| 403 | `INVALID_CREDENTIALS` | 密码不对 |
| 404 | `NOT_FOUND` | 账户已经不存在 |

#### `DeleteAccountIn`

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `password` | string | 是 | 当前密码 |

### `POST /v1/me/password`

修改密码，需要输入当前密码。其他设备上的登录都退出，这台设备换一组新令牌（客户端要换上响应里的令牌）。

- 鉴权：需要；按用户限流（每分钟 5 次）。
- 请求头：`X-Auth-Mode: cookie` 时新的刷新令牌放进 Cookie。
- 请求体：[`ChangePasswordIn`](#changepasswordin)
- 成功：`200`，返回 [`AuthOut`](#authout)。

| HTTP | code | 情形 |
| --- | --- | --- |
| 403 | `INVALID_CREDENTIALS` | 当前密码不对 |
| 403 | `CROSS_SITE` | Cookie 模式下，请求来自别的网站 |
| 404 | `NOT_FOUND` | 账户已经不存在 |
| 422 | `VALIDATION_ERROR` | 新密码长度不在 8 到 128 之间（`field: "new_password"`）；`X-Auth-Mode` 不是 `cookie` |
| 429 | `RATE_LIMITED` | 每分钟超过 5 次 |

#### `ChangePasswordIn`

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `current_password` | string | 是 | 当前密码 |
| `new_password` | string | 是 | 新密码，8 到 128 个字符 |

## 响应对象

### `UserOut`

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | string | 用户 ID |
| `email` | string | 注册时填的邮箱（保留大小写） |
| `display_name` | string | 昵称，可能是空串 |
| `locale` | string | 注册时的界面语言（`zh`、`en`、`ja`），服务端发邮件用；界面语言仍然是设备上的设置，见 [i18n.md](../i18n.md) |
| `created_at` | string（时间） | 注册时间 |
| `email_verified` | boolean | 邮箱是否验证过。不要求验证邮箱的部署里注册即为 `true` |

### `AuthOut`

验证邮箱、登录、刷新、找回密码、修改密码的响应。

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `user` | [`UserOut`](#userout) | 当前用户 |
| `access_token` | string | 访问令牌，放进 `Authorization: Bearer …` |
| `token_type` | string | 固定为 `Bearer` |
| `expires_in` | integer | 访问令牌还有多少秒过期（默认 900） |
| `refresh_token` | string 或 null | 刷新令牌（`rt_…`）。只在这里出现，客户端要安全保存（例如放进 Keychain）。Cookie 模式下是 `null`，令牌在 `Set-Cookie` 里 |
| `refresh_expires_at` | string（时间） | 刷新令牌的过期时间 |

### `RegisterOut`

注册的响应。不要求验证邮箱时和 [`AuthOut`](#authout) 一样（多一个 `verification_required: false`）；
要求验证邮箱时还没登录，令牌字段都是 `null`。

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `user` | [`UserOut`](#userout) | 新建的用户 |
| `verification_required` | boolean | 要不要先验证邮箱：`true` 时客户端去验证页，验证码已经发出 |
| `access_token` | string 或 null | 访问令牌；要验证邮箱时是 `null` |
| `token_type` | string | 固定为 `Bearer` |
| `expires_in` | integer 或 null | 访问令牌还有多少秒过期 |
| `refresh_token` | string 或 null | 刷新令牌；Cookie 模式、要验证邮箱时是 `null` |
| `refresh_expires_at` | string（时间）或 null | 刷新令牌的过期时间 |

