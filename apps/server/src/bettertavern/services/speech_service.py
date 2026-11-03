"""朗读（docs/speech.md）：把一小段文字交给玩家配的语音服务，声音原样还给客户端。

声音不存：同一段读过一次由客户端留在本机。Key 只在这里解开，不出服务器。
日志只记服务、字数、多大、用了多久、失败的原因，不写文字。
"""

from __future__ import annotations

import asyncio
import time

import httpx
import structlog

from bettertavern.providers.speech import (
    SPEECH_PROTOCOLS,
    SpeechAudio,
    SpeechConfig,
    SpeechError,
    SpeechProtocol,
    Voice,
)
from bettertavern.runtime.ports import ToolConfig

from .errors import AppError, Invalid
from .tool_route_service import ToolRouteService

log = structlog.get_logger(__name__)

# 一小段合成的时限：几家服务一般几秒，读长一点的段落也够
SYNTHESIZE_TIMEOUT_S = 60.0
VOICES_TIMEOUT_S = 20.0
# 下一次重试可能好起来的失败
RETRYABLE = ("http", "network", "timeout", "quota")


def _failed(kind: str, message: str) -> AppError:
    return AppError(
        message, code="SPEECH_FAILED", status=502, retryable=kind in RETRYABLE, reason=kind
    )


def _speech_config(config: ToolConfig) -> SpeechConfig:
    return SpeechConfig(
        model=config.model,
        api_key=config.api_key,
        base_url=config.base_url,
        params=config.params,
    )


class SpeechService:
    def __init__(self, tools: ToolRouteService, client: httpx.AsyncClient) -> None:
        self._tools = tools
        self._client = client

    async def synthesize(
        self, user_id: str, *, text: str, route_id: str | None = None, voice: str | None = None
    ) -> SpeechAudio:
        text = text.strip()
        if not text:
            raise Invalid("Nothing to read", field="text")
        config = await self._tools.speech_config(user_id, route_id)
        if config is None:
            raise AppError("No speech service is set up", code="SPEECH_NOT_CONFIGURED", status=409)
        protocol = SPEECH_PROTOCOLS[config.provider]
        settings = _speech_config(config)
        started = time.perf_counter()
        try:
            async with asyncio.timeout(SYNTHESIZE_TIMEOUT_S):
                chosen = voice or await self._default_voice(protocol, settings)
                audio = await protocol.synthesize(self._client, settings, text=text, voice=chosen)
        except SpeechError as exc:
            self._log_failure(config, exc.kind, started)
            raise _failed(exc.kind, exc.message) from exc
        except httpx.HTTPError as exc:
            self._log_failure(config, "network", started)
            raise _failed(
                "network", f"Couldn't reach the speech service: {type(exc).__name__}"
            ) from exc
        except TimeoutError as exc:
            self._log_failure(config, "timeout", started)
            raise _failed("timeout", "The speech service took too long") from exc
        log.info(
            "speech.synthesized",
            route_id=config.route_id,
            provider=config.provider,
            chars=len(text),
            bytes=len(audio.data),
            duration_ms=int((time.perf_counter() - started) * 1000),
        )
        return audio

    async def voices(self, user_id: str, route_id: str) -> list[Voice]:
        config = await self._tools.speech_config(user_id, route_id)
        assert config is not None  # 指定了服务时不存在就是 404
        protocol = SPEECH_PROTOCOLS[config.provider]
        try:
            async with asyncio.timeout(VOICES_TIMEOUT_S):
                voices = await protocol.voices(self._client, _speech_config(config))
        except SpeechError as exc:
            raise _failed(exc.kind, exc.message) from exc
        except httpx.HTTPError as exc:
            raise _failed(
                "network", f"Couldn't reach the speech service: {type(exc).__name__}"
            ) from exc
        except TimeoutError as exc:
            raise _failed("timeout", "The speech service took too long") from exc
        # 设置里填的默认声音排在最前面（可能是列表里没有的自定义声音）
        own = config.params.get("voice")
        if isinstance(own, str) and own:
            voices = [Voice(own, own), *[v for v in voices if v.id != own]]
        return voices

    async def _default_voice(self, protocol: SpeechProtocol, settings: SpeechConfig) -> str:
        own = settings.params.get("voice")
        if isinstance(own, str) and own:
            return own
        voices = await protocol.voices(self._client, settings)
        if not voices:
            raise SpeechError("bad_response", "The service lists no voices")
        return voices[0].id

    def _log_failure(self, config: ToolConfig, kind: str, started: float) -> None:
        log.warning(
            "speech.failed",
            route_id=config.route_id,
            provider=config.provider,
            reason=kind,
            duration_ms=int((time.perf_counter() - started) * 1000),
        )
