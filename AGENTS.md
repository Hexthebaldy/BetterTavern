# 仓库约定（给编码 agent 与贡献者）

设计文档在 `docs/`，改动前先读对应的那一份。下面是写代码时要守住的约定。

## 分层（`apps/server/importlinter.ini` 在 CI 里强制）

- 依赖方向：`api` → `services` → `runtime` → `domain`；反过来禁止。
- `domain` 只用标准库和 pydantic，能脱离 FastAPI 和数据库单测。
- `providers` 不 import 本项目的其他包；只有 `runtime` 和 `services` 可以用它。
- `infra` 是叶子：可以 import `domain`，不能 import `runtime`、`services`、`api`。
- `importers` 把外部格式（角色卡等）翻译成 `domain` 的数据：本项目里只 import `domain`。
- `runtime` 不直接访问数据库，通过 `runtime/ports.py` 的接口读写。

## 代码

- 提示词是数据文件：放在 `runtime/prompts/<lang>/*.j2`，Python 里不写超过一行的提示词字符串。每种语言（中文、英文、日文）一套文件，一一对应，改一套就改其他几套；拼进模型上下文的固定文字（标签、字段说明）也放在这些目录里（见 `docs/i18n.md`）。
- 模板渲染必须确定性：不调用时间和随机函数（前缀缓存和重放测试依赖这一点）。
- 注入上下文的用户文本（玩家输入、角色卡、实体文字）一律先过 `sanitize_for_fence()`。
- 一个 agent 一个文件，agent 之间不互相 import。
- 单个文件超过约 600 行就拆成门面加同级文件。
- 所有后台提交先做带条件的 UPDATE（版本围栏），再写其他表。
- 日志不写故事文本和密钥。

## 测试

- 测行为，不测实现文本；测试不读取源码文件内容。
- 数据库不 mock：队列、版本围栏、回退用真实 Postgres（`pytest -m integration`）。
- 对外部模型的测试用 `tests/fakes/llm_server.py` 的假服务，可以注入 429、断流、坏标签、慢首 token。
- 客户端的纯逻辑（SSE 解析、重连、状态机）用 `node --test` 测，不依赖 RN。

## 文档与中文

- 界面文字一律走 i18n：写进 `packages/core/src/i18n/` 的中文资源（源语言）和英文资源，组件里用 `t()`；`make lint` 里的 `scripts/check-i18n.mjs` 会拦住写死的中文。例外是落地页 `apps/site`：只有中文，文案直接写在组件里，不在检查范围内（见 `docs/i18n.md` 第 1 节）。
- 服务端返回的说明（错误的 `title`、回合失败的 `message`、探针结果）一律英文，不做多语言；客户端按错误码翻译。
- 面向用户和协作者的文字用中文；标识符、提交信息的类型前缀用英文。
- 改了接口、事件或约定，同一个 PR 里更新 `docs/`。两个参考文档目录必须和代码保持一致：
  - 改表结构（加迁移）时更新 `docs/data-model/` 里对应领域的文件：列、类型、可空、默认值、约束与索引、JSON 结构、状态机；跨领域的关系和删除规则在 `docs/data-model/README.md`；
  - 改接口的路径或方法、请求或响应字段、状态码、参数时更新 `docs/api/` 里对应领域的文件，SSE 事件在 `docs/api/events.md`，错误码在 `docs/api/README.md`；
  - 两个目录都按领域分文件，新领域新建文件，并登记在目录的 README.md 里；
  - `tests/unit/api/test_api_doc.py`、`tests/integration/test_data_model_doc.py` 会对照 OpenAPI 和真实表结构检查这两个目录（它们读的是文档，不是源码），格式要求见两个目录的 README.md 最后一节。
