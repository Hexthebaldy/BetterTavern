"""提示词库：模板是数据文件（runtime/prompts/<lang>/<name>.j2），不写在 Python 字符串里。

渲染必须是确定性的：模板里不调用时间和随机函数，同样的输入产出逐字节相同的文本，
这样前缀缓存才能命中，回放测试也能复现。模板头部写 {# version: N #}，渲染结果的哈希
写入 agent_runs.prompt_hash，评测时可以按版本对比。
"""

from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import jinja2

PROMPTS_ROOT = Path(__file__).parent
_VERSION = re.compile(r"\{#\s*version:\s*([\w.-]+)\s*#\}")


@dataclass(frozen=True, slots=True)
class RenderedPrompt:
    name: str
    version: str
    text: str

    @property
    def hash(self) -> str:
        return hashlib.sha256(self.text.encode()).hexdigest()[:16]


class PromptLibrary:
    def __init__(self, language: str = "zh", root: Path = PROMPTS_ROOT) -> None:
        directory = root / language
        if not directory.is_dir():
            raise FileNotFoundError(f"没有 {language} 的提示词目录：{directory}")
        self.language = language
        self._env = jinja2.Environment(
            loader=jinja2.FileSystemLoader(directory),
            undefined=jinja2.StrictUndefined,
            autoescape=False,
            trim_blocks=True,
            lstrip_blocks=True,
            keep_trailing_newline=False,
        )
        self._versions: dict[str, str] = {}

    def version(self, name: str) -> str:
        if name not in self._versions:
            loader = self._env.loader
            assert loader is not None
            source, _, _ = loader.get_source(self._env, f"{name}.j2")
            match = _VERSION.search(source)
            self._versions[name] = match.group(1) if match else "0"
        return self._versions[name]

    def render(self, name: str, **context: Any) -> RenderedPrompt:
        template = self._env.get_template(f"{name}.j2")
        text = template.render(**context).strip()
        return RenderedPrompt(name=name, version=self.version(name), text=text)
