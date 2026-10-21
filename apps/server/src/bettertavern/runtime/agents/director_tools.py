"""导演的召回工具（docs/agent-runtime.md 第 7 节“召回”）。是 director.py 的同级文件。

三个工具都是只读的，只能看到当前故事线上、不在上下文里的更早回合（RecallContext.before_seq 之前）：
- recall：按关键词（在玩家行动、叙述、一句话摘要里找）或按名字（回合标签里记的实体）找回合，
  从近到远，每个回合给回合号、一句话摘要、玩家行动和命中处前后约 100 字的原文；
- read_turn：某一回合的玩家行动和完整叙述，最多 3000 字；
- lookup：一个实体的完整资料、有效事实（只给导演看的秘密单独标出）、关系，已经退场的也能查。

结果是紧凑的 JSON，故事文字由注册表统一过 sanitize_for_fence() 并用 <recall> 包起来。
每次调用的返回不超过约 800 token，一回合所有工具的返回加起来不超过约 2000 token（按字数算），
超过以后再调用就告诉模型“直接写”。出错时的说明按这一局的语言取（runtime/prompts/<lang>/recall.json）。
"""

from __future__ import annotations

import json
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Any

from bettertavern.domain.world.mentions import find_named
from bettertavern.domain.world.records import EntityRecord, WorldRecords
from bettertavern.runtime.agent import Tool, ToolError, ToolRegistry
from bettertavern.runtime.ports import PastTurn, RecallStore

MAX_TURNS = 5
DEFAULT_TURNS = 3
CANDIDATES = 40  # 按关键词找时先取最近这么多个候选，再按命中的词数排
MAX_TERMS = 5
EXCERPT_CHARS = 100  # 命中处前后各取这么多字
ACTION_CHARS = 100
READ_CHARS = 3000
RESULT_CHARS = 2400  # 每次调用的返回上限，约 800 token
TURN_BUDGET_CHARS = 6000  # 一回合所有工具的返回加起来，约 2000 token
MAX_FACTS = 12
PLACE_RELS = ("located_in", "held_by")


@dataclass
class RecallContext:
    store: RecallStore
    playthrough_id: str
    seq: int  # 正在写的回合
    before_seq: int  # 上下文里的原文从这一回合开始：只查更早的
    messages: Mapping[str, Any]  # recall.json：出错时的说明
    used_chars: int = 0
    _world: WorldRecords | None = None

    async def world(self) -> WorldRecords:
        if self._world is None:
            self._world = await self.store.world(self.playthrough_id)
        return self._world

    def error(self, code: str, **params: Any) -> ToolError:
        return ToolError(self.messages["errors"][code].format(**params))

    def charge(self, text: str) -> str:
        """记下这一回合工具已经返回了多少字；用完额度后不再给结果。"""
        if self.used_chars >= TURN_BUDGET_CHARS:
            raise self.error("budget")
        self.used_chars += len(text)
        return text


def to_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def _flat(text: str) -> str:
    return " ".join(text.split())


def _clip(text: str, limit: int) -> str:
    text = _flat(text)
    return text if len(text) <= limit else text[:limit] + "…"


def excerpt(text: str, needles: Sequence[str]) -> str:
    """第一个命中处前后各约 EXCERPT_CHARS 字；都没命中时取开头。"""
    flat = _flat(text)
    lowered = flat.lower()
    hits = [(i, len(n)) for n in needles if n and (i := lowered.find(n.lower())) >= 0]
    if not hits:
        return _clip(flat, EXCERPT_CHARS * 2)
    index, size = min(hits)
    start = max(0, index - EXCERPT_CHARS)
    end = min(len(flat), index + size + EXCERPT_CHARS)
    return ("…" if start else "") + flat[start:end] + ("…" if end < len(flat) else "")


def split_terms(query: str) -> list[str]:
    terms = [t for t in query.replace("，", " ").replace(",", " ").split() if t.strip()]
    return list(dict.fromkeys(terms))[:MAX_TERMS]


def _turn_brief(turn: PastTurn, needles: Sequence[str]) -> dict[str, Any]:
    out: dict[str, Any] = {"turn": turn.seq}
    if turn.digest:
        out["digest"] = _flat(turn.digest)
    if turn.action.text and turn.action.source != "opening":
        out["action"] = _clip(turn.action.text, ACTION_CHARS)
    out["excerpt"] = excerpt(turn.narrative, needles)
    return out


def _fit(out: dict[str, Any], key: str, items: list[Any]) -> dict[str, Any]:
    """把 items 一个个放进 out[key]，放到返回内容快超过上限为止。"""
    kept: list[Any] = []
    for item in items:
        if len(to_json({**out, key: [*kept, item]})) > RESULT_CHARS:
            break
        kept.append(item)
    if kept:
        out[key] = kept
    return out


def _names(world: WorldRecords) -> dict[str, EntityRecord]:
    return {e.id: e for e in world.entities}


def _limit(args: Mapping[str, Any]) -> int:
    value = args.get("limit", DEFAULT_TURNS)
    return max(1, min(int(value), MAX_TURNS))


