"""人设（F3，docs/personas.md）：玩家扮演的“我”，存在设置里的人设库，好几个剧本、好几局都能用。

一个人设有名字、描述、头像（可以没有）；每个用户最多一个默认人设。开新故事时先替玩家选好一个：
剧本设置里选的人设，没有就用默认人设，都没有就让玩家临时填（choose_persona；剧本设置里还有旧版 App
写的默认主角时它排在默认人设前面，见 services/playthrough_service.py 的 _protagonist）。
开局时把名字和描述存进这一局（playthroughs.settings.protagonist），之后改人设不影响已经开始的故事。
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass

from bettertavern.domain.world.names import clean_display_name

from .setup import MAX_PROTAGONIST_NAME

MAX_PERSONA_NAME = MAX_PROTAGONIST_NAME
MAX_PERSONA_DESCRIPTION = 2000


class PersonaError(ValueError):
    """field 指出是哪个字段不合格：name、description。"""

    def __init__(self, field: str, message: str) -> None:
        super().__init__(message)
        self.field = field
        self.message = message


def persona_name(value: str) -> str:
    """名字照主角名的规整（NFKC、合并空白），不能为空，最多 MAX_PERSONA_NAME 字
    （玩家自己填的，超长拒绝，不截断）。"""
    name = clean_display_name(value.replace("\x00", ""), limit=len(value) + 1)
    if not name:
        raise PersonaError("name", "The name can't be empty")
    if len(name) > MAX_PERSONA_NAME:
        raise PersonaError("name", f"The name can be at most {MAX_PERSONA_NAME} characters")
    return name


def persona_description(value: str) -> str:
    text = value.replace("\x00", "").replace("\r\n", "\n").strip()
    if len(text) > MAX_PERSONA_DESCRIPTION:
        raise PersonaError(
            "description", f"The description can be at most {MAX_PERSONA_DESCRIPTION} characters"
        )
    return text


@dataclass(frozen=True, slots=True)
class PersonaChoice:
    id: str
    is_default: bool


def choose_persona(
    scenario_persona_id: str | None, personas: Sequence[PersonaChoice]
) -> str | None:
    """开新故事时先选哪个人设：剧本设置里选的（还在的话），没有就用默认人设；都没有返回 None。"""
    ids = {p.id for p in personas}
    if scenario_persona_id and scenario_persona_id in ids:
        return scenario_persona_id
    return next((p.id for p in personas if p.is_default), None)
