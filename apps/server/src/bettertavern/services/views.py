"""用例层返回给 api 层的视图对象（与库表结构解耦）。"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

from bettertavern.domain.story.illustration import effective_status
from bettertavern.infra.db.repositories.cast import CastRow
from bettertavern.infra.db.repositories.story import PlaythroughRow, TurnRow
from bettertavern.infra.db.repositories.turn_images import TurnImageRow


@dataclass(frozen=True, slots=True)
class TurnImageView:
    """一回合的配图（docs/illustrations.md）：超过时限还在画的按失败（timeout）显示。"""

    id: str
    turn_id: str
    status: str  # pending / ready / failed
    blob_id: str | None
    width: int | None
    height: int | None
    error: str | None
    request: str
    style: str
    prompt: str | None
    created_at: datetime

    @classmethod
    def of(cls, row: TurnImageRow) -> TurnImageView:
        status, expired = effective_status(row.status, row.age_s)
        return cls(
            id=row.id,
            turn_id=row.turn_id,
            status=status,
            blob_id=row.blob_id if status == "ready" else None,
            width=row.width if status == "ready" else None,
            height=row.height if status == "ready" else None,
            error=(expired or row.error) if status == "failed" else None,
            request=row.request,
            style=row.style,
            prompt=row.prompt,
            created_at=row.created_at,
        )


@dataclass(frozen=True, slots=True)
class TurnView:
    id: str
    playthrough_id: str
    seq: int
    attempt: int
    status: str
    action: dict[str, Any]
    narrative: str
    options: list[dict[str, Any]]
    options_source: str | None
    state_seq: int
    segments: list[dict[str, Any]]
    error: dict[str, Any] | None
    created_at: datetime
    replied_at: datetime | None
    images: list[TurnImageView] = field(default_factory=list)

    @classmethod
    def of(cls, row: TurnRow, images: list[TurnImageView] | None = None) -> TurnView:
        return cls(
            id=row.id,
            playthrough_id=row.playthrough_id,
            seq=row.seq,
            attempt=row.attempt,
            status=row.status,
            action=row.user_action,
            narrative=row.narrative,
            options=row.options,
            options_source=row.options_source,
            state_seq=row.state_seq,
            segments=row.segments,
            error=row.error,
            created_at=row.created_at,
            replied_at=row.replied_at,
            images=list(images or []),
        )


@dataclass(frozen=True, slots=True)
class PlaythroughView:
    id: str
    title: str
    status: str
    scenario_id: str | None
    language: str
    mode: str  # standard / lightning
    protagonist_name: str
    persona_id: str | None  # 开局时用的人设（只用来显示头像）
    preferences: dict[str, Any]
    image_style: str  # 这一局配图的画风，空是不指定（docs/illustrations.md）
    head_turn_id: str | None
    head_seq: int | None
    head_excerpt: str
    active_turn_id: str | None
    state_seq: int
    rollbacks_left: int  # 还能回退几次
    seed_source: str | None
    created_at: datetime
    updated_at: datetime

    @classmethod
    def of(
        cls,
        row: PlaythroughRow,
        *,
        rollback_limit: int,
        head_seq: int | None = None,
        head_excerpt: str = "",
    ) -> PlaythroughView:
        protagonist = row.settings.get("protagonist") or {}
        return cls(
            id=row.id,
            title=row.title,
            status=row.status,
            scenario_id=row.scenario_id,
            language=row.language,
            mode=row.mode,
            protagonist_name=str(protagonist.get("name") or ""),
            persona_id=str(protagonist["persona_id"]) if protagonist.get("persona_id") else None,
            preferences=dict(row.settings.get("preferences") or {}),
            image_style=str(row.settings.get("image_style") or ""),
            head_turn_id=row.head_turn_id,
            head_seq=head_seq,
            head_excerpt=head_excerpt,
            active_turn_id=row.active_turn_id,
            state_seq=row.state_seq,
            rollbacks_left=max(rollback_limit - row.rollbacks_used, 0),
            seed_source=row.seed_source,
            created_at=row.created_at,
            updated_at=row.updated_at,
        )


@dataclass(frozen=True, slots=True)
class CastView:
    position: int
    name: str
    cover_blob_id: str | None
    muted: bool

    @classmethod
    def of(cls, row: CastRow) -> CastView:
        return cls(
            position=row.position, name=row.name, cover_blob_id=row.cover_blob_id, muted=row.muted
        )


@dataclass(frozen=True, slots=True)
class PlaythroughDetail:
    playthrough: PlaythroughView
    head: TurnView | None
    active_turn: TurnView | None
    last_failed: TurnView | None
    cast: list[CastView]
