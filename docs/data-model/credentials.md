# 数据模型：凭据与模型路由

> 文档索引：[总览](../README.md) · [后端](../backend.md) · [客户端](../client.md) · [测试](../testing.md) · [数据模型](README.md) · [接口](../api/README.md)
>
> 数据模型：[说明与约定](README.md) · [账户与令牌](accounts.md) · [凭据与模型路由](credentials.md) · [剧本库](library.md) · [游玩与回合](story.md) · [世界状态](world.md) · [运行基础设施](infra.md)

玩家自己的模型密钥与端点，以及每个 agent 槽位用哪个模型。对应的接口见 [api/credentials.md](../api/credentials.md)。

## 表

### `credentials`

玩家自己提供的模型密钥与端点。

| 列 | 类型 | 可空 | 默认 | 说明 |
| --- | --- | --- | --- | --- |
| `id` | uuid | 否 |  | 主键，由应用生成 |
| `user_id` | uuid | 否 |  | → `users.id`，级联删除 |
| `provider` | text | 否 |  | 服务商：`deepseek`、`huggingface`、`custom_openai`。这一列没有 CHECK，合法值由服务商注册表（`providers/profiles/`）决定，新增厂商不用改表 |
| `label` | text | 否 |  | 显示名，最多 60 字；不填时用服务商的名字 |
| `base_url` | text | 是 |  | 自定义的接口地址（去掉末尾的 `/`）；为空表示使用服务商的默认地址，`custom_openai` 必须填写。写入前做 SSRF 校验 |
| `api_key_enc` | text | 否 |  | 加密后的 API Key，加密格式见本节末尾 |
| `key_id` | text | 否 |  | 加密 `api_key_enc` 时用的主密钥编号（`MASTER_KEYS` 里的 kid），留给以后的重新加密工具定位用（还没有这个工具）。只改 Key 时 `extra_headers_enc` 不会重新加密，所以它可能还在用旧的 kid |
| `key_last4` | text | 否 | `''` | Key 的后四位，用于显示；Key 短于 8 个字符时为空 |
| `extra_headers_enc` | text | 是 |  | 加密后的自定义请求头（一个 JSON 对象）；没有自定义请求头时为空 |
| `extra_body` | jsonb | 否 | `'{}'` | 合并进每个请求体的自定义字段，明文存储，最大 8 KB，结构见下文“JSON 列” |
| `probed` | jsonb | 否 | `'{}'` | 能力探测和模型列表的结果，结构见下文“JSON 列” |
| `status` | text | 否 | `'unverified'` | `unverified` / `ok` / `invalid`，状态变化见下文“状态” |
| `last_ok_at` | timestamptz | 是 |  | 最近一次探测或获取模型列表成功的时间 |
| `created_at` | timestamptz | 否 | `now()` |  |
| `updated_at` | timestamptz | 否 | `now()` |  |

约束与索引：`status` 的 CHECK；`credentials_user_idx (user_id, created_at)`，凭据列表按创建时间升序排列。

加密方式（`infra/crypto/envelope.py`）：
- 使用 AES-256-GCM 信封加密。每个密文有一个随机生成的数据密钥，数据密钥再用主密钥加密。
- 密文格式是 `v1.{kid}.{base64(nonce + 加密后的数据密钥)}.{base64(nonce + 密文)}`。
- 附加数据（AAD）绑定到具体的行和字段：`credential:{id}:api_key`、`credential:{id}:headers`。把密文复制到别的行或字段会解密失败。
- 主密钥不存进数据库。主密钥丢了，这两列就解不开了，接口返回 409 `CREDENTIAL_UNREADABLE`。

修改了 Key 或接口地址时，`status` 重置为 `unverified`、`probed` 清空，因为之前的探测结果已经不可信。

### `model_routes`

模型路由：每个 agent 槽位（task）用哪个凭据的哪个模型，以及采样参数。

| 列 | 类型 | 可空 | 默认 | 说明 |
| --- | --- | --- | --- | --- |
| `id` | uuid | 否 | `gen_random_uuid()` | 主键 |
| `user_id` | uuid | 否 |  | → `users.id`，级联删除 |
| `playthrough_id` | uuid | 是 |  | → `playthroughs.id`，级联删除。为空是用户级路由，不为空是对单局的覆盖。M1 还没有写入单局覆盖的接口，但解析路由时已经支持 |
| `task` | text | 否 |  | `director` / `state_keeper` / `outline` / `compactor` / `gate` / `world_builder` / `repair` |
| `credential_id` | uuid | 否 |  | → `credentials.id`，**级联删除**：删除凭据会一并删除用到它的路由 |
| `model` | text | 否 |  | 模型名，原样发给服务商（Hugging Face 可以带 `:fastest` 之类的后缀），最长 200 |
| `params` | jsonb | 否 | `'{}'` | 采样参数和工作窗口上限，结构见下文“JSON 列” |
| `caps_override` | jsonb | 否 | `'{}'` | 玩家手动覆盖的模型能力，结构见下文“JSON 列” |
| `fallback_route_id` | uuid | 是 |  | → `model_routes.id`，被删除时置空。备用路由，只有导演使用：导演在输出第一段文字之前失败，并且错误类别允许切换（限流、繁忙、5xx、超时、连接错误、欠费、无效响应、未知错误）时，改用这条路由。WorldBuilder 和补选项不使用它 |
| `created_at` | timestamptz | 否 | `now()` |  |
| `updated_at` | timestamptz | 否 | `now()` |  |

