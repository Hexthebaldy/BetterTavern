"""openai_speech 协议：POST {base}/audio/speech，回的是声音文件。
OpenAI 的 gpt-4o-mini-tts、硅基流动的 CosyVoice 以及各种中转和自己架的服务都兼容这个接口。"""

from __future__ import annotations

import httpx

from .base import SpeechAudio, SpeechConfig, Voice, fetch_audio

DEFAULT_BASE = "https://api.openai.com/v1"
OPENAI_VOICES = (
    "alloy",
    "ash",
    "ballad",
    "cedar",
    "coral",
    "echo",
    "fable",
    "marin",
    "nova",
    "onyx",
    "sage",
    "shimmer",
    "verse",
)
# 硅基流动的 CosyVoice：声音的名字要带模型名（模型名:alex）
COSYVOICE_VOICES = ("alex", "benjamin", "charles", "david", "anna", "bella", "claire", "diana")


class OpenAISpeech:
    id = "openai_speech"
    needs_base_url = False
    needs_model = True

    async def synthesize(
        self, client: httpx.AsyncClient, config: SpeechConfig, *, text: str, voice: str
    ) -> SpeechAudio:
        base = (config.base_url or DEFAULT_BASE).rstrip("/")
        return await fetch_audio(
            client,
            f"{base}/audio/speech",
            vendor="Speech service",
            json={
                "model": config.model,
                "input": text,
                "voice": voice,
                "response_format": "mp3",
                **config.extra_body(),
            },
            headers={"Authorization": f"Bearer {config.api_key}"},
        )

    async def voices(self, client: httpx.AsyncClient, config: SpeechConfig) -> list[Voice]:
        if "cosyvoice" in config.model.lower():
            return [Voice(f"{config.model}:{name}", name) for name in COSYVOICE_VOICES]
        return [Voice(name, name) for name in OPENAI_VOICES]
