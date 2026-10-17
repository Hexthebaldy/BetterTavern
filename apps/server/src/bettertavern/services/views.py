"""用例层返回给 api 层的视图对象（与库表结构解耦）。"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Any

from bettertavern.infra.db.repositories.story import PlaythroughRow, TurnRow


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
    state_lag: bool
    error: dict[str, Any] | None
    created_at: datetime
    replied_at: datetime | None

    @classmethod
    def of(cls, row: TurnRow) -> TurnView:
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
            state_lag=row.state_lag,
            error=row.error,
            created_at=row.created_at,
            replied_at=row.replied_at,
        )


@dataclass(frozen=True, slots=True)
class PlaythroughView:
    id: str
    title: str
    status: str
    scenario_id: str | None
    language: str
    protagonist_name: str
    preferences: dict[str, Any]
    head_turn_id: str | None
    head_seq: int | None
    head_excerpt: str
    active_turn_id: str | None
    rollback_floor_seq: int
    seed_source: str | None
    created_at: datetime
    updated_at: datetime

    @classmethod
    def of(
        cls, row: PlaythroughRow, *, head_seq: int | None = None, head_excerpt: str = ""
    ) -> PlaythroughView:
        protagonist = row.settings.get("protagonist") or {}
        return cls(
            id=row.id,
            title=row.title,
            status=row.status,
            scenario_id=row.scenario_id,
            language=row.language,
            protagonist_name=str(protagonist.get("name") or ""),
            preferences=dict(row.settings.get("preferences") or {}),
            head_turn_id=row.head_turn_id,
            head_seq=head_seq,
            head_excerpt=head_excerpt,
            active_turn_id=row.active_turn_id,
            rollback_floor_seq=row.rollback_floor_seq,
            seed_source=row.seed_source,
            created_at=row.created_at,
            updated_at=row.updated_at,
        )


@dataclass(frozen=True, slots=True)
class PlaythroughDetail:
    playthrough: PlaythroughView
    head: TurnView | None
    active_turn: TurnView | None
    last_failed: TurnView | None
