"""docs/api/ 与接口一致：每个接口一节，鉴权、成功状态码、参数都写对，
每个请求和响应模型的字段都写全。目录里按领域分的文件合在一起检查。

接口和模型从 FastAPI 生成的 OpenAPI 里取（只构造应用，不连数据库）；
M0 探针是挂载的子应用，不在 OpenAPI 里，从路由表里单独取出。只读 docs/，不读源码。
"""

from __future__ import annotations

import re
from collections.abc import AsyncIterator
from pathlib import Path
from typing import Any

import pytest
from fastapi import FastAPI
from pydantic import SecretStr
from starlette.routing import Mount, Route

from bettertavern.entrypoints.api import create_app
from bettertavern.infra.crypto.keyring import new_master_key_entry
from bettertavern.settings import Settings
from tests.support.docs import (
    ENDPOINT_TITLE,
    NAME_TITLE,
    Section,
    code_text,
    index_sections,
    read_doc_dir,
)

pytestmark = pytest.mark.anyio

DOC = "docs/api/"
METHODS = ("GET", "POST", "PUT", "PATCH", "DELETE")
# FastAPI 自带的校验错误模型，以及 multipart 请求体自动生成的模型（导入接口的说明里写了字段）
FRAMEWORK_SCHEMAS = {"HTTPValidationError", "ValidationError"}
FRAMEWORK_SCHEMA_PREFIX = "Body_"
# 每个接口都可能带、在“约定”里统一说明的请求头
COMMON_HEADERS = {"authorization", "user-agent"}
AUTH_LINE = re.compile(r"^- 鉴权：(不需要|需要)", re.MULTILINE)
SUCCESS_LINE = re.compile(r"^- 成功：`(\d{3})`", re.MULTILINE)
REQUIRED = {"是": True, "否": False}


@pytest.fixture
async def app(tmp_path: Path) -> AsyncIterator[FastAPI]:
    settings = Settings(
        env="test",
        # 只构造应用、读路由表，不会真的连接数据库
        database_url="postgresql://bettertavern:bettertavern@127.0.0.1:9/unused",
        data_dir=tmp_path,
        master_keys=SecretStr(new_master_key_entry("t1")),
        auth_secret=SecretStr("test-secret-" + "x" * 40),
        enable_probe_endpoints=True,
    )
    app = create_app(settings)
    try:
        yield app
    finally:
        services = app.state.services
        await services.aclose(grace=0)
        await services.engine.dispose()


def documented() -> tuple[dict[str, Section], dict[str, Section], list[str]]:
    sections = read_doc_dir("api")
    endpoints, duplicate_endpoints = index_sections(sections, ENDPOINT_TITLE)
    schemas, duplicate_schemas = index_sections(sections, NAME_TITLE)
    return endpoints, schemas, duplicate_endpoints + duplicate_schemas


def operations(app: FastAPI) -> dict[str, dict[str, Any]]:
    """OpenAPI 里的接口：'METHOD /path' → operation。"""
    found: dict[str, dict[str, Any]] = {}
    for path, item in app.openapi()["paths"].items():
        for method, operation in item.items():
            if method.upper() in METHODS:
                found[f"{method.upper()} {path}"] = operation
    return found


def mounted_endpoints(app: FastAPI) -> set[str]:
    """挂载的子应用（M0 探针）的接口，不在 OpenAPI 里。"""
    found: set[str] = set()
    for mount in app.routes:
        if not isinstance(mount, Mount):
            continue
        for route in mount.routes:
            if isinstance(route, Route):
                for method in route.methods or ():
                    if method in METHODS:
                        found.add(f"{method} {mount.path}{route.path}")
    return found


def contract_schemas(app: FastAPI) -> dict[str, dict[str, Any]]:
    schemas: dict[str, dict[str, Any]] = app.openapi()["components"]["schemas"]
    return {
        name: schema
        for name, schema in schemas.items()
        if name not in FRAMEWORK_SCHEMAS and not name.startswith(FRAMEWORK_SCHEMA_PREFIX)
    }


