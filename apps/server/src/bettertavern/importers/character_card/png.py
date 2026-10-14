"""从 PNG 里取出角色卡的文本块（ST 写在 tEXt 块里：V2 的关键字是 chara，V3 是 ccv3）。

PNG 是不可信输入：限制文件大小、块的数量和单块大小；只解压角色卡用到的关键字，
解压时限制单块和总的输出大小（防压缩炸弹）。只读元数据，不解码图像。
"""

from __future__ import annotations

import zlib

PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"
MAX_CHUNKS = 4096
MAX_TEXT_BYTES = 8 * 1024 * 1024
# 所有被读取的文本块（解压后）加起来的上限
MAX_TOTAL_TEXT_BYTES = 16 * 1024 * 1024
CARD_KEYWORDS = ("ccv3", "chara")


class PngError(ValueError):
    pass


def _inflate(data: bytes, limit: int) -> bytes:
    decompressor = zlib.decompressobj()
    try:
        out = decompressor.decompress(data, limit + 1)
    except zlib.error as exc:
        raise PngError("压缩的文本块损坏") from exc
    if len(out) > limit or decompressor.unconsumed_tail:
        raise PngError("压缩的文本块解压后过大")
    return out


def _keyword(body: bytes) -> str | None:
    keyword, sep, _rest = body.partition(b"\x00")
    if not sep or not keyword:
        return None
    return keyword.decode("latin-1")


def _text_chunk(kind: bytes, body: bytes) -> tuple[str, bytes] | None:
    keyword, sep, rest = body.partition(b"\x00")
    if not sep or not keyword:
        return None
    name = keyword.decode("latin-1")
    if kind == b"tEXt":
        return name, rest
    if kind == b"zTXt":
        if not rest or rest[0] != 0:
            return None
        return name, _inflate(rest[1:], MAX_TEXT_BYTES)
    if kind == b"iTXt":
        if len(rest) < 2:
            return None
        compressed, method = rest[0], rest[1]
        _language, sep1, rest = rest[2:].partition(b"\x00")
        _translated, sep2, text = rest.partition(b"\x00")
        if not (sep1 and sep2):
            return None
        if compressed:
            if method != 0:
                return None
            return name, _inflate(text, MAX_TEXT_BYTES)
        return name, text
    return None


def read_text_chunks(data: bytes, keywords: tuple[str, ...] | None = None) -> dict[str, bytes]:
    """返回 PNG 里的文本块（关键字 → 原始字节）。同名的块以第一个为准。

    给了 keywords（不区分大小写）就只读这些关键字的块，其余的块不解压。
    """
    if not data.startswith(PNG_SIGNATURE):
        raise PngError("不是 PNG 文件")
    wanted = {k.lower() for k in keywords} if keywords is not None else None
    texts: dict[str, bytes] = {}
    total = 0
    pos = len(PNG_SIGNATURE)
    count = 0
    while pos < len(data):
        if pos + 8 > len(data):
            raise PngError("PNG 文件被截断")
        length = int.from_bytes(data[pos : pos + 4], "big")
        kind = data[pos + 4 : pos + 8]
        end = pos + 8 + length
        if length > len(data) or end + 4 > len(data):
            raise PngError("PNG 文件被截断")
        count += 1
        if count > MAX_CHUNKS:
            raise PngError("PNG 的块数量过多")
        if kind in (b"tEXt", b"zTXt", b"iTXt"):
            if length > MAX_TEXT_BYTES:
                raise PngError("PNG 的文本块过大")
            body = data[pos + 8 : end]
            name = _keyword(body)
            if (
                name is not None
                and name not in texts
                and (wanted is None or name.lower() in wanted)
            ):
                parsed = _text_chunk(kind, body)
                if parsed is not None:
                    total += len(parsed[1])
                    if total > MAX_TOTAL_TEXT_BYTES:
                        raise PngError("PNG 的文本块合计过大")
                    texts[parsed[0]] = parsed[1]
        pos = end + 4  # 跳过 CRC
        if kind == b"IEND":
            break
    return texts


def card_payload(data: bytes) -> tuple[str, bytes]:
    """取角色卡的 base64 文本：优先 V3 的 ccv3，没有再取 V2 的 chara。"""
    texts = read_text_chunks(data, CARD_KEYWORDS)
    for keyword in CARD_KEYWORDS:
        for name, value in texts.items():
            if name.lower() == keyword:
                return keyword, value
    raise PngError("这张 PNG 里没有角色卡数据（找不到 chara 或 ccv3 文本块）")
