"""边收边读工具参数里的字符串：任意切分、转义、中文和表情、嵌套的同名键都不影响结果。"""

from __future__ import annotations

import json
import random

import pytest

from bettertavern.runtime.agent.partial_json import PartialStringField


def stream(obj: dict[str, object], key: str, seed: int, *, ascii_only: bool) -> list[str]:
    text = json.dumps(obj, ensure_ascii=ascii_only)
    rnd = random.Random(seed)
    parser = PartialStringField(key)
    pieces: list[str] = []
    i = 0
    while i < len(text):
        n = rnd.randint(1, 7)
        pieces.append(parser.feed(text[i : i + n]))
        i += n
    assert parser.done == isinstance(obj.get(key), str)
    return pieces


@pytest.mark.parametrize(
    ("obj", "key"),
    [
        ({"field": "first_mes", "text": '他说："你好"\n😀 结尾\\'}, "text"),
        ({"a": {"text": "嵌套的不算"}, "text": "顶层的"}, "text"),
        ({"x": ["text"], "text": "数组里的不算"}, "text"),
        ({"content": "abc", "text": ""}, "content"),
        ({"name": "温九", "keys": ["当铺"], "content": "城南\t的当铺"}, "content"),
    ],
)
@pytest.mark.parametrize("ascii_only", [True, False])
def test_reassembles_the_value_from_any_split(
    obj: dict[str, object], key: str, ascii_only: bool
) -> None:
    for seed in range(25):
        assert "".join(stream(obj, key, seed, ascii_only=ascii_only)) == obj[key]


def test_text_comes_out_while_streaming() -> None:
    parser = PartialStringField("text")
    assert parser.feed('{"field": "description", "te') == ""
    assert parser.feed('xt": "长生') == "长生"
    assert parser.feed("当的掌柜") == "当的掌柜"
    assert parser.feed('", "x": 1}') == ""
    assert parser.done


def test_missing_key_yields_nothing() -> None:
    parser = PartialStringField("text")
    assert parser.feed('{"field": "description"}') == ""
    assert not parser.done
