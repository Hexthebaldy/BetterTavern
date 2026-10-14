"""文档同步测试用的 Markdown 解析：按标题切成节，取出节里的表格。

只读 docs/ 下的文档，不读源码。docs/api/ 和 docs/data-model/ 按领域分成多个文件，
测试把一个目录里的文件合在一起检查。格式（两个目录的 README.md 最后一节有说明）：
- 一个接口一节，标题只有 `METHOD /path`；
- 一个模型或一张表一节，标题只有 `名字`；
  节里第一张“字段”或“列”表格的第一列是用反引号包起来的字段名。
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from pathlib import Path

DOCS_DIR = Path(__file__).resolve().parents[4] / "docs"

_HEADING = re.compile(r"^(#{1,6})\s+(.+?)\s*$")
_FENCE = re.compile(r"^\s*(```|~~~)")
_CELL_SEPARATOR = re.compile(r"(?<!\\)\|")
_DIVIDER_CELL = re.compile(r"^:?-{3,}:?$")
_CODE_ONLY = re.compile(r"^`([^`]+)`$")

ENDPOINT_TITLE = re.compile(r"^`(GET|POST|PUT|PATCH|DELETE) (/[^`\s]*)`$")
NAME_TITLE = re.compile(r"^`([A-Za-z_][A-Za-z0-9_]*)`$")


@dataclass
class Table:
    header: list[str]
    rows: list[list[str]]

    def column(self, name: str) -> int | None:
        try:
            return self.header.index(name)
        except ValueError:
            return None


@dataclass
class Section:
    title: str
    level: int
    file: str = ""
    lines: list[str] = field(default_factory=list)

    @property
    def text(self) -> str:
        return "\n".join(self.lines)

    def tables(self) -> list[Table]:
        tables: list[Table] = []
        block: list[list[str]] = []
        for line in [*self.lines, ""]:
            stripped = line.strip()
            if stripped.startswith("|") and stripped.endswith("|"):
                block.append(split_row(stripped))
                continue
            if len(block) >= 2 and all(_DIVIDER_CELL.match(c) for c in block[1]):
                tables.append(Table(header=block[0], rows=block[2:]))
            block = []
        return tables

    def first_table(self, first_header: str) -> Table | None:
        """第一张首列表头是 first_header 的表格（例如“字段”“列”）。"""
        return next((t for t in self.tables() if t.header[:1] == [first_header]), None)


def split_row(line: str) -> list[str]:
    inner = line.strip()[1:-1]
    return [cell.strip() for cell in _CELL_SEPARATOR.split(inner)]


def code_text(cell: str) -> str:
    """单元格只有一段行内代码时取出代码内容，否则原样返回。"""
    match = _CODE_ONLY.match(cell.strip())
    return match.group(1) if match else cell.strip()


def split_sections(text: str, file: str = "") -> list[Section]:
    """按标题切节（代码块里的 # 不算标题）。第一个元素是第一个标题之前的内容。"""
    current = Section(title="", level=0, file=file)
    sections = [current]
    in_code = False
    for line in text.splitlines():
        if _FENCE.match(line):
            in_code = not in_code
        match = None if in_code else _HEADING.match(line)
        if match:
            current = Section(title=match.group(2), level=len(match.group(1)), file=file)
            sections.append(current)
        else:
            current.lines.append(line)
    return sections


def read_doc_dir(name: str) -> list[Section]:
    """docs/<name>/ 下所有 Markdown 文件的节，按文件名顺序；每一节记着它来自哪个文件。"""
    directory = DOCS_DIR / name
    files = sorted(directory.glob("*.md"))
    if not files:
        raise FileNotFoundError(f"{directory} 下没有 Markdown 文件")
    sections: list[Section] = []
    for path in files:
        label = f"docs/{name}/{path.name}"
        sections += split_sections(path.read_text(encoding="utf-8"), label)
    return sections


def index_sections(
    sections: list[Section], key: re.Pattern[str]
) -> tuple[dict[str, Section], list[str]]:
    """标题完全匹配 key 的节，按匹配到的分组（用空格连起来）索引。

    同一个标题出现不止一次时，第二个返回值里给出说明（带上所在的文件）。
    """
    found: dict[str, Section] = {}
    duplicates: list[str] = []
    for section in sections:
        match = key.match(section.title)
        if match is None:
            continue
        name = " ".join(match.groups())
        if name in found:
            duplicates.append(f"### `{name}` 写了不止一次：{found[name].file}、{section.file}")
        found[name] = section
    return found, duplicates
