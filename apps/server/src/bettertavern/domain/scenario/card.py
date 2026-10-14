"""规范化的角色卡（兼容 ST 的 V1、V2、V3）。

角色卡是站在第三人称描述 {{char}}、假设与 {{user}} 对话写成的；在本项目里 {{user}} 是玩家扮演的
主角，{{char}} 成为关键 NPC。卡片文字一律当作数据，不当作指令。
"""

from __future__ import annotations

import re
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

CardSpec = Literal["card_v1", "card_v2", "card_v3"]

# 单个文本字段和总量的上限（字符）。超出的部分截断，并在导入预览里提示
MAX_FIELD_CHARS = 60_000
MAX_TOTAL_CHARS = 300_000
MAX_BOOK_ENTRIES = 1000


class LoreEntry(BaseModel):
    model_config = ConfigDict(frozen=True)

    name: str = ""
    keys: tuple[str, ...] = ()
    content: str = ""
    constant: bool = False
    enabled: bool = True
    order: int = 0


class CharacterCard(BaseModel):
    model_config = ConfigDict(frozen=True)

    spec: CardSpec
    name: str
    description: str = ""
    personality: str = ""
    scenario: str = ""
    first_mes: str = ""
    mes_example: str = ""
    alternate_greetings: tuple[str, ...] = ()
    system_prompt: str = ""
    post_history_instructions: str = ""
    creator_notes: str = ""
    creator: str = ""
    character_version: str = ""
    nickname: str = ""
    tags: tuple[str, ...] = ()
    book_name: str = ""
    book: tuple[LoreEntry, ...] = ()
    truncated: tuple[str, ...] = Field(default=(), description="被截断的字段名")

    def total_chars(self) -> int:
        texts = [
            self.description,
            self.personality,
            self.scenario,
            self.first_mes,
            self.mes_example,
            self.system_prompt,
            self.post_history_instructions,
            self.creator_notes,
            *self.alternate_greetings,
        ]
        return sum(len(t) for t in texts) + sum(len(e.content) for e in self.book)


_USER = re.compile(r"\{\{\s*user\s*\}\}|<USER>", re.IGNORECASE)
_CHAR = re.compile(r"\{\{\s*char\s*\}\}|<BOT>|<CHAR>", re.IGNORECASE)
_OTHER_MACRO = re.compile(r"\{\{[^{}]{0,200}\}\}")


def apply_macros(text: str, *, user: str, char: str) -> str:
    """{{user}} → 主角名，{{char}} → 角色名，其他宏（{{random}}、{{time}} 等）丢弃。"""
    text = _USER.sub(lambda _m: user, text)
    text = _CHAR.sub(lambda _m: char, text)
    return _OTHER_MACRO.sub("", text)
