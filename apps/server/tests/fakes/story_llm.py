"""开发用的假模型服务：按一段固定的剧情回复，不用真实的 Key 就能在网页端、App 里从导入一路玩下去。

    cd apps/server && uv run python -m tests.fakes.story_llm --port 8020

在“添加模型”里选 OpenAI 兼容的服务商，端点填 http://127.0.0.1:8020/v1，Key 随便填（至少 8 个字符），
模型选 fake-model，设为导演。服务端要允许内网地址（ALLOW_PRIVATE_ENDPOINTS=true）。

回复规则和 e2e/test_m1_flow.py 的假导演相同：
带 stream 的请求是导演（叙述 + 两个选项，逐段流式发出），
提示词里有 <character-card> 的是 WorldBuilder，问“接下来可以采取的行动”的是选项修复。
"""

from __future__ import annotations

import argparse
import json
from dataclasses import dataclass

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


def director_text(n: int) -> str:
    paragraph = PARAGRAPHS[(n - 1) % len(PARAGRAPHS)]
    first, second = OPTIONS[(n - 1) % len(OPTIONS)]
    return f"<narrative>\n{paragraph}\n</narrative>\n<options>\n1. {first}\n2. {second}\n</options>"


@dataclass
class StoryScript:
    """按请求的种类回复；piece_delay 是每一小段之间的停顿（秒），让流式输出看得见"""

    piece_delay: float = 0.04
    director_calls: int = 0

    def reply(self, request: RecordedRequest) -> Reply:
        body = request.body if isinstance(request.body, dict) else {}
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
        prompt = "\n".join(str(m.get("content", "")) for m in body.get("messages", []))
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
    args = parser.parse_args()
    app = FakeLLM()
    app.default_reply = StoryScript(piece_delay=args.delay).reply
    print(f"假模型服务：http://{args.host}:{args.port}/v1 ，模型 fake-model")
    uvicorn.run(app, host=args.host, port=args.port, log_level="warning")


if __name__ == "__main__":
    main()
