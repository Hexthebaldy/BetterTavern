"""世界状态 agent 的工具（docs/agent-runtime.md 第 4 节“世界状态 agent”）。
是 state_keeper.py 的同级文件。

- 查询：find_entity、lookup。
- 修改：create_entity、update_entity、retire_entity、move、link、unlink、add_fact、retract_fact、
  share_fact、set_scene、set_clock。只作用到这次运行的修改清单
  （domain/world/draft.py 的 WorldDraft），当场检查，不合规的把原因交回模型，让它改正。
- 收尾：commit。整个世界再检查一遍，通过了这次运行才算完成。

工具结果是紧凑的 JSON：键是英文标识，值里的故事文字都先过 sanitize_for_fence()。
出错时给模型看的说明按这一局的语言取（runtime/prompts/<lang>/state_keeper.json）。
"""

from __future__ import annotations

import json
import re
from collections.abc import Awaitable, Callable, Iterable, Mapping
from dataclasses import dataclass, field
from typing import Any

from bettertavern.domain.world.draft import KINDS, LINK_RULES, DraftError, DraftIssues, WorldDraft
from bettertavern.domain.world.records import EntityRecord, FactRecord
from bettertavern.runtime.agent import AgentStep, Tool, ToolError, ToolRegistry
from bettertavern.runtime.context.fences import sanitize_for_fence

FINISH_TOOL = "commit"
MAX_MATCHES = 8
_REF = re.compile(r"\b[ef]\d+\b")


@dataclass
class StateToolContext:
    draft: WorldDraft
    messages: Mapping[str, Any]  # state_keeper.json：出错时的说明
    rejected: list[dict[str, str]] = field(default_factory=list)  # 被拒绝的修改：工具名和原因代码
    commits: int = 0  # 调用了几次 commit


def to_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def _text(value: Any) -> str:
    return sanitize_for_fence(str(value))


def brief(draft: WorldDraft, entity: EntityRecord) -> dict[str, Any]:
    out: dict[str, Any] = {
        "ref": draft.ref(entity.id),
        "kind": entity.kind,
        "name": _text(entity.name),
    }
    if entity.aliases:
        out["aliases"] = [_text(a) for a in entity.aliases]
    if entity.is_protagonist:
        out["protagonist"] = True
    if entity.canon == "sketch":
        out["sketch"] = True
    if entity.retired:
        out["retired"] = True
    return out


def describe(
    draft: WorldDraft, entity: EntityRecord, *, summary_chars: int = 400
) -> dict[str, Any]:
    """一个实体现在的资料：长期描述、状态、在哪里或在谁手里、带着什么、谁在这里、其他关系。"""
    out = brief(draft, entity)
    if entity.summary:
        out["summary"] = _text(entity.summary[:summary_chars])
    details = {k: _text(v) for k, v in entity.data.items() if isinstance(v, str) and v}
    if details:
        out["details"] = details
    place = draft.place_of(entity.id)
    if place is not None:
        rel, target = place
        out[rel] = {"ref": draft.ref(target.id), "name": _text(target.name)}
    held = [e for e in draft.sources(entity.id, "held_by") if not e.retired]
    if held:
        out["holds"] = [{"ref": draft.ref(e.id), "name": _text(e.name)} for e in held]
    if entity.kind == "location":
        here = [e for e in draft.sources(entity.id, "located_in") if not e.retired]
        if here:
            out["here"] = [{"ref": draft.ref(e.id), "name": _text(e.name)} for e in here]
    others = [
        {
            "rel": lk.rel,
            "ref": draft.ref(other),
            "name": _text(draft.entity(other).name),
            "incoming": lk.dst_id == entity.id,
        }
        for lk in draft.links
        if lk.rel in LINK_RULES and entity.id in (lk.src_id, lk.dst_id)
        for other in [lk.dst_id if lk.src_id == entity.id else lk.src_id]
    ]
    if others:
        out["links"] = others
    return out


def describe_fact(draft: WorldDraft, fact: FactRecord) -> dict[str, Any]:
    out: dict[str, Any] = {"ref": draft.fact_ref(fact.id), "text": _text(fact.text)}
    if fact.entity_ids:
        out["about"] = [draft.ref(i) for i in fact.entity_ids]
    if fact.visibility == "secret":
        out["secret"] = True
        out["known_by"] = [draft.ref(i) for i in fact.known_by]
    return out


