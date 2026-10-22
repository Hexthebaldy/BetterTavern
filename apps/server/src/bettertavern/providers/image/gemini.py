"""gemini 协议：Gemini 原生的 generateContent，让它输出图片。
Key 放在 x-goog-api-key 头里，不放进地址。"""

from __future__ import annotations

import base64
from collections.abc import Sequence
from typing import Any

import httpx

from .base import (
    ASPECT_RATIOS,
    Aspect,
    GeneratedImage,
    ImageConfig,
    ImageError,
    Reference,
    decode_b64,
    json_of,
    raise_for,
)

DEFAULT_BASE = "https://generativelanguage.googleapis.com/v1beta"


class GeminiImages:
    id = "gemini"
    max_references = 3
    needs_base_url = False

    async def generate(
        self,
        client: httpx.AsyncClient,
        config: ImageConfig,
        *,
        prompt: str,
        aspect: Aspect,
        count: int,
        references: Sequence[Reference] = (),
    ) -> list[GeneratedImage]:
        parts: list[dict[str, Any]] = [{"text": prompt}]
        parts += [
            {"inline_data": {"mime_type": ref.mime, "data": base64.b64encode(ref.data).decode()}}
            for ref in references[: self.max_references]
        ]
        body = {
            "contents": [{"parts": parts}],
            "generationConfig": {
                "responseModalities": ["TEXT", "IMAGE"],
                "imageConfig": {"aspectRatio": ASPECT_RATIOS[aspect]},
            },
            **config.extra_body(),
        }
        base = (config.base_url or DEFAULT_BASE).rstrip("/")
        images: list[GeneratedImage] = []
        for _ in range(max(1, min(count, 4))):
            response = await client.post(
                f"{base}/models/{config.model}:generateContent",
                json=body,
                headers={"x-goog-api-key": config.api_key},
            )
            raise_for(response, "Gemini")
            images.extend(_images_of(json_of(response, "Gemini")))
        if not images:
            raise ImageError("bad_response", "Gemini replied without an image")
        return images


def _images_of(payload: Any) -> list[GeneratedImage]:
    found: list[GeneratedImage] = []
    for candidate in (payload.get("candidates") if isinstance(payload, dict) else None) or []:
        content = candidate.get("content") if isinstance(candidate, dict) else None
        for part in (content.get("parts") if isinstance(content, dict) else None) or []:
            if not isinstance(part, dict):
                continue
            inline = part.get("inlineData") or part.get("inline_data")
            if isinstance(inline, dict) and isinstance(inline.get("data"), str):
                found.append(GeneratedImage(data=decode_b64(inline["data"])))
    return found
