"""导出角色卡：V3 的 JSON，或者把卡片数据写进封面 PNG
（ccv3 写 V3，chara 写 V2，SillyTavern 两种都认）。

导入的卡保留原始 JSON 里 extensions 的内容（别的软件的设置），BetterTavern 自己的信息放进
extensions.bettertavern。卡片文字原样写出，不做宏替换。
"""

from __future__ import annotations

import base64
import json
import zlib
from collections.abc import Mapping
from typing import Any

from bettertavern.domain.scenario.card import CharacterCard
from bettertavern.domain.scenario.edit import book_in_order

from .png import PNG_SIGNATURE


def _extensions(raw: Any) -> dict[str, Any]:
    if not isinstance(raw, Mapping):
        return {}
    inner = raw.get("data") if isinstance(raw.get("data"), Mapping) else raw
    ext = inner.get("extensions") if isinstance(inner, Mapping) else None
    return dict(ext) if isinstance(ext, Mapping) else {}


def card_data(card: CharacterCard, *, raw: Any, extra: Mapping[str, Any]) -> dict[str, Any]:
    """V2、V3 共用的 data 部分。"""
    extensions = _extensions(raw)
    extensions["bettertavern"] = dict(extra)
    book = book_in_order(card.book)
    data: dict[str, Any] = {
        "name": card.name,
        "description": card.description,
        "personality": card.personality,
        "scenario": card.scenario,
        "first_mes": card.first_mes,
        "mes_example": card.mes_example,
        "creator_notes": card.creator_notes,
        "system_prompt": card.system_prompt,
        "post_history_instructions": card.post_history_instructions,
        "alternate_greetings": list(card.alternate_greetings),
        "tags": list(card.tags),
        "creator": card.creator,
        "character_version": card.character_version,
        "extensions": extensions,
    }
    if book:
        data["character_book"] = {
            "name": card.book_name or card.name,
            "extensions": {},
            "entries": [
                {
                    "id": index,
                    "keys": list(e.keys),
                    "content": e.content,
                    "extensions": {},
                    "enabled": e.enabled,
                    "insertion_order": index,
                    "constant": e.constant,
                    "name": e.name,
                    "comment": e.name,
                    "use_regex": False,
                }
                for index, e in enumerate(book)
            ],
        }
    return data


def card_v3(card: CharacterCard, *, raw: Any, extra: Mapping[str, Any]) -> dict[str, Any]:
    data = card_data(card, raw=raw, extra=extra)
    data["nickname"] = card.nickname
    data["group_only_greetings"] = []
    data["assets"] = [{"type": "icon", "uri": "ccdefault:", "name": "main", "ext": "png"}]
    return {"spec": "chara_card_v3", "spec_version": "3.0", "data": data}


def card_v2(card: CharacterCard, *, raw: Any, extra: Mapping[str, Any]) -> dict[str, Any]:
    return {
        "spec": "chara_card_v2",
        "spec_version": "2.0",
        "data": card_data(card, raw=raw, extra=extra),
    }


def _chunk(kind: bytes, body: bytes) -> bytes:
    crc = zlib.crc32(kind + body) & 0xFFFFFFFF
    return len(body).to_bytes(4, "big") + kind + body + crc.to_bytes(4, "big")


def _b64(value: Any) -> bytes:
    text = json.dumps(value, ensure_ascii=False, separators=(",", ":"))
    return base64.b64encode(text.encode("utf-8"))


def embed_card(png: bytes, *, v2: Mapping[str, Any], v3: Mapping[str, Any]) -> bytes:
    """在 IEND 之前插入 chara（V2）和 ccv3（V3）两个 tEXt 块。png 必须是不带角色卡文本块的图。"""
    if not png.startswith(PNG_SIGNATURE):
        raise ValueError("Not a PNG image")
    iend = png.rfind(b"IEND")
    if iend < 4:
        raise ValueError("Truncated PNG image")
    start = iend - 4  # 长度字段
    chunks = _chunk(b"tEXt", b"chara\x00" + _b64(v2)) + _chunk(b"tEXt", b"ccv3\x00" + _b64(v3))
    return png[:start] + chunks + png[start:]
