"""agent 这一轮用哪种做法、给哪些工具（docs/workbench.md 第 4.3 节）。

写在代码里，不只靠提示词：
- planning（新卡还没有确认的方案）：只能沟通、查资料，不给写卡的工具，
  agent 没法跳过问卷和方案直接动手；
- build（方案确认以后，或者手动开始、导入的草稿还没写完，让 agent 接着写）：直接写卡；
- revise（写好以后接着改，或者改仓库里已有的卡）：只给 propose_changes，改动一定先给用户看。
"""

from __future__ import annotations

from typing import Literal

RunMode = Literal["planning", "build", "revise"]
Trigger = Literal["text", "answers", "plan_reply", "continue"]

STAGES = ("start", "research", "questions", "plan", "build", "check", "done", "revise")

COMMON_TOOLS = ("update_todos", "read_draft", "read_field", "check_draft", "show_images")
SEARCH_TOOLS = ("web_search",)
IMAGE_SEARCH_TOOLS = ("image_search",)
FETCH_TOOLS = ("web_fetch", "read_page", "save_note", "save_image")
PLANNING_TOOLS = ("ask_user", "propose_plan")
BUILD_TOOLS = ("write_field", "lore_upsert", "lore_delete", "set_greetings", "set_cover")
IMAGE_TOOLS = ("generate_image",)
REVISE_TOOLS = ("propose_changes",)

# 调用成功就结束这一轮、等用户回答或决定的工具
END_TOOLS = ("ask_user", "propose_plan", "propose_changes")


def run_mode(
    *,
    stage: str,
    origin: str,
    plan_approved: bool,
    complete: bool,
    trigger: Trigger,
) -> RunMode:
    if stage in ("build", "check"):
        return "build"
    if stage in ("done", "revise"):
        return "build" if trigger == "continue" and not complete else "revise"
    # start / research / questions / plan
    if origin == "agent" and not plan_approved:
        return "planning"
    return "revise" if complete and trigger != "continue" else "build"


def tools_for(
    mode: RunMode,
    *,
    can_search: bool,
    can_fetch: bool = True,
    can_images: bool = False,
    image_budget: int = 0,
) -> tuple[str, ...]:
    tools: list[str] = list(COMMON_TOOLS)
    if can_search:
        tools.extend(SEARCH_TOOLS)
        if can_images:
            tools.extend(IMAGE_SEARCH_TOOLS)
    if can_fetch:
        tools.extend(FETCH_TOOLS)
    if mode == "planning":
        tools.extend(PLANNING_TOOLS)
    elif mode == "build":
        tools.extend(BUILD_TOOLS)
        if image_budget > 0:
            tools.extend(IMAGE_TOOLS)
    else:
        tools.extend(REVISE_TOOLS)
    return tuple(tools)


def stage_of(mode: RunMode) -> str:
    """这一轮开始时草稿的 stage。"""
    return {"planning": "start", "build": "build", "revise": "revise"}[mode]
