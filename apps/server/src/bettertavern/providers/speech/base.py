"""朗读（文字转语音）的统一形状（docs/speech.md）：按接口协议接，不按厂家接。

统一的输入：一小段文字和声音的名字。返回声音文件的内容；语速由客户端放的时候调，换语速不用重新合成。
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass, field
from typing import Any, Protocol

import httpx

from ..errors import short_error_text

# 一小段最多 1000 字，读出来几分钟；wav 也不会超过这个大小
MAX_AUDIO_BYTES = 32 * 1024 * 1024


class SpeechError(Exception):
    """kind：auth、quota、blocked（内容策略）、http、network、bad_response、unsupported。"""

    def __init__(self, kind: str, message: str) -> None:
        super().__init__(message)
        self.kind = kind
        self.message = message


@dataclass(frozen=True, slots=True)
class SpeechConfig:
    model: str = ""
    api_key: str = ""
    base_url: str = ""
    params: Mapping[str, Any] = field(default_factory=dict)

    def extra_body(self) -> dict[str, Any]:
        extra = self.params.get("extra_body")
        return dict(extra) if isinstance(extra, Mapping) else {}


@dataclass(frozen=True, slots=True)
class SpeechAudio:
    data: bytes
    mime: str


@dataclass(frozen=True, slots=True)
class Voice:
    id: str  # 发给服务的名字或编号
    name: str  # 显示给玩家看的


class SpeechProtocol(Protocol):
    id: str
    needs_base_url: bool
    needs_model: bool

    async def synthesize(
        self, client: httpx.AsyncClient, config: SpeechConfig, *, text: str, voice: str
    ) -> SpeechAudio: ...

    async def voices(self, client: httpx.AsyncClient, config: SpeechConfig) -> list[Voice]: ...


def raise_for_status(status: int, body: str, vendor: str) -> None:
    if status < 400:
        return
    if status in (401, 403):
        raise SpeechError("auth", f"{vendor} rejected the key ({status})")
    if status in (402, 429):
        raise SpeechError("quota", f"{vendor} is out of quota or rate-limiting ({status})")
    if status == 400 and "safety" in body.lower():
        raise SpeechError("blocked", f"{vendor} refused the text (content policy)")
    said = short_error_text(body)
    raise SpeechError("http", f"{vendor} returned HTTP {status}" + (f": {said}" if said else ""))


async def fetch_audio(
    client: httpx.AsyncClient,
    url: str,
    *,
    vendor: str,
    json: Mapping[str, Any],
    headers: Mapping[str, str],
    params: Mapping[str, str] | None = None,
) -> SpeechAudio:
    """发请求、边收边数大小，收到的必须是声音（有的服务出错时也回 200 加一段 JSON）。"""
    async with client.stream("POST", url, json=json, headers=headers, params=params) as response:
        if response.status_code >= 400:
            body = (await response.aread())[:4096].decode(errors="replace")
            raise_for_status(response.status_code, body, vendor)
        kind = response.headers.get("content-type", "").split(";")[0].strip().lower()
        if kind.startswith(("application/json", "text/")):
            raise SpeechError("bad_response", f"{vendor} didn't return audio ({kind})")
        data = bytearray()
        async for piece in response.aiter_bytes():
            data += piece
            if len(data) > MAX_AUDIO_BYTES:
                raise SpeechError("bad_response", f"{vendor} returned more than 32 MB of audio")
    if not data:
        raise SpeechError("bad_response", f"{vendor} returned no audio")
    return SpeechAudio(bytes(data), kind if kind.startswith("audio/") else "audio/mpeg")
