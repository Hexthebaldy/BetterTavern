"""提示词库：模板是数据文件（runtime/prompts/<lang>/<name>.j2），不写在 Python 字符串里。

渲染必须是确定性的：模板里不调用时间和随机函数，同样的输入产出逐字节相同的文本，
这样前缀缓存才能命中，重放测试也能复现。模板头部写 {# version: N #}，渲染结果的哈希
写入 agent_runs.prompt_hash，评测时可以按版本对比。

每种语言一个目录，文件一一对应（tests/unit/runtime/test_prompt_languages.py 检查）。
除了模板，目录里还有几份 JSON 数据：状态块的标签（state_block.json）、
结构化输出的字段说明（schema/<name>.json）、工具的说明和出错提示（tools.json，说明按 agent 分组）、
世界状态 agent 修改出错时的说明（state_keeper.json）、导演召回工具出错时的说明（recall.json）。
一局用哪种语言由 playthroughs.language 决定，runtime 从 PromptBook 里按它取
（docs/i18n.md 第 4 节）。
"""

from __future__ import annotations

import hashlib
import json
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import jinja2

from bettertavern.domain.story.language import DEFAULT_LANGUAGE, PROMPT_LANGUAGES

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
    def __init__(self, language: str = DEFAULT_LANGUAGE, root: Path = PROMPTS_ROOT) -> None:
        directory = root / language
        if not directory.is_dir():
            raise FileNotFoundError(f"No prompt directory for {language}: {directory}")
        self.language = language
        self._directory = directory
        self._env = jinja2.Environment(
            loader=jinja2.FileSystemLoader(directory),
            undefined=jinja2.StrictUndefined,
            autoescape=False,
            trim_blocks=True,
            lstrip_blocks=True,
            keep_trailing_newline=False,
        )
        self._versions: dict[str, str] = {}
        self._data: dict[str, Any] = {}

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

    def data(self, name: str) -> Any:
        """<lang>/<name>.json 里的数据（状态块的标签、结构化输出的字段说明）；读一次后缓存"""
        if name not in self._data:
            path = self._directory / f"{name}.json"
            self._data[name] = json.loads(path.read_text(encoding="utf-8"))
        return self._data[name]


class PromptBook:
    """每种语言一套提示词；按一局的语言（playthroughs.language）取，不认识的语言用默认语言。"""

    def __init__(
        self, languages: tuple[str, ...] = PROMPT_LANGUAGES, root: Path = PROMPTS_ROOT
    ) -> None:
        self._libraries = {language: PromptLibrary(language, root) for language in languages}

    @property
    def languages(self) -> tuple[str, ...]:
        return tuple(self._libraries)

    def get(self, language: str) -> PromptLibrary:
        return self._libraries.get(language) or self._libraries[DEFAULT_LANGUAGE]
