"""工作台 agent（card_maker）的工具：沟通（问卷、方案、进度）、读写草稿、改动对比、检查、放图
（docs/workbench.md 第 4.3 节）。
联网和出图的工具在 card_maker_web.py。

- 写卡的工具改的是 ctx 里的卡片，再经 WorkbenchStore.write_card 带着草稿的版本号写回去；
  版本号对不上（用户在表单里同时改了）就重读一遍：用户改的正是这一处时不覆盖，告诉模型；
  否则在新内容上重做这一处修改。
- 用户手动改过的地方（和上一轮结束时比）不让 agent 覆盖：write_field、lore_upsert 碰到时拒绝，
  让它先在对话里问用户。
- 给模型看的说明、出错提示在 runtime/prompts/<lang>/tools.json（card_maker 一组）
  和 card_maker.json。
"""

from __future__ import annotations

import json
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field, replace
from typing import Any

from bettertavern.domain.scenario.card import CharacterCard, LoreEntry
from bettertavern.domain.scenario.check import check_card
from bettertavern.domain.scenario.edit import (
    EDITABLE_TEXT_FIELDS,
    CardEdit,
    EditError,
    LoreEntryEdit,
    apply_edit,
    book_in_order,
)
from bettertavern.domain.workbench.changes import ChangeError, ProposedChange, build_hunks
from bettertavern.domain.workbench.digest import draft_digest
from bettertavern.domain.workbench.messages import (
    MessageError,
    normalize_plan,
    normalize_questions,
)
from bettertavern.domain.workbench.stage import RunMode
from bettertavern.runtime.agent import Tool, ToolError, ToolRegistry
from bettertavern.runtime.ports import WorkbenchAsset, WorkbenchRun, WorkbenchStore
from bettertavern.runtime.workbench_events import EventBatcher

WRITABLE_FIELDS = ("name", "display_name", "tags", *EDITABLE_TEXT_FIELDS)
FREE_LICENSES = ("public_domain", "own")
MAX_TODOS = 12

# 每一轮的上限（docs/workbench.md 第 4.3 节）
MAX_TOOL_CALLS = 60
MAX_SEARCHES = 20
MAX_PAGES = 30


@dataclass
class Limits:
    tool_calls: int = 0
    searches: int = 0
    pages: int = 0
    images: int = 0
    image_budget: int = 0  # 确认的方案里写了生成几张


@dataclass
class CardMakerContext:
    run: WorkbenchRun
    store: WorkbenchStore
    events: EventBatcher
    messages: Mapping[str, str]  # card_maker.json 里的出错说明
    mode: RunMode
    card: CharacterCard
    name: str
    version: int
    user_edits: tuple[str, ...] = ()
    todos: list[dict[str, Any]] = field(default_factory=list)
    assets: dict[str, WorkbenchAsset] = field(default_factory=dict)
    limits: Limits = field(default_factory=Limits)
    ended: str | None = None  # 调了哪个结束这一轮的工具：questions / plan / changes
    awaiting_seq: int | None = None
    written: list[str] = field(default_factory=list)  # 这一轮写过的地方（进度摘要用）
    lore_added: int = 0
    cover_set: bool = False
    web: Any = None  # card_maker_web.WebTools（配了联网时）

    def fail(self, key: str, **params: Any) -> ToolError:
        return ToolError(self.messages[key].format(**params))

    def count_call(self) -> None:
        self.limits.tool_calls += 1
        if self.limits.tool_calls > MAX_TOOL_CALLS:
            raise self.fail("limit_tools", max=MAX_TOOL_CALLS)


def to_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


# ---- 写回草稿 ----------------------------------------------------------------------------


