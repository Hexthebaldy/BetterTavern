# 数据模型：模型路由

> 文档索引：[总览](../README.md) · [后端](../backend.md) · [客户端](../client.md) · [测试](../testing.md) · [数据模型](README.md) · [接口](../api/README.md)
>
> 数据模型：[说明与约定](README.md) · [账户与令牌](accounts.md) · [模型路由](models.md) · [剧本库](library.md) · [游玩与回合](story.md) · [世界状态](world.md) · [运行基础设施](infra.md)

玩家配好的模型：一行就是一个能用来写故事的模型，包括服务商、API Key、端点、模型名、上下文窗口和写法设置。其中一行是导演。
对应的接口见 [api/models.md](../api/models.md)。

迁移 `0003` 把原来的 `credentials`（密钥与端点）并进了这张表：之前 Key 存在 `credentials`，`model_routes` 只记“哪个 task 用哪个凭据的哪个模型”，
模型名只存在路由上，换一次导演就要重新选模型。现在一个 Key 用在几个模型上时，每行各存一份密文，换 Key 时可以一起换。

## 表

### `model_routes`

| 列 | 类型 | 可空 | 默认 | 说明 |
| --- | --- | --- | --- | --- |
| `id` | uuid | 否 |  | 主键，由应用生成（加密要把行 ID 绑进附加数据） |
| `user_id` | uuid | 否 |  | → `users.id`，级联删除 |
| `label` | text | 否 | `''` | 显示名，最多 60 字；为空时界面显示模型名 |
| `provider` | text | 否 |  | 服务商：`deepseek`、`huggingface`、`custom_openai`。没有 CHECK，合法值由服务商注册表（`providers/profiles/`）决定，新增厂商不用改表 |
| `base_url` | text | 是 |  | 自定义的接口地址（去掉末尾的 `/`）；为空表示使用服务商的默认地址，`custom_openai` 必须填写。写入前做 SSRF 校验 |
| `api_key_enc` | text | 否 |  | 加密后的 API Key，加密格式见本节末尾 |
| `key_id` | text | 否 |  | 加密 `api_key_enc` 时用的主密钥编号（`MASTER_KEYS` 里的 kid），留给以后的重新加密工具定位用。只改 Key 时 `extra_headers_enc` 不会重新加密，所以它可能还在用旧的 kid |
| `key_last4` | text | 否 | `''` | Key 的后四位，用于显示；Key 短于 8 个字符时为空 |
| `extra_headers_enc` | text | 是 |  | 加密后的自定义请求头（一个 JSON 对象）；没有自定义请求头时为空 |
| `extra_body` | jsonb | 否 | `'{}'` | 合并进每个请求体的自定义字段，明文存储，最大 8 KB，结构见下文“JSON 列” |
| `model` | text | 否 |  | 模型名，原样发给服务商（Hugging Face 可以带 `:fastest`、`:novita` 之类的后缀），最长 200 |
| `listed_window` | integer | 是 |  | 服务商模型列表里这个模型的上下文长度；保存和重新获取列表时写入，列表没给时为空 |
| `manual_window` | integer | 是 |  | 玩家手填的上下文窗口，4096 到 10,000,000；只在列表和能力表都不知道时使用 |
| `learned_window` | integer | 是 |  | 运行中服务商报“上下文超长”并写明上限时记下的值，只会往小改 |
| `params` | jsonb | 否 | `'{}'` | 写法设置：采样参数、深度思考、工作窗口上限，结构见下文“JSON 列” |
| `caps_override` | jsonb | 否 | `'{}'` | 手动覆盖的模型能力，结构见下文“JSON 列” |
| `probe` | jsonb | 否 | `'{}'` | 最近一次“测试这个模型”的结果，结构见下文“JSON 列” |
| `status` | text | 否 | `'unverified'` | `unverified` / `ok` / `invalid`，状态变化见下文“状态” |
| `last_ok_at` | timestamptz | 是 |  | 最近一次确认 Key 可用的时间（获取模型列表或测试成功） |
| `is_director` | boolean | 否 | `false` | 是不是导演。每个用户最多一行为真 |
| `fallback_route_id` | uuid | 是 |  | → `model_routes.id`，被删除时置空。备用模型，只有导演使用：导演在输出第一段文字之前失败，并且错误类别允许切换（限流、繁忙、5xx、超时、连接错误、欠费、无效响应、未知错误）时，改用这一行 |
| `created_at` | timestamptz | 否 | `now()` |  |
| `updated_at` | timestamptz | 否 | `now()` |  |

约束与索引：
- `status` 的 CHECK；三个窗口列的 CHECK（大于 0）。
- `model_routes_user_idx (user_id, created_at)`：列表按添加时间升序排列。
- `model_routes_director_uq (user_id) WHERE is_director`：每个用户最多一个导演。换导演时先把旧的置为假，再把新的置为真（唯一索引逐行检查，不能在一条语句里互换）。

谁用哪一行（`services/route_service.py`）：导演、开局搭建世界（`world_builder`）、补选项（`repair`）都用 `is_director` 为真的那一行。
没有导演时，开局和提交行动返回 409 `ROUTE_MISSING`。

加密方式（`infra/crypto/envelope.py`）：
- 使用 AES-256-GCM 信封加密。每个密文有一个随机生成的数据密钥，数据密钥再用主密钥加密。
- 密文格式是 `v1.{kid}.{base64(nonce + 加密后的数据密钥)}.{base64(nonce + 密文)}`。
- 附加数据（AAD）绑定到具体的行和字段：`route:{id}:api_key`、`route:{id}:headers`。把密文复制到别的行或字段会解密失败；
  复用别的模型的 Key 时，服务端先解密，再用新行的附加数据重新加密。
