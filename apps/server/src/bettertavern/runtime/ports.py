"""runtime 访问持久化与路由的接口。具体实现由 services 提供，在 entrypoints 里注入。

这样热路径的执行器和 agent 能用内存里的假实现单测，不依赖数据库。
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from typing import Any, Literal, Protocol

from bettertavern.domain.billing import TokenPrices
from bettertavern.domain.memory.outline import Beat, Outline, OutlineSlice
from bettertavern.domain.routing import RouteTask
from bettertavern.domain.scenario.card import CharacterCard, LoreEntry
from bettertavern.domain.story.turn import PlayerAction, TurnOption
from bettertavern.domain.world.card_source import CardSource
from bettertavern.domain.world.lore import LoreSnapshot
from bettertavern.domain.world.records import RowChange, WorldRecords
from bettertavern.domain.world.seed import Seed
from bettertavern.domain.world.views import ThreadView, WorldSnapshot
from bettertavern.providers import Usage

from .agent.steps import AgentStep
from .routing import ResolvedRoute


@dataclass(frozen=True, slots=True)
class Preferences:
    """玩家在开局时设的偏好：篇幅、文风、内容边界。"""

    length: Literal["short", "medium", "long"] = "medium"
    style: str = ""
    boundaries: str = ""

    @classmethod
    def from_json(cls, data: Mapping[str, Any] | None) -> Preferences:
        data = data or {}
        length = data.get("length")
        return cls(
            length=length if length in ("short", "medium", "long") else "medium",
            style=str(data.get("style") or "")[:200],
            boundaries=str(data.get("boundaries") or "")[:300],
        )


@dataclass(frozen=True, slots=True)
class TurnHeader:
    """runner 需要的回合基本信息（加载一次）。"""

    turn_id: str
    playthrough_id: str
    user_id: str
    seq: int
    attempt: int
    epoch: int
    status: str
    world_ready: bool
    language: str = "zh"
    mode: str = "standard"  # standard / lightning（domain/story/mode.py）


@dataclass(frozen=True, slots=True)
class HistoryTurn:
    seq: int
    action: PlayerAction
    narrative: str
    options: tuple[str, ...] = ()  # 当时给玩家的选项；结局回合、没补齐时可能少于 2 个
    director_notes: str = ""  # 导演当时写的隐藏备注


@dataclass(frozen=True, slots=True)
class ChapterSummary:
    first_seq: int
    last_seq: int
    text: str


@dataclass(frozen=True)
class StoryMemory:
    """整理出来的记忆（docs/agent-runtime.md 第 7 节）：全书梗概、还没并进梗概的最近几章的章节摘要
    （按回合升序）、玩家画像，以及章节摘要已经覆盖到第几回合（-1 表示还没有）。"""

    synopsis: str = ""
    synopsis_last_seq: int = -1  # 全书梗概覆盖到第几回合
    chapters: tuple[ChapterSummary, ...] = ()
    profile: str = ""
    summarized_seq: int = -1


@dataclass(frozen=True)
class TurnContext:
    header: TurnHeader
    action: PlayerAction
    protagonist_name: str
    preferences: Preferences
    seed: Seed | None
    # 原文回合：章节摘要覆盖到的回合之后（再加上一章最后两回合），到上一回合为止
    history: tuple[HistoryTurn, ...]
    world: WorldSnapshot
    # 世界状态已整理到第几回合（-1 表示还没整理过）：状态块开头写“截至第几回合”
    state_seq: int = -1
    memory: StoryMemory = field(default_factory=StoryMemory)
    outline: OutlineSlice | None = None  # 大纲里导演要看的那一部分；还没有大纲时为空
    # 剧本设置里选了用卡片的开场白开场时，开场回合的叙述就是它（宏已经换好）；否则为空，由导演写
    opening_greeting: str = ""
    # 开局时卡的原文快照（domain/world/card_source.py）：闪电模式放进导演的系统提示；
    # 开局前、以及这个功能上线前开局的存档没有
    cards: CardSource | None = None
    # 这一局的世界书快照（domain/world/lore.py），每回合按关键词挑条目（runtime/context/lore.py）；
    # 世界书功能上线（2026-10-25）前开局的存档没有，那时卡里的世界书在 cards 快照里
    lore: LoreSnapshot | None = None


@dataclass(frozen=True, slots=True)
class AgentRunRecord:
    agent: str
    task: str
    status: Literal["ok", "failed", "stale", "cancelled"]
    provider: str | None = None
    model: str | None = None
    prompt_hash: str | None = None
    usage: Usage | None = None
    ttft_ms: int | None = None
    latency_ms: int | None = None
    error_class: str | None = None
    result: Mapping[str, Any] = field(default_factory=dict)
    # 这次运行里的每一步（调模型、用工具），写进 agent_steps
    steps: tuple[AgentStep, ...] = ()
    # 用的是官方模型时的单价（route.prices）：写进 agent_runs 时按用量扣用户的点数
    prices: TokenPrices | None = None


@dataclass(frozen=True)
class TurnOutcome:
    narrative: str
    options: list[TurnOption]
    options_source: str | None  # 结局那一轮没有选项，是 None
    usage: Usage | None
    state_seq: int  # 这一回合的状态块截至第几回合
    runs: list[AgentRunRecord]
    ends_story: bool = False  # 结局写完了：提交时把这局标为 ended
    director_notes: str = ""  # 导演写在选项之后、玩家看不到的备注


@dataclass(frozen=True)
class TurnFailure:
    code: str
    message: str
    retryable: bool
    partial: bool = False
    narrative: str = ""
    runs: list[AgentRunRecord] = field(default_factory=list)
    # 服务商错误的类别（auth、billing、rate_limit……），客户端按它翻译；不是服务商错误时为 None
    reason: str | None = None

    def to_json(self) -> dict[str, Any]:
        return {
            "code": self.code,
            "message": self.message,
            "retryable": self.retryable,
            "partial": self.partial,
            "reason": self.reason,
        }


@dataclass(frozen=True)
class WorldBuildInput:
    card: CharacterCard | None  # 主角色卡（剧本里的第一张）
    protagonist_name: str
    protagonist_summary: str
    preferences: Preferences
    # 剧本里的全部卡，按顺序（群像剧本有几张；第一张就是 card）
    cards: tuple[CharacterCard, ...] = ()
    # 选定的开场白原文（宏没替换）和它属于哪张卡；没选时为空，用主角色卡的 first_mes 作参考
    opening: str = ""
    opening_char: str = ""
    # 剧本挂的世界书（书名，条目），按挂的顺序
    lorebooks: tuple[tuple[str, tuple[LoreEntry, ...]], ...] = ()


class TurnStore(Protocol):
    async def load_header(self, turn_id: str) -> TurnHeader | None: ...

    async def load_context(self, header: TurnHeader) -> TurnContext: ...

    async def renew_lease(self, header: TurnHeader, ttl_s: float) -> bool: ...

    async def commit_turn(self, header: TurnHeader, outcome: TurnOutcome) -> bool:
        """一个事务：回合落库、头部前移、清租约、写账本（结局还要标记这局已完结）。
        普通回合存为 replied，同时放一个整理世界状态的任务；结局直接是 committed。
        围栏不满足返回 False。"""
        ...

    async def fail_turn(self, header: TurnHeader, failure: TurnFailure) -> bool: ...

    async def world_build_input(self, header: TurnHeader) -> WorldBuildInput: ...

    async def save_world(
        self,
        header: TurnHeader,
        seed: Seed,
        source: str,
        run: AgentRunRecord | None,
        cards: CardSource | None = None,
        lore: LoreSnapshot | None = None,
    ) -> int:
        """写入开局世界（实体、关系、事实）、卡的原文快照和世界书快照，playthrough 置为 active。
        返回实体数量。"""
        ...


class RouteResolver(Protocol):
    async def resolve(
        self, user_id: str, task: RouteTask, playthrough_id: str | None = None
    ) -> ResolvedRoute | None: ...

    async def note_window(self, user_id: str, route_id: str, window: int) -> bool:
        """服务商报超长时写明了模型的真实上限：记到这个路由上（只会往小调）。返回是否改了。"""
        ...


# ---- 世界状态 agent（后台） --------------------------------------------------------------


@dataclass(frozen=True)
class StateTurn:
    """世界状态 agent 要整理的一回合，连同它需要的资料（由服务层一次查好）。"""

    turn_id: str
    playthrough_id: str
    user_id: str
    seq: int
    epoch: int
    language: str
    action: PlayerAction
    narrative: str
    recent: tuple[tuple[int, str], ...]  # 前几回合的（回合，一句话摘要），按回合升序
    scene_start: int  # 当前场景从第几回合开始
    world: WorldRecords  # 包括没解开的线索
    failures: int = 0  # 这一回合之前整理失败过几次
    director_notes: str = ""  # 导演写在这一回合的隐藏备注
    beat: Beat | None = None  # 大纲当前这一拍；还没有大纲时为空
    # 前几回合已经说过“大纲要改”、大纲修订还没处理的（回合，原因）：同一件事不用再说
    outline_pending: tuple[tuple[int, str], ...] = ()
    outline_seq: int = -1  # 大纲修订已经看过第几回合的原因（-1 表示还没有大纲）


@dataclass(frozen=True)
class StateCommit:
    changes: tuple[RowChange, ...]
    digest: str
    entity_ids: tuple[str, ...]
    scene_ended: bool
    run: AgentRunRecord
    outline_reason: str = ""  # 大纲要改的原因；不用改时为空


class StateStore(Protocol):
    async def next_turn(self, playthrough_id: str) -> StateTurn | None:
        """还没整理的最早一回合；都整理完了，或者下一回合还没写完，返回 None。"""
        ...

    async def commit(self, turn: StateTurn, result: StateCommit) -> bool:
        """一个事务：整理进度前进一回合、写世界状态和撤销记录、写回合标签、回合标为 committed、
        记下这次运行。整理进度或时间线编号对不上（期间回退过、已经整理过）时什么都不写，
        运行记为 stale，返回 False。"""
        ...

    async def fail(self, turn: StateTurn, run: AgentRunRecord) -> None:
        """记下一次失败的整理；世界状态不变，下一回合的任务会再从这一回合开始。"""
        ...

    async def skip(self, turn: StateTurn, run: AgentRunRecord) -> bool:
        """失败次数用完：记下这次失败，回合标签留空并标为跳过，整理进度照样前进。"""
        ...


# ---- 召回（导演的只读工具） ---------------------------------------------------------------


@dataclass(frozen=True, slots=True)
class PastTurn:
    """当前故事线上更早的一回合（召回工具查到的）。"""

    seq: int
    action: PlayerAction
    narrative: str
    digest: str = ""  # 回合标签的一句话摘要；还没整理或被跳过的回合为空


class RecallStore(Protocol):
    """导演的召回工具读数据的接口。只看当前故事线（回合状态 replied / committed），
    并且只看 before_seq 之前的回合：之后的回合本来就整段在上下文里。"""

    async def world(self, playthrough_id: str) -> WorldRecords:
        """这一局的全部实体（包括已退场的）、关系、有效事实。"""
        ...

    async def turns_with(
        self, playthrough_id: str, entity_ids: Sequence[str], *, before_seq: int, limit: int
    ) -> list[PastTurn]:
        """回合标签里涉及这些实体之一的回合，从近到远。"""
        ...

    async def search(
        self, playthrough_id: str, terms: Sequence[str], *, before_seq: int, limit: int
    ) -> list[PastTurn]:
        """玩家行动、叙述或一句话摘要里包含任一关键词的回合（不分大小写），从近到远。"""
        ...

    async def turn(self, playthrough_id: str, seq: int) -> PastTurn | None: ...


# ---- 章节整理（后台） ---------------------------------------------------------------------


@dataclass(frozen=True, slots=True)
class ChapterTurn:
    """章节整理要读的一回合。"""

    turn_id: str
    seq: int
    action: PlayerAction
    narrative: str
    scene_ended: bool  # 世界状态 agent 判断这一回合之后场景结束了


@dataclass(frozen=True)
class MemoryWork:
    """一局待整理的情况：章节摘要覆盖到的回合之后、已经整理进世界状态的回合，和现有的记忆。"""

    playthrough_id: str
    user_id: str
    epoch: int
    language: str
    protagonist_name: str
    turns: tuple[ChapterTurn, ...]
    memory: StoryMemory


@dataclass(frozen=True)
class ChapterCommit:
    first_seq: int
    last_seq: int
    chapter: str  # 这一章的摘要
    profile: str  # 新一版玩家画像
    run: AgentRunRecord
    synopsis: str | None = None  # 并进了最早一章时的新一版全书梗概
    synopsis_last_seq: int | None = None  # 新梗概覆盖到第几回合


class MemoryStore(Protocol):
    async def pending(self, playthrough_id: str) -> MemoryWork | None:
        """这一局待整理的情况；局不存在或者还在开局时返回 None。"""
        ...

    async def commit(self, work: MemoryWork, result: ChapterCommit) -> bool:
        """一个事务：章节摘要的覆盖进度前进到这一章末尾，写章节摘要、新梗概（有的话）、新一版玩家画像，
        记下这次运行。覆盖进度或时间线编号对不上（期间回退过、已经写过）时什么都不写，
        运行记为 stale，返回 False。"""
        ...

    async def fail(self, work: MemoryWork, run: AgentRunRecord) -> None: ...


# ---- 闪电模式的压缩（后台） -----------------------------------------------------------------


@dataclass(frozen=True)
class CompressWork:
    """闪电模式一局待压缩的情况（docs/agent-runtime.md 的“闪电模式”）：按下一回合拼导演上下文要用的
    全部内容（context：原文是梗概之后到头部回合为止，行动留空），加上记运行用的回合 id。"""

    playthrough_id: str
    user_id: str
    epoch: int
    context: TurnContext
    turn_ids: dict[int, str]  # 回合号 → 回合 id


@dataclass(frozen=True)
class CompressCommit:
    first_seq: int  # 这次压进梗概的第一回合（梗概原来覆盖到的回合 + 1）
    last_seq: int  # 压到第几回合（含）
    synopsis: str  # 新一版全书梗概
    run: AgentRunRecord


class LightningStore(Protocol):
    async def pending(self, playthrough_id: str) -> CompressWork | None:
        """这一局的压缩材料；局不存在、不是闪电模式、还在开局或者已经写完结局时返回 None。"""
        ...

    async def commit(self, work: CompressWork, result: CompressCommit) -> bool:
        """一个事务：梗概的覆盖进度从 first_seq - 1 前进到 last_seq，写新一版全书梗概，
        记下这次运行。覆盖进度或时间线编号对不上（期间回退过、已经压过）时什么都不写，
        运行记为 stale，返回 False。"""
        ...

    async def fail(self, work: CompressWork, run: AgentRunRecord) -> None: ...


# ---- 大纲修订（后台） ---------------------------------------------------------------------


@dataclass(frozen=True)
class OutlineWork:
    """一局待修订的情况：现在的大纲（还没有时为空，要写第一版）、上次修订以来的“要改”的原因、
    最近几回合的一句话摘要、整理出来的记忆、没解开的线索、开局设定。"""

    playthrough_id: str
    user_id: str
    epoch: int
    language: str
    protagonist_name: str
    outline_seq: int  # 修订已经看过第几回合的原因
    based_on_seq: int  # 这次依据到第几回合（世界状态已整理到的回合）
    turn_id: str | None  # 那一回合的 id：这次运行记在它上面
    outline: Outline | None
    reasons: tuple[tuple[int, str], ...]
    digests: tuple[tuple[int, str], ...]
    memory: StoryMemory
    threads: tuple[ThreadView, ...]
    seed: Seed | None


@dataclass(frozen=True)
class OutlineCommit:
    outline: Outline | None  # 新一版大纲；不改时为空
    reason: str
    run: AgentRunRecord


class OutlineStore(Protocol):
    async def pending(self, playthrough_id: str) -> OutlineWork | None:
        """要修订时返回待修订的情况：还没有大纲（世界状态至少整理过一回合），或者有还没处理的
        “大纲要改”的原因。别的时候返回 None。"""
        ...

    async def commit(self, work: OutlineWork, result: OutlineCommit) -> bool:
        """一个事务：修订进度从 work.outline_seq 前进到 work.based_on_seq，记下这次决定（改或不改）
        和这次运行。进度或时间线编号对不上时什么都不写，运行记为 stale，返回 False。"""
        ...

    async def fail(self, work: OutlineWork, run: AgentRunRecord) -> None: ...


# ---- 工作台的 agent（worker） --------------------------------------------------------------


@dataclass(frozen=True)
class WorkbenchMessage:
    seq: int
    role: Literal["user", "assistant"]
    kind: str  # text / research / questions / answers / plan / plan_reply / changes / ...
    content: Mapping[str, Any]


@dataclass(frozen=True)
class WorkbenchAsset:
    id: str
    blob_id: str
    source: str
    license: str
    source_url: str | None = None
    prompt: str | None = None
    width: int | None = None
    height: int | None = None
    meta: Mapping[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class WorkbenchNote:
    id: str
    text: str
    source: Mapping[str, Any]
    used_in: tuple[str, ...] = ()


@dataclass(frozen=True)
class WorkbenchRun:
    """一轮 agent 开始时草稿的样子（docs/workbench.md 第 4.4 节的上下文都从这里来）。"""

    run_id: str
    draft_id: str
    user_id: str
    trigger: Literal["text", "answers", "plan_reply", "continue"]
    origin: str
    stage: str
    language: str
    name: str  # 显示名
    card: CharacterCard
    version: int  # 草稿的版本号，写卡时带着它
    cover_asset_id: str | None
    plan_approved_seq: int | None
    todos: tuple[Mapping[str, Any], ...]
    baseline: Mapping[str, Any] | None  # 上一轮结束时卡片的样子
    messages: tuple[WorkbenchMessage, ...]
    assets: tuple[WorkbenchAsset, ...] = ()
    notes: tuple[WorkbenchNote, ...] = ()


@dataclass(frozen=True)
class DraftSnapshot:
    version: int
    name: str
    card: CharacterCard


@dataclass(frozen=True)
class WorkbenchFinish:
    stage: str
    agent_status: Literal["idle", "awaiting_user"]
    awaiting: Mapping[str, Any] | None
    run: AgentRunRecord


class WorkbenchStore(Protocol):
    """worker 里的一轮 agent 读写草稿。每个写入都带 run_id：不是这一轮在跑（被别的接管了）就不写，
    返回 False / None。"""

    async def load_run(self, draft_id: str, run_id: str) -> WorkbenchRun | None: ...

    async def should_stop(self, draft_id: str, run_id: str) -> bool:
        """用户点了停止、切到手动接管，或者这一轮已经不是正在跑的那一轮；顺带报一次平安（心跳）。"""
        ...

    async def emit(
        self, draft_id: str, run_id: str, events: Sequence[tuple[str, Mapping[str, Any]]]
    ) -> None:
        """写一批推送事件（delta、field_delta、tool、todos……），并通知 api 进程。"""
        ...

    async def read_draft(self, draft_id: str) -> DraftSnapshot | None: ...

    async def write_card(
        self,
        draft_id: str,
        run_id: str,
        *,
        expected_version: int,
        name: str,
        card: CharacterCard,
        fields: Sequence[str],
    ) -> int | None:
        """写卡（版本围栏）：成功返回新的版本号，并推一条 draft 事件；版本号对不上返回 None。"""
        ...

    async def append_message(
        self,
        draft_id: str,
        run_id: str,
        *,
        kind: str,
        content: Mapping[str, Any],
    ) -> int:
        """agent 说的一条话（或问卷、方案、改动、进度），返回序号，并推一条 message 事件。"""
        ...

    async def set_todos(
        self, draft_id: str, run_id: str, todos: Sequence[Mapping[str, Any]]
    ) -> None: ...

    async def set_stage(self, draft_id: str, run_id: str, stage: str) -> None: ...

    async def set_cover(self, draft_id: str, run_id: str, asset_id: str | None) -> int | None:
        """换封面，返回草稿新的版本号；不是这一轮在跑时返回 None。"""
        ...

    async def finish(self, draft_id: str, run_id: str, result: WorkbenchFinish) -> None:
        """一个事务：草稿回到 idle 或 awaiting_user，记下这一轮结束时卡片的样子（下一轮比对用户
        手动改了什么），清掉停止标记，记下这次运行。"""
        ...


# ---- 工作台的联网和出图 ------------------------------------------------------------------


@dataclass(frozen=True)
class ToolConfig:
    """一个配置好的外部服务（tool_routes 的一行，Key 已解密，只活在一次运行里）。"""

    route_id: str
    kind: Literal["search", "fetch", "image"]
    provider: str  # 搜索、读网页是服务商名；文生图是接口协议
    label: str
    api_key: str = field(repr=False, default="")
    base_url: str = ""
    model: str = ""
    params: Mapping[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class ResolvedTools:
    search: ToolConfig | None = None
    fetch: ToolConfig | None = None
    image: ToolConfig | None = None
    # 官方搜索：运营方的 Key（只用免费额度）。用户自己没配搜索时用它，用完了查维基百科
    platform_search: ToolConfig | None = None


class ToolResolver(Protocol):
    async def resolve_tools(self, user_id: str) -> ResolvedTools:
        """这个用户每一种默认的外部服务；Key 解密不了的当作没配。"""
        ...


@dataclass(frozen=True)
class StoredPage:
    id: str
    url: str
    final_url: str | None
    title: str
    content: str
    fetcher: str


class StorageFull(Exception):
    """这个用户存的图已经到上限，WebStore.add_image 存不下了。"""


@dataclass(frozen=True)
class NewImage:
    data: bytes
    mime: str
    width: int
    height: int
    sha256: str


class WebStore(Protocol):
    async def cached_page(
        self, user_id: str, url_hash: str, *, max_age_s: int
    ) -> StoredPage | None: ...

    async def save_page(
        self,
        user_id: str,
        *,
        url: str,
        url_hash: str,
        final_url: str | None,
        title: str,
        content: str,
        fetcher: str,
    ) -> str: ...

    async def page(self, user_id: str, page_id: str) -> StoredPage | None: ...

    async def claim_platform_search(self, user_id: str) -> bool:
        """用一次官方搜索：记一次数；这个用户今天或全站这个月的次数用完了返回 False（不记）。"""
        ...

    async def add_note(
        self, draft_id: str, *, text: str, source: Mapping[str, Any], used_in: Sequence[str]
    ) -> str: ...

    async def add_image(
        self,
        user_id: str,
        draft_id: str,
        image: NewImage,
        *,
        source: str,
        license: str,
        source_url: str | None = None,
        prompt: str | None = None,
        meta: Mapping[str, Any] | None = None,
    ) -> WorkbenchAsset:
        """存一张图（blobs）并记进草稿的图片（workbench_assets）。存满了抛 StorageFull。"""
        ...

    async def image_bytes(self, user_id: str, blob_id: str) -> tuple[bytes, str] | None:
        """一张图的内容和类型（给出图当参考图用）。"""
        ...
