"""朗读的三种接口协议：请求的样子、回的声音、声音列表、出错（用假的 HTTP）。"""

from __future__ import annotations

import base64
import io
import json
import wave

import httpx
import pytest

from bettertavern.providers.speech import (
    MAX_AUDIO_BYTES,
    SPEECH_PROTOCOLS,
    SpeechConfig,
    SpeechError,
)

pytestmark = pytest.mark.anyio

MP3 = b"ID3fake-mp3"


def client(handler):  # type: ignore[no-untyped-def]
    return httpx.AsyncClient(transport=httpx.MockTransport(handler))


async def test_openai_speech_sends_the_text_and_returns_the_audio() -> None:
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(200, content=MP3, headers={"content-type": "audio/mpeg"})

    protocol = SPEECH_PROTOCOLS["openai_speech"]
    config = SpeechConfig(
        model="gpt-4o-mini-tts", api_key="k", params={"extra_body": {"instructions": "轻声"}}
    )
    async with client(handler) as http:
        audio = await protocol.synthesize(http, config, text="前面就是渡口了", voice="coral")
    assert audio.data == MP3 and audio.mime == "audio/mpeg"
    assert str(seen[0].url) == "https://api.openai.com/v1/audio/speech"
    assert seen[0].headers["authorization"] == "Bearer k"
    body = json.loads(seen[0].content)
    assert body["input"] == "前面就是渡口了" and body["voice"] == "coral"
    assert body["model"] == "gpt-4o-mini-tts" and body["response_format"] == "mp3"
    assert body["instructions"] == "轻声"


async def test_openai_speech_treats_unknown_binary_as_mp3_and_uses_the_given_address() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert str(request.url) == "https://api.siliconflow.cn/v1/audio/speech"
        return httpx.Response(
            200, content=MP3, headers={"content-type": "application/octet-stream"}
        )

    config = SpeechConfig(model="m", api_key="k", base_url="https://api.siliconflow.cn/v1/")
    async with client(handler) as http:
        audio = await SPEECH_PROTOCOLS["openai_speech"].synthesize(
            http, config, text="t", voice="v"
        )
    assert audio.mime == "audio/mpeg"


async def test_openai_speech_voices_depend_on_the_model() -> None:
    protocol = SPEECH_PROTOCOLS["openai_speech"]

    def handler(request: httpx.Request) -> httpx.Response:
        raise AssertionError("listing these voices needs no request")

    async with client(handler) as http:
        openai = await protocol.voices(http, SpeechConfig(model="gpt-4o-mini-tts"))
        cosy = await protocol.voices(http, SpeechConfig(model="FunAudioLLM/CosyVoice2-0.5B"))
    assert "alloy" in [v.id for v in openai]
    assert cosy[0].id == "FunAudioLLM/CosyVoice2-0.5B:alex" and cosy[0].name == "alex"


@pytest.mark.parametrize(
    ("status", "body", "kind"),
    [
        (401, b"{}", "auth"),
        (403, b"{}", "auth"),
        (402, b"{}", "quota"),
        (429, b"{}", "quota"),
        (400, b'{"error": "safety system"}', "blocked"),
        (400, b"{}", "http"),
        (500, b"{}", "http"),
    ],
)
async def test_errors_are_classified(status: int, body: bytes, kind: str) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(status, content=body)

    async with client(handler) as http:
        with pytest.raises(SpeechError) as raised:
            await SPEECH_PROTOCOLS["openai_speech"].synthesize(
                http, SpeechConfig(model="m", api_key="k"), text="t", voice="v"
            )
    assert raised.value.kind == kind


async def test_a_json_answer_with_status_200_is_not_audio() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"message": "余额不足"})

    async with client(handler) as http:
        with pytest.raises(SpeechError) as raised:
            await SPEECH_PROTOCOLS["openai_speech"].synthesize(
                http, SpeechConfig(model="m", api_key="k"), text="t", voice="v"
            )
    assert raised.value.kind == "bad_response"


async def test_empty_and_oversized_audio_are_refused() -> None:
    sizes = iter([0, MAX_AUDIO_BYTES + 1])

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200, content=b"x" * next(sizes), headers={"content-type": "audio/mpeg"}
        )

    async with client(handler) as http:
        for _ in range(2):
            with pytest.raises(SpeechError) as raised:
                await SPEECH_PROTOCOLS["openai_speech"].synthesize(
                    http, SpeechConfig(model="m", api_key="k"), text="t", voice="v"
                )
            assert raised.value.kind == "bad_response"


