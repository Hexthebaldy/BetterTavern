"""openai_chat 协议：用对话接口出图，回复里带图片（OpenRouter 上的图像模型、Gemini 的兼容接口）。

请求带 modalities: ["image", "text"]；图片在 message.images（OpenRouter）
或 content 的 image_url 部分里，
通常是 data:image/...;base64 地址。参考图作为 image_url 放进用户消息。"""

from __future__ import annotations

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
    data_url,
    decode_b64,
    json_of,
    raise_for,
)


class OpenAIChatImages:
    id = "openai_chat"
    max_references = 3
    needs_base_url = True

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
        if not config.base_url:
            raise ImageError("bad_config", "This protocol needs the service address")
        content: list[dict[str, Any]] = [
            {"type": "text", "text": f"{prompt}\n\nAspect ratio {ASPECT_RATIOS[aspect]}."}
        ]
        content += [
            {"type": "image_url", "image_url": {"url": data_url(ref)}}
            for ref in references[: self.max_references]
        ]
        body = {
            "model": config.model,
            "messages": [{"role": "user", "content": content}],
            "modalities": ["image", "text"],
            **config.extra_body(),
        }
        images: list[GeneratedImage] = []
        # 对话接口一次只出一张：要几张就请求几次
        for _ in range(max(1, min(count, 4))):
            response = await client.post(
                f"{config.base_url.rstrip('/')}/chat/completions",
                json=body,
                headers={"Authorization": f"Bearer {config.api_key}"},
            )
            raise_for(response, "Image service")
            images.extend(_images_of(json_of(response, "Image service")))
        if not images:
            raise ImageError("bad_response", "The model replied without an image")
        return images


def _images_of(payload: Any) -> list[GeneratedImage]:
    found: list[GeneratedImage] = []
    choices = payload.get("choices") if isinstance(payload, dict) else None
    for choice in choices or []:
        message = choice.get("message") if isinstance(choice, dict) else None
        if not isinstance(message, dict):
            continue
        parts = list(message.get("images") or [])
        if isinstance(message.get("content"), list):
            parts += [p for p in message["content"] if isinstance(p, dict)]
        for part in parts:
            url = (part.get("image_url") or {}).get("url") if isinstance(part, dict) else None
            if not isinstance(url, str):
                continue
            if url.startswith("data:"):
                found.append(GeneratedImage(data=decode_b64(url)))
            else:
                found.append(GeneratedImage(url=url))
    return found
