"""vis 的回合详情：不显示故事内容时，每一步和运行结果里都不能带出故事里的文字。"""

from __future__ import annotations

from types import SimpleNamespace
from typing import Any

from bettertavern.vis.queries import run_result_view, step_view


def row(kind: str, args: dict[str, Any], result: dict[str, Any], tool: str | None = None) -> Any:
    return SimpleNamespace(
        step=0,
        kind=kind,
        tool=tool,
        args=args,
        result=result,
        latency_ms=5,
        input_tokens=None,
        cached_tokens=None,
        output_tokens=None,
    )


MODEL = row(
    "model",
    {"model": "m", "round": 1},
    {"text": "", "tool_calls": [{"name": "move", "arguments": '{"entity": "铜钥匙"}'}]},
)
TOOL = row(
    "tool", {"entity": "铜钥匙", "to": "老周"}, {"text": '{"ok":true}', "error": None}, "move"
)
RESULT = {"changes": 2, "refs": {"e1": "老周"}}


def test_hidden_story_keeps_only_names_and_lengths() -> None:
    model = step_view(MODEL, story=False)
    assert model["result"] == {"text_chars": 0, "tool_calls": [{"name": "move"}]}
    assert model["args"] == {"model": "m", "round": 1}
    tool = step_view(TOOL, story=False)
    assert tool["args"] == {"entity": None, "to": None}
    assert tool["result"] == {"error": None, "text_chars": 11}
    assert run_result_view(RESULT, story=False) == {"changes": 2}


def test_shown_story_keeps_everything() -> None:
    assert step_view(MODEL, story=True)["result"] == MODEL.result
    assert step_view(TOOL, story=True)["args"] == TOOL.args
    assert run_result_view(RESULT, story=True) == RESULT
