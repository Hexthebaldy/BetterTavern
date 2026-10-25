"""导入独立的世界书（docs/lorebook.md 第 6 节）：JSON 文件 → 书名、简介、规范化的条目和导入报告。

按内容识别格式，不看扩展名：
1. SillyTavern 的世界书文件：顶层有 entries（对象或数组），条目里是 key、content；
2. 角色卡规范里单独导出的世界书：{"spec": "lorebook_v3", "data": {...}}，
   或者直接是一个 character_book；
3. 角色卡：拒绝（code=is_card），客户端提示去工作台导入；
4. 其他（NovelAI、Agnai、RisuAI 的格式）：不认。

没有正文的、没有关键词又不是常驻的条目丢掉；最多 MAX_LOREBOOK_ENTRIES 条（按显示的先后取）；
正文加起来超过 MAX_LOREBOOK_CHARS 字的拒绝。原始 JSON 原样留着（lorebooks.raw）。
"""

from __future__ import annotations

import hashlib
import json
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import PurePath
from typing import Any, Literal

from bettertavern.domain.scenario.card import LoreEntry
from bettertavern.domain.scenario.lorebook import (
    MAX_LOREBOOK_CHARS,
    MAX_LOREBOOK_DESCRIPTION_CHARS,
    MAX_LOREBOOK_ENTRIES,
    MAX_LOREBOOK_NAME_CHARS,
    LorebookReport,
    book_chars,
    never_triggers,
)

from .entries import EntryStats, from_book, from_world, is_book_entry, text

MAX_UPLOAD_BYTES = 8 * 1024 * 1024
# 一个文件里最多看这么多条（丢掉空条目之前）；再多的直接不看，免得一个文件撑爆内存
MAX_RAW_ENTRIES = 20_000

LorebookSource = Literal["st_world", "lorebook"]

__all__ = ["MAX_UPLOAD_BYTES", "ImportedLorebook", "LorebookError", "import_lorebook"]


class LorebookError(ValueError):
    """code：invalid（不是世界书、坏了、超限）/ is_card（传的是角色卡）。"""

    def __init__(self, message: str, *, code: Literal["invalid", "is_card"] = "invalid") -> None:
        super().__init__(message)
        self.code = code


@dataclass(frozen=True)
class ImportedLorebook:
    name: str
    description: str
    source: LorebookSource
    book: tuple[LoreEntry, ...]
    report: LorebookReport
    raw: Any
    sha256: str


def _loads(data: bytes) -> Any:
    try:
        return json.loads(data.decode("utf-8-sig"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise LorebookError("The file isn't valid JSON") from exc
    except RecursionError as exc:
        raise LorebookError("The file is nested too deeply") from exc


def _is_card(data: Mapping[str, Any]) -> bool:
    spec = data.get("spec")
    if isinstance(spec, str) and spec.startswith("chara_card"):
        return True
    inner = data.get("data")
    fields = inner if isinstance(inner, Mapping) else data
    return "first_mes" in fields or (
        "name" in fields and "description" in fields and "personality" in fields
    )


def _book_of(data: Any) -> tuple[Mapping[str, Any], LorebookSource]:
    if not isinstance(data, Mapping):
        raise LorebookError("The file must be a JSON object")
    if _is_card(data):
        raise LorebookError("This is a character card, not a lorebook", code="is_card")
    inner = data.get("data")
    if data.get("spec") == "lorebook_v3" and isinstance(inner, Mapping):
        return inner, "lorebook"
    entries = data.get("entries")
    if isinstance(entries, Mapping):
        return data, "st_world"
    if isinstance(entries, list):
        is_book = any(isinstance(e, Mapping) and is_book_entry(e) for e in entries[:50])
        return data, "lorebook" if is_book else "st_world"
    raise LorebookError("Unrecognized lorebook format (no entries)")


def _raw_entries(book: Mapping[str, Any]) -> list[Mapping[str, Any]]:
    entries = book.get("entries")
    items = list(entries.values()) if isinstance(entries, Mapping) else entries
    if not isinstance(items, list):
        return []
    return [e for e in items[:MAX_RAW_ENTRIES] if isinstance(e, Mapping)]


def _name(data: Mapping[str, Any], book: Mapping[str, Any], filename: str) -> str:
    original = data.get("originalData")
    candidates = (
        book.get("name"),
        original.get("name") if isinstance(original, Mapping) else None,
        PurePath(filename).stem if filename else None,
    )
    for value in candidates:
        name = " ".join(text(value).split())[:MAX_LOREBOOK_NAME_CHARS]
        if name:
            return name
    return "Lorebook"


def import_lorebook(data: bytes, *, filename: str = "") -> ImportedLorebook:
    if len(data) > MAX_UPLOAD_BYTES:
        raise LorebookError(f"File exceeds {MAX_UPLOAD_BYTES // (1024 * 1024)} MB")
    raw = _loads(data)
    book, source = _book_of(raw)
    kept: list[tuple[int, int, LoreEntry, EntryStats]] = []
    empty = unreachable = 0
    for index, item in enumerate(_raw_entries(book)):
        convert = from_book if is_book_entry(item) else from_world
        one = EntryStats()  # 只数留下来的条目
        entry = convert(item, index=index, stats=one)
        if entry is None:
            empty += 1
        elif never_triggers(entry):
            unreachable += 1
        else:
            kept.append((entry.order, index, entry, one))
    if not kept:
        raise LorebookError("The lorebook has no usable entries")
    kept.sort(key=lambda t: (t[0], t[1]))
    over = max(0, len(kept) - MAX_LOREBOOK_ENTRIES)
    kept = kept[:MAX_LOREBOOK_ENTRIES]
    entries = tuple(e.model_copy(update={"order": i}) for i, (_, _, e, _) in enumerate(kept))
    stats = EntryStats(
        vectorized=sum(t[3].vectorized for t in kept),
        character_filter=sum(t[3].character_filter for t in kept),
        bad_regex=sum(t[3].bad_regex for t in kept),
        other_macros=sum(t[3].other_macros for t in kept),
    )
    total = book_chars(entries)
    if total > MAX_LOREBOOK_CHARS:
        raise LorebookError(f"The lorebook has more than {MAX_LOREBOOK_CHARS} characters of text")
    report = LorebookReport(
        entries=len(entries),
        constant=sum(1 for e in entries if e.constant),
        disabled=sum(1 for e in entries if not e.enabled),
        dropped_empty=empty,
        dropped_unreachable=unreachable,
        dropped_over_limit=over,
        vectorized=stats.vectorized,
        character_filter=stats.character_filter,
        bad_regex=stats.bad_regex,
        other_macros=stats.other_macros,
    )
    return ImportedLorebook(
        name=_name(raw, book, filename),
        description=text(book.get("description")).strip()[:MAX_LOREBOOK_DESCRIPTION_CHARS],
        source=source,
        book=entries,
        report=report,
        raw=raw,
        sha256=hashlib.sha256(data).hexdigest(),
    )
