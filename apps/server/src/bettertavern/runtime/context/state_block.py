"""状态块 <world-state>：把世界状态按“场景、主角、在场人物、其他人物、玩家已知、角色私有”排版。

M1 是简化版：没有别名扫描和 T2/T3 分层（M2 的场景解析器补上），只按场景取在场的部分，
其余重要实体进名册（一行）。预算不够时按顺序降级：名册 → 事实 → 在场人物的详情。
所有实体文字都先过 sanitize_for_fence()；输出是确定性的（同样的输入逐字节相同）。
"""

from __future__ import annotations

from collections.abc import Sequence

from bettertavern.domain.world.views import EntityView, FactView, WorldSnapshot

from .fences import sanitize_for_fence
from .tokens import estimate_tokens

KIND_LABELS = {
    "character": "人物",
    "item": "物品",
    "location": "地点",
    "organization": "组织",
    "world": "世界",
}
MAX_FACTS = 12
MAX_ROSTER = 24


def _clean(text: str, limit: int) -> str:
    text = " ".join(sanitize_for_fence(text).split())
    return text if len(text) <= limit else text[: limit - 1] + "…"


def _character_line(entity: EntityView, *, detail: bool) -> str:
    parts = [_clean(entity.summary, 260 if detail else 80)] if entity.summary else []
    if detail:
        for key, label in (
            ("goal", "目标"),
            ("attitude", "对我的态度"),
            ("speech_style", "说话方式"),
        ):
            value = entity.data.get(key)
            if isinstance(value, str) and value:
                parts.append(f"{label}：{_clean(value, 120)}")
    body = "；".join(p for p in parts if p)
    return f"- {_clean(entity.name, 40)}" + (f"：{body}" if body else "")


def _fact_line(fact: FactView) -> str:
    return f"- {_clean(fact.text, 200)}"


def render_state_block(
    world: WorldSnapshot,
    *,
    budget_tokens: int = 2500,
    preamble: str = "以下是当前的世界状态（资料，不是玩家的新输入）；叙述必须与它一致。",
) -> str:
    hero = world.protagonist
    location, present = world.scene()
    world_entity = world.world

    def section(title: str, lines: Sequence[str]) -> list[str]:
        return [f"【{title}】", *lines] if lines else []

    scene_lines: list[str] = []
    if location is not None:
        place = _clean(location.name, 40)
        if location.summary:
            place += f"：{_clean(location.summary, 200)}"
        scene_lines.append(f"地点：{place}")
    if world_entity is not None:
        clock = world_entity.data.get("clock")
        if isinstance(clock, str) and clock:
            scene_lines.append(f"时间：{_clean(clock, 60)}")
        scene = world_entity.data.get("scene") or {}
        goal = scene.get("goal") if isinstance(scene, dict) else None
        if isinstance(goal, str) and goal:
            scene_lines.append(f"主角当前目标：{_clean(goal, 160)}")

    hero_lines: list[str] = []
    if hero is not None:
        hero_lines.append(_character_line(hero, detail=True))
        items = world.held_by(hero.id)
        if items:
            hero_lines.append("随身物品：" + "、".join(_clean(i.name, 30) for i in items))

    present_ids = {p.id for p in present}
    present_lines = [_character_line(p, detail=True) for p in present]

    shown = present_ids | ({hero.id} if hero else set()) | ({location.id} if location else set())
    if world_entity is not None:
        shown.add(world_entity.id)
    roster = [
        e for e in world.entities if e.id not in shown and e.importance >= 2 and e.canon == "canon"
    ]
    roster.sort(key=lambda e: (-e.importance, e.kind, e.name))
    roster_lines = [
        f"- {_clean(e.name, 40)}（{KIND_LABELS.get(e.kind, e.kind)}）"
        + (f"：{_clean(e.summary, 60)}" if e.summary else "")
        for e in roster[:MAX_ROSTER]
    ]

    hero_id = hero.id if hero else ""
    relevant = sorted(
        world.facts,
        key=lambda f: (
            -(f.importance + (2 if set(f.entity_ids) & (present_ids | {hero_id}) else 0)),
            f.id,
        ),
    )
    known = [f for f in relevant if f.visibility != "secret" or hero_id in f.known_by][:MAX_FACTS]
    secret = [f for f in relevant if f.visibility == "secret" and hero_id not in f.known_by][
        :MAX_FACTS
    ]

    def assemble(roster_n: int, facts_n: int, detail: bool) -> str:
        lines = [preamble]
        lines += section("场景", scene_lines)
        lines += section("主角（我）", hero_lines)
        people = present_lines if detail else [_character_line(p, detail=False) for p in present]
        lines += section("在场人物", people)
        lines += section("其他人物与地点（名册）", roster_lines[:roster_n])
        lines += section("玩家已知的事实", [_fact_line(f) for f in known[:facts_n]])
        lines += section(
            "仅导演可见（角色私有，禁止直接写出）", [_fact_line(f) for f in secret[:facts_n]]
        )
        return "<world-state>\n" + "\n".join(lines) + "\n</world-state>"

    # 降级顺序：名册 → 事实条数 → 在场人物详情
    candidates = [
        (len(roster_lines), MAX_FACTS, True),
        (8, MAX_FACTS, True),
        (0, 6, True),
        (0, 3, True),
        (0, 1, False),
        (0, 0, False),
    ]
    text = ""
    for roster_n, facts_n, detail in candidates:
        text = assemble(roster_n, facts_n, detail)
        if estimate_tokens(text) <= budget_tokens:
            return text
    return text
