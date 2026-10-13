# 评测

## director_compliance：导演输出协议合规率（M0 的 go / no-go）

在真实模型上连续跑 N 个回合（默认 200），每回合把导演的流式输出交给 `DirectorStreamParser`，
再走修复阶梯（选项不足时调用一次 OptionsRepair，仍失败用默认选项），统计：

| 指标 | 含义 |
| --- | --- |
| 无需修复的合规率 | 解析阶段完全合规（ok）的回合占比，出口标准 ≥ 95% |
| 含修复的合规率 | ok + 解析器抢救（salvaged）+ OptionsRepair 补齐（repaired）的占比，出口标准 ≥ 99.5% |
| fallback / failed | 用了默认选项、没有叙述或请求失败的回合 |
| 首 token 延迟 | p50 / p95，毫秒 |
| 前缀缓存命中率 | DeepSeek 等返回缓存命中数的厂商才有 |

```bash
DEEPSEEK_API_KEY=sk-... uv run python -m evals.director_compliance --provider deepseek --model deepseek-flash
uv run python -m evals.director_compliance --help
```

剧本在 `datasets/m0/tavern.yaml`（合成数据）；报告写到 `reports/`（不入库）。每次评测都会记录提示词模板的版本，
改了提示词之后用同样的参数再跑一次，对比两份报告。

离线冒烟测试 `tests/e2e/test_director_eval_offline.py` 用假 LLM 服务把整条链路跑通，不需要密钥。
