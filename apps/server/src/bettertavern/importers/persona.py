"""SillyTavern 的人设备份文件（人设管理里的“备份”按钮导出的 personas_日期.json）→ 几个人设。

文件里只有名字和描述，没有头像：

    {"personas": {"头像文件名": "名字"},
     "persona_descriptions": {"头像文件名": {"description": "…", "position": 0, …}},
     "default_persona": "头像文件名"}

老版本的描述直接是一段文字。描述放在提示词哪里、深度、专属世界书这些我们不用（docs/personas.md）。
名字照主角名规整，描述超过上限的截断；没有名字的跳过。
"""

from __future__ import annotations

import json
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any

from bettertavern.domain.scenario.persona import (
    MAX_PERSONA_DESCRIPTION,
    MAX_PERSONA_NAME,
)
from bettertavern.domain.world.names import clean_display_name

MAX_BACKUP_BYTES = 2 * 1024 * 1024
MAX_BACKUP_PERSONAS = 1000


class PersonaBackupError(ValueError):
    pass


@dataclass(frozen=True, slots=True)
class BackupPersona:
    name: str
    description: str
    is_default: bool


@dataclass(frozen=True, slots=True)
class PersonaBackup:
    personas: tuple[BackupPersona, ...]
    truncated: int  # 描述太长被截断的个数
    skipped: int  # 没有名字跳过的个数


def _description(value: Any) -> str:
    if isinstance(value, Mapping):
        value = value.get("description")
    return value.replace("\x00", "").replace("\r\n", "\n").strip() if isinstance(value, str) else ""


def parse_backup(data: bytes) -> PersonaBackup:
    if len(data) > MAX_BACKUP_BYTES:
        raise PersonaBackupError("The file is too large")
    try:
        raw = json.loads(data.decode("utf-8-sig"))
    except (UnicodeDecodeError, json.JSONDecodeError, RecursionError) as exc:
        raise PersonaBackupError("The file isn't valid JSON") from exc
    names = raw.get("personas") if isinstance(raw, Mapping) else None
    if not isinstance(names, Mapping):
        raise PersonaBackupError("This isn't a SillyTavern persona backup")
    descriptions = raw.get("persona_descriptions")
    if not isinstance(descriptions, Mapping):
        descriptions = {}
    default = raw.get("default_persona")
    personas: list[BackupPersona] = []
    truncated = skipped = 0
    for key, value in list(names.items())[:MAX_BACKUP_PERSONAS]:
        name = clean_display_name(value.replace("\x00", "")) if isinstance(value, str) else ""
        if not name:
            skipped += 1
            continue
        description = _description(descriptions.get(key))
        if len(description) > MAX_PERSONA_DESCRIPTION:
            description = description[:MAX_PERSONA_DESCRIPTION].rstrip()
            truncated += 1
        personas.append(
            BackupPersona(
                name=name[:MAX_PERSONA_NAME],
                description=description,
                is_default=key == default,
            )
        )
    return PersonaBackup(personas=tuple(personas), truncated=truncated, skipped=skipped)