async def commit(
    ctx: CardMakerContext,
    change: Any,
    *,
    touched: Sequence[str],
    name: str | None = None,
) -> None:
    """change(card) 返回改好的卡片（不合格时抛 EditError）。写回草稿，版本号对不上时重读再做。"""
    for _ in range(3):
        try:
            updated = change(ctx.card)
        except EditError as exc:
            raise ctx.fail("invalid", field=exc.field, detail=exc.message) from exc
        new_name = ctx.name if name is None else name
        version = await ctx.store.write_card(
            ctx.run.draft_id,
            ctx.run.run_id,
            expected_version=ctx.version,
            name=new_name,
            card=updated,
            fields=touched,
        )
        if version is not None:
            ctx.card, ctx.name, ctx.version = updated, new_name, version
            ctx.written.extend(t for t in touched if t not in ctx.written)
            return
        fresh = await ctx.store.read_draft(ctx.run.draft_id)
        if fresh is None:
            raise ctx.fail("draft_gone")
        clash = [t for t in touched if _value(fresh.card, t) != _value(ctx.card, t)]
        ctx.card, ctx.name, ctx.version = fresh.card, fresh.name, fresh.version
        if clash:
            ctx.user_edits = tuple(dict.fromkeys((*ctx.user_edits, *clash)))
            raise ctx.fail("user_edited", where=", ".join(clash))
    raise ctx.fail("busy")


def _value(card: CharacterCard, where: str) -> Any:
    if where.startswith("lore."):
        return [(e.name, e.keys, e.content) for e in book_in_order(card.book)]
    if where == "alternate_greetings":
        return card.alternate_greetings
    if where == "display_name":
        return None
    return getattr(card, where, None)


def _edit(card: CharacterCard, **changes: Any) -> CharacterCard:
    """草稿模式（宽松）应用一处修改，长度照样检查。"""
    base = CardEdit.of(card)
    values = {f: getattr(base, f) for f in base.__dataclass_fields__}
    values.update(changes)
    return apply_edit(card, CardEdit(**values), lenient=True)


def _guard_user_edit(ctx: CardMakerContext, where: str, *, confirmed: bool) -> None:
    if where in ctx.user_edits and not confirmed:
        raise ctx.fail("user_edited", where=where)


# ---- 读 -----------------------------------------------------------------------------------


async def read_draft(args: Mapping[str, Any], ctx: CardMakerContext) -> str:
    ctx.count_call()
    digest = draft_digest(
        ctx.card,
        display_name=ctx.name,
        has_cover=ctx.run.cover_asset_id is not None or ctx.cover_set,
    )
    digest["user_edits"] = list(ctx.user_edits)
    return to_json(digest)


async def read_field(args: Mapping[str, Any], ctx: CardMakerContext) -> str:
    ctx.count_call()
    where = str(args["field"]).strip()
    card = ctx.card
    if where in EDITABLE_TEXT_FIELDS or where == "name":
        return getattr(card, where) or ctx.messages["empty"]
    if where == "tags":
        return ", ".join(card.tags) or ctx.messages["empty"]
    if where.startswith("greeting."):
        index = _index(where, "greeting.")
        if index is None or not 1 <= index <= len(card.alternate_greetings):
            raise ctx.fail("no_greeting", index=where)
        return card.alternate_greetings[index - 1]
    if where.startswith("lore."):
        index = _index(where, "lore.")
        book = book_in_order(card.book)
        if index is None or not 0 <= index < len(book):
            raise ctx.fail("no_entry", index=where)
        entry = book[index]
        return to_json(
            {
                "index": index,
                "name": entry.name,
                "keys": list(entry.keys),
                "constant": entry.constant,
                "enabled": entry.enabled,
                "content": entry.content,
            }
        )
    raise ctx.fail("no_field", field=where)


def _index(where: str, prefix: str) -> int | None:
    try:
        return int(where[len(prefix) :])
    except ValueError:
        return None


async def check_draft(args: Mapping[str, Any], ctx: CardMakerContext) -> str:
    ctx.count_call()
    issues = check_card(ctx.card, display_name=ctx.name or ctx.card.name)
    if not issues:
        return ctx.messages["check_ok"]
    return to_json(
        [{"field": i.field, "code": i.code, "level": i.level, **i.params} for i in issues]
    )


