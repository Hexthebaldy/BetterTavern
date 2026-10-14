"""角色卡导入：PNG（chara / ccv3 文本块）或 JSON（V1、V2、V3）→ 规范化的 CharacterCard。"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass
from typing import Any

from bettertavern.domain.scenario.card import CharacterCard

from .parse import CardError, decode_base64_json, loads, normalize_card
from .png import PNG_SIGNATURE, PngError, card_payload

MAX_UPLOAD_BYTES = 16 * 1024 * 1024

__all__ = ["MAX_UPLOAD_BYTES", "CardError", "ImportedCard", "import_card"]


@dataclass(frozen=True)
class ImportedCard:
    card: CharacterCard
    raw: Any  # 原始 JSON，原样存入 scenarios.raw
    sha256: str  # 整个上传文件的哈希
    image: bytes | None  # PNG 卡片本身就是头像
    image_mime: str | None


def import_card(data: bytes) -> ImportedCard:
    if len(data) > MAX_UPLOAD_BYTES:
        raise CardError(f"文件超过 {MAX_UPLOAD_BYTES // (1024 * 1024)} MB")
    digest = hashlib.sha256(data).hexdigest()
    if data.startswith(PNG_SIGNATURE):
        try:
            _keyword, payload = card_payload(data)
        except PngError as exc:
            raise CardError(str(exc)) from exc
        raw = decode_base64_json(payload)
        return ImportedCard(
            card=normalize_card(raw), raw=raw, sha256=digest, image=data, image_mime="image/png"
        )
    stripped = data.lstrip()
    if stripped.startswith((b"{", b"\xef\xbb\xbf")):
        raw = loads(data)
        return ImportedCard(
            card=normalize_card(raw), raw=raw, sha256=digest, image=None, image_mime=None
        )
    raise CardError("只支持 PNG 角色卡或 JSON 角色卡")