- 主密钥不存进数据库。主密钥丢了，这两列就解不开了，接口返回 409 `CREDENTIAL_UNREADABLE`。

### 上下文窗口

模型窗口 M 按下面的顺序取第一个有值的（`services/route_codec.py`）：

1. `listed_window`：服务商的模型列表给的。最可信，因为这是对方实际部署的上限（不少推理服务为了省显存只开 32K）。
   Hugging Face 的列表里一个模型有几家后端、各自的窗口不同：模型名带了后端后缀（`:novita`）就用那一家的，没带或用的是 `:fastest`、`:cheapest`、`:preferred` 时取各家里最小的。
2. 内置能力表（`providers/capabilities.yaml`）里这个模型的 `context_window`，例如 DeepSeek。
3. `manual_window`：玩家手填的。
4. 都没有时按 32768 估计。

然后，`learned_window` 比上面得到的值小时，以 `learned_window` 为准。接口在 [`WindowOut`](../api/models.md#windowout) 的 `source` 里说明用的是哪一个。

有效窗口 W = min(M, `working_window`) − `max_tokens` − 2% × min(M, `working_window`)，向下取整。W 小于 16000 时，保存返回 422 `WINDOW_TOO_SMALL`。

## JSON 列

### `model_routes.params`

```json
{ "temperature": 0.9, "top_p": 0.95, "max_tokens": 4096, "thinking": false, "working_window": 128000 }
```

只保存设置过的键，`thinking` 总会保存。导演使用全部参数；WorldBuilder 使用 `max_tokens`、`temperature`、`thinking`，不发送 `top_p`；
补选项（`repair`）只使用 `max_tokens`，温度固定为 0.7，思考固定关闭。取值范围和默认值（`domain/routing.py`）：

| 键 | 范围 | 不设置时 |
| --- | --- | --- |
| `temperature` | 0 到 2 | `director` 0.9，`world_builder`、`repair` 0.7 |
| `top_p` | 大于 0，不超过 1 | 服务商的默认值 |
| `max_tokens` | 64 到 65536 | 按 task：`director` 4096，`world_builder` 8192，`repair` 256 |
| `thinking` | true / false | false（默认关闭思考，首 token 更快） |
| `working_window` | 4096 到 10,000,000 | 128000 |

### `model_routes.caps_override`

覆盖模型能力，只允许下面这些键（`providers/capabilities.py` 的 `Capabilities.from_mapping`），有未知键时保存会返回 422。
上下文窗口不在这里设置（用 `manual_window`），写了 `context_window` 也返回 422。

```jsonc
{
  "max_output": 8192,
  "structured": ["json_schema", "tool_call", "json_object"],  // 可以使用的结构化输出方式
  "reasoning": { "control": "thinking_toggle", "efforts": [], "field": "reasoning_content" },  // control：none / thinking_toggle / effort
  "sampling": { "temperature": true, "top_p": true, "temperature_when_thinking": true },
  "roles": { "system": true, "alternation": "loose" },  // alternation：loose / strict
  "stream_usage": true,
  "echo_reasoning_with_tools": false
}
```

模型能力的计算顺序是：能力表 < `probe.caps` < `caps_override`，后面的覆盖前面的；窗口按上一节的顺序单独计算。

### `model_routes.probe`

```jsonc
{
  "report": {                              // 与接口返回的 ProbeOut 相同
    "provider": "deepseek", "model": "deepseek-chat", "probed_at": "2026-10-14T08:00:00+00:00",
    "fatal_error": null,                   // 例如 "auth: Invalid API key"：冒号前是错误类别
    "checks": [{ "name": "stream", "ok": true, "detail": "收到文字", "latency_ms": 420 }],
    "caps_overlay": { "structured": ["json_object", "tool_call"], "stream_usage": true }
  },
  "caps": { "structured": ["json_object", "tool_call"], "stream_usage": true }  // 叠加到能力表上的测试结果
}
```

没测试过时是 `{}`。换了 Key、端点或模型名时清空。

### `model_routes.extra_body`

任意 JSON 对象，最大 8 KB。它会递归合并进发给服务商的请求体；值为 `null` 表示删掉这个键；`messages`、`stream`、`stream_options` 不能被覆盖。

自定义请求头（加密在 `extra_headers_enc` 里）最多 20 个。`Authorization`、`Host`、`Content-Length`、`Transfer-Encoding`、`Connection`、`Cookie` 不能自定义，值不能含换行。

## 状态

`model_routes.status` 表示这一行的 Key 能不能用：

| 事件 | 结果 |
| --- | --- |
| 添加时顺便拉到了模型列表（用表单刚拉过的缓存，或者当场拉一次） | `ok`，写入 `last_ok_at` |
| 添加时没拉到列表（服务商出错或超过 15 秒） | `unverified` |
| 修改了 Key、端点或模型名 | `unverified`，同时清空 `probe`；改了端点或模型名还会清空 `listed_window`、`learned_window`，再按上一行的规则重新拉列表 |
| 测试完成，没有致命错误 | `ok`，写入 `last_ok_at` |
| 测试的致命错误是 `auth` 类 | `invalid` |
| 测试的致命错误是其他类别（模型不存在、网络等） | 不变 |
| 获取模型列表成功 | `ok`，写入 `last_ok_at` |
| 获取模型列表时服务商拒绝了 Key | `invalid` |
| 换 Key 时选了“同时更新用同一个 Key 的其他模型” | 那些行和这一行一样变化 |