def ref_labels(draft: WorldDraft, steps: Iterable[AgentStep]) -> dict[str, str]:
    """这次运行的工具参数和结果里出现过的编号，各自对应的名字（事实是开头几个字）。

    编号只在这一次运行里有效，记下来给日志查看工具用：打开“显示故事内容”时把编号换成名字显示。
    """
    seen: dict[str, None] = {}
    for step in steps:
        if step.kind != "tool":
            continue
        text = to_json(dict(step.args)) + str(step.result.get("text") or "")
        seen.update(dict.fromkeys(_REF.findall(text)))
    labels = {ref: label for ref in seen if (label := draft.label(ref)) is not None}
    return dict(sorted(labels.items(), key=lambda item: (item[0][0], int(item[0][1:]))))


def _error(ctx: StateToolContext, tool: str, exc: DraftError) -> ToolError:
    ctx.rejected.append({"tool": tool, "code": exc.code})
    errors: Mapping[str, str] = ctx.messages["errors"]
    if isinstance(exc, DraftIssues):
        issues: Mapping[str, str] = ctx.messages["issues"]
        text = "; ".join(issues[i.code].format(**i.params) for i in exc.issues)
        return ToolError(errors["world_issues"].format(issues=text))
    return ToolError(errors[exc.code].format(**exc.params))


Handler = Callable[[Mapping[str, Any], StateToolContext], str]


def _tool(
    name: str, kind: str, properties: Mapping[str, Any], required: tuple[str, ...]
) -> Callable[[Handler], Tool]:
    """把一个同步的处理函数包成工具：DraftError 变成交回模型的说明。"""
    schema = {
        "type": "object",
        "properties": dict(properties),
        "required": list(required),
        "additionalProperties": False,
    }

    def wrap(handler: Handler) -> Tool:
        async def run(args: Mapping[str, Any], ctx: Any) -> str:
            try:
                return handler(args, ctx)
            except DraftError as exc:
                raise _error(ctx, name, exc) from exc

        handle: Callable[[Mapping[str, Any], Any], Awaitable[str]] = run
        return Tool(
            name=name, kind="read" if kind == "read" else "write", parameters=schema, handler=handle
        )

    return wrap


STRING = {"type": "string"}
STRINGS = {"type": "array", "items": {"type": "string"}}
DETAILS = {"type": "object", "additionalProperties": {"type": "string"}}
OK = to_json({"ok": True})


@_tool("find_entity", "read", {"name": STRING}, ("name",))
def find_entity(args: Mapping[str, Any], ctx: StateToolContext) -> str:
    draft = ctx.draft
    matches = draft.find(str(args["name"]))[:MAX_MATCHES]
    return to_json({"matches": [brief(draft, e) for e in matches]})


@_tool("lookup", "read", {"entity": STRING}, ("entity",))
def lookup(args: Mapping[str, Any], ctx: StateToolContext) -> str:
    draft = ctx.draft
    entity = draft.resolve(str(args["entity"]), active=False)
    out = describe(draft, entity)
    facts = [f for f in draft.facts if entity.id in f.entity_ids]
    if facts:
        out["facts"] = [describe_fact(draft, f) for f in facts]
    return to_json(out)


@_tool(
    "create_entity",
    "write",
    {
        "kind": {"type": "string", "enum": list(KINDS)},
        "name": STRING,
        "summary": STRING,
        "aliases": STRINGS,
        "details": DETAILS,
    },
    ("kind", "name", "summary"),
)
def create_entity(args: Mapping[str, Any], ctx: StateToolContext) -> str:
    record = ctx.draft.create_entity(
        kind=str(args["kind"]),
        name=str(args["name"]),
        summary=str(args["summary"]),
        aliases=[str(a) for a in args.get("aliases") or ()],
        details=args.get("details") or {},
    )
    return to_json({"ref": ctx.draft.ref(record.id), "name": _text(record.name)})


@_tool(
    "update_entity",
    "write",
    {"entity": STRING, "summary": STRING, "aliases": STRINGS, "details": DETAILS},
    ("entity",),
)
def update_entity(args: Mapping[str, Any], ctx: StateToolContext) -> str:
    summary = args.get("summary")
    ctx.draft.update_entity(
        str(args["entity"]),
        summary=None if summary is None else str(summary),
        aliases=[str(a) for a in args.get("aliases") or ()],
        details=args.get("details") or {},
    )
    return OK


