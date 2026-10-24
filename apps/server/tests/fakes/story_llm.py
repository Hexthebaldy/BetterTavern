"""开发用的假模型服务：按一段固定的剧情回复，不用真实的 Key 就能在网页端、App 里从导入一路玩下去。

    cd apps/server && uv run python -m tests.fakes.story_llm --port 8020

在“添加模型”里选 OpenAI 兼容的服务商，端点填 http://127.0.0.1:8020/v1，Key 随便填（至少 8 个字符），
模型选 fake-model，设为导演。服务端要允许内网地址（ALLOW_PRIVATE_ENDPOINTS=true）。

回复规则和 e2e/test_m1_flow.py 的假导演相同：
带 stream 的请求是导演（叙述 + 两个选项，逐段流式发出），
提示词里有 <character-card> 的是 WorldBuilder，问“接下来可以采取的行动”的是选项修复，
带 tools 的非流式请求是后台整理世界状态的 agent：每次直接调用 commit，只写一句摘要、不改世界状态。
recall 打开时（--recall），导演收到召回工具会先查一次“火漆”，拿到结果再写；
提示词里有 <chapter-turns> 的是章节整理，回一段固定的章节摘要和玩家画像（要并梗概时也回梗概）；
有 <outline-source> 的是大纲修订：还没有大纲时回一版三拍的大纲，之后都回“不改”；
最后一条消息要 <synopsis> 的是闪电模式的压缩，回一段固定的梗概。
自定义端点默认被当成不能调用工具：要让后台整理跑起来，先在设置里测试一下这个模型。
"""

from __future__ import annotations

import argparse
import json
from dataclasses import dataclass
from typing import Any

import uvicorn

from tests.fakes.llm_server import (
    DONE,
    FakeLLM,
    JsonReply,
    RecordedRequest,
    Reply,
    StreamReply,
    chunk,
    completion,
    sse,
)

SEED = {
    "world": {
        "title": "雨夜渡口",
        "setting": "江南水乡的古渡口，常年阴雨，渡船只在夜里开。镇上的人都说对岸的灯从来没灭过。",
        "tone": "潮湿、克制、带一点悬疑",
        "rules": ["渡船只在子时开", "对岸的事不能当着船夫说"],
        "style": "现在时，第一人称，细节具体，对话简短",
    },
    "protagonist": {
        "name": "我",
        "summary": "从北方来的信使",
        "goal": "把一封没写收件人的信送到对岸",
    },
    "characters": [
        {
            "name": "沈知微",
            "summary": "渡口茶馆的掌柜，话很少，记性很好",
            "attitude": "警惕但好奇",
            "speech_style": "说半句留半句",
        },
        {"name": "老船夫", "summary": "撑了三十年船，从不收钱"},
        {"name": "阿砚", "summary": "茶馆的小伙计，总在偷看信封"},
    ],
    "locations": [
        {"name": "渡口茶馆", "summary": "临水的二层木楼，楼下烧着炭炉"},
        {"name": "对岸灯塔", "summary": "隔着雾只能看见一点黄光"},
    ],
    "items": [{"name": "无名信", "summary": "火漆上印着一只合拢的眼睛", "holder": "我"}],
    "organizations": [
        {
            "name": "守灯人",
            "summary": "据说世代守着对岸的灯",
            "members": ["老船夫"],
            "stance": "不明",
        }
    ],
    "facts": [
        {"text": "沈知微认得信上的火漆", "about": ["沈知微", "无名信"]},
        {
            "text": "老船夫就是守灯人",
            "about": ["老船夫", "守灯人"],
            "secret": True,
            "known_by": ["老船夫", "沈知微"],
        },
        {"text": "渡船只在子时开", "about": ["老船夫"]},
    ],
    "opening": {
        "location": "渡口茶馆",
        "present": ["沈知微", "阿砚"],
        "situation": "我推开茶馆的门，雨水顺着斗篷往下淌。",
        "hook": "沈知微的目光落在我怀里的信上。",
    },
}

PARAGRAPHS = [
    "沈知微往我杯里续了茶，水声很轻。“在这个渡口，等船的人都不说话。”她顿了顿，"
    "目光又落回我怀里的信上，“你要过河，就得等到子时。”",
    "窗外忽然传来船桨拍水的声音，可子时明明还没到。阿砚放下抹布，踮着脚往外看，"
    "雾里只有一点黄光，一明一灭，像是有人在对岸打着信号。",
    "老船夫在门口抖了抖蓑衣上的水，没有进来。他看了我一眼，又看了沈知微一眼，"
    "说：“今晚的船，只载一个人。”炭炉里的火噼啪响了一声。",
    "我把信从怀里取出来，火漆上那只合拢的眼睛在灯下泛着暗红。沈知微的手指在桌面上停住了，"
    "她压低声音：“这东西，你是从哪儿拿到的？”",
]

OPTIONS = [
    ("问沈知微对岸的灯是谁点的", "把信放在桌上，看她怎么反应"),
    ("跟着阿砚出门看个究竟", "留在茶馆，假装什么都没听见"),
    ("拦住老船夫，问他船去哪儿", "先付茶钱，等他自己开口"),
    ("说出信是从北边驿站捡来的", "反问她认不认得这个火漆"),
]


# 大纲修订的提示词里有“现在的大纲”时是修订，没有时是写第一版（三种语言）
_CURRENT_OUTLINE = ("现在的大纲：", "Current outline:", "現在の大綱：")


