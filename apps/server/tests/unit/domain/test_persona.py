"""人设（F3）：名字和描述的规整、上限，开新故事时先选哪个；SillyTavern 人设备份的解析；
头像裁成正方形。"""

from __future__ import annotations

import io
import json

import pytest
from PIL import Image

from bettertavern.domain.scenario.persona import (
    MAX_PERSONA_DESCRIPTION,
    PersonaChoice,
    PersonaError,
    choose_persona,
    persona_description,
    persona_name,
)
from bettertavern.importers.images import ImageError, avatar_image
from bettertavern.importers.persona import PersonaBackupError, parse_backup


def test_names_and_descriptions_are_cleaned_and_limited() -> None:
    assert persona_name("  林　川 ") == "林 川"
    assert persona_description("  第一行\r\n第二行\x00 ") == "第一行\n第二行"
    for bad in ("", "   ", "名" * 41):
        with pytest.raises(PersonaError) as error:
            persona_name(bad)
        assert error.value.field == "name"
    with pytest.raises(PersonaError) as error:
        persona_description("字" * (MAX_PERSONA_DESCRIPTION + 1))
    assert error.value.field == "description"


def test_the_scenario_persona_comes_before_the_default_one() -> None:
    personas = [PersonaChoice("a", is_default=False), PersonaChoice("b", is_default=True)]
    assert choose_persona("a", personas) == "a"
    # 剧本选的人设删掉了：用默认人设
    assert choose_persona("gone", personas) == "b"
    assert choose_persona(None, personas) == "b"
    assert choose_persona(None, [PersonaChoice("a", is_default=False)]) is None


def backup(**data: object) -> bytes:
    return json.dumps(data, ensure_ascii=False).encode()


def test_sillytavern_backups_become_personas() -> None:
    parsed = parse_backup(
        backup(
            personas={"a.png": "林川", "b.png": "  沈砚 ", "c.png": "", "d.png": "旧格式"},
            persona_descriptions={
                "a.png": {"description": "一名信使\r\n", "position": 0, "lorebook": "x"},
                "b.png": {"description": "字" * (MAX_PERSONA_DESCRIPTION + 5)},
                "d.png": "描述直接是文字",
            },
            default_persona="b.png",
        )
    )
    assert [(p.name, p.is_default) for p in parsed.personas] == [
        ("林川", False),
        ("沈砚", True),
        ("旧格式", False),
    ]
    assert parsed.personas[0].description == "一名信使"
    assert len(parsed.personas[1].description) == MAX_PERSONA_DESCRIPTION
    assert parsed.personas[2].description == "描述直接是文字"
    assert (parsed.truncated, parsed.skipped) == (1, 1)


@pytest.mark.parametrize(
    "data", [b"not json", backup(personas=["a"]), backup(other={}), b"\xff\xfe"]
)
def test_other_files_are_rejected(data: bytes) -> None:
    with pytest.raises(PersonaBackupError):
        parse_backup(data)


def png(size: tuple[int, int]) -> bytes:
    out = io.BytesIO()
    Image.new("RGB", size, (10, 120, 200)).save(out, format="PNG")
    return out.getvalue()


def test_avatars_are_cropped_to_a_square() -> None:
    avatar = avatar_image(png((300, 120)))
    assert (avatar.width, avatar.height, avatar.mime) == (512, 512, "image/png")
    with Image.open(io.BytesIO(avatar.data)) as image:
        assert image.size == (512, 512)
    with pytest.raises(ImageError):
        avatar_image(b"not an image")
