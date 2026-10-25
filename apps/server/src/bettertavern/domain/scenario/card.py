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

# 世界书条目的触发设置照 SillyTavern（docs/lorebook.md 第 6.1 节）
# 次要关键词的逻辑：再命中任一个 / 全命中 / 一个都不命中 / 不全命中
LoreLogic = Literal["any", "all", "not_any", "not_all"]
# 顺带扫描哪段文字：主角介绍、卡的描述、性格、深度提示、场景、作者备注
LoreMatch = Literal[
    "persona", "description", "personality", "depth_prompt", "scenario", "creator_notes"
]
# 只在哪几种生成方式下触发（ST 的 triggers）；我们每回合都相当于 normal
LoreTrigger = Literal["normal", "continue", "impersonate", "swipe", "regenerate", "quiet"]
LORE_MATCHES: tuple[LoreMatch, ...] = (
    "persona",
    "description",
    "personality",
    "depth_prompt",
    "scenario",
    "creator_notes",
)
LORE_TRIGGERS: tuple[LoreTrigger, ...] = (
    "normal",
    "continue",
    "impersonate",
    "swipe",
    "regenerate",
    "quiet",
)
DEFAULT_PRIORITY = 100  # ST 新建条目的 order


class LoreRules(BaseModel):
    """不常用的触发设置。没设的取 SillyTavern 新装时的默认值；为空（None）的项表示“按默认”。
    粘滞、冷却、延迟按回合存（ST 的消息条数除以 2 向上取整：一回合是玩家一条加导演一条）。"""

    model_config = ConfigDict(frozen=True)

    whole_words: bool | None = None  # 整词匹配，默认开
    case_sensitive: bool | None = None  # 区分大小写，默认关
    scan_depth: int | None = Field(default=None, ge=0, le=1000)  # 往回扫几条消息，默认 2
    match: tuple[LoreMatch, ...] = ()
    exclude_recursion: bool = False  # 不被别的条目的内容触发
    prevent_recursion: bool = False  # 内容不去触发别的条目
    delay_until_recursion: int = Field(default=0, ge=0, le=100)  # 第几层递归以后才能触发
    probability: int = Field(default=100, ge=0, le=100)
    groups: tuple[str, ...] = ()
    group_override: bool = False  # 组内优先
    group_weight: int = Field(default=100, ge=0, le=1_000_000)
    group_scoring: bool | None = None  # 组打分，默认关
    sticky: int = Field(default=0, ge=0, le=1000)
    cooldown: int = Field(default=0, ge=0, le=1000)
    delay: int = Field(default=0, ge=0, le=1000)
    triggers: tuple[LoreTrigger, ...] = ()
    ignore_budget: bool = False


class LoreEntry(BaseModel):
    """世界书的一条。order 是列表里的位置（显示、编辑时的先后）；priority 是 ST 的 order 数字，
    管优先级和放进上下文的先后（docs/lorebook.md 第 3.3 节），为空时按 order 算。"""

    model_config = ConfigDict(frozen=True)

    name: str = ""
    keys: tuple[str, ...] = ()
    content: str = ""
    constant: bool = False
    enabled: bool = True
    order: int = 0
    secondary_keys: tuple[str, ...] = ()
    logic: LoreLogic = "any"
    priority: int | None = None
    rules: LoreRules | None = None  # 为空表示全按默认

    def effective_priority(self) -> int:
        return self.order if self.priority is None else self.priority

    def effective_rules(self) -> LoreRules:
        return self.rules if self.rules is not None else LoreRules()


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
