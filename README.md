# BetterTavern

服务端生成式互动小说：玩家以第一人称推进剧情，每轮在两个选项里选一个（或自由输入），世界状态由后台 agent 自动维护。
后端是 Python + FastAPI + LangGraph 的 agent runtime，客户端是 React Native（Expo）。用户自带模型 API Key，
v1 适配 DeepSeek、Hugging Face 和自定义的 OpenAI 兼容端点。

设计文档在 [docs/](docs/README.md)：[后端](docs/backend.md)、[客户端](docs/client.md)、[测试](docs/testing.md)。

## 当前进度：M0 探针

M0 先验掉三件最不确定的事，再决定是否进入 M1：

| 探针 | 代码 | 怎么跑 |
| --- | --- | --- |
| RN 真机上的 SSE（长流、中文、断网续传、延迟） | 服务端 `api/probe_app.py`，客户端 `apps/mobile` | 见 [apps/mobile/README.md](apps/mobile/README.md) |
| 两家厂商加自定义端点的协议差异 | `apps/server/src/bettertavern/providers/` | 单测覆盖；真实厂商用下面的合规率评测 |
| 导演输出协议的遵守率（go / no-go） | `apps/server/evals/director_compliance.py` | 见下文“合规率评测” |
| Postgres 车道队列原型 | `apps/server/src/bettertavern/infra/queue/` | `make test-integration` |

## 本地开发

需要：Python 3.12+ 和 [uv](https://docs.astral.sh/uv/)、Docker（跑 Postgres）、Node 22.18+。

```bash
cp apps/server/.env.example apps/server/.env
cp apps/mobile/.env.example apps/mobile/.env   # 改成电脑的局域网 IP
make db-up          # docker compose 起一个 Postgres
make install        # uv sync，装后端依赖
make migrate        # 建表
make dev            # 启动 api，http://localhost:8000/docs
make worker         # 另开一个终端，启动 worker
```

第一次 `make install` 会生成 `apps/server/uv.lock`。请提交它，并按锁文件把 `pyproject.toml` 里的直接依赖改成精确版本
（项目约定直接依赖精确锁定；初版 pyproject 只写了下限，因为生成它的环境访问不到 PyPI）。

## 测试

```bash
make test               # 后端单测与端到端测试（不需要数据库）
make test-integration   # 需要 make db-up；会建临时 schema，测完删除
make lint               # ruff、pyright、import-linter
make mobile-test        # 客户端的 SSE 解析与重连测试
```

## 合规率评测（M0 的 go / no-go）

在真实模型上跑 200 回合，统计导演输出协议的合规率。出口标准：无需修复不低于 95%，含修复不低于 99.5%。

```bash
cd apps/server
DEEPSEEK_API_KEY=sk-... uv run python -m evals.director_compliance --provider deepseek --model deepseek-flash
HF_TOKEN=hf_... uv run python -m evals.director_compliance --provider huggingface --model <org/model>:fastest
```

报告写在 `apps/server/evals/reports/`（不入库）。至少用 3 个模型各跑一次。

## 目录

```
apps/server     后端：FastAPI、agent runtime、provider 层、队列、迁移、测试、评测
apps/mobile     客户端：Expo + TypeScript
deploy          docker compose 与镜像
docs            设计文档
```

## 许可证

待定（MIT 或 Apache-2.0），发布前确定。
