"""RecallStore 的 Postgres 实现：导演的召回工具通过它读更早的回合和世界状态（只读）。"""

from __future__ import annotations

from collections.abc import Sequence

from sqlalchemy.ext.asyncio import AsyncEngine

from bettertavern.domain.story.turn import PlayerAction
from bettertavern.domain.world.records import WorldRecords
from bettertavern.infra.db.repositories import recall as recall_repo
from bettertavern.infra.db.repositories import state as state_repo
from bettertavern.runtime.ports import PastTurn


def _past(row: recall_repo.PastTurnRow) -> PastTurn:
    return PastTurn(
        seq=row.seq,
        action=PlayerAction.from_json(row.user_action),
        narrative=row.narrative,
        digest=row.digest,
    )


class PgRecallStore:
    def __init__(self, engine: AsyncEngine) -> None:
        self._engine = engine

    async def world(self, playthrough_id: str) -> WorldRecords:
        async with self._engine.connect() as conn:
            return await state_repo.load_records(conn, playthrough_id)

    async def turns_with(
        self, playthrough_id: str, entity_ids: Sequence[str], *, before_seq: int, limit: int
    ) -> list[PastTurn]:
        if not entity_ids:
            return []
        async with self._engine.connect() as conn:
            rows = await recall_repo.turns_with_entities(
                conn, playthrough_id, entity_ids, before_seq=before_seq, limit=limit
            )
        return [_past(r) for r in rows]

    async def search(
        self, playthrough_id: str, terms: Sequence[str], *, before_seq: int, limit: int
    ) -> list[PastTurn]:
        async with self._engine.connect() as conn:
            rows = await recall_repo.search_turns(
                conn, playthrough_id, terms, before_seq=before_seq, limit=limit
            )
        return [_past(r) for r in rows]

    async def turn(self, playthrough_id: str, seq: int) -> PastTurn | None:
        async with self._engine.connect() as conn:
            row = await recall_repo.turn_at(conn, playthrough_id, seq)
        return None if row is None else _past(row)
