"""导出角色卡：V3 的 JSON，或者把卡片数据写进封面 PNG
（ccv3 写 V3，chara 写 V2，SillyTavern 两种都认）。

导入的卡保留原始 JSON 里 extensions 的内容（别的软件的设置），BetterTavern 自己的信息放进
extensions.bettertavern，角色备注写回 extensions.depth_prompt。卡片文字原样写出，不做宏替换。
"""

from __future__ import annotations

import base64
import json
import zlib
from collections.abc import Mapping
from typing import Any

from bettertavern.domain.scenario.card import CharacterCard, LoreEntry
from bettertavern.domain.scenario.edit import book_in_order

from .png import PNG_SIGNATURE


def _extensions(raw: Any) -> dict[str, Any]:
    if not isinstance(raw, Mapping):
        return {}
    inner = raw.get("data") if isinstance(raw.get("data"), Mapping) else raw
    ext = inner.get("extensions") if isinstance(inner, Mapping) else None
    return dict(ext) if isinstance(ext, Mapping) else {}


# 次要关键词的逻辑 → ST 的 selectiveLogic
_LOGIC = {"any": 0, "not_all": 1, "not_any": 2, "all": 3}
_MATCH_KEYS = {
    "persona": "match_persona_description",
    "description": "match_character_description",
    "personality": "match_character_personality",
    "depth_prompt": "match_character_depth_prompt",
    "scenario": "match_scenario",
    "creator_notes": "match_creator_notes",
}


def _entry(index: int, entry: LoreEntry) -> dict[str, Any]:
    """一条世界书写成 character_book 的格式，ST 的设置写进 extensions（键名同 ST 导出卡时写的）。
    粘滞、冷却、延迟我们按回合存，写回去时换成消息条数（一回合两条）。"""
    rules = entry.effective_rules()
    extensions: dict[str, Any] = {
        "display_index": index,
        "selectiveLogic": _LOGIC[entry.logic],
        "probability": rules.probability,
        "useProbability": rules.probability < 100,
        "group": ",".join(rules.groups),
        "group_override": rules.group_override,
        "group_weight": rules.group_weight,
        "use_group_scoring": rules.group_scoring,
        "exclude_recursion": rules.exclude_recursion,
        "prevent_recursion": rules.prevent_recursion,
        "delay_until_recursion": rules.delay_until_recursion,
        "scan_depth": rules.scan_depth,
        "case_sensitive": rules.case_sensitive,
        "match_whole_words": rules.whole_words,
        "sticky": rules.sticky * 2,
        "cooldown": rules.cooldown * 2,
        "delay": rules.delay * 2,
        "triggers": list(rules.triggers),
        "ignore_budget": rules.ignore_budget,
        **{key: name in rules.match for name, key in _MATCH_KEYS.items()},
    }
    return {
        "id": index,
        "keys": list(entry.keys),
        "secondary_keys": list(entry.secondary_keys),
        "selective": bool(entry.secondary_keys),
        "content": entry.content,
        "extensions": extensions,
        "enabled": entry.enabled,
        "insertion_order": entry.effective_priority(),
        "constant": entry.constant,
        "name": entry.name,
        "comment": entry.name,
        "use_regex": False,
    }


def card_data(card: CharacterCard, *, raw: Any, extra: Mapping[str, Any]) -> dict[str, Any]:
    """V2、V3 共用的 data 部分。"""
    extensions = _extensions(raw)
    extensions["bettertavern"] = dict(extra)
    # 角色备注写回 ST 的位置；原卡里的插入深度和角色照旧，没有就用 ST 的默认值
    note = extensions.get("depth_prompt")
    if card.depth_prompt or isinstance(note, Mapping):
        base = dict(note) if isinstance(note, Mapping) else {"depth": 4, "role": "system"}
        extensions["depth_prompt"] = {**base, "prompt": card.depth_prompt}
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
            "entries": [_entry(index, e) for index, e in enumerate(book)],
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
