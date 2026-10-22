"""对话记录里几种结构化消息的格式和校验：问卷、回答、方案、方案的回复
（docs/workbench.md 第 3.7 节）。

agent 用工具发问卷、出方案时，参数先过这里；不合格的抛 MessageError，说明交回模型让它改。
用户交上来的回答、对方案的回复也过这里，不合格的接口返回 422。
文字都按长度截断，不做内容判断。
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

MAX_QUESTIONS = 6
MAX_CHOICES = 5
MAX_QUESTION_CHARS = 200
MAX_CHOICE_CHARS = 80
MAX_ANSWER_CHARS = 500
MAX_NAMES = 5
MAX_SECTIONS = 10
MAX_LORE_TITLES = 30
MAX_PLAN_TEXT = 2000
MAX_IMAGES_IN_PLAN = 8
COVER_MODES = ("generate", "search", "upload", "none")


class MessageError(ValueError):
    pass


def _text(value: Any, limit: int) -> str:
    if value is None:
        return ""
    if not isinstance(value, str):
        value = str(value)
    return value.replace("\x00", "").strip()[:limit]


def _int(value: Any, *, low: int, high: int, default: int) -> int:
    if isinstance(value, bool) or not isinstance(value, int | float | str):
        return default
    try:
        number = int(value)
    except ValueError:
        return default
    return max(low, min(high, number))


def normalize_questions(raw: Mapping[str, Any]) -> dict[str, Any]:
    """问卷：最多 6 题，每题 2 到 5 个选项；recommended 是预先选好的那个（多选题可以没有）。
    qid 由代码按顺序编号（q0、q1……），不用模型给的。"""
    items = raw.get("questions")
    if not isinstance(items, list) or not items:
        raise MessageError("questions must be a non-empty list")
    if len(items) > MAX_QUESTIONS:
        raise MessageError(f"at most {MAX_QUESTIONS} questions")
    questions: list[dict[str, Any]] = []
    for index, item in enumerate(items):
        if not isinstance(item, Mapping):
            raise MessageError(f"question {index + 1} must be an object")
        question = _text(item.get("question"), MAX_QUESTION_CHARS)
        if not question:
            raise MessageError(f"question {index + 1} is empty")
        choices_raw = item.get("choices")
        if not isinstance(choices_raw, list):
            raise MessageError(f"question {index + 1} needs choices")
        choices: list[str] = []
        for choice in choices_raw:
            text = _text(choice, MAX_CHOICE_CHARS)
            if text and text not in choices:
                choices.append(text)
        if len(choices) < 2:
            raise MessageError(f"question {index + 1} needs at least 2 different choices")
        if len(choices) > MAX_CHOICES:
            raise MessageError(f"question {index + 1} has more than {MAX_CHOICES} choices")
        multi = bool(item.get("multi", False))
        recommended = item.get("recommended")
        if isinstance(recommended, bool) or not isinstance(recommended, int):
            recommended = None if multi else 0
        elif not 0 <= recommended < len(choices):
            raise MessageError(f"question {index + 1}: recommended is not one of the choices")
        questions.append(
            {
                "qid": f"q{index}",
                "question": question,
                "choices": choices,
                "recommended": recommended,
                "multi": multi,
            }
        )
    intro = _text(raw.get("intro"), MAX_PLAN_TEXT)
    return {"intro": intro, "questions": questions, "skippable": True}


def normalize_answers(raw: Mapping[str, Any], questions: Mapping[str, Any]) -> dict[str, Any]:
    """用户的回答：键是问卷里的 qid；单选题是一个字符串（选项或“其他”里写的话），
    多选题是字符串数组。
    没答的题按推荐项补上；delegated 为真表示“都交给你”，此时不看 answers。"""
    delegated = bool(raw.get("delegated", False))
    answers_raw = raw.get("answers") or {}
    if not isinstance(answers_raw, Mapping):
        raise MessageError("answers must be an object")
    known = {q["qid"]: q for q in questions.get("questions") or []}
    unknown = [k for k in answers_raw if k not in known]
    if unknown:
        raise MessageError(f"unknown question: {unknown[0]}")
    answers: dict[str, Any] = {}
    for qid, question in known.items():
        if delegated:
            break
        value = answers_raw.get(qid)
        if value is None:
            recommended = question.get("recommended")
            if recommended is not None:
                choice = question["choices"][recommended]
                answers[qid] = [choice] if question.get("multi") else choice
            continue
        if question.get("multi"):
            if isinstance(value, str):
                value = [value]
            if not isinstance(value, list):
                raise MessageError(f"answer to {qid} must be a list")
            picked = [_text(v, MAX_ANSWER_CHARS) for v in value]
            answers[qid] = [p for p in dict.fromkeys(picked) if p][: MAX_CHOICES + 1]
        else:
            if not isinstance(value, str):
                raise MessageError(f"answer to {qid} must be a string")
            answers[qid] = _text(value, MAX_ANSWER_CHARS)
    return {"answers": answers, "delegated": delegated}


def normalize_plan(raw: Mapping[str, Any]) -> dict[str, Any]:
    """方案：名字候选、一句话设定、各部分、世界书条目、开场、封面、资料来源、大概要调用几次。"""
    names_raw = raw.get("names")
    names: list[str] = []
    if isinstance(names_raw, list):
        for name in names_raw:
            text = _text(name, 80)
            if text and text not in names:
                names.append(text)
    if not names:
        raise MessageError("the plan needs at least one name")
    pitch = _text(raw.get("pitch"), 400)
    if not pitch:
        raise MessageError("the plan needs a one-line pitch")
    sections: list[dict[str, str]] = []
    for item in raw.get("sections") or []:
        if not isinstance(item, Mapping):
            continue
        heading = _text(item.get("heading"), 40)
        body = _text(item.get("body"), MAX_PLAN_TEXT)
        if heading and body:
            sections.append({"key": _text(item.get("key"), 40), "heading": heading, "body": body})
    lore = [t for t in (_text(x, 80) for x in raw.get("lore") or []) if t][:MAX_LORE_TITLES]
    cover_raw = raw.get("cover") if isinstance(raw.get("cover"), Mapping) else {}
    assert isinstance(cover_raw, Mapping)
    mode = cover_raw.get("mode") if cover_raw.get("mode") in COVER_MODES else "none"
    cover = {
        "mode": mode,
        "count": _int(cover_raw.get("count"), low=0, high=MAX_IMAGES_IN_PLAN, default=4)
        if mode == "generate"
        else 0,
        "style": _text(cover_raw.get("style"), 20),
        "note": _text(cover_raw.get("note"), 200),
    }
    sources = []
    for item in raw.get("sources") or []:
        if isinstance(item, Mapping) and _text(item.get("url"), 2000):
            sources.append(
                {"url": _text(item.get("url"), 2000), "title": _text(item.get("title"), 200)}
            )
    estimate_raw = raw.get("estimate") if isinstance(raw.get("estimate"), Mapping) else {}
    assert isinstance(estimate_raw, Mapping)
    estimate = {
        key: _int(estimate_raw.get(key), low=0, high=50, default=0)
        for key in ("searches", "pages", "images")
    }
    estimate["images"] = max(estimate["images"], cover["count"])
    return {
        "names": names[:MAX_NAMES],
        "pitch": pitch,
        "sections": sections[:MAX_SECTIONS],
        "lore": lore,
        "opening": _text(raw.get("opening"), MAX_PLAN_TEXT),
        "cover": cover,
        "sources": sources[:20],
        "estimate": estimate,
        "language": _text(raw.get("language"), 20),
        "ip": _ip(raw.get("ip")),
    }


def _ip(value: Any) -> dict[str, str] | None:
    """作品里的角色：出自哪部作品、是谁（原创角色为空）。"""
    if not isinstance(value, Mapping) or not _text(value.get("work"), 80):
        return None
    return {"work": _text(value.get("work"), 80), "character": _text(value.get("character"), 80)}


def normalize_plan_reply(raw: Mapping[str, Any], plan: Mapping[str, Any]) -> dict[str, Any]:
    """确认方案（选中一个名字，可以是自己写的）或者退回（写明想改哪里）。"""
    approved = bool(raw.get("approved", False))
    if approved:
        name = _text(raw.get("name"), 80) or (plan.get("names") or [""])[0]
        return {"approved": True, "name": name}
    text = _text(raw.get("text"), MAX_ANSWER_CHARS * 4)
    if not text:
        raise MessageError("say what to change in the plan")
    return {"approved": False, "text": text}
