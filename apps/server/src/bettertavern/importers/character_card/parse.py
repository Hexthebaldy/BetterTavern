"""角色卡 JSON 的解析与规范化：识别 V1（平铺字段）、V2（chara_card_v2）、V3（chara_card_v3）。

只取故事需要的字段；其余（扩展字段、资源列表）保留在 scenarios.raw 里，不参与生成。
"""

from __future__ import annotations

import base64
import binascii
import json
from collections.abc import Mapping
from typing import Any

from bettertavern.domain.scenario.card import (
    MAX_BOOK_ENTRIES,
    MAX_FIELD_CHARS,
    MAX_TOTAL_CHARS,
    CardSpec,
    CharacterCard,
    LoreEntry,
)

MAX_JSON_BYTES = 4 * 1024 * 1024
TEXT_FIELDS = (
    "description",
    "personality",
    "scenario",
    "first_mes",
    "mes_example",
    "system_prompt",
    "post_history_instructions",
    "creator_notes",
)


class CardError(ValueError):
    pass


def decode_base64_json(payload: bytes) -> Any:
    try:
        raw = base64.b64decode(payload.strip(), validate=False)
    except (binascii.Error, ValueError) as exc:
        raise CardError("The card data isn't valid base64") from exc
    return loads(raw)


def loads(raw: bytes) -> Any:
    if len(raw) > MAX_JSON_BYTES:
        raise CardError("The card data is too large")
    try:
        return json.loads(raw.decode("utf-8-sig"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise CardError("The card data isn't valid JSON") from exc
    except RecursionError as exc:  # 嵌套极深的 JSON
        raise CardError("The card data is nested too deeply") from exc


def _text(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, str):
        return value.replace("\r\n", "\n")
    if isinstance(value, int | float | bool):
        return str(value)
    return ""


def _strings(value: Any, limit: int = 64) -> tuple[str, ...]:
    if not isinstance(value, list):
        return ()
    return tuple(_text(v).strip() for v in value[:limit] if _text(v).strip())


def detect_spec(data: Mapping[str, Any]) -> tuple[CardSpec, Mapping[str, Any]]:
    spec = data.get("spec")
    inner = data.get("data")
    if spec == "chara_card_v3" and isinstance(inner, Mapping):
        return "card_v3", inner
    if spec == "chara_card_v2" and isinstance(inner, Mapping):
        return "card_v2", inner
    if isinstance(inner, Mapping) and inner.get("name"):
        return "card_v2", inner  # 没写 spec 但结构是 V2
    if data.get("name") and any(k in data for k in ("description", "first_mes", "personality")):
        return "card_v1", data
    raise CardError("Unrecognized card format (not V1, V2 or V3)")


def _book(data: Mapping[str, Any]) -> tuple[str, tuple[LoreEntry, ...]]:
    book = data.get("character_book")
    if not isinstance(book, Mapping):
        return "", ()
    entries_raw = book.get("entries")
    if isinstance(entries_raw, Mapping):  # 少数导出工具把条目写成对象
        entries_raw = list(entries_raw.values())
    if not isinstance(entries_raw, list):
        return _text(book.get("name")), ()
    entries: list[LoreEntry] = []
    for index, item in enumerate(entries_raw[:MAX_BOOK_ENTRIES]):
        if not isinstance(item, Mapping):
            continue
        content = _text(item.get("content")).strip()
        if not content:
            continue
        order = item.get("insertion_order", item.get("order", index))
        entries.append(
            LoreEntry(
                name=_text(item.get("name") or item.get("comment")).strip()[:120],
                keys=_strings(item.get("keys")),
                content=content[:MAX_FIELD_CHARS],
                constant=bool(item.get("constant", False)),
                enabled=bool(item.get("enabled", True)),
                order=order if isinstance(order, int) else index,
            )
        )
    return _text(book.get("name")).strip()[:120], tuple(entries)


def normalize_card(data: Any) -> CharacterCard:
    if not isinstance(data, Mapping):
        raise CardError("The card data must be a JSON object")
    spec, fields = detect_spec(data)
    name = _text(fields.get("name")).strip()
    if not name:
        raise CardError("The card has no name")
    truncated: list[str] = []
    values: dict[str, str] = {}
    for key in TEXT_FIELDS:
        text = _text(fields.get(key)).strip()
        if len(text) > MAX_FIELD_CHARS:
            text = text[:MAX_FIELD_CHARS]
            truncated.append(key)
        values[key] = text
    greetings = tuple(g[:MAX_FIELD_CHARS] for g in _strings(fields.get("alternate_greetings")))
    book_name, book = _book(fields)
    card = CharacterCard(
        spec=spec,
        name=name[:80],
        alternate_greetings=greetings,
        creator=_text(fields.get("creator")).strip()[:120],
        character_version=_text(fields.get("character_version")).strip()[:40],
        nickname=_text(fields.get("nickname")).strip()[:80],
        tags=_strings(fields.get("tags"), limit=32),
        book_name=book_name,
        book=book,
        truncated=tuple(truncated),
        **values,
    )
    if card.total_chars() > MAX_TOTAL_CHARS:
        raise CardError(f"The card has more than {MAX_TOTAL_CHARS} characters of text")
    return card
