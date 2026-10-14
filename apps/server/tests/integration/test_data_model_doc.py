"""docs/data-model/ 与迁移建出来的表一致：表、列名、类型、可空、索引名。
目录里按领域分的文件合在一起检查。

在临时 schema 里执行全部迁移，再从 Postgres 的系统表读出实际结构，和文档逐项对比。
只读 docs/，不读源码。

    BT_TEST_DATABASE_URL=postgresql://bettertavern:bettertavern@localhost:5432/bettertavern \\
        uv run pytest tests/integration/test_data_model_doc.py
"""

from __future__ import annotations

import re
from dataclasses import dataclass

import pytest
from sqlalchemy import text

from tests.support.docs import (
    NAME_TITLE,
    Section,
    code_text,
    index_sections,
    read_doc_dir,
)
from tests.support.pg import database_url, schema_engine

pytestmark = [pytest.mark.integration, pytest.mark.anyio]

URL = database_url()
if not URL:
    pytest.skip("没有设置 BT_TEST_DATABASE_URL", allow_module_level=True)

DOC = "docs/data-model/"
# Postgres 的类型名 → 文档里的写法
TYPE_NAMES = {"timestamp with time zone": "timestamptz"}
NULLABLE = {"是": True, "否": False}

COLUMNS_SQL = """
SELECT c.relname AS table_name, a.attname AS column_name,
       format_type(a.atttypid, a.atttypmod) AS column_type, NOT a.attnotnull AS nullable
FROM pg_attribute AS a
JOIN pg_class AS c ON c.oid = a.attrelid
JOIN pg_namespace AS n ON n.oid = c.relnamespace
WHERE n.nspname = current_schema() AND c.relkind = 'r' AND a.attnum > 0 AND NOT a.attisdropped
ORDER BY c.relname, a.attnum
"""

# 迁移里显式创建的索引；主键和 UNIQUE 约束自带的索引不算
INDEXES_SQL = """
SELECT t.relname AS table_name, i.relname AS index_name
FROM pg_index AS x
JOIN pg_class AS i ON i.oid = x.indexrelid
JOIN pg_class AS t ON t.oid = x.indrelid
JOIN pg_namespace AS n ON n.oid = t.relnamespace
WHERE n.nspname = current_schema()
  AND NOT EXISTS (
      SELECT 1 FROM pg_constraint AS k
      WHERE k.conindid = x.indexrelid AND k.contype IN ('p', 'u', 'x')
  )
ORDER BY t.relname, i.relname
"""


@dataclass(frozen=True)
class Column:
    type: str
    nullable: bool

    def describe(self) -> str:
        return f"{self.type}，{'可空' if self.nullable else '非空'}"


@dataclass
class Schema:
    columns: dict[str, dict[str, Column]]
    indexes: dict[str, list[str]]


async def load_schema() -> Schema:
    assert URL is not None
    schema = Schema(columns={}, indexes={})
    async with schema_engine(URL, pool_size=1) as engine, engine.connect() as conn:
        for row in (await conn.execute(text(COLUMNS_SQL))).mappings():
            pg_type = str(row["column_type"])
            table = schema.columns.setdefault(row["table_name"], {})
            table[row["column_name"]] = Column(
                TYPE_NAMES.get(pg_type, pg_type), bool(row["nullable"])
            )
        for row in (await conn.execute(text(INDEXES_SQL))).mappings():
            schema.indexes.setdefault(row["table_name"], []).append(row["index_name"])
    return schema


def documented_columns(name: str, section: Section) -> tuple[dict[str, Column], list[str]]:
    problems: list[str] = []
    table = section.first_table("列")
    if table is None:
        return {}, [f"{name}：这一节里没有以“列”开头的列表"]
    type_at, null_at = table.column("类型"), table.column("可空")
    if type_at is None or null_at is None:
        return {}, [f"{name}：列表缺少“类型”或“可空”列"]
    columns: dict[str, Column] = {}
    for row in table.rows:
        if len(row) <= max(type_at, null_at):
            problems.append(f"{name}：这一行的单元格不够：{row}")
            continue
        column = code_text(row[0])
        if column in columns:
            problems.append(f"{name}.{column}：写了两次")
        if row[null_at] not in NULLABLE:
            problems.append(f"{name}.{column}：“可空”只能写“是”或“否”，现在是 {row[null_at]!r}")
            continue
        columns[column] = Column(code_text(row[type_at]), NULLABLE[row[null_at]])
    return columns, problems


def compare_table(
    name: str, section: Section, actual: dict[str, Column], indexes: list[str]
) -> list[str]:
    documented, problems = documented_columns(name, section)
    for column in actual.keys() - documented.keys():
        problems.append(f"{name}.{column}：表里有这一列，文档没写（{actual[column].describe()}）")
    for column in documented.keys() - actual.keys():
        problems.append(f"{name}.{column}：文档写了这一列，表里没有")
    for column in actual.keys() & documented.keys():
        if documented[column] != actual[column]:
            problems.append(
                f"{name}.{column}：文档写的是 {documented[column].describe()}，"
                f"实际是 {actual[column].describe()}"
            )
    for index in indexes:
        if not re.search(rf"`{re.escape(index)}\b", section.text):
            problems.append(f"{name}：索引 {index} 没有写进“约束与索引”")
    return problems


async def test_data_model_doc_matches_migrations() -> None:
    schema = await load_schema()
    sections, problems = index_sections(read_doc_dir("data-model"), NAME_TITLE)
    actual = set(schema.columns) - {"alembic_version"}
    for name in sorted(actual - sections.keys()):
        problems.append(f"表 {name} 没有写进 {DOC}（在它所属领域的文件里加一节 ### `{name}`）")
    for name in sorted(sections.keys() - actual):
        problems.append(f"{sections[name].file} 有 ### `{name}` 一节，但迁移里没有这张表")
    for name in sorted(actual & sections.keys()):
        section = sections[name]
        found = compare_table(name, section, schema.columns[name], schema.indexes.get(name, []))
        problems += [f"{section.file}：{p}" for p in found]
    assert not problems, f"{DOC} 与迁移不一致：\n" + "\n".join(problems)
