"""导演上下文的装配（纯函数：同样的输入产出逐字节相同的消息，前缀缓存与重放测试依赖这一点）。

消息摆放（docs/agent-runtime.md 第 6 节），按“变得多慢”从前往后排，前缀缓存只认一字不差的开头：
1. system：规则 + 故事设定（取自开局 Seed，开局后不变）；后面接 <recap> 回顾：全书梗概、
   最近几章的章节摘要、玩家画像（每章结束时才变）；
2. 原文：当前这一章的回合（再加上一章最后两回合），按顺序交替的 user / assistant，导演回合
   写成当时的叙述加给玩家的选项（和导演的输出格式一样，模型看着历史也会照样写选项）。
   哪些回合放进来由调用方定（TurnContext.history，见 domain/memory/chapters.py）；
3. 最后一条 user：状态块在前、玩家行动在后（或开场简报、结局要求），离生成点最近。

章节摘要之前的回合不在上下文里，导演用召回工具查（第 7 节“召回”）。超过有效窗口 95% 时只截断
发送视图，从最旧的回合开始丢，至少保留最近 2 个回合，直到不超过 90%：这是整理跟不上时的保护。
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

STATE_BLOCK_RATIO = 0.12
STATE_BLOCK_CAP = 2500
ACTION_RATIO = 0.03
MIN_KEEP_TURNS = 2
MAX_SYSTEM_CHARACTERS = 8


def director_reply(
    narrative: str, options: tuple[str, ...] | list[str] = (), notes: str = ""
) -> str:
    """历史回合里导演那一条消息：叙述，后面跟当时给玩家的选项（没有选项就只有叙述），
    再跟导演当时写的隐藏备注（没写就没有）。导演靠它记得自己埋过什么伏笔。"""
    reply = f"<narrative>\n{sanitize_for_fence(narrative)}\n</narrative>"
    if options:
        lines = "\n".join(f"{i}. {sanitize_for_fence(text)}" for i, text in enumerate(options, 1))
        reply += f"\n<options>\n{lines}\n</options>"
    if notes.strip():
        reply += f"\n<director-notes>\n{sanitize_for_fence(notes.strip())}\n</director-notes>"
    return reply


class ContextTooLarge(Exception):
    """丢光可丢的历史仍然放不下：建议换更大窗口的模型。"""


@dataclass(frozen=True)
class AssembledContext:
    messages: list[Message]
    estimated_tokens: int
    window: int
    dropped_turns: int
    prompt_versions: dict[str, str] = field(default_factory=dict)
    # 上下文里的原文从第几回合开始：更早的回合不在上下文里，召回工具只查它们。0 表示没有可查的
    recall_before: int = 0

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
    """一种语言一个：runner 按这一局的 playthroughs.language 取对应语言的提示词来建"""

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
            # 开局设定里的人物按顺序取前几个（角色卡的主角色排在第一个）
            characters = [
                {"name": sanitize_for_fence(c.name), "description": sanitize_for_fence(c.summary)}
                for c in seed.characters[:MAX_SYSTEM_CHARACTERS]
            ]
            style = style or seed.world.style
        return self._prompts.render(
            "director.system",
            protagonist={
                "name": sanitize_for_fence(ctx.protagonist_name),
                "description": sanitize_for_fence(protagonist_desc),
            },
            title=sanitize_for_fence(title),
            world=sanitize_for_fence(world_text),
            rules=rules,
            characters=characters,
            style=sanitize_for_fence(style),
            boundaries=sanitize_for_fence(prefs.boundaries),
            length=prefs.length,
        )

    def recap(self, ctx: TurnContext) -> RenderedPrompt | None:
        """<recap> 回顾：全书梗概、最近几章的章节摘要、玩家画像；还没有任何记忆时为 None。"""
        memory = ctx.memory
        if not (memory.synopsis or memory.chapters or memory.profile):
            return None
        return self._prompts.render(
            "director.recap",
            synopsis=sanitize_for_fence(memory.synopsis),
            chapters=[
                {"first": c.first_seq, "last": c.last_seq, "text": sanitize_for_fence(c.text)}
                for c in memory.chapters
            ],
            profile=sanitize_for_fence(memory.profile),
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
            assistant = director_reply(turn.narrative, turn.options, turn.director_notes)
            pairs.append(
                (Message(role="user", content=user), Message(role="assistant", content=assistant))
            )
        return pairs

    def final_message(
        self, ctx: TurnContext, window: int, *, recall_before: int = 0
    ) -> RenderedPrompt:
        """recall_before 大于 0 时（提供了召回工具）提示导演：
        现在是第几回合，原文从第几回合开始。"""
        state_budget = min(math.floor(window * STATE_BLOCK_RATIO), STATE_BLOCK_CAP)
        last_narrative = ctx.history[-1].narrative if ctx.history else ""
        world_state = render_state_block(
            ctx.world,
            self._prompts,
            budget_tokens=state_budget,
            state_seq=ctx.state_seq,
            mention_texts=(ctx.action.text, last_narrative),
            turn_seq=ctx.header.seq,
        )
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
        hint = {"seq": ctx.header.seq, "recall_before": recall_before}
        if ctx.action.source == "ending":
            return self._prompts.render(
                "director.ending", wish=action, world_state=world_state, **hint
            )
        return self._prompts.render("director.turn", action=action, world_state=world_state, **hint)

    def assemble(
        self,
        ctx: TurnContext,
        window: int,
        *,
        budget: int | None = None,
        recall: bool = False,
    ) -> AssembledContext:
        """budget 不为空时（厂商报超窗后的重试）直接截断到不超过 budget。
        recall 为真表示这一回合会给导演召回工具。"""
        system = self.system_prompt(ctx)
        recap = self.recap(ctx)
        seqs = [t.seq for t in ctx.history]
        pairs = self.history_messages(ctx)
        system_text = system.text if recap is None else f"{system.text}\n\n{recap.text}"
        head = [Message(role="system", content=system_text)]
        finals: dict[int, RenderedPrompt] = {}

        def first_seq(kept: int) -> int:
            """留下最后 kept 个回合时，上下文里的原文从第几回合开始（0 表示没有可查的）"""
            if not recall or ctx.action.source == "opening" or not seqs:
                return 0
            return seqs[len(seqs) - kept] if kept else ctx.header.seq

        def final(kept: int) -> RenderedPrompt:
            before = first_seq(kept)
            if before not in finals:
                finals[before] = self.final_message(ctx, window, recall_before=before)
            return finals[before]

        def build(keep: list[tuple[Message, Message]]) -> list[Message]:
            body = [m for pair in keep for m in pair]
            return [*head, *body, Message(role="user", content=final(len(keep)).text)]

        messages = build(pairs)
        total = estimate_messages(messages)
        dropped = 0
        keep = list(pairs)
        limit = budget if budget is not None else window * EMERGENCY_LINE
        if total > limit:
            target = budget if budget is not None else emergency_budget(window)
            while len(keep) > MIN_KEEP_TURNS and total > target:
                keep.pop(0)
                dropped += 1
                messages = build(keep)
                total = estimate_messages(messages)
            if total > limit:
                raise ContextTooLarge(
                    f"Context is about {total} tokens, "
                    f"more than the effective window {window} holds"
                )
        last = final(len(keep))
        versions = {
            "director.system": system.version,
            last.name: last.version,
        }
        if recap is not None:
            versions[recap.name] = recap.version
        return AssembledContext(
            messages=messages,
            estimated_tokens=total,
            window=window,
            dropped_turns=dropped,
            prompt_versions=versions,
            recall_before=first_seq(len(keep)),
        )