# ---- 沟通 ---------------------------------------------------------------------------------


async def update_todos(args: Mapping[str, Any], ctx: CardMakerContext) -> str:
    ctx.count_call()
    items = args.get("items")
    if not isinstance(items, list) or not items:
        raise ctx.fail("bad_todos")
    todos: list[dict[str, Any]] = []
    for index, item in enumerate(items[:MAX_TODOS]):
        if not isinstance(item, Mapping):
            continue
        text = str(item.get("text") or "").strip()[:60]
        if not text:
            continue
        state = item.get("state") if item.get("state") in ("todo", "doing", "done") else "todo"
        todos.append(
            {
                "key": str(item.get("key") or f"t{index}")[:40],
                "text": text,
                "state": state,
                "detail": str(item.get("detail") or "").strip()[:80],
            }
        )
    if not todos:
        raise ctx.fail("bad_todos")
    ctx.todos = todos
    await ctx.store.set_todos(ctx.run.draft_id, ctx.run.run_id, todos)
    await ctx.events.event("todos", {"todos": todos})
    return ctx.messages["ok"]


async def ask_user(args: Mapping[str, Any], ctx: CardMakerContext) -> str:
    ctx.count_call()
    try:
        content = normalize_questions(args)
    except MessageError as exc:
        raise ctx.fail("bad_message", detail=str(exc)) from exc
    await ctx.events.flush()
    ctx.awaiting_seq = await ctx.store.append_message(
        ctx.run.draft_id, ctx.run.run_id, kind="questions", content=content
    )
    ctx.ended = "questions"
    await ctx.store.set_stage(ctx.run.draft_id, ctx.run.run_id, "questions")
    return ctx.messages["sent"]


async def propose_plan(args: Mapping[str, Any], ctx: CardMakerContext) -> str:
    ctx.count_call()
    try:
        content = normalize_plan(args)
    except MessageError as exc:
        raise ctx.fail("bad_message", detail=str(exc)) from exc
    await ctx.events.flush()
    ctx.awaiting_seq = await ctx.store.append_message(
        ctx.run.draft_id, ctx.run.run_id, kind="plan", content=content
    )
    ctx.ended = "plan"
    await ctx.store.set_stage(ctx.run.draft_id, ctx.run.run_id, "plan")
    return ctx.messages["sent"]


async def propose_changes(args: Mapping[str, Any], ctx: CardMakerContext) -> str:
    ctx.count_call()
    raw = args.get("changes")
    if not isinstance(raw, list):
        raise ctx.fail("bad_message", detail="changes must be a list")
    proposed: list[ProposedChange] = []
    for item in raw:
        if not isinstance(item, Mapping) or not isinstance(item.get("target"), Mapping):
            raise ctx.fail("bad_message", detail="each change needs a target object")
        after = item.get("after")
        proposed.append(
            ProposedChange(
                target=item["target"],
                after=None if after is None else str(after),
                summary=str(item.get("summary") or ""),
            )
        )
    try:
        hunks = build_hunks(ctx.card, proposed)
    except ChangeError as exc:
        raise ctx.fail("bad_message", detail=str(exc)) from exc
    await ctx.events.flush()
    content = {"intro": str(args.get("intro") or "").strip()[:500], "hunks": hunks}
    ctx.awaiting_seq = await ctx.store.append_message(
        ctx.run.draft_id, ctx.run.run_id, kind="changes", content=content
    )
    ctx.ended = "changes"
    return ctx.messages["sent"]