async def _recall(args: Mapping[str, Any], ctx: Any) -> str:
    assert isinstance(ctx, RecallContext)
    query = str(args.get("query") or "").strip()
    name = str(args.get("entity") or "").strip()
    limit = _limit(args)
    if not query and not name:
        raise ctx.error("need_query")
    turns: list[PastTurn] = []
    needles: list[str] = []
    out: dict[str, Any] = {}
    if name:
        world = await ctx.world()
        found = find_named((e for e in world.entities if e.kind != "world"), name)[:3]
        if found:
            out["entity"] = found[0].name
            needles = [k for e in found for k in (e.name, *e.aliases)]
            turns = await ctx.store.turns_with(
                ctx.playthrough_id, [e.id for e in found], before_seq=ctx.before_seq, limit=limit
            )
        # 世界状态里没有这个名字，或者回合标签里没记它：当关键词在原文里找
        query = query or name
    if query and not turns:
        terms = split_terms(query)
        needles = terms
        candidates = await ctx.store.search(
            ctx.playthrough_id, terms, before_seq=ctx.before_seq, limit=CANDIDATES
        )

        def score(turn: PastTurn) -> int:
            text = " ".join((turn.narrative, turn.action.text or "", turn.digest)).lower()
            return sum(1 for t in terms if t.lower() in text)

        # 命中的词多的在前，一样多的按回合从近到远（候选本来就是从近到远）
        turns = sorted(candidates, key=score, reverse=True)[:limit]
    return ctx.charge(to_json(_fit(out, "turns", [_turn_brief(t, needles) for t in turns])))


async def _read_turn(args: Mapping[str, Any], ctx: Any) -> str:
    assert isinstance(ctx, RecallContext)
    seq = int(args["seq"])
    if seq >= ctx.seq or seq < 0:
        raise ctx.error("no_turn", seq=seq)
    if seq >= ctx.before_seq:
        raise ctx.error("turn_in_context", seq=seq)
    turn = await ctx.store.turn(ctx.playthrough_id, seq)
    if turn is None:
        raise ctx.error("no_turn", seq=seq)
    out: dict[str, Any] = {"turn": turn.seq}
    if turn.action.text and turn.action.source != "opening":
        out["action"] = _clip(turn.action.text, ACTION_CHARS * 3)
    out["narrative"] = turn.narrative.strip()[:READ_CHARS]
    return ctx.charge(to_json(out))


async def _lookup(args: Mapping[str, Any], ctx: Any) -> str:
    assert isinstance(ctx, RecallContext)
    name = str(args["name"]).strip()
    world = await ctx.world()
    found = find_named((e for e in world.entities if e.kind != "world"), name)
    if not found:
        raise ctx.error("unknown_entity", name=name[:40])
    entity = found[0]
    names = _names(world)

    def label(entity_id: str) -> str | None:
        other = names.get(entity_id)
        return other.name if other is not None else None

    out: dict[str, Any] = {"name": entity.name, "kind": entity.kind}
    if entity.aliases:
        out["aliases"] = list(entity.aliases)
    if entity.is_protagonist:
        out["protagonist"] = True
    if entity.retired:
        out["retired"] = True
    if entity.summary:
        out["summary"] = _clip(entity.summary, 400)
    details = {k: _clip(v, 160) for k, v in entity.data.items() if isinstance(v, str) and v}
    if details:
        out["details"] = details
    for link in world.links:
        if link.src_id == entity.id and link.rel in PLACE_RELS and (where := label(link.dst_id)):
            out[link.rel] = where
    held = [
        thing.name
        for lk in world.links
        if lk.rel == "held_by" and lk.dst_id == entity.id
        if (thing := names.get(lk.src_id)) is not None and not thing.retired
    ]
    if held:
        out["holds"] = held
    others = [
        {"rel": lk.rel, "name": other, "incoming": lk.dst_id == entity.id}
        for lk in world.links
        if lk.rel not in PLACE_RELS and entity.id in (lk.src_id, lk.dst_id)
        if (other := label(lk.dst_id if lk.src_id == entity.id else lk.src_id))
    ]
    if others:
        out["links"] = others
    if len(found) > 1:
        out["also_matches"] = [e.name for e in found[1:4]]
    facts: list[dict[str, Any]] = []
    for fact in sorted(world.facts, key=lambda f: -f.created_seq):
        if entity.id not in fact.entity_ids:
            continue
        item: dict[str, Any] = {"text": _flat(fact.text), "since": fact.created_seq}
        if fact.visibility == "secret":
            item["secret"] = True
            item["known_by"] = [n for i in fact.known_by if (n := label(i))]
        facts.append(item)
        if len(facts) >= MAX_FACTS:
            break
    return ctx.charge(to_json(_fit(out, "facts", facts)))


def _schema(properties: Mapping[str, Any], required: tuple[str, ...]) -> dict[str, Any]:
    return {
        "type": "object",
        "properties": dict(properties),
        "required": list(required),
        "additionalProperties": False,
    }


TOOLS = (
    Tool(
        name="recall",
        kind="read",
        parameters=_schema(
            {
                "query": {"type": "string"},
                "entity": {"type": "string"},
                "limit": {"type": "integer", "minimum": 1, "maximum": MAX_TURNS},
            },
            (),
        ),
        handler=_recall,
        max_result_chars=RESULT_CHARS,
    ),
    Tool(
        name="read_turn",
        kind="read",
        parameters=_schema({"seq": {"type": "integer", "minimum": 0}}, ("seq",)),
        handler=_read_turn,
        max_result_chars=READ_CHARS + 400,
    ),
    Tool(
        name="lookup",
        kind="read",
        parameters=_schema({"name": {"type": "string"}}, ("name",)),
        handler=_lookup,
        max_result_chars=RESULT_CHARS,
    ),
)
TOOL_NAMES = tuple(t.name for t in TOOLS)
REGISTRY = ToolRegistry(TOOLS)
