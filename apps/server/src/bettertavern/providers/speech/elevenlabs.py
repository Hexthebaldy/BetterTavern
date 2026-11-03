"""elevenlabs 协议：POST {base}/text-to-speech/{voice}；声音列表从 GET {base}/voices 读。"""

from __future__ import annotations

from urllib.parse import quote

import httpx

from .base import SpeechAudio, SpeechConfig, SpeechError, Voice, fetch_audio, raise_for_status

DEFAULT_BASE = "https://api.elevenlabs.io/v1"
DEFAULT_MODEL = "eleven_multilingual_v2"


class ElevenLabsSpeech:
    id = "elevenlabs"
    needs_base_url = False
    needs_model = False

    async def synthesize(
        self, client: httpx.AsyncClient, config: SpeechConfig, *, text: str, voice: str
    ) -> SpeechAudio:
        base = (config.base_url or DEFAULT_BASE).rstrip("/")
        return await fetch_audio(
            client,
            f"{base}/text-to-speech/{quote(voice, safe='')}",
            vendor="ElevenLabs",
            params={"output_format": "mp3_44100_128"},
            json={
                "text": text,
                "model_id": config.model or DEFAULT_MODEL,
                **config.extra_body(),
            },
            headers={"xi-api-key": config.api_key},
        )

    async def voices(self, client: httpx.AsyncClient, config: SpeechConfig) -> list[Voice]:
        base = (config.base_url or DEFAULT_BASE).rstrip("/")
        response = await client.get(f"{base}/voices", headers={"xi-api-key": config.api_key})
        raise_for_status(response.status_code, response.text[:4096], "ElevenLabs")
        try:
            items = response.json().get("voices", [])
            return [Voice(str(v["voice_id"]), str(v.get("name") or v["voice_id"])) for v in items]
        except (ValueError, AttributeError, KeyError, TypeError) as exc:
            raise SpeechError("bad_response", "ElevenLabs returned an unexpected shape") from exc