@_tool("retire_entity", "write", {"entity": STRING}, ("entity",))
def retire_entity(args: Mapping[str, Any], ctx: StateToolContext) -> str:
    ctx.draft.retire_entity(str(args["entity"]))
    return OK


@_tool("move", "write", {"entity": STRING, "to": STRING}, ("entity", "to"))
def move(args: Mapping[str, Any], ctx: StateToolContext) -> str:
    rel, _, _ = ctx.draft.move(str(args["entity"]), str(args["to"]))
    return to_json({"ok": True, "rel": rel})


@_tool(
    "link",
    "write",
    {"src": STRING, "rel": {"type": "string", "enum": list(LINK_RULES)}, "dst": STRING},
    ("src", "rel", "dst"),
)
def link(args: Mapping[str, Any], ctx: StateToolContext) -> str:
    ctx.draft.link(str(args["src"]), str(args["rel"]), str(args["dst"]))
    return OK


@_tool("unlink", "write", {"src": STRING, "rel": STRING, "dst": STRING}, ("src", "rel", "dst"))
def unlink(args: Mapping[str, Any], ctx: StateToolContext) -> str:
    ctx.draft.unlink(str(args["src"]), str(args["rel"]), str(args["dst"]))
    return OK


@_tool(
    "add_fact",
    "write",
    {"text": STRING, "about": STRINGS, "secret": {"type": "boolean"}, "known_by": STRINGS},
    ("text", "about"),
)
def add_fact(args: Mapping[str, Any], ctx: StateToolContext) -> str:
    fact = ctx.draft.add_fact(
        str(args["text"]),
        about=[str(a) for a in args.get("about") or ()],
        secret=bool(args.get("secret", False)),
        known_by=[str(k) for k in args.get("known_by") or ()],
    )
    return to_json({"ref": ctx.draft.fact_ref(fact.id)})


@_tool("retract_fact", "write", {"fact": STRING, "replaced_by": STRING}, ("fact",))
def retract_fact(args: Mapping[str, Any], ctx: StateToolContext) -> str:
    newer = args.get("replaced_by")
    ctx.draft.retract_fact(str(args["fact"]), replaced_by=str(newer) if newer else None)
    return OK


@_tool("share_fact", "write", {"fact": STRING, "people": STRINGS}, ("fact", "people"))
def share_fact(args: Mapping[str, Any], ctx: StateToolContext) -> str:
    ctx.draft.share_fact(str(args["fact"]), [str(p) for p in args.get("people") or ()])
    return OK


@_tool("set_scene", "write", {"location": STRING, "present": STRINGS, "goal": STRING}, ())
def set_scene(args: Mapping[str, Any], ctx: StateToolContext) -> str:
    draft = ctx.draft
    present = args.get("present")
    scene = draft.set_scene(
        location=str(args["location"]) if args.get("location") else None,
        present=None if present is None else [str(p) for p in present],
        goal=None if args.get("goal") is None else str(args["goal"]),
    )
    location = scene.get("location")
    return to_json(
        {
            "location": brief(draft, draft.entity(str(location))) if location else None,
            "present": [brief(draft, draft.entity(str(p))) for p in scene.get("present") or ()],
            "goal": _text(scene.get("goal") or ""),
        }
    )


@_tool("set_clock", "write", {"time": STRING}, ("time",))
def set_clock(args: Mapping[str, Any], ctx: StateToolContext) -> str:
    return to_json({"time": _text(ctx.draft.set_clock(str(args["time"])))})


@_tool(
    FINISH_TOOL,
    "write",
    {"digest": STRING, "entities": STRINGS, "scene_ended": {"type": "boolean"}},
    ("digest", "entities", "scene_ended"),
)
def commit(args: Mapping[str, Any], ctx: StateToolContext) -> str:
    ctx.commits += 1
    ctx.draft.finish(
        digest=str(args["digest"]),
        entities=[str(e) for e in args.get("entities") or ()],
        scene_ended=bool(args["scene_ended"]),
    )
    return OK


TOOLS = (
    find_entity,
    lookup,
    create_entity,
    update_entity,
    retire_entity,
    move,
    link,
    unlink,
    add_fact,
    retract_fact,
    share_fact,
    set_scene,
    set_clock,
    commit,
)
TOOL_NAMES = tuple(t.name for t in TOOLS)
REGISTRY = ToolRegistry(TOOLS)
