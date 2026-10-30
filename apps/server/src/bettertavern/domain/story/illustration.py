"""故事里配图（docs/illustrations.md）的规则：哪些回合能画、画风、“想看什么”的长度、多久算没画完。

- 只有写完的回合能画（replied、committed），开场、结局也算；
- 同一回合同时只画一张，一个人同时最多画 MAX_PENDING 张；
- 从点下去算起超过 DEADLINE_S 秒还没画好就当失败（后台任务卡住、worker 重启都不会让它一直转圈）；
- 一回合只留一张：新的画好时，旧的那张（和失败的记录）一起删掉。
"""

from __future__ import annotations

from typing import Literal

ImageStatus = Literal["pending", "ready", "failed"]

# 画风：空是“不指定”；其余的拼进提示词时换成英文说法（providers/image 的 STYLE_HINTS）
STYLES = ("", "anime", "realistic", "ink", "oil", "film", "flat")
MAX_REQUEST_CHARS = 300
DEADLINE_S = 180
MAX_PENDING = 3
SETTLED = frozenset({"replied", "committed"})

# 没画出来的原因（turn_images.error，客户端按它翻译）：
# - route_missing：没有可用的模型写画面描述；model_failed：写画面描述出错；
# - tool_missing：没配出图服务（点下去以后被删了）；storage_full：图片空间满了；
# - timeout：超过 DEADLINE_S 还没画好；
# - auth、quota、blocked、http、network、bad_response、unsupported：出图服务报的错
#   （providers/image 的 ImageError.kind）
IMAGE_ERRORS = frozenset(
    {
        "route_missing",
        "model_failed",
        "tool_missing",
        "storage_full",
        "timeout",
        "auth",
        "quota",
        "blocked",
        "http",
        "network",
        "bad_response",
        "unsupported",
    }
)


def normalize_style(value: str | None) -> str:
    """不认识的画风当作“不指定”。"""
    style = (value or "").strip()
    return style if style in STYLES else ""


def clean_request(value: str | None) -> str:
    """玩家写的“想看什么”：去掉空字符、合并首尾空白，截到 MAX_REQUEST_CHARS。"""
    return (value or "").replace("\x00", "").strip()[:MAX_REQUEST_CHARS]


def can_draw(turn_status: str) -> bool:
    return turn_status in SETTLED


def effective_status(status: str, age_s: float) -> tuple[str, str | None]:
    """读的时候：还在画但已经超过时限的，当作失败（timeout）。返回（状态，额外的原因）。"""
    if status == "pending" and age_s > DEADLINE_S:
        return "failed", "timeout"
    return status, None


def time_left(age_s: float) -> float:
    """后台任务开始时还剩多少秒（排队等了多久也算在里面）。"""
    return max(0.0, DEADLINE_S - age_s)
