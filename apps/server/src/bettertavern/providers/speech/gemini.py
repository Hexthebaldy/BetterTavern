"""gemini 协议：POST {base}/models/{model}:generateContent，要求回声音。
回的是没有封装的 PCM 数据（base64），这里包成 wav，浏览器和手机才放得了。"""

from __future__ import annotations

import base64
import binascii
import io
import re
import wave
from typing import Any

import httpx

from .base import SpeechAudio, SpeechConfig, SpeechError, Voice, raise_for_status

DEFAULT_BASE = "https://generativelanguage.googleapis.com/v1beta"
DEFAULT_RATE = 24000
VOICES = (
    "Kore",
    "Puck",
    "Zephyr",
    "Charon",
    "Fenrir",
    "Leda",
    "Orus",
    "Aoede",
    "Callirrhoe",
    "Autonoe",
    "Enceladus",
    "Iapetus",
    "Umbriel",
    "Algieba",
    "Despina",
    "Erinome",
    "Algenib",
    "Rasalgethi",
    "Laomedeia",
    "Achernar",
    "Alnilam",
    "Schedar",
    "Gacrux",
    "Pulcherrima",
    "Achird",
    "Zubenelgenubi",
    "Vindemiatrix",
    "Sadachbia",
    "Sadaltager",
    "Sulafat",
)


def _wav(pcm: bytes, rate: int) -> bytes:
    out = io.BytesIO()
    with wave.open(out, "wb") as file:
        file.setnchannels(1)
        file.setsampwidth(2)
        file.setframerate(rate)
        file.writeframes(pcm)
    return out.getvalue()


def _inline_audio(payload: Any) -> tuple[str, str]:
    """回复里的声音：（mime，base64 数据）。没有声音时是被内容策略拦了，或者回的格式不对。"""
    try:
        candidates = payload.get("candidates") or []
        if not candidates:
            if payload.get("promptFeedback", {}).get("blockReason"):
                raise SpeechError("blocked", "Gemini refused the text (content policy)")
            raise SpeechError("bad_response", "Gemini returned no audio")
        for part in candidates[0].get("content", {}).get("parts", []):
            inline = part.get("inlineData")
            if inline and inline.get("data"):
                return str(inline.get("mimeType", "")), str(inline["data"])
    except AttributeError as exc:
        raise SpeechError("bad_response", "Gemini returned an unexpected shape") from exc
    if candidates[0].get("finishReason") in ("SAFETY", "PROHIBITED_CONTENT", "BLOCKLIST"):
        raise SpeechError("blocked", "Gemini refused the text (content policy)")
    raise SpeechError("bad_response", "Gemini returned no audio")


class GeminiSpeech:
    id = "gemini"
    needs_base_url = False
    needs_model = True

    async def synthesize(
        self, client: httpx.AsyncClient, config: SpeechConfig, *, text: str, voice: str
    ) -> SpeechAudio:
        base = (config.base_url or DEFAULT_BASE).rstrip("/")
        response = await client.post(
            f"{base}/models/{config.model}:generateContent",
            headers={"x-goog-api-key": config.api_key},
            json={
                "contents": [{"parts": [{"text": text}]}],
                "generationConfig": {
                    "responseModalities": ["AUDIO"],
                    "speechConfig": {
                        "voiceConfig": {"prebuiltVoiceConfig": {"voiceName": voice}},
                    },
                },
                **config.extra_body(),
            },
        )
        raise_for_status(response.status_code, response.text[:4096], "Gemini")
        try:
            payload = response.json()
        except ValueError as exc:
            raise SpeechError("bad_response", "Gemini returned something that isn't JSON") from exc
        mime, data = _inline_audio(payload)
        try:
            raw = base64.b64decode(data, validate=False)
        except (binascii.Error, ValueError) as exc:
            raise SpeechError("bad_response", "Gemini's audio data isn't valid base64") from exc
        if not mime.startswith("audio/L16"):  # 已经是能放的格式（wav、mp3 等）
            return SpeechAudio(raw, mime or "audio/wav")
        rate = re.search(r"rate=(\d+)", mime)
        return SpeechAudio(_wav(raw, int(rate.group(1)) if rate else DEFAULT_RATE), "audio/wav")

    async def voices(self, client: httpx.AsyncClient, config: SpeechConfig) -> list[Voice]:
        return [Voice(name, name) for name in VOICES]
