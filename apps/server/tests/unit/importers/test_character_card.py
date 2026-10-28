from __future__ import annotations

import base64
import json
import struct
import zlib
from typing import Any

import pytest

from bettertavern.domain.scenario.card import apply_macros, display_text
from bettertavern.importers.character_card import CardError, import_card

PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"


def png_chunk(kind: bytes, body: bytes) -> bytes:
    crc = zlib.crc32(kind + body) & 0xFFFFFFFF
    return struct.pack(">I", len(body)) + kind + body + struct.pack(">I", crc)


def make_png(*text_chunks: tuple[bytes, bytes]) -> bytes:
    ihdr = png_chunk(b"IHDR", struct.pack(">IIBBBBB", 1, 1, 8, 6, 0, 0, 0))
    idat = png_chunk(b"IDAT", zlib.compress(b"\x00\x00\x00\x00\x00"))
    texts = b"".join(png_chunk(kind, body) for kind, body in text_chunks)
    return PNG_SIGNATURE + ihdr + texts + idat + png_chunk(b"IEND", b"")


def b64json(data: Any) -> bytes:
    return base64.b64encode(json.dumps(data, ensure_ascii=False).encode())


V2 = {
    "spec": "chara_card_v2",
    "spec_version": "2.0",
    "data": {
        "name": "阿苓",
        "description": "{{char}} 认识 {{user}}。",
        "personality": "机灵",
        "scenario": "雨夜的酒馆",
        "first_mes": "外乡人？",
        "mes_example": "<START>\n{{char}}: 嗯。",
        "alternate_greetings": ["你好", ""],
        "tags": ["fantasy", "酒馆"],
        "creator": "someone",
        "character_book": {
            "name": "灰石镇",
            "entries": [
                {
                    "keys": ["火漆"],
                    "content": "火漆是黑色的",
                    "constant": True,
                    "insertion_order": 2,
                },
                {"keys": [], "content": "   ", "enabled": True},
                "not-an-entry",
            ],
        },
    },
}


def test_png_v2_card() -> None:
    png = make_png((b"tEXt", b"chara\x00" + b64json(V2)))
    imported = import_card(png)
    card = imported.card
    assert card.spec == "card_v2" and card.name == "阿苓"
    assert card.alternate_greetings == ("你好",)
    assert [e.content for e in card.book] == ["火漆是黑色的"]
    assert card.book[0].constant and card.book_name == "灰石镇"
    assert imported.image == png and imported.image_mime == "image/png"
    assert imported.raw == V2


def test_png_prefers_v3_over_v2() -> None:
    v3 = {
        "spec": "chara_card_v3",
        "spec_version": "3.0",
        "data": {"name": "新版", "nickname": "小新"},
    }
    png = make_png((b"tEXt", b"chara\x00" + b64json(V2)), (b"tEXt", b"ccv3\x00" + b64json(v3)))
    card = import_card(png).card
    assert card.spec == "card_v3" and card.name == "新版" and card.nickname == "小新"


def test_png_compressed_text_chunks() -> None:
    payload = b64json(V2)
    ztxt = make_png((b"zTXt", b"chara\x00\x00" + zlib.compress(payload)))
    assert import_card(ztxt).card.name == "阿苓"
    itxt = make_png((b"iTXt", b"chara\x00\x01\x00\x00\x00" + zlib.compress(payload)))
    assert import_card(itxt).card.name == "阿苓"


def test_png_decompression_bomb_is_rejected() -> None:
    bomb = zlib.compress(b"A" * (9 * 1024 * 1024))
    png = make_png((b"zTXt", b"chara\x00\x00" + bomb))
    with pytest.raises(CardError):
        import_card(png)


def test_unrelated_text_chunks_are_not_decompressed() -> None:
    """只解压角色卡用到的块：别的关键字的块再大、再坏也不碰（防止用很多压缩块耗尽内存）"""
    broken = b"\x78\x9c" + b"\xff" * 64  # 解压必然出错的数据
    bomb = zlib.compress(b"\0" * (8 * 1024 * 1024), 9)
    noise = [(b"zTXt", f"k{i}".encode() + b"\x00\x00" + bomb) for i in range(30)]
    png = make_png(
        (b"zTXt", b"Comment\x00\x00" + broken),
        *noise,
        (b"tEXt", b"chara\x00" + b64json(V2)),
    )
    assert import_card(png).card.name == "阿苓"


def test_deeply_nested_json_is_a_card_error() -> None:
    with pytest.raises(CardError):
        import_card(b'{"a":' + b"[" * 100_000 + b"]" * 100_000 + b"}")
    with pytest.raises(CardError):
        import_card(b'{"a":' * 100_000 + b"1" + b"}" * 100_000)


