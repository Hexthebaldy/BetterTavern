"""朗读的接口协议（docs/speech.md）：用户选协议、填地址、模型名和 Key，就能接任何兼容的服务。

和 providers 的其他部分一样不 import 本项目的其他包；请求走 transport.py 的防内网访问网络层。
"""

from __future__ import annotations

from .base import MAX_AUDIO_BYTES, SpeechAudio, SpeechConfig, SpeechError, SpeechProtocol, Voice
from .elevenlabs import ElevenLabsSpeech
from .gemini import GeminiSpeech
from .openai_speech import OpenAISpeech

SPEECH_PROTOCOLS: dict[str, SpeechProtocol] = {
    p.id: p for p in (OpenAISpeech(), GeminiSpeech(), ElevenLabsSpeech())
}

__all__ = [
    "MAX_AUDIO_BYTES",
    "SPEECH_PROTOCOLS",
    "SpeechAudio",
    "SpeechConfig",
    "SpeechError",
    "SpeechProtocol",
    "Voice",
]
