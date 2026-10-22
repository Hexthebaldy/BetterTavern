"""openai_images 协议：POST {base}/images/generations；
带参考图时 POST {base}/images/edits（multipart）。
OpenAI 的 gpt-image、硅基流动、火山方舟的豆包 Seedream 以及各种中转都兼容这个接口。"""

from __future__ import annotations

from collections.abc import Sequence

import httpx

from .base import (
    Aspect,
    GeneratedImage,
    ImageConfig,
    ImageError,
    Reference,
    decode_b64,
    json_of,
    raise_for,
)

DEFAULT_BASE = "https://api.openai.com/v1"


class OpenAIImages:
    id = "openai_images"
    max_references = 4
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
        base = (config.base_url or DEFAULT_BASE).rstrip("/")
        headers = {"Authorization": f"Bearer {config.api_key}"}
        fields = {
            "model": config.model,
            "prompt": prompt,
            "n": max(1, min(count, 4)),
            "size": config.size_for(aspect),
            **config.extra_body(),
        }
        if references:
            files = [
                ("image[]", (f"ref{i}.png", ref.data, ref.mime))
                for i, ref in enumerate(references[: self.max_references])
            ]
            data = {k: str(v) for k, v in fields.items()}
            response = await client.post(
                f"{base}/images/edits", data=data, files=files, headers=headers
            )
        else:
            response = await client.post(f"{base}/images/generations", json=fields, headers=headers)
        raise_for(response, "Image service")
        payload = json_of(response, "Image service")
        items = payload.get("data") if isinstance(payload, dict) else None
        if not isinstance(items, list) or not items:
            raise ImageError("bad_response", "The image service returned no images")
        images: list[GeneratedImage] = []
        for item in items:
            if not isinstance(item, dict):
                continue
            if isinstance(item.get("b64_json"), str):
                images.append(GeneratedImage(data=decode_b64(item["b64_json"])))
            elif isinstance(item.get("url"), str):
                images.append(GeneratedImage(url=item["url"]))
        if not images:
            raise ImageError("bad_response", "The image service returned no images")
        return images
