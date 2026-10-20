"""状态块 <world-state>：把世界状态按“场景、主角、在场人物、提到的、相关的、名册、玩家已知、
角色私有”排版（backend.md 第 3 节“披露分层”，docs/agent-runtime.md 第 7 节“状态块”）。
标签和标点随这一局的语言（runtime/prompts/<lang>/state_block.json），排版规则相同。

- 开头写明截至第几回合：世界状态由后台整理，可能落后几回合，之后原文里的变化以原文为准；
- 在场：场景地点、在场人物、主角和随身物品；
- 提到的：玩家这次的行动和上一段叙述里出现了名字或别名的实体（包括铅笔实体）；
- 相关的：在场实体的一跳邻居（只取钢笔实体）；
- 名册：其余钢笔实体，按最近出现的回合从近到远，一行一个。
预算不够时按顺序删减：名册 → 相关的 → 提到的压成一行 → 事实 → 在场人物的详情。
所有实体文字都先过 sanitize_for_fence()；输出是确定性的（同样的输入逐字节相同）。
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import Any

from bettertavern.domain.world.mentions import mentioned
from bettertavern.domain.world.views import EntityView, FactView, WorldSnapshot
from bettertavern.runtime.prompts import PromptLibrary

from .fences import sanitize_for_fence
from .tokens import estimate_tokens

MAX_FACTS = 12
MAX_ROSTER = 24
MAX_MENTIONED = 8
MAX_NEARBY = 12
DETAIL_KEYS = ("goal", "attitude", "speech_style")


def _clean(text: str, limit: int) -> str:
    text = " ".join(sanitize_for_fence(text).split())
    return text if len(text) <= limit else text[: limit - 1] + "…"


def _describe(labels: Mapping[str, Any], name: str, body: str) -> str:
    """名字后面跟一段说明：中文“名字：说明”，英文“name: description”"""
    return name + (labels["describe"].format(value=body) if body else "")


def _character_line(labels: Mapping[str, Any], entity: EntityView, *, detail: bool) -> str:
    parts = [_clean(entity.summary, 260 if detail else 80)] if entity.summary else []
    if detail:
        for key in DETAIL_KEYS:
            value = entity.data.get(key)
            if isinstance(value, str) and value:
                parts.append(labels["details"][key].format(value=_clean(value, 120)))
    body = labels["join_details"].join(p for p in parts if p)
    return "- " + _describe(labels, _clean(entity.name, 40), body)


def _fact_line(fact: FactView) -> str:
    return f"- {_clean(fact.text, 200)}"


def _entity_line(labels: Mapping[str, Any], entity: EntityView, *, summary_chars: int) -> str:
    """一行：名字（类型）：简短描述"""
    name = _clean(entity.name, 40) + labels["kind"].format(
        kind=labels["kinds"].get(entity.kind, entity.kind)
    )
    summary = _clean(entity.summary, summary_chars) if entity.summary and summary_chars else ""
    return "- " + _describe(labels, name, summary)


def render_state_block(
    world: WorldSnapshot,
    prompts: PromptLibrary,
    *,
    budget_tokens: int = 2500,
    state_seq: int = -1,
    mention_texts: Sequence[str] = (),
) -> str:
    """标签和标点取自这一局语言的 state_block.json；结构和降级规则与语言无关。

    state_seq：世界状态已整理到第几回合（-1 表示还是开局时的样子）；
    mention_texts：用来找“提到的”实体的文字（玩家这次的行动、上一段叙述）。
    """
    labels: Mapping[str, Any] = prompts.data("state_block")
    hero = world.protagonist
    location, present = world.scene()
    world_entity = world.world

    def section(key: str, lines: Sequence[str]) -> list[str]:
        return [labels["section"].format(title=labels["sections"][key]), *lines] if lines else []

    scene_lines: list[str] = []
    if location is not None:
        summary = _clean(location.summary, 200) if location.summary else ""
        place = _describe(labels, _clean(location.name, 40), summary)
        scene_lines.append(labels["scene"]["location"].format(value=place))
    if world_entity is not None:
        clock = world_entity.data.get("clock")
        if isinstance(clock, str) and clock:
            scene_lines.append(labels["scene"]["time"].format(value=_clean(clock, 60)))
        scene = world_entity.data.get("scene") or {}
        goal = scene.get("goal") if isinstance(scene, dict) else None
        if isinstance(goal, str) and goal:
            scene_lines.append(labels["scene"]["goal"].format(value=_clean(goal, 160)))

    hero_lines: list[str] = []
    if hero is not None:
        hero_lines.append(_character_line(labels, hero, detail=True))
        items = world.held_by(hero.id)
        if items:
            names = labels["join_names"].join(_clean(i.name, 30) for i in items)
            hero_lines.append(labels["items"].format(value=names))

    present_ids = {p.id for p in present}
    present_lines = [_character_line(labels, p, detail=True) for p in present]

    shown = present_ids | ({hero.id} if hero else set()) | ({location.id} if location else set())
    if world_entity is not None:
        shown.add(world_entity.id)
    if hero is not None:
        shown.update(i.id for i in world.held_by(hero.id))

    # 提到的：行动和上一段叙述里出现了名字的实体，铅笔实体也算
    candidates = [e for e in world.entities if e.id not in shown and e.kind != "world"]
    named = mentioned(candidates, mention_texts)[:MAX_MENTIONED]
    shown.update(e.id for e in named)

    def mentioned_lines(full: bool) -> list[str]:
        return [
            _character_line(labels, e, detail=False)
            if e.kind == "character" and full
            else _entity_line(labels, e, summary_chars=120 if full else 0)
            for e in named
        ]

    # 相关的：在场实体的一跳邻居（钢笔实体），按最近出现的回合排
    anchors = present_ids | ({hero.id} if hero else set()) | ({location.id} if location else set())
    neighbours: dict[str, EntityView] = {}
    for link in world.links:
        for here, other in ((link.src_id, link.dst_id), (link.dst_id, link.src_id)):
            entity = world.get(other)
            if (
                here in anchors
                and entity is not None
                and other not in shown
                and entity.canon == "canon"
                and entity.kind != "world"
            ):
                neighbours[other] = entity
    nearby = sorted(neighbours.values(), key=lambda e: (-e.last_seen_seq, e.kind, e.name))
    nearby_lines = [_entity_line(labels, e, summary_chars=60) for e in nearby[:MAX_NEARBY]]
    shown.update(neighbours)

    # 名册：其余钢笔实体，最近出现过的排前面
    roster = [e for e in world.entities if e.id not in shown and e.canon == "canon"]
    roster.sort(key=lambda e: (-e.last_seen_seq, e.first_seq, e.kind, e.name))
    roster_lines = [_entity_line(labels, e, summary_chars=60) for e in roster[:MAX_ROSTER]]

    hero_id = hero.id if hero else ""
    # 事实：涉及在场人物、主角或提到的实体的排前面，其次是建立得越晚越靠前
    relevant = sorted(
        world.facts,
        key=lambda f: (
            0 if set(f.entity_ids) & (present_ids | {hero_id} | {e.id for e in named}) else 1,
            -f.created_seq,
            f.id,
        ),
    )
    known = [f for f in relevant if f.visibility != "secret" or hero_id in f.known_by][:MAX_FACTS]
    secret = [f for f in relevant if f.visibility == "secret" and hero_id not in f.known_by][
        :MAX_FACTS
    ]

    preamble = (
        labels["preamble"].format(seq=state_seq) if state_seq >= 0 else labels["preamble_opening"]
    )

    def assemble(
        roster_n: int, nearby_n: int, full_mentions: bool, facts_n: int, detail: bool
    ) -> str:
        lines = [preamble]
        lines += section("scene", scene_lines)
        lines += section("hero", hero_lines)
        people = (
            present_lines if detail else [_character_line(labels, p, detail=False) for p in present]
        )
        lines += section("present", people)
        lines += section("mentioned", mentioned_lines(full_mentions))
        lines += section("nearby", nearby_lines[:nearby_n])
        lines += section("roster", roster_lines[:roster_n])
        lines += section("known", [_fact_line(f) for f in known[:facts_n]])
        lines += section("secret", [_fact_line(f) for f in secret[:facts_n]])
        return "<world-state>\n" + "\n".join(lines) + "\n</world-state>"

    # 降级顺序：名册 → 相关的 → 提到的压成一行 → 事实条数 → 在场人物详情
    steps = [
        (len(roster_lines), len(nearby_lines), True, MAX_FACTS, True),
        (8, len(nearby_lines), True, MAX_FACTS, True),
        (0, len(nearby_lines), True, MAX_FACTS, True),
        (0, 0, True, MAX_FACTS, True),
        (0, 0, False, 6, True),
        (0, 0, False, 3, True),
        (0, 0, False, 1, False),
        (0, 0, False, 0, False),
    ]
    text = ""
    for roster_n, nearby_n, full_mentions, facts_n, detail in steps:
        text = assemble(roster_n, nearby_n, full_mentions, facts_n, detail)
        if estimate_tokens(text) <= budget_tokens:
            return text
    return text
