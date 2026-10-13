# 仓库约定（给编码 agent 与贡献者）

设计文档在 `docs/`，改动前先读对应的那一份。下面是写代码时要守住的约定。

## 分层（`apps/server/importlinter.ini` 在 CI 里强制）

- 依赖方向：`api` → `services` → `runtime` → `domain`；反过来禁止。
- `domain` 只用标准库和 pydantic，能脱离 FastAPI、数据库、LangGraph 单测。
- `providers` 不 import 本项目的其他包；只有 `runtime` 和 `services` 可以用它。
- `infra` 是叶子：可以 import `domain`，不能 import `runtime`、`services`、`api`。
- `runtime` 不直接访问数据库，通过 `runtime/ports.py` 的接口读写。

## 代码

- 提示词是数据文件：放在 `runtime/prompts/<lang>/*.j2`，Python 里不写超过一行的提示词字符串。
- 模板渲染必须确定性：不调用时间和随机函数（前缀缓存和回放测试依赖这一点）。
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

- 面向用户和协作者的文字用中文；标识符、提交信息的类型前缀用英文。
- 改了接口、事件或约定，同一个 PR 里更新 `docs/`。
