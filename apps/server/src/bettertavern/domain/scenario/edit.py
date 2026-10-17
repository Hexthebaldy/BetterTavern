"""导入后编辑角色卡：能改哪些字段、各自的上限和校验（上限和导入共用 card.py 里的常量）。

导入时超长的部分会被截断（不能因为一个字段太长就整张卡导入失败）；编辑时超长就拒绝并指出是哪个字段，
用户自己写的内容不能被悄悄截掉。改过的字段从 truncated（导入时被截断的记录）里去掉。

能改的是 AI 会读的部分：角色名、五个文本字段、标签，以及卡片自带的世界书条目。
系统提示、作者备注、备选开场白这些 AI 用不到的字段不开放，原样保留。
世界书条目按列表顺序重新编号（order），开局搭建世界时常驻条目优先、其次按这个顺序取。
"""

from __future__ import annotations

from dataclasses import dataclass

from .card import MAX_BOOK_ENTRIES, MAX_FIELD_CHARS, MAX_TOTAL_CHARS, CharacterCard, LoreEntry

EDITABLE_TEXT_FIELDS = ("description", "personality", "scenario", "first_mes", "mes_example")
MAX_NAME_CHARS = 80
MAX_TAGS = 32
MAX_TAG_CHARS = 40
MAX_ENTRY_NAME_CHARS = 120
MAX_KEYS = 64
MAX_KEY_CHARS = 100


class EditError(ValueError):
    """field 指出是哪个字段不合格：name、description、tags、book.3.content、card（总量）等。"""

    def __init__(self, field: str, message: str) -> None:
        super().__init__(message)
        self.field = field
        self.message = message


@dataclass(frozen=True, slots=True)
class LoreEntryEdit:
    name: str = ""
    keys: tuple[str, ...] = ()
    content: str = ""
    enabled: bool = True
    constant: bool = False


@dataclass(frozen=True, slots=True)
class CardEdit:
    name: str
    description: str = ""
    personality: str = ""
    scenario: str = ""
    first_mes: str = ""
    mes_example: str = ""
    tags: tuple[str, ...] = ()
    book: tuple[LoreEntryEdit, ...] = ()


def _clean(text: str) -> str:
    # Postgres 的 jsonb 不接受 \u0000；换行统一成 \n
    return text.replace("\x00", "").replace("\r\n", "\n").strip()


def _strings(
    values: tuple[str, ...], *, field: str, limit: int, each: int, what: str
) -> tuple[str, ...]:
    """去掉首尾空白、空项和重复项（保留先出现的）；超过个数或单项长度就拒绝。"""
    result: list[str] = []
    for value in values:
        item = _clean(value)
        if not item or item in result:
            continue
        if len(item) > each:
            raise EditError(field, f"{what} “{item[:20]}…” is too long; at most {each} characters")
        result.append(item)
    if len(result) > limit:
        raise EditError(field, f"At most {limit} {what}")
    return tuple(result)


def _entry(index: int, edit: LoreEntryEdit) -> LoreEntry:
    where = f"book.{index}"
    name = _clean(edit.name)
    if len(name) > MAX_ENTRY_NAME_CHARS:
        raise EditError(
            f"{where}.name", f"The entry name can be at most {MAX_ENTRY_NAME_CHARS} characters"
        )
    content = _clean(edit.content)
    if not content:
        raise EditError(f"{where}.content", "The entry content can't be empty")
    if len(content) > MAX_FIELD_CHARS:
        raise EditError(
            f"{where}.content", f"The entry content can be at most {MAX_FIELD_CHARS} characters"
        )
    keys = _strings(
        edit.keys, field=f"{where}.keys", limit=MAX_KEYS, each=MAX_KEY_CHARS, what="keywords"
    )
    return LoreEntry(
        name=name,
        keys=keys,
        content=content,
        constant=edit.constant,
        enabled=edit.enabled,
        order=index,
    )


def apply_edit(card: CharacterCard, edit: CardEdit) -> CharacterCard:
    """把编辑应用到卡片上，返回新卡片；不合格时抛 EditError。没开放的字段原样保留。"""
    name = _clean(edit.name)
    if not name:
        raise EditError("name", "The character name can't be empty")
    if len(name) > MAX_NAME_CHARS:
        raise EditError("name", f"The character name can be at most {MAX_NAME_CHARS} characters")
    texts: dict[str, str] = {}
    for field in EDITABLE_TEXT_FIELDS:
        text = _clean(getattr(edit, field))
        if len(text) > MAX_FIELD_CHARS:
            raise EditError(field, f"At most {MAX_FIELD_CHARS} characters (now {len(text)})")
        texts[field] = text
    tags = _strings(edit.tags, field="tags", limit=MAX_TAGS, each=MAX_TAG_CHARS, what="tags")
    if len(edit.book) > MAX_BOOK_ENTRIES:
        raise EditError("book", f"The lorebook can have at most {MAX_BOOK_ENTRIES} entries")
    book = tuple(_entry(i, entry) for i, entry in enumerate(edit.book))
    updated = card.model_copy(update={"name": name, "tags": tags, "book": book, **texts})
    if updated.total_chars() > MAX_TOTAL_CHARS:
        raise EditError(
            "card",
            f"The card can have at most {MAX_TOTAL_CHARS} characters in total "
            f"(now {updated.total_chars()})",
        )
    # 改过的字段不再算“导入时被截断”
    still_truncated = tuple(f for f in card.truncated if getattr(updated, f) == getattr(card, f))
    return updated.model_copy(update={"truncated": still_truncated})


def book_in_order(book: tuple[LoreEntry, ...]) -> tuple[LoreEntry, ...]:
    """按 order 排好的世界书（编辑页按这个顺序显示，保存时按列表顺序重新编号，先后关系不变）。"""
    return tuple(sorted(book, key=lambda e: e.order))


def changed_fields(before: CharacterCard, after: CharacterCard) -> list[str]:
    """哪些可编辑的字段变了（只用于日志，不记内容）。世界书只看内容和先后，不看编号本身。"""

    def entries(card: CharacterCard) -> list[tuple[object, ...]]:
        return [
            (e.name, e.keys, e.content, e.constant, e.enabled) for e in book_in_order(card.book)
        ]

    changed = [
        f
        for f in ("name", *EDITABLE_TEXT_FIELDS, "tags")
        if getattr(before, f) != getattr(after, f)
    ]
    if entries(before) != entries(after):
        changed.append("book")
    return changed