约束与索引：
- `model_routes_user_task_uq (user_id, task) WHERE playthrough_id IS NULL`：每个用户的每个 task 只有一条用户级路由，`PUT` 时用 `ON CONFLICT` 覆盖。
- `model_routes_pt_task_uq (playthrough_id, task) WHERE playthrough_id IS NOT NULL`：每局的每个 task 最多一条覆盖。
- `task` 的 CHECK。

解析顺序（`services/route_service.py`）：本局对这个 task 的覆盖 → 用户对这个 task 的路由 → 本局对 `director` 的覆盖 → 用户的 `director` 路由。也就是说，没有单独配置的 task 都用导演的路由。
凭据被删除后路由也跟着消失，之后开局或提交行动会返回 409 `ROUTE_MISSING`。

## JSON 列

### `credentials.probed`

```jsonc
{
  "models": {                              // 每个测试过的模型一项，POST /credentials/{id}/probe 写入
    "deepseek-chat": {
      "report": {                          // 探测报告，与接口返回的 ProbeOut 相同
        "provider": "deepseek", "model": "deepseek-chat", "probed_at": "2026-10-14T08:00:00+00:00",
        "fatal_error": null,               // 例如 "auth: Invalid API key"：冒号前是错误类别
        "checks": [{ "name": "stream", "ok": true, "detail": "收到文字", "latency_ms": 420 }],
        "caps_overlay": { "structured": ["json_object", "tool_call"], "stream_usage": true }
      },
      "caps": { "structured": ["json_object", "tool_call"], "stream_usage": true }  // 叠加到能力表上的探测结果
    }
  },
  "listed": {                              // GET /credentials/{id}/models 写入
    "at": "2026-10-14T08:00:00+00:00",
    "windows": { "Qwen/Qwen3-235B-A22B": 131072 }  // 模型列表里带了上下文长度的模型（Hugging Face 有）
  }
}
```

模型能力的计算顺序是：能力表（`providers/capabilities.yaml`）< `listed.windows` 与 `models[*].caps` < 路由的 `caps_override`，后面的覆盖前面的。

### `credentials.extra_body`

任意 JSON 对象，最大 8 KB。它会递归合并进发给服务商的请求体；值为 `null` 表示删掉这个键；`messages`、`stream`、`stream_options` 不能被覆盖。

自定义请求头（加密在 `extra_headers_enc` 里）最多 20 个。`Authorization`、`Host`、`Content-Length`、`Transfer-Encoding`、`Connection`、`Cookie` 不能自定义，值不能含换行。

### `model_routes.params`

```json
{ "temperature": 0.9, "top_p": 0.95, "max_tokens": 4096, "thinking": false, "working_window": 128000 }
```

只保存设置过的键，`thinking` 总会保存。导演使用全部参数；WorldBuilder 使用 `max_tokens`、`temperature`、`thinking`，不发送 `top_p`；
补选项（`repair`）只使用 `max_tokens`，温度固定为 0.7，思考固定关闭。取值范围和默认值（`domain/routing.py`）：

| 键 | 范围 | 不设置时 |
| --- | --- | --- |
| `temperature` | 0 到 2 | `director` 0.9，`world_builder`、`repair` 0.7，其他 task 用服务商的默认值 |
| `top_p` | 大于 0，不超过 1 | 服务商的默认值 |
| `max_tokens` | 64 到 65536 | 按 task：`director` 4096，`state_keeper` 2048，`outline` 4096，`compactor` 8192，`gate` 512，`world_builder` 8192，`repair` 256 |
| `thinking` | true / false | false（所有 task 默认关闭思考，首 token 更快） |
| `working_window` | 4096 到 10,000,000 | 128000 |

有效窗口 W = min(模型窗口, `working_window`) − `max_tokens` − 2% × min(模型窗口, `working_window`)，向下取整。
模型窗口取能力里的 `context_window`，能力表和探测都没有给出时按 32768 算。W 小于 16000 时，保存路由会返回 422 `WINDOW_TOO_SMALL`。

### `model_routes.caps_override`

覆盖模型能力，只允许下面这些键（`providers/capabilities.py` 的 `Capabilities.from_mapping`），有未知键时保存会返回 422：

```jsonc
{
  "context_window": 131072,
  "max_output": 8192,
  "structured": ["json_schema", "tool_call", "json_object"],  // 可以使用的结构化输出方式
  "reasoning": { "control": "thinking_toggle", "efforts": [], "field": "reasoning_content" },  // control：none / thinking_toggle / effort
  "sampling": { "temperature": true, "top_p": true, "temperature_when_thinking": true },
  "roles": { "system": true, "alternation": "loose" },  // alternation：loose / strict
  "stream_usage": true,
  "echo_reasoning_with_tools": false
}
```

## 状态

`credentials.status`：

| 事件 | 结果 |
| --- | --- |
| 创建，或修改了 Key、接口地址 | `unverified`，同时清空 `probed` |
| 探测完成，没有致命错误 | `ok`，写入 `last_ok_at` |
| 探测的致命错误是 `auth` 类 | `invalid` |
| 探测的致命错误是其他类别（模型不存在、网络等） | 不变 |
| 获取模型列表成功 | `ok`，写入 `last_ok_at` |
| 获取模型列表时服务商拒绝了密钥 | `invalid` |
