"""外来的图片（上传的封面、角色卡自带的图、网上存下来的图、文生图的结果）→ 能放心存的图片。

图片是不可信输入：先看文件头认格式，限制像素总数（防解压炸弹），
用 Pillow 完整解码一遍，确认真是图片；
再重新编码，顺带去掉 EXIF（拍摄地点之类）和 PNG 里的文本块（角色卡数据）。
只收 PNG、JPEG、WebP；动图只取第一帧。
"""

from __future__ import annotations

import hashlib
import io
from dataclasses import dataclass

from PIL import Image, ImageOps, UnidentifiedImageError

MAX_IMAGE_BYTES = 16 * 1024 * 1024
MAX_PIXELS = 40_000_000  # 例如 8000×5000
MAX_SIDE = 4096  # 存之前把长边缩到这么大

_MIMES = {"PNG": "image/png", "JPEG": "image/jpeg", "WEBP": "image/webp"}


class ImageError(ValueError):
    pass


@dataclass(frozen=True, slots=True)
class CleanImage:
    data: bytes
    mime: str
    width: int
    height: int
    sha256: str


def sniff_mime(data: bytes) -> str | None:
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if data.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if len(data) >= 12 and data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp"
    return None


def clean_image(data: bytes, *, max_bytes: int = MAX_IMAGE_BYTES) -> CleanImage:
    """解码、按 EXIF 方向转正、缩到长边不超过 MAX_SIDE、重新编码；格式不变（PNG 仍是 PNG）。"""
    if len(data) > max_bytes:
        raise ImageError(f"The image exceeds {max_bytes // (1024 * 1024)} MB")
    if sniff_mime(data) is None:
        raise ImageError("Only PNG, JPEG or WebP images are supported")
    try:
        with Image.open(io.BytesIO(data)) as probe:
            fmt = probe.format or ""
            width, height = probe.size
            if width * height > MAX_PIXELS:
                raise ImageError("The image has too many pixels")
            probe.seek(0)
            image = ImageOps.exif_transpose(probe)
            image.load()
    except ImageError:
        raise
    except (UnidentifiedImageError, OSError, ValueError, Image.DecompressionBombError) as exc:
        raise ImageError("The image couldn't be decoded") from exc
    mime = _MIMES.get(fmt)
    if mime is None:
        raise ImageError("Only PNG, JPEG or WebP images are supported")
    if max(image.size) > MAX_SIDE:
        image.thumbnail((MAX_SIDE, MAX_SIDE))
    out = io.BytesIO()
    if fmt == "JPEG":
        image.convert("RGB").save(out, format="JPEG", quality=90, optimize=True)
    elif fmt == "WEBP":
        image.save(out, format="WEBP", quality=90)
    else:
        if image.mode not in ("RGB", "RGBA", "L", "LA", "P"):
            image = image.convert("RGBA")
        image.save(out, format="PNG", optimize=True)
    encoded = out.getvalue()
    return CleanImage(
        data=encoded,
        mime=mime,
        width=image.size[0],
        height=image.size[1],
        sha256=hashlib.sha256(encoded).hexdigest(),
    )


def cover_png(data: bytes | None, *, width: int = 512, height: int = 768) -> bytes:
    """导出 PNG 角色卡用的封面：居中裁成 2:3，缩到 512×768；没有封面时是一张纯色图。"""
    if data is None:
        image = Image.new("RGB", (width, height), (232, 228, 220))
    else:
        try:
            with Image.open(io.BytesIO(data)) as source:
                source.load()
                image = ImageOps.fit(source.convert("RGBA"), (width, height))
        except (UnidentifiedImageError, OSError, ValueError) as exc:
            raise ImageError("The cover couldn't be decoded") from exc
    out = io.BytesIO()
    image.save(out, format="PNG", optimize=True)
    return out.getvalue()


def avatar_image(data: bytes, *, side: int = 512) -> CleanImage:
    """人设的头像：先按 clean_image 清洗，再居中裁成正方形、缩到 side×side。格式不变。"""
    clean = clean_image(data)
    with Image.open(io.BytesIO(clean.data)) as source:
        source.load()
        fmt = source.format or "PNG"
        image = ImageOps.fit(source, (side, side)) if source.size != (side, side) else source.copy()
    out = io.BytesIO()
    if fmt == "JPEG":
        image.convert("RGB").save(out, format="JPEG", quality=90, optimize=True)
    elif fmt == "WEBP":
        image.save(out, format="WEBP", quality=90)
    else:
        image.save(out, format="PNG", optimize=True)
    encoded = out.getvalue()
    return CleanImage(
        data=encoded,
        mime=clean.mime,
        width=side,
        height=side,
        sha256=hashlib.sha256(encoded).hexdigest(),
    )


def scene_image(data: bytes, *, max_side: int = 1536, quality: int = 85) -> CleanImage:
    """故事里的配图（docs/illustrations.md）：先按 clean_image 清洗，再缩到长边不超过 max_side，
    一律存成 WebP（出图服务多半给 PNG，一张两三 MB；WebP 只要两三百 KB，省用户的图片空间）。"""
    clean = clean_image(data)
    with Image.open(io.BytesIO(clean.data)) as source:
        source.load()
        image = source.convert("RGBA" if source.mode in ("RGBA", "LA", "P") else "RGB")
    if max(image.size) > max_side:
        image.thumbnail((max_side, max_side))
    out = io.BytesIO()
    image.save(out, format="WEBP", quality=quality, method=4)
    encoded = out.getvalue()
    return CleanImage(
        data=encoded,
        mime="image/webp",
        width=image.size[0],
        height=image.size[1],
        sha256=hashlib.sha256(encoded).hexdigest(),
    )
