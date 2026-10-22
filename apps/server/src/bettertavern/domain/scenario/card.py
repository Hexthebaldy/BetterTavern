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
    truncated: tuple[str, ...] = Field(default=(), description="Names of truncated fields")

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


_BOLD = re.compile(r"\*\*([^*\n]+?)\*\*")
# 连同两边的空格一起匹配：中文的动作换成全角括号，括号两边不留空格
_ACTION = re.compile(r"([ \t]*)\*([^*\n]+?)\*([ \t]*)")
_CJK = re.compile(r"[\u3400-\u9fff\uf900-\ufaff]")


def _action(match: re.Match[str], *, chinese: bool) -> str:
    lead, inner, trail = match.group(1), match.group(2).strip(), match.group(3)
    if not inner:
        return lead + trail
    if chinese:
        return f"（{inner}）"
    return f"{lead}({inner}){trail}"


def format_actions(text: str, *, chinese: bool) -> str:
    """SillyTavern 用 *……* 写动作：换成括号（中文用全角括号）；**加粗** 只留文字；
    落单的星号去掉。"""
    text = _BOLD.sub(r"\1", text)
    text = _ACTION.sub(lambda m: _action(m, chinese=chinese), text)
    return text.replace("*", "")


def display_text(text: str, *, char: str) -> str:
    """给人看的卡片文字（剧本库和详情页的预览），不用于发给模型的文本。

    {{char}} 换成角色名，{{user}} 换成“你”（英文卡换成 you），动作和加粗的写法见 format_actions。
    中文还是英文看卡片原文，不看替换进去的名字。
    """
    chinese = _CJK.search(text) is not None
    text = apply_macros(text, user="你" if chinese else "you", char=char)
    return format_actions(text, chinese=chinese)


def greeting_narrative(text: str, *, user: str, char: str) -> str:
    """用卡片的开场白直接开场（剧本设置里选了哪一条）：宏换成主角名和角色名，
    动作写法同 display_text。"""
    chinese = _CJK.search(text) is not None
    return format_actions(apply_macros(text, user=user, char=char), chinese=chinese).strip()
