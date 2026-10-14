# 世界书导入器（v1 未实现）

v1 不做世界书模块。以后的导入器把 ST 世界书的每个条目转成 `entities` 和 `facts`：

- 常驻条目（`constant = true`）成为 world 实体的设定或 T0 事实；
- 关键词并入对应实体的 `aliases`；
- 关键词触发、递归激活这些逻辑由别名索引与披露分层取代，不再需要。

角色卡内嵌的 `character_book` 在 v1 只由 WorldBuilder 一次性提炼（最多 40 条，常驻条目优先），
见 `docs/backend.md` 第 6 节。
