# 接口：认证与账户

> 文档索引：[总览](../README.md) · [后端](../backend.md) · [客户端](../client.md) · [测试](../testing.md) · [数据模型](../data-model/README.md) · [接口](README.md)
>
> 接口：[说明与约定](README.md) · [认证与账户](auth.md) · [模型路由](models.md) · [剧本库](library.md) · [游玩与回合](play.md) · [回合事件流](events.md) · [运维与开发](ops.md)

注册、登录、令牌刷新与退出，以及当前账户。鉴权方式和令牌的规则见 [README.md 的“鉴权”](README.md#鉴权)；
相关的表见 [数据模型：账户与令牌](../data-model/accounts.md)。

## 两种登录方式

注册、登录、刷新、退出这四个接口都有两种用法，由请求头 `X-Auth-Mode` 决定：

- **请求体模式**（不带这个请求头，手机 App）：刷新令牌在响应体的 `refresh_token` 里，客户端自己保存（例如放进 Keychain）；
  刷新和退出时放在请求体里发回来。
- **Cookie 模式**（`X-Auth-Mode: cookie`，网页）：刷新令牌不进响应体（`refresh_token` 是 `null`），只在响应头里设置成 Cookie，
  页面脚本读不到它；刷新和退出不带请求体，凭浏览器自动带上的 Cookie。访问令牌两种模式一样，在响应体里，网页只放在内存中。

Cookie 的样子：

```
Set-Cookie: bt_refresh=rt_…; HttpOnly; Max-Age=2591999; Path=/v1/auth; SameSite=strict; Secure
```

- `Path=/v1/auth`：只发往这四个接口，其他请求不带；`Max-Age` 是刷新令牌剩下的秒数，每次刷新随新令牌更新。
- `Secure` 由 `AUTH_COOKIE_SECURE` 决定，不设置时开发环境（`ENV=dev`）不带（Safari 在 http://localhost 上不保存带 Secure 的 Cookie），其他环境带。
- 退出、刷新被拒（401）时，响应里带一个 `Max-Age=0` 的同名 Cookie，让浏览器删掉它。
- 防跨站：Cookie 是 `SameSite=strict`；`X-Auth-Mode` 是自定义请求头，跨域请求要先过 CORS 预检；
  浏览器带的 `Sec-Fetch-Site` 不是 `same-origin`（或 `none`）时，`Origin` 必须在 `CORS_ORIGINS` 里，否则返回 403 `CROSS_SITE`。
  网页和接口同源部署（同一个域名，`/v1` 由反向代理转给 api）时什么都不用配。

## 接口

### `POST /v1/auth/register`

注册新账户，并且直接登录。

- 鉴权：不需要；按 IP 限流。
- 请求头：`X-Auth-Mode: cookie` 时刷新令牌放进 Cookie（见上文“两种登录方式”）。
- 请求体：[`RegisterIn`](#registerin)
- 成功：`201`，返回 [`AuthOut`](#authout)。

| HTTP | code | 情形 |
| --- | --- | --- |
| 422 | `VALIDATION_ERROR` | 邮箱格式不对（`field: "email"`）；密码长度不在 8 到 128 之间（`field: "password"`）；字段超过 `RegisterIn` 的长度限制（带 `errors`）；`X-Auth-Mode` 不是 `cookie`（`field: "X-Auth-Mode"`） |
| 403 | `CROSS_SITE` | Cookie 模式下，请求来自别的网站 |
| 409 | `EMAIL_TAKEN` | 邮箱已经注册过（不区分大小写，忽略首尾空白） |
| 429 | `RATE_LIMITED` | 同一个 IP 每分钟注册超过 5 次 |

#### `RegisterIn`

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `email` | string | 是 | 邮箱，最长 254 个字符，格式为 `名字@域名.后缀` |
| `password` | string | 是 | 8 到 128 个字符（请求模型的上限是 1024，超过 128 的由业务校验拒绝） |
| `display_name` | string | 否 | 昵称，最多 40 个字符，默认空串 |

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

## 响应对象

### `UserOut`

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | string | 用户 ID |
| `email` | string | 注册时填的邮箱（保留大小写） |
| `display_name` | string | 昵称，可能是空串 |
| `locale` | string | 界面语言；M1 固定为 `zh` |
| `created_at` | string（时间） | 注册时间 |

### `AuthOut`

注册、登录、刷新的响应。

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `user` | [`UserOut`](#userout) | 当前用户 |
| `access_token` | string | 访问令牌，放进 `Authorization: Bearer …` |
| `token_type` | string | 固定为 `Bearer` |
| `expires_in` | integer | 访问令牌还有多少秒过期（默认 900） |
| `refresh_token` | string 或 null | 刷新令牌（`rt_…`）。只在这里出现，客户端要安全保存（例如放进 Keychain）。Cookie 模式下是 `null`，令牌在 `Set-Cookie` 里 |
| `refresh_expires_at` | string（时间） | 刷新令牌的过期时间 |