def outline_payload(prompt: str) -> dict[str, Any]:
    if any(label in prompt for label in _CURRENT_OUTLINE):
        return {"change": False, "reason": "故事还在照着大纲走。"}
    beats = [
        {"id": "b1", "status": "active", "intent": "在渡口打听对岸的灯", "done_when": "上了船"},
        {"id": "b2", "status": "pending", "intent": "跟老船夫渡河"},
        {"id": "b3", "status": "pending", "intent": "在对岸找到点灯的人"},
    ]
    return {"premise": "我要弄清对岸那盏灯是谁点的。", "beats": beats, "constraints": []}


def director_text(n: int) -> str:
    paragraph = PARAGRAPHS[(n - 1) % len(PARAGRAPHS)]
    first, second = OPTIONS[(n - 1) % len(OPTIONS)]
    return f"<narrative>\n{paragraph}\n</narrative>\n<options>\n1. {first}\n2. {second}\n</options>"


@dataclass
class StoryScript:
    """按请求的种类回复；piece_delay 是每一小段之间的停顿（秒），让流式输出看得见"""

    piece_delay: float = 0.04
    recall: bool = False  # 导演有召回工具时先调用一次 recall
    director_calls: int = 0
    recall_calls: int = 0
    state_calls: int = 0
    chapter_calls: int = 0
    outline_calls: int = 0
    compress_calls: int = 0

    def reply(self, request: RecordedRequest) -> Reply:
        body = request.body if isinstance(request.body, dict) else {}
        messages = body.get("messages") or [{}]
        if (
            body.get("stream")
            and body.get("tools")
            and self.recall
            and messages[-1].get("role") != "tool"
        ):
            self.recall_calls += 1
            call = {
                "index": 0,
                "id": f"recall-{self.recall_calls}",
                "type": "function",
                "function": {"name": "recall", "arguments": '{"query": "火漆"}'},
            }
            return StreamReply(
                [
                    sse(chunk(tool_calls=[call])),
                    sse(chunk(finish="tool_calls")),
                    sse(
                        chunk(
                            usage={"prompt_tokens": 900, "completion_tokens": 10}, no_choices=True
                        )
                    ),
                    DONE,
                ]
            )
        if body.get("stream"):
            self.director_calls += 1
            text = director_text(self.director_calls)
            items: list[bytes | float] = []
            for i in range(0, len(text), 6):
                items.append(sse(chunk(text[i : i + 6])))
                items.append(self.piece_delay)
            items.append(sse(chunk(finish="stop")))
            usage = {"prompt_tokens": 900, "completion_tokens": 120, "prompt_cache_hit_tokens": 800}
            items.append(sse(chunk(usage=usage, no_choices=True)))
            items.append(DONE)
            return StreamReply(items)
        if body.get("tools"):
            self.state_calls += 1
            arguments = {
                "digest": f"第 {self.state_calls} 次整理",
                "entities": [],
                "scene_ended": False,
            }
            call = {
                "id": f"call-{self.state_calls}",
                "type": "function",
                "function": {
                    "name": "commit",
                    "arguments": json.dumps(arguments, ensure_ascii=False),
                },
            }
            return JsonReply(completion("", tool_calls=[call], finish="tool_calls"))
        if "<synopsis>" in str(messages[-1].get("content", "")):
            # 压缩请求的开头是导演的上下文，只有最后一条是整理要求，所以只看最后一条
            self.compress_calls += 1
            synopsis = f"第 {self.compress_calls} 版：我在渡口等船，打听对岸的灯。"
            text = f"<synopsis>\n{synopsis}\n</synopsis>"
            usage = {"prompt_tokens": 900, "completion_tokens": 40, "prompt_cache_hit_tokens": 850}
            return JsonReply(completion(text, usage=usage))
        prompt = "\n".join(str(m.get("content", "")) for m in body.get("messages", []))
        if "<chapter-turns>" in prompt:
            self.chapter_calls += 1
            payload = {
                "chapter_summary": f"第 {self.chapter_calls} 章：我在渡口等船，见到了老船夫。",
                "player_profile": "玩家喜欢慢慢打听，不急着行动。",
            }
            if "要并进去的一章" in prompt or "The chapter to merge" in prompt:
                payload["synopsis"] = "## 剧情主线\n我来到渡口，打听对岸的灯。"
            return JsonReply(completion(json.dumps(payload, ensure_ascii=False)))
        if "<outline-source>" in prompt:
            self.outline_calls += 1
            return JsonReply(completion(json.dumps(outline_payload(prompt), ensure_ascii=False)))
        if "<character-card>" in prompt:
            return JsonReply(completion(json.dumps(SEED, ensure_ascii=False)))
        if "接下来可以采取的行动" in prompt or "actions the player could take next" in prompt:
            return JsonReply(completion('{"options": ["看看四周", "继续等待"]}'))
        error = {"error": {"message": "fake story server: unexpected request"}}
        return JsonReply(error, status=400)


def main() -> None:
    parser = argparse.ArgumentParser(description="开发用的假模型服务")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8020)
    parser.add_argument(
        "--delay", type=float, default=0.04, help="流式输出每一小段之间的停顿（秒）"
    )
    parser.add_argument(
        "--recall", action="store_true", help="导演有召回工具时先查一次（看“正在回想”的提示用）"
    )
    args = parser.parse_args()
    app = FakeLLM()
    app.default_reply = StoryScript(piece_delay=args.delay, recall=args.recall).reply
    print(f"假模型服务：http://{args.host}:{args.port}/v1 ，模型 fake-model")
    uvicorn.run(app, host=args.host, port=args.port, log_level="warning")


if __name__ == "__main__":
    main()