async def test_gemini_wraps_raw_pcm_into_a_wav_file() -> None:
    pcm = b"\x00\x01" * 2400
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(
            200,
            json={
                "candidates": [
                    {
                        "content": {
                            "parts": [
                                {
                                    "inlineData": {
                                        "mimeType": "audio/L16;codec=pcm;rate=16000",
                                        "data": base64.b64encode(pcm).decode(),
                                    }
                                }
                            ]
                        }
                    }
                ]
            },
        )

    config = SpeechConfig(model="gemini-tts", api_key="k")
    async with client(handler) as http:
        audio = await SPEECH_PROTOCOLS["gemini"].synthesize(http, config, text="你好", voice="Kore")
    assert audio.mime == "audio/wav"
    with wave.open(io.BytesIO(audio.data)) as file:
        assert file.getframerate() == 16000 and file.getnchannels() == 1
        assert file.readframes(file.getnframes()) == pcm
    assert seen[0].url.path.endswith("/models/gemini-tts:generateContent")
    assert seen[0].headers["x-goog-api-key"] == "k"
    generation = json.loads(seen[0].content)["generationConfig"]
    assert generation["responseModalities"] == ["AUDIO"]
    voice = generation["speechConfig"]["voiceConfig"]["prebuiltVoiceConfig"]
    assert voice["voiceName"] == "Kore"


@pytest.mark.parametrize(
    ("payload", "kind"),
    [
        ({"promptFeedback": {"blockReason": "SAFETY"}}, "blocked"),
        ({"candidates": [{"finishReason": "SAFETY", "content": {"parts": []}}]}, "blocked"),
        ({"candidates": [{"content": {"parts": [{"text": "你好"}]}}]}, "bad_response"),
        ({"candidates": []}, "bad_response"),
    ],
)
async def test_gemini_without_audio(payload: dict[str, object], kind: str) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=payload)

    async with client(handler) as http:
        with pytest.raises(SpeechError) as raised:
            await SPEECH_PROTOCOLS["gemini"].synthesize(
                http, SpeechConfig(model="m", api_key="k"), text="t", voice="Kore"
            )
    assert raised.value.kind == kind


async def test_gemini_lists_its_prebuilt_voices() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        raise AssertionError("listing these voices needs no request")

    async with client(handler) as http:
        voices = await SPEECH_PROTOCOLS["gemini"].voices(http, SpeechConfig())
    assert len(voices) == 30 and voices[0].id == "Kore"


async def test_elevenlabs_voice_goes_into_the_path_and_voices_come_from_the_service() -> None:
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        if request.method == "GET":
            return httpx.Response(200, json={"voices": [{"voice_id": "abc", "name": "Rachel"}]})
        return httpx.Response(200, content=MP3, headers={"content-type": "audio/mpeg"})

    protocol = SPEECH_PROTOCOLS["elevenlabs"]
    config = SpeechConfig(api_key="k")
    async with client(handler) as http:
        voices = await protocol.voices(http, config)
        audio = await protocol.synthesize(http, config, text="你好", voice="a/b")
    assert [(v.id, v.name) for v in voices] == [("abc", "Rachel")]
    assert audio.data == MP3
    assert seen[1].url.raw_path.startswith(b"/v1/text-to-speech/a%2Fb?")
    assert seen[1].url.params["output_format"] == "mp3_44100_128"
    assert seen[1].headers["xi-api-key"] == "k"
    body = json.loads(seen[1].content)
    assert body["text"] == "你好" and body["model_id"] == "eleven_multilingual_v2"


async def test_elevenlabs_voice_list_errors() -> None:
    answers = iter([httpx.Response(401, json={}), httpx.Response(200, json={"voices": [{}]})])

    def handler(request: httpx.Request) -> httpx.Response:
        return next(answers)

    async with client(handler) as http:
        for kind in ("auth", "bad_response"):
            with pytest.raises(SpeechError) as raised:
                await SPEECH_PROTOCOLS["elevenlabs"].voices(http, SpeechConfig(api_key="k"))
            assert raised.value.kind == kind
