# 评测

## director_compliance：导演输出协议合规率（M0 的 go / no-go）

在真实模型上连续跑 N 个回合（默认 200），每回合把导演的流式输出交给 `DirectorStreamParser`，
再走修复阶梯（选项不足时调用 OptionsRepair 补，失败再试一次，仍补不齐就这一回合不给选项），统计：

| 指标 | 含义 |
| --- | --- |
| 无需修复的合规率 | 解析阶段完全合规（ok）的回合占比，出口标准 ≥ 95% |
| 含修复的合规率 | ok + 解析器抢救（salvaged）+ OptionsRepair 补齐（repaired）的占比，出口标准 ≥ 99.5% |
| missing / failed | 补了两次也没补齐选项（这一回合没有选项，玩家自己写）、没有叙述或请求失败的回合 |
| 首 token 延迟 | p50 / p95，毫秒 |
| 前缀缓存命中率 | DeepSeek 等返回缓存命中数的厂商才有 |

```bash
DEEPSEEK_API_KEY=sk-... uv run python -m evals.director_compliance --provider deepseek --model deepseek-flash
uv run python -m evals.director_compliance --help
```

剧本在 `datasets/m0/tavern.yaml`（合成数据，中文）；日文提示词用 `--scenario evals/datasets/m0/ryokan_ja.yaml`，剧本里的 `language` 决定提示词的语言。报告写到 `reports/`（不入库）。每次评测都会记录提示词模板的版本，
改了提示词之后用同样的参数再跑一次，对比两份报告。

离线冒烟测试 `tests/e2e/test_director_eval_offline.py` 用假 LLM 服务把整条链路跑通，不需要密钥。

## playtest：剧本试玩（agent runtime 阶段 2 到 4）

跑之前要做什么、剧本和题目怎么写、历次试玩的结果和花费，见 [docs/evals.md](../../../docs/evals.md)。

用一份写好的剧本代替玩家，用真模型把一局玩 N 回合（默认 100），走服务端的整套流程：开局搭世界、导演写叙述和选项、回合存好后放进任务队列，
由脚本里带的后台进程（和 worker 一样从队列领任务）整理世界状态。跑完等世界状态追上，然后分析。

总结页第一行是结论：下面任何一条不满足就判为**不合格**，并写明是哪几条：
导演自己给出选项的回合不到 95%（和 M0 的标准一样）；检查点没全过；有回合出现了一致性问题；世界状态没整理到最后一回合。

| 指标 | 含义 |
| --- | --- |
| 导演自己给出选项 | 不算结局那一轮，导演自己写出两个选项的回合占多少；补出来的、没补齐的都不算 |
| 检查点 | 剧本里写明“整理完第几回合以后，世界应该是什么样”，逐条判断；没过的写明当时实际记成了什么。种类有：已退场、还在、在谁手里、不在谁手里、在某地、不在某地、两人在一处、两人不在一处、在场、不在场、已退场或不在场、有包含这些字的事实（`playtest_checks.py`）。人和物按名字或别名找，名字里包含所写的字就算对上 |
| 流水账和一次性实体 | 有效事实里以主角名字开头的有几条（多半是记动作经过的流水账）；只出现过一回合的人物和地点各有几个；被推翻的事实有几条 |
| 一致性 | 用撤销记录倒推出每一回合整理完时的世界，逐回合检查一致性规则（`domain/world/invariants.py`）；正常应该一个问题都没有 |
| 退场后又被写到 | 已经退场（死去、永久离开）的人和物，后来又出现在叙述里的地方；可能是回忆，要人工看一眼 |
| 落后 | 导演写某一回合时，世界状态落后几回合：最多、平均、分布 |
| 世界状态 agent | 成功、失败、作废的次数和原因，跳过的回合，每回合调几次模型、改几行，被拒绝的修改（按工具和原因），耗时 |
| 用量 | 导演和世界状态 agent 各自的输入、缓存命中、输出 token；导演的首字等待 |
| 召回 | 提供了召回工具的回合有几个、用了工具的占多少、用了几轮的分布、各工具调用次数；用了工具和没用的回合各自的首字等待中位数 |
| 召回题 | 剧本里 `recall` 写的题：玩家早先说出一个细节，后面再问，那一回合的叙述里要出现指定的词；列出每题对错、导演那一回合用了几轮工具、命中处附近的原文。只看结果，不计入结论 |
| 线索 | 最终世界里的线索，按种类和状态（没解开、已解开、已合并）计数；写了答案的条数；挂了超过 50 回合还没解开的线索 |
| 章节整理 | 写了几章、几版全书梗概，失败的原因，每章耗时和用量；导演的上下文长度按 50 回合一段看（估算 token 的平均和最大、服务商算的平均输入、缓存命中），章节整理跟得上时应该稳定 |

```bash
DEEPSEEK_API_KEY=sk-... uv run python -m evals.playtest --provider deepseek --model deepseek-flash
# 300 回合（阶段 4 的验收）：
DEEPSEEK_API_KEY=sk-... uv run python -m evals.playtest --provider deepseek --model deepseek-flash \
    --scenario evals/datasets/m2/tavern_300.yaml --turns 300
# 后台整理用另一个模型：
DEEPSEEK_API_KEY=sk-... GEMINI_API_KEY=... uv run python -m evals.playtest \
    --provider deepseek --model deepseek-flash --state-provider gemini --state-model gemini-3-flash
uv run python -m evals.playtest --help
```

- 写进开发数据库（`DATABASE_URL`，先 `make migrate`），每次新注册一个评测账号（`playtest-时间@example.com`），不碰你自己的账号；
  报告里给出存档 id，用日志查看器（`make vis`）打开这局，能逐回合看导演和世界状态 agent 的每一步。
- 剧本在 `datasets/m2/tavern_100.yaml`：`"@option"` 是按种子随机点一个选项（这一段没有选项时写一句继续），其余是玩家自己写的行动，
  专门考交出和藏起物品、换地方、遇到新人物、有人死去、得知秘密、有人离开；关键事件（老周死了、阿苓离开）在行动里写明白。
  `checks` 是检查点，`recall` 是召回题（第 1、10、26 回合说出火漆的图案、搬运工的刺青、驿站的名字，第 84、90、99 回合再问），换剧本时照着写。
- `--think` 是每回合之间停几秒（默认 5，模拟读叙述）；设成 0 就是一回合接一回合地点，用来看世界状态最多会落后多少。
- 章节整理也在脚本里带的后台进程里跑；`--chapter-soft`、`--chapter-hard` 是切章的两条线（默认和服务端一样，8000、16000 token）。
  有了章节摘要以后，更早的回合不在导演的上下文里，召回题考的是召回工具和整理出来的记忆。
- 开发环境的 worker 也开着时，两边一起从队列领任务，不会重复整理同一回合。
- 报告写到 `reports/`（JSON 和一页中文总结，不入库）。

离线冒烟测试 `tests/e2e/test_playtest_offline.py` 用假模型服务把整条链路跑几回合，需要数据库（`make test-integration`），不需要密钥；
其中一个用例把原文每 2 回合移出，假导演先调一次 `recall` 再写，检查工具调用走真实的流式格式也能跑通。
