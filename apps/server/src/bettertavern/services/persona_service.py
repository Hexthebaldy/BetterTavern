"""人设库（F3，docs/personas.md）：列表、新建、改名字和描述、设默认、换头像、删除、
导入 SillyTavern 的人设备份文件。

剧本选了某个人设时，剧本设置里的 protagonist 是它的副本（给旧版 App 读）：改名字和描述时跟着改，
删人设时剧本不再选它。已经开始的故事用的是开局时存下的名字和描述，不受影响。
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass
from datetime import datetime
from typing import Any

import structlog
from sqlalchemy.ext.asyncio import AsyncEngine

from bettertavern.domain.scenario.persona import (
    PersonaError,
    persona_description,
    persona_name,
)
from bettertavern.importers.images import ImageError, avatar_image
from bettertavern.importers.persona import PersonaBackupError, parse_backup
from bettertavern.infra.db.repositories import library as library_repo
from bettertavern.infra.db.repositories import personas as repo
from bettertavern.infra.db.sqlutil import is_uuid

from .errors import Invalid, NotFound
from .quotas import Quotas, check_personas, check_storage, lock_user

log = structlog.get_logger(__name__)


@dataclass(frozen=True, slots=True)
class PersonaView:
    id: str
    name: str
    description: str
    avatar_blob_id: str | None
    is_default: bool
    scenario_count: int
    created_at: datetime
    updated_at: datetime


@dataclass(frozen=True, slots=True)
class PersonaImport:
    personas: list[PersonaView]  # 导入以后人设库里的全部人设
    created: int
    skipped: int  # 和已有的一模一样、没有名字、超过上限的


def view_of(row: repo.PersonaRow) -> PersonaView:
    return PersonaView(
        id=row.id,
        name=row.name,
        description=row.description,
        avatar_blob_id=row.avatar_blob_id,
        is_default=row.is_default,
        scenario_count=row.scenario_count,
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


def _invalid(exc: PersonaError) -> Invalid:
    return Invalid(exc.message, field=exc.field)


class PersonaService:
    def __init__(self, engine: AsyncEngine, quotas: Quotas | None = None) -> None:
        self._engine = engine
        self._quotas = quotas or Quotas()

    async def _row(self, conn: Any, user_id: str, persona_id: str) -> repo.PersonaRow:
        row = (
            await repo.get_persona(conn, user_id, persona_id, lock=True)
            if is_uuid(persona_id)
            else None
        )
        if row is None:
            raise NotFound("Persona not found")
        return row

    async def list(self, user_id: str) -> list[PersonaView]:
        async with self._engine.connect() as conn:
            return [view_of(r) for r in await repo.list_personas(conn, user_id)]

    async def create(
        self, user_id: str, *, name: str, description: str = "", is_default: bool = False
    ) -> PersonaView:
        try:
            clean_name, clean_description = persona_name(name), persona_description(description)
        except PersonaError as exc:
            raise _invalid(exc) from exc
        async with self._engine.begin() as conn:
            await lock_user(conn, user_id)
            await check_personas(conn, user_id, self._quotas)
            row = await repo.insert_persona(
                conn,
                user_id=user_id,
                name=clean_name,
                description=clean_description,
                is_default=is_default,
            )
        log.info("persona.created", persona_id=row.id)
        return view_of(row)

    async def update(
        self,
        user_id: str,
        persona_id: str,
        *,
        name: str | None = None,
        description: str | None = None,
        is_default: bool | None = None,
    ) -> PersonaView:
        """没给的项不改。改了名字或描述时，选了这个人设的剧本里的副本跟着改。"""
        try:
            clean_name = persona_name(name) if name is not None else None
            clean_description = (
                persona_description(description) if description is not None else None
            )
        except PersonaError as exc:
            raise _invalid(exc) from exc
        async with self._engine.begin() as conn:
            row = await self._row(conn, user_id, persona_id)
            new_name = clean_name if clean_name is not None else row.name
            new_description = (
                clean_description if clean_description is not None else row.description
            )
            if (new_name, new_description) != (row.name, row.description):
                await repo.update_persona(
                    conn, user_id, persona_id, name=new_name, description=new_description
                )
                await repo.sync_scenarios(
                    conn, user_id, persona_id, name=new_name, description=new_description
                )
            if is_default is not None and is_default != row.is_default:
                await repo.set_default(conn, user_id, persona_id, is_default)
            updated = await repo.get_persona(conn, user_id, persona_id)
            assert updated is not None  # 已经锁住了这一行
        return view_of(updated)

    async def set_avatar(self, user_id: str, persona_id: str, data: bytes) -> PersonaView:
        """换头像：居中裁成正方形；原来的头像没有别处在用时删掉。"""
        try:
            image = await asyncio.to_thread(avatar_image, data)
        except ImageError as exc:
            raise Invalid(str(exc), code="IMAGE_INVALID", field="file") from exc
        async with self._engine.begin() as conn:
            await lock_user(conn, user_id)
            row = await self._row(conn, user_id, persona_id)
            await check_storage(conn, user_id, self._quotas, len(image.data))
            blob_id = await library_repo.insert_blob(
                conn,
                user_id=user_id,
                sha256=image.sha256,
                mime=image.mime,
                data=image.data,
                width=image.width,
                height=image.height,
            )
            await repo.set_avatar(conn, user_id, persona_id, blob_id)
            if row.avatar_blob_id:
                await library_repo.delete_orphan_blobs(conn, user_id, [row.avatar_blob_id])
            updated = await repo.get_persona(conn, user_id, persona_id)
            assert updated is not None
        log.info("persona.avatar_set", persona_id=persona_id, bytes=len(image.data))
        return view_of(updated)

    async def remove_avatar(self, user_id: str, persona_id: str) -> PersonaView:
        async with self._engine.begin() as conn:
            row = await self._row(conn, user_id, persona_id)
            await repo.set_avatar(conn, user_id, persona_id, None)
            if row.avatar_blob_id:
                await library_repo.delete_orphan_blobs(conn, user_id, [row.avatar_blob_id])
            updated = await repo.get_persona(conn, user_id, persona_id)
            assert updated is not None
        return view_of(updated)

    async def delete(self, user_id: str, persona_id: str) -> None:
        """删人设：选了它的剧本不再选人设；头像没有别处在用时删掉。已经开始的故事不受影响。"""
        async with self._engine.begin() as conn:
            row = await self._row(conn, user_id, persona_id)
            scenarios = await repo.unbind_scenarios(conn, user_id, persona_id)
            await repo.delete_persona(conn, user_id, persona_id)
            if row.avatar_blob_id:
                await library_repo.delete_orphan_blobs(conn, user_id, [row.avatar_blob_id])
        log.info("persona.deleted", persona_id=persona_id, scenarios=scenarios)

    async def import_backup(self, user_id: str, data: bytes) -> PersonaImport:
        """导入 SillyTavern 的人设备份：名字和描述都和已有的一样的跳过；
        文件里的默认人设只在人设库里还没有默认人设时才设成默认。"""
        try:
            backup = await asyncio.to_thread(parse_backup, data)
        except PersonaBackupError as exc:
            log.info("persona.import_failed", bytes=len(data), reason=str(exc))
            raise Invalid(
                f"Couldn't import the personas: {exc}", code="PERSONA_BACKUP_INVALID"
            ) from exc
        created = 0
        skipped = backup.skipped
        async with self._engine.begin() as conn:
            await lock_user(conn, user_id)
            existing = await repo.list_personas(conn, user_id)
            seen = {(p.name, p.description) for p in existing}
            has_default = any(p.is_default for p in existing)
            room = self._quotas.max_personas - len(existing)
            for item in backup.personas:
                if (item.name, item.description) in seen or created >= room:
                    skipped += 1
                    continue
                default = item.is_default and not has_default
                await repo.insert_persona(
                    conn,
                    user_id=user_id,
                    name=item.name,
                    description=item.description,
                    is_default=default,
                )
                has_default = has_default or default
                seen.add((item.name, item.description))
                created += 1
            rows = await repo.list_personas(conn, user_id)
        log.info(
            "persona.imported",
            bytes=len(data),
            created=created,
            skipped=skipped,
            truncated=backup.truncated,
        )
        return PersonaImport(personas=[view_of(r) for r in rows], created=created, skipped=skipped)
