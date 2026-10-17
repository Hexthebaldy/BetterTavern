"""导演上下文的装配（纯函数：同样的输入产出逐字节相同的消息，前缀缓存与回放测试依赖这一点）。

消息摆放（docs/backend.md 第 4 节）：
1. system：规则 + 故事设定（取自开局 Seed，开局后基本不变，放最前面命中前缀缓存）；
2. 近期原文：按顺序交替的 user / assistant，导演回合只保留叙述，不带历史选项；
3. 最后一条 user：状态块在前、玩家行动在后（或开场简报、结局要求），离生成点最近。

M1 还没有摘要与压缩（M3），近期原文就是全部历史；超过有效窗口 95% 时只截断发送视图，
从最旧的回合开始丢，至少保留最近 2 个回合，直到不超过 90%。
"""

from __future__ import annotations

import hashlib
import math
from dataclasses import dataclass, field

from bettertavern.domain.memory.thresholds import EMERGENCY_LINE, emergency_budget
from bettertavern.domain.story.turn import clip_middle
from bettertavern.providers import Message
from bettertavern.runtime.ports import TurnContext
from bettertavern.runtime.prompts import PromptLibrary, RenderedPrompt

from .fences import sanitize_for_fence
from .state_block import render_state_block
from .tokens import estimate_messages

LENGTH_HINTS = {
    "short": "每次 100 到 200 字",
    "medium": "每次 200 到 400 字",
    "long": "每次 400 到 700 字",
}
STATE_BLOCK_RATIO = 0.12
STATE_BLOCK_CAP = 2500
ACTION_RATIO = 0.03
MIN_KEEP_TURNS = 2


class ContextTooLarge(Exception):
    """丢光可丢的历史仍然放不下：建议换更大窗口的模型。"""


@dataclass(frozen=True)
class AssembledContext:
    messages: list[Message]
    estimated_tokens: int
    window: int
    dropped_turns: int
    prompt_versions: dict[str, str] = field(default_factory=dict)

    @property
    def usage_ratio(self) -> float:
        return self.estimated_tokens / self.window if self.window else 0.0

    @property
    def fingerprint(self) -> str:
        digest = hashlib.sha256()
        for message in self.messages:
            digest.update(message.role.encode())
            digest.update(b"\x00")
            digest.update(message.content.encode())
            digest.update(b"\x01")
        return digest.hexdigest()[:16]


class ContextAssembler:
    def __init__(self, prompts: PromptLibrary) -> None:
        self._prompts = prompts

    def system_prompt(self, ctx: TurnContext) -> RenderedPrompt:
        seed = ctx.seed
        prefs = ctx.preferences
        world_text = ""
        title = ""
        rules: list[str] = []
        characters: list[dict[str, str]] = []
        protagonist_desc = ""
        style = prefs.style
        if seed is not None:
            world_text = "\n".join(p for p in (seed.world.setting, seed.world.tone) if p)
            title = seed.world.title
            rules = [sanitize_for_fence(r) for r in seed.world.rules]
            protagonist_desc = seed.protagonist.summary
            characters = [
                {"name": sanitize_for_fence(c.name), "description": sanitize_for_fence(c.summary)}
                for c in seed.characters
                if c.importance >= 3
            ][:8]
            style = style or seed.world.style
        return self._prompts.render(
            "director.system",
            protagonist={
                "name": sanitize_for_fence(ctx.protagonist_name),
                "description": sanitize_for_fence(protagonist_desc),
            },
            title=sanitize_for_fence(title),
            world=sanitize_for_fence(world_text) or "（未提供）",
            rules=rules,
            characters=characters,
            style=sanitize_for_fence(style),
            boundaries=sanitize_for_fence(prefs.boundaries),
            length_hint=LENGTH_HINTS[prefs.length],
        )

    def history_messages(self, ctx: TurnContext) -> list[tuple[Message, Message]]:
        pairs: list[tuple[Message, Message]] = []
        for turn in ctx.history:
            if turn.action.source == "opening":
                user = self._prompts.render(
                    "director.opening",
                    world_state="",
                    location="",
                    present=[],
                    situation="",
                    hook="",
                    reference_opening="",
                ).text
            elif turn.action.source == "ending":
                user = self._prompts.render(
                    "director.ending", world_state="", wish=sanitize_for_fence(turn.action.text)
                ).text
            else:
                user = self._prompts.render(
                    "director.turn", action=sanitize_for_fence(turn.action.text)
                ).text
            assistant = f"<narrative>\n{sanitize_for_fence(turn.narrative)}\n</narrative>"
            pairs.append(
                (Message(role="user", content=user), Message(role="assistant", content=assistant))
            )
        return pairs

    def final_message(self, ctx: TurnContext, window: int) -> RenderedPrompt:
        state_budget = min(math.floor(window * STATE_BLOCK_RATIO), STATE_BLOCK_CAP)
        world_state = render_state_block(ctx.world, budget_tokens=state_budget)
        if ctx.action.source == "opening":
            opening = ctx.seed.opening if ctx.seed is not None else None
            return self._prompts.render(
                "director.opening",
                world_state=world_state,
                location=sanitize_for_fence(opening.location or "") if opening else "",
                present=[sanitize_for_fence(p) for p in opening.present] if opening else [],
                situation=sanitize_for_fence(opening.situation) if opening else "",
                hook=sanitize_for_fence(opening.hook) if opening else "",
                reference_opening="",
            )
        action_chars = max(math.floor(window * ACTION_RATIO), 200)
        action = clip_middle(sanitize_for_fence(ctx.action.text), action_chars)
        if ctx.action.source == "ending":
            return self._prompts.render("director.ending", wish=action, world_state=world_state)
        return self._prompts.render("director.turn", action=action, world_state=world_state)

    def assemble(
        self, ctx: TurnContext, window: int, *, budget: int | None = None
    ) -> AssembledContext:
        """budget 不为空时（厂商报超窗后的重试）直接截断到不超过 budget。"""
        system = self.system_prompt(ctx)
        final = self.final_message(ctx, window)
        pairs = self.history_messages(ctx)
        head = [Message(role="system", content=system.text)]
        tail = [Message(role="user", content=final.text)]

        def build(keep: list[tuple[Message, Message]]) -> list[Message]:
            body = [m for pair in keep for m in pair]
            return [*head, *body, *tail]

        messages = build(pairs)
        total = estimate_messages(messages)
        dropped = 0
        limit = budget if budget is not None else window * EMERGENCY_LINE
        if total > limit:
            target = budget if budget is not None else emergency_budget(window)
            keep = list(pairs)
            while len(keep) > MIN_KEEP_TURNS and total > target:
                keep.pop(0)
                dropped += 1
                messages = build(keep)
                total = estimate_messages(messages)
            if total > limit:
                raise ContextTooLarge(f"上下文约 {total} token，超过有效窗口 {window} 能容纳的量")
        versions = {
            "director.system": system.version,
            final.name: final.version,
        }
        return AssembledContext(
            messages=messages,
            estimated_tokens=total,
            window=window,
            dropped_turns=dropped,
            prompt_versions=versions,
        )