async def test_every_endpoint_is_documented(app: FastAPI) -> None:
    endpoints, _, problems = documented()
    actual = set(operations(app)) | mounted_endpoints(app)
    for name in sorted(actual - endpoints.keys()):
        problems.append(f"接口 {name} 没有写进 {DOC}（在它所属领域的文件里加一节 ### `{name}`）")
    for name in sorted(endpoints.keys() - actual):
        problems.append(f"{endpoints[name].file} 有 ### `{name}` 一节，但服务端没有这个接口")
    assert not problems, f"{DOC} 与接口不一致：\n" + "\n".join(problems)


def check_operation(name: str, operation: dict[str, Any], section: Section) -> list[str]:
    problems: list[str] = []
    parameters = operation.get("parameters", [])
    headers = {p["name"].lower() for p in parameters if p["in"] == "header"}
    auth = AUTH_LINE.search(section.text)
    expected_auth = "需要" if "authorization" in headers else "不需要"
    if auth is None:
        problems.append(f"{name}：缺少“- 鉴权：需要”或“- 鉴权：不需要”一行")
    elif auth.group(1) != expected_auth:
        problems.append(f"{name}：鉴权写的是“{auth.group(1)}”，实际是“{expected_auth}”")
    success = SUCCESS_LINE.search(section.text)
    codes = sorted(code for code in operation["responses"] if code.startswith("2"))
    expected = ", ".join(codes)
    if success is None:
        problems.append(f"{name}：缺少“- 成功：`状态码`”一行（实际是 {expected}）")
    elif success.group(1) not in codes:
        problems.append(f"{name}：成功状态码写的是 {success.group(1)}，实际是 {expected}")
    for parameter in parameters:
        where, param = parameter["in"], parameter["name"]
        if where == "query" and f"`{param}`" not in section.text:
            problems.append(f"{name}：查询参数 {param} 没有写")
        if (
            where == "header"
            and param.lower() not in COMMON_HEADERS
            and f"`{param.lower()}`" not in section.text.lower()
        ):
            problems.append(f"{name}：请求头 {param} 没有写")
    return problems


async def test_endpoint_sections_match_operations(app: FastAPI) -> None:
    endpoints, _, problems = documented()
    for name, operation in sorted(operations(app).items()):
        if name in endpoints:
            section = endpoints[name]
            problems += [f"{section.file}：{p}" for p in check_operation(name, operation, section)]
    assert not problems, f"{DOC} 与接口不一致：\n" + "\n".join(problems)


def check_schema(name: str, schema: dict[str, Any], section: Section) -> list[str]:
    table = section.first_table("字段")
    if table is None:
        return [f"{name}：这一节里没有以“字段”开头的表格"]
    problems: list[str] = []
    fields = [code_text(row[0]) for row in table.rows]
    duplicates = {f for f in fields if fields.count(f) > 1}
    problems += [f"{name}.{f}：写了两次" for f in sorted(duplicates)]
    actual = set(schema.get("properties", {}))
    problems += [f"{name}.{f}：模型里有这个字段，文档没写" for f in sorted(actual - set(fields))]
    problems += [f"{name}.{f}：文档写了这个字段，模型里没有" for f in sorted(set(fields) - actual)]
    required_at = table.column("必填")
    if required_at is not None:
        required = set(schema.get("required", []))
        for row in table.rows:
            field = code_text(row[0])
            value = row[required_at] if len(row) > required_at else ""
            if value not in REQUIRED:
                problems.append(f"{name}.{field}：“必填”只能写“是”或“否”，现在是 {value!r}")
            elif field in actual and REQUIRED[value] != (field in required):
                actual_text = "必填" if field in required else "选填"
                problems.append(f"{name}.{field}：必填写的是“{value}”，实际是{actual_text}")
    return problems


async def test_every_schema_is_documented_with_all_fields(app: FastAPI) -> None:
    _, sections, problems = documented()
    schemas = contract_schemas(app)
    for name in sorted(schemas.keys() - sections.keys()):
        problems.append(f"模型 {name} 没有写进 {DOC}（在用到它的领域文件里加一节 ### `{name}`）")
    for name in sorted(sections.keys() - schemas.keys()):
        problems.append(f"{sections[name].file} 有 ### `{name}` 一节，但 OpenAPI 里没有这个模型")
    for name in sorted(schemas.keys() & sections.keys()):
        section = sections[name]
        problems += [f"{section.file}：{p}" for p in check_schema(name, schemas[name], section)]
    assert not problems, f"{DOC} 与接口模型不一致：\n" + "\n".join(problems)
