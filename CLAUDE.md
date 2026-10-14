# BetterTavern

@AGENTS.md

接手时先读 [docs/handoff.md](docs/handoff.md)：已经完成的工作、验证到什么程度、哪些没验证，以及下一步。
设计文档在 `docs/`（README、backend、client、testing）；常用命令见根目录 README 的“本地开发”和“测试”两节。
实际的表结构和接口以 `docs/data-model/`、`docs/api/` 为准（按领域分文件）：改表或改接口时在同一个改动里更新对应领域的文件，有测试检查是否一致。

给用户的终端命令不要带行尾注释：用户用 zsh，交互模式下 `#` 会被当成参数。