async def show_images(args: Mapping[str, Any], ctx: CardMakerContext) -> str:
    ctx.count_call()
    ids = [str(a) for a in args.get("asset_ids") or [] if str(a) in ctx.assets]
    if not ids:
        raise ctx.fail("no_asset", asset_id=", ".join(map(str, args.get("asset_ids") or [])))
    purpose = (
        args.get("purpose")
        if args.get("purpose") in ("cover_candidates", "references")
        else "references"
    )
    await ctx.events.flush()
    await ctx.store.append_message(
        ctx.run.draft_id,
        ctx.run.run_id,
        kind="images",
        content={
            "asset_ids": ids[:8],
            "purpose": purpose,
            "note": str(args.get("note") or "")[:300],
        },
    )
    return ctx.messages["sent"]


# ---- 写卡 ---------------------------------------------------------------------------------


async def write_field(args: Mapping[str, Any], ctx: CardMakerContext) -> str:
    ctx.count_call()
    where = str(args["field"]).strip()
    text = str(args["text"])
    if where not in WRITABLE_FIELDS:
        raise ctx.fail("no_field", field=where)
    _guard_user_edit(ctx, where, confirmed=bool(args.get("user_confirmed")))
    if where == "display_name":
        name = text.replace("\x00", "").strip()[:80]
        await commit(ctx, lambda card: card, touched=["display_name"], name=name)
        return ctx.messages["written"].format(where=where, chars=len(name))
    if where == "tags":
        tags = tuple(t.strip() for t in text.replace("，", ",").replace("、", ",").split(","))
        await commit(ctx, lambda card: _edit(card, tags=tags), touched=["tags"])
        return ctx.messages["written"].format(where=where, chars=len(ctx.card.tags))
    await commit(ctx, lambda card: _edit(card, **{where: text}), touched=[where])
    return ctx.messages["written"].format(where=where, chars=len(getattr(ctx.card, where)))


async def set_greetings(args: Mapping[str, Any], ctx: CardMakerContext) -> str:
    ctx.count_call()
    raw = args.get("greetings")
    if not isinstance(raw, list):
        raise ctx.fail("invalid", field="greetings", detail="greetings must be a list")
    _guard_user_edit(ctx, "alternate_greetings", confirmed=bool(args.get("user_confirmed")))
    if any(e.startswith("greeting.") for e in ctx.user_edits) and not args.get("user_confirmed"):
        raise ctx.fail("user_edited", where="alternate_greetings")
    greetings = tuple(str(g) for g in raw if str(g).strip())
    await commit(
        ctx,
        lambda card: _edit(card, alternate_greetings=greetings),
        touched=["alternate_greetings"],
    )
    return ctx.messages["written"].format(
        where="alternate_greetings", chars=len(ctx.card.alternate_greetings)
    )


def _lore_edit(entry: LoreEntry) -> LoreEntryEdit:
    return LoreEntryEdit.of(entry)


async def lore_upsert(args: Mapping[str, Any], ctx: CardMakerContext) -> str:
    """index 给了就改那一条，没给就按名字找，找不到加在最后。"""
    ctx.count_call()
    name = str(args.get("name") or "").strip()
    content = str(args["content"])
    keys = tuple(str(k) for k in args.get("keys") or [] if str(k).strip())
    book = list(book_in_order(ctx.card.book))
    index = args.get("index")
    if isinstance(index, bool) or (index is not None and not isinstance(index, int)):
        index = None
    if index is not None and not 0 <= index < len(book):
        raise ctx.fail("no_entry", index=f"lore.{index}")
    if index is None and name:
        index = next((i for i, e in enumerate(book) if e.name == name), None)
    if index is not None:
        _guard_user_edit(
            ctx, f"lore.{book[index].name}", confirmed=bool(args.get("user_confirmed"))
        )
    added = index is None

    def change(card: CharacterCard) -> CharacterCard:
        entries = [_lore_edit(e) for e in book_in_order(card.book)]
        # 改已有的条目时，次要关键词、优先级这些 agent 不管的设置原样留着
        base = entries[index] if index is not None and index < len(entries) else LoreEntryEdit()
        target = replace(
            base,
            name=name or base.name,
            keys=keys,
            content=content,
            enabled=bool(args.get("enabled", True)),
            constant=bool(args.get("constant", False)),
        )
        if index is None:
            entries.append(target)
        elif index < len(entries):
            entries[index] = target
        else:
            raise EditError(f"lore.{index}", "the entry no longer exists")
        return _edit(card, book=tuple(entries))

    await commit(ctx, change, touched=[f"lore.{name or index}"])
    if added:
        ctx.lore_added += 1
    position = len(ctx.card.book) - 1 if index is None else index
    return ctx.messages["lore_written"].format(index=position, name=name)