@pytest.mark.parametrize(
    "data",
    [
        make_png(),  # 没有角色卡文本块
        make_png((b"tEXt", b"chara\x00!!!not-base64-json!!!")),
        PNG_SIGNATURE + b"\x00\x00\x10\x00IHDR",  # 被截断
        b"GIF89a....",
        b"{not json",
        json.dumps({"hello": "world"}).encode(),
        json.dumps({"spec": "chara_card_v2", "data": {"name": ""}}).encode(),
    ],
)
def test_invalid_inputs(data: bytes) -> None:
    with pytest.raises(CardError):
        import_card(data)


def test_json_v1_and_v3() -> None:
    v1 = {"name": "老周", "description": "掌柜", "first_mes": "要点什么？"}
    card = import_card(json.dumps(v1).encode()).card
    assert card.spec == "card_v1" and card.first_mes == "要点什么？"
    v3 = {"spec": "chara_card_v3", "data": {"name": "阿苓", "description": "x" * 70_000}}
    card = import_card(("﻿" + json.dumps(v3)).encode()).card
    assert card.spec == "card_v3"
    assert len(card.description) == 60_000 and card.truncated == ("description",)


def test_the_depth_prompt_is_read_from_the_extensions() -> None:
    note = {"prompt": "  {{char}} 不轻易信人。\r\n  ", "depth": 2, "role": "system"}
    v2 = {"spec": "chara_card_v2", "data": {"name": "阿苓", "extensions": {"depth_prompt": note}}}
    assert import_card(json.dumps(v2).encode()).card.depth_prompt == "{{char}} 不轻易信人。"
    long = {
        "spec": "chara_card_v2",
        "data": {"name": "阿苓", "extensions": {"depth_prompt": {"prompt": "x" * 70_000}}},
    }
    card = import_card(json.dumps(long).encode()).card
    assert len(card.depth_prompt) == 60_000 and card.truncated == ("depth_prompt",)
    # 没有、或者写错了形状的都当作空
    for ext in (None, {"depth_prompt": "不是对象"}, {"depth_prompt": {"depth": 4}}):
        odd = {"spec": "chara_card_v2", "data": {"name": "阿苓", "extensions": ext}}
        assert import_card(json.dumps(odd).encode()).card.depth_prompt == ""


def test_identical_files_have_identical_hashes() -> None:
    data = json.dumps(V2).encode()
    assert import_card(data).sha256 == import_card(data).sha256


def test_macros() -> None:
    text = "{{char}} 看着 {{user}}，<USER> 也看着 <BOT>。{{random:a,b}}{{ time }}结束"
    assert apply_macros(text, user="林川", char="阿苓") == "阿苓 看着 林川，林川 也看着 阿苓。结束"


@pytest.mark.parametrize(
    ("text", "shown"),
    [
        ("{{char}}是{{User}}的青梅竹马", "阿苓是你的青梅竹马"),
        ("*阿苓抬起头* 外乡人？先把斗篷上的水拧干。", "（阿苓抬起头）外乡人？先把斗篷上的水拧干。"),
        ("“来了？” *{{char}}放下杯子* “坐。”", "“来了？”（阿苓放下杯子）“坐。”"),
        ("**加粗**和*动作*", "加粗和（动作）"),
        ("*smiles at <USER>* Welcome, **traveler**.", "(smiles at you) Welcome, traveler."),
        ("*{{char}} nods* Sit.", "(阿苓 nods) Sit."),
        ("3 * 4 = 12，没有成对的星号", "3  4 = 12，没有成对的星号"),
        ("前面 *  * 后面", "前面  后面"),
        ("没有任何标记的文字", "没有任何标记的文字"),
    ],
)
def test_display_text(text: str, shown: str) -> None:
    assert display_text(text, char="阿苓") == shown


def test_card_book_keeps_sillytavern_settings() -> None:
    data = json.loads(json.dumps(V2))
    data["data"]["character_book"]["entries"] = [
        {
            "keys": ["老周"],
            "secondary_keys": ["欠债"],
            "selective": True,
            "content": "老周是船夫",
            "insertion_order": 300,
            "comment": "老周",
            "extensions": {"display_index": 1, "selectiveLogic": 3, "sticky": 4, "group": "人物"},
        },
        {
            "keys": ["商会"],
            "content": "北境商会",
            "insertion_order": 5,
            "extensions": {"display_index": 0},
        },
        # 没有关键词的条目留着（工作台里会提示永远用不到）
        {"keys": [], "content": "孤零零的一条"},
    ]
    card = import_card(json.dumps(data, ensure_ascii=False).encode()).card
    assert [e.content for e in card.book] == ["北境商会", "老周是船夫", "孤零零的一条"]
    assert [e.order for e in card.book] == [0, 1, 2]
    shang, zhou, _ = card.book
    assert shang.priority == 5 and shang.rules is None
    assert zhou.priority == 300 and zhou.secondary_keys == ("欠债",) and zhou.logic == "all"
    assert zhou.rules is not None and zhou.rules.sticky == 2 and zhou.rules.groups == ("人物",)
