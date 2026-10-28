"""图片清洗（解码校验、去 EXIF、缩放）和角色卡导出（导出的 PNG、JSON 能原样再导入）。"""

from __future__ import annotations

import io
import json

import pytest
from PIL import Image

from bettertavern.domain.scenario.card import CharacterCard, LoreEntry, LoreRules
from bettertavern.importers.character_card import import_card
from bettertavern.importers.character_card.export import card_v2, card_v3, embed_card
from bettertavern.importers.images import ImageError, clean_image, cover_png

CARD = CharacterCard(
    spec="card_v3",
    name="温九",
    description="长生当的掌柜",
    first_mes="客官当什么？",
    alternate_greetings=("又来了？",),
    creator_notes="原创",
    tags=("民国", "志怪"),
    book=(
        LoreEntry(name="规矩", content="三不当", constant=True, order=1),
        LoreEntry(name="长生当", keys=("当铺",), content="城南的当铺", order=0),
    ),
)


def jpeg_with_exif(size: tuple[int, int] = (64, 32)) -> bytes:
    image = Image.new("RGB", size, (200, 10, 10))
    exif = Image.Exif()
    exif[0x010F] = "SomeCamera"  # Make
    exif[0x0112] = 6  # 方向：顺时针转 90 度才是正的
    out = io.BytesIO()
    image.save(out, format="JPEG", exif=exif)
    return out.getvalue()


def test_clean_image_strips_exif_and_applies_orientation() -> None:
    clean = clean_image(jpeg_with_exif())
    assert clean.mime == "image/jpeg"
    assert (clean.width, clean.height) == (32, 64)
    with Image.open(io.BytesIO(clean.data)) as image:
        assert not image.getexif()


def test_clean_image_rejects_non_images() -> None:
    with pytest.raises(ImageError):
        clean_image(b"GIF89a....")
    with pytest.raises(ImageError):
        clean_image(b"\x89PNG\r\n\x1a\n" + b"\x00" * 64)


def test_clean_image_shrinks_huge_images() -> None:
    image = Image.new("RGB", (5000, 1000), (0, 0, 0))
    out = io.BytesIO()
    image.save(out, format="PNG")
    clean = clean_image(out.getvalue())
    assert (clean.width, clean.height) == (4096, 819)


def test_exported_png_imports_back_as_the_same_card() -> None:
    raw = {"spec": "chara_card_v2", "data": {"name": "旧", "extensions": {"other_app": {"x": 1}}}}
    extra = {"card_id": "c1", "version": 3}
    png = embed_card(
        cover_png(None),
        v2=card_v2(CARD, raw=raw, extra=extra),
        v3=card_v3(CARD, raw=raw, extra=extra),
    )
    imported = import_card(png)
    assert imported.card.spec == "card_v3"
    assert imported.card.name == "温九"
    assert imported.card.alternate_greetings == ("又来了？",)
    assert imported.card.creator_notes == "原创"
    # 世界书按顺序写出
    assert [e.name for e in imported.card.book] == ["长生当", "规矩"]
    extensions = imported.raw["data"]["extensions"]
    assert extensions["other_app"] == {"x": 1}
    assert extensions["bettertavern"] == extra
    with Image.open(io.BytesIO(png)) as image:
        assert image.size == (512, 768)


def test_exported_json_is_a_v3_card() -> None:
    data = json.dumps(card_v3(CARD, raw=None, extra={})).encode()
    imported = import_card(data)
    assert imported.card.spec == "card_v3"
    assert imported.card.book[0].keys == ("当铺",)


def test_the_card_authors_instructions_survive_export_and_import() -> None:
    card = CARD.model_copy(
        update={
            "system_prompt": "{{char}} 说话带江南口音",
            "post_history_instructions": "别让 {{char}} 太快信任 {{user}}",
            "depth_prompt": "{{char}} 嘴硬心软",
        }
    )
    # 原卡里角色备注的插入深度照旧；没有的用 ST 的默认值
    raw = {"spec": "chara_card_v2", "data": {"extensions": {"depth_prompt": {"depth": 2}}}}
    for source, depth in ((raw, 2), (None, 4)):
        data = card_v3(card, raw=source, extra={})
        assert data["data"]["extensions"]["depth_prompt"]["depth"] == depth
        imported = import_card(json.dumps(data).encode()).card
        assert imported.system_prompt == "{{char}} 说话带江南口音"
        assert imported.post_history_instructions == "别让 {{char}} 太快信任 {{user}}"
        assert imported.depth_prompt == "{{char}} 嘴硬心软"
    # 没有角色备注、原卡里也没有的，不写这一项
    assert "depth_prompt" not in card_v3(CARD, raw=None, extra={})["data"]["extensions"]


def test_cover_is_cropped_to_two_by_three() -> None:
    image = Image.new("RGB", (1000, 1000), (0, 0, 255))
    out = io.BytesIO()
    image.save(out, format="PNG")
    with Image.open(io.BytesIO(cover_png(out.getvalue()))) as cover:
        assert cover.size == (512, 768)


def test_lore_settings_survive_export_and_import() -> None:
    entry = LoreEntry(
        name="老周",
        keys=("老周", "/周叔|老周头/i"),
        secondary_keys=("欠债",),
        logic="not_all",
        content="老周欠北境商会的钱",
        order=0,
        priority=250,
        rules=LoreRules(
            whole_words=False,
            scan_depth=6,
            match=("scenario",),
            prevent_recursion=True,
            delay_until_recursion=2,
            probability=40,
            groups=("人物", "渡口"),
            group_override=True,
            group_weight=30,
            sticky=2,
            cooldown=1,
            delay=4,
            triggers=("normal",),
            ignore_budget=True,
        ),
    )
    card = CARD.model_copy(update={"book": (entry,)})
    imported = import_card(json.dumps(card_v3(card, raw=None, extra={})).encode())
    assert imported.card.book == (entry,)