async def lore_delete(args: Mapping[str, Any], ctx: CardMakerContext) -> str:
    ctx.count_call()
    index = args["index"]
    book = list(book_in_order(ctx.card.book))
    if not isinstance(index, int) or isinstance(index, bool) or not 0 <= index < len(book):
        raise ctx.fail("no_entry", index=f"lore.{index}")
    victim = book[index]
    _guard_user_edit(ctx, f"lore.{victim.name}", confirmed=bool(args.get("user_confirmed")))

    def change(card: CharacterCard) -> CharacterCard:
        entries = [_lore_edit(e) for e in book_in_order(card.book)]
        kept = [e for i, e in enumerate(entries) if not (i == index and e.name == victim.name)]
        return _edit(card, book=tuple(kept))

    await commit(ctx, change, touched=[f"lore.{victim.name}"])
    return ctx.messages["lore_deleted"].format(index=index, name=victim.name)


async def set_cover(args: Mapping[str, Any], ctx: CardMakerContext) -> str:
    ctx.count_call()
    asset_id = str(args["asset_id"])
    asset = ctx.assets.get(asset_id)
    if asset is None:
        raise ctx.fail("no_asset", asset_id=asset_id)
    if asset.license not in FREE_LICENSES and not asset.meta.get("personal_use"):
        raise ctx.fail("license", license=asset.license)
    version = await ctx.store.set_cover(ctx.run.draft_id, ctx.run.run_id, asset_id)
    if version is None:
        raise ctx.fail("draft_gone")
    ctx.version = version
    ctx.cover_set = True
    await ctx.events.event("draft", {"version": version, "fields": ["cover"]})
    return ctx.messages["ok"]


# ---- 注册表 --------------------------------------------------------------------------------

_STRING = {"type": "string"}
_TARGET = {
    "type": "object",
    "description": (
        "{field: name|description|...} / {greeting: n} / {lore: index} / "
        "{lore_new: {name, keys, constant}}"
    ),
}

