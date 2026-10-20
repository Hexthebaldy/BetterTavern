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

## playtest：剧本试玩（agent runtime 阶段 2）

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

```bash
DEEPSEEK_API_KEY=sk-... uv run python -m evals.playtest --provider deepseek --model deepseek-flash
# 后台整理用另一个模型：
DEEPSEEK_API_KEY=sk-... GEMINI_API_KEY=... uv run python -m evals.playtest \
    --provider deepseek --model deepseek-flash --state-provider gemini --state-model gemini-3-flash
uv run python -m evals.playtest --help
```

- 写进开发数据库（`DATABASE_URL`，先 `make migrate`），每次新注册一个评测账号（`playtest-时间@example.com`），不碰你自己的账号；
  报告里给出存档 id，用日志查看器（`make vis`）打开这局，能逐回合看导演和世界状态 agent 的每一步。
- 剧本在 `datasets/m2/tavern_100.yaml`：`"@option"` 是按种子随机点一个选项（这一段没有选项时写一句继续），其余是玩家自己写的行动，
  专门考交出和藏起物品、换地方、遇到新人物、有人死去、得知秘密、有人离开；关键事件（老周死了、阿苓离开）在行动里写明白。
  `checks` 是检查点，换剧本时照着写。
- `--think` 是每回合之间停几秒（默认 5，模拟读叙述）；设成 0 就是一回合接一回合地点，用来看世界状态最多会落后多少。
- 开发环境的 worker 也开着时，两边一起从队列领任务，不会重复整理同一回合。
- 报告写到 `reports/`（JSON 和一页中文总结，不入库）。

离线冒烟测试 `tests/e2e/test_playtest_offline.py` 用假模型服务把整条链路跑几回合，需要数据库（`make test-integration`），不需要密钥。