TOOLS: tuple[Tool, ...] = (
    Tool(
        name="update_todos",
        kind="write",
        parameters={
            "type": "object",
            "properties": {
                "items": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "key": _STRING,
                            "text": _STRING,
                            "state": {"type": "string", "enum": ["todo", "doing", "done"]},
                            "detail": _STRING,
                        },
                        "required": ["text", "state"],
                    },
                }
            },
            "required": ["items"],
        },
        handler=update_todos,
    ),
    Tool(
        name="read_draft",
        kind="read",
        parameters={"type": "object", "properties": {}},
        handler=read_draft,
        max_result_chars=12000,
    ),
    Tool(
        name="read_field",
        kind="read",
        parameters={
            "type": "object",
            "properties": {"field": _STRING},
            "required": ["field"],
        },
        handler=read_field,
        max_result_chars=60000,
    ),
    Tool(
        name="check_draft",
        kind="read",
        parameters={"type": "object", "properties": {}},
        handler=check_draft,
        max_result_chars=6000,
    ),
    Tool(
        name="ask_user",
        kind="write",
        parameters={
            "type": "object",
            "properties": {
                "intro": _STRING,
                "questions": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "question": _STRING,
                            "choices": {"type": "array", "items": _STRING},
                            "recommended": {"type": "integer"},
                            "multi": {"type": "boolean"},
                        },
                        "required": ["question", "choices"],
                    },
                },
            },
            "required": ["questions"],
        },
        handler=ask_user,
    ),
    Tool(
        name="propose_plan",
        kind="write",
        parameters={
            "type": "object",
            "properties": {
                "names": {"type": "array", "items": _STRING},
                "pitch": _STRING,
                "sections": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {"key": _STRING, "heading": _STRING, "body": _STRING},
                        "required": ["heading", "body"],
                    },
                },
                "lore": {"type": "array", "items": _STRING},
                "opening": _STRING,
                "cover": {
                    "type": "object",
                    "properties": {
                        "mode": {
                            "type": "string",
                            "enum": ["generate", "search", "upload", "none"],
                        },
                        "count": {"type": "integer"},
                        "style": _STRING,
                        "note": _STRING,
                    },
                },
                "sources": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {"url": _STRING, "title": _STRING},
                    },
                },
                "estimate": {
                    "type": "object",
                    "properties": {
                        "searches": {"type": "integer"},
                        "pages": {"type": "integer"},
                        "images": {"type": "integer"},
                    },
                },
                "language": _STRING,
                "ip": {
                    "type": "object",
                    "properties": {"work": _STRING, "character": _STRING},
                },
            },
            "required": ["names", "pitch"],
        },
        handler=propose_plan,
    ),
    Tool(
        name="propose_changes",
        kind="write",
        parameters={
            "type": "object",
            "properties": {
                "intro": _STRING,
                "changes": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "target": _TARGET,
                            "after": {"type": ["string", "null"]},
                            "summary": _STRING,
                        },
                        "required": ["target", "after"],
                    },
                },
            },
            "required": ["changes"],
        },
        handler=propose_changes,
    ),
    Tool(
        name="show_images",
        kind="write",
        parameters={
            "type": "object",
            "properties": {
                "asset_ids": {"type": "array", "items": _STRING},
                "purpose": {"type": "string", "enum": ["cover_candidates", "references"]},
                "note": _STRING,
            },
            "required": ["asset_ids"],
        },
        handler=show_images,
    ),
    Tool(
        name="write_field",
        kind="write",
        parameters={
            "type": "object",
            "properties": {
                "field": {"type": "string", "enum": list(WRITABLE_FIELDS)},
                "text": _STRING,
                "user_confirmed": {"type": "boolean"},
            },
            "required": ["field", "text"],
        },
        handler=write_field,
    ),
    Tool(
        name="set_greetings",
        kind="write",
        parameters={
            "type": "object",
            "properties": {
                "greetings": {"type": "array", "items": _STRING},
                "user_confirmed": {"type": "boolean"},
            },
            "required": ["greetings"],
        },
        handler=set_greetings,
    ),
    Tool(
        name="lore_upsert",
        kind="write",
        parameters={
            "type": "object",
            "properties": {
                "index": {"type": "integer"},
                "name": _STRING,
                "keys": {"type": "array", "items": _STRING},
                "content": _STRING,
                "constant": {"type": "boolean"},
                "enabled": {"type": "boolean"},
                "user_confirmed": {"type": "boolean"},
            },
            "required": ["name", "content"],
        },
        handler=lore_upsert,
    ),
    Tool(
        name="lore_delete",
        kind="write",
        parameters={
            "type": "object",
            "properties": {
                "index": {"type": "integer"},
                "user_confirmed": {"type": "boolean"},
            },
            "required": ["index"],
        },
        handler=lore_delete,
    ),
    Tool(
        name="set_cover",
        kind="write",
        parameters={
            "type": "object",
            "properties": {"asset_id": _STRING},
            "required": ["asset_id"],
        },
        handler=set_cover,
    ),
)

# 工具参数里边收边推的字段：工具名 → (放正文的键, 指明写哪里的键)
STREAMED_ARGS: Mapping[str, tuple[str, str | None]] = {
    "write_field": ("text", "field"),
    "lore_upsert": ("content", "name"),
}


def registry(extra: Sequence[Tool] = ()) -> ToolRegistry:
    return ToolRegistry((*TOOLS, *extra))
