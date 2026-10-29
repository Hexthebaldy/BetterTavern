"""多角色的局（docs/cast.md）：几个人一个接一个写、每人只看自己的卡和自己知道的秘密、
开头照抄的名字不推给玩家、选项在最后补、中途失败留下草稿、开场和结局照旧由导演写、开局记下角色。"""

from __future__ import annotations

import json

import pytest

from bettertavern.domain.routing import RouteTask
from bettertavern.domain.scenario.card import CharacterCard
from bettertavern.domain.story.cast import CastMember
from bettertavern.domain.story.turn import PlayerAction
from bettertavern.domain.world.card_source import CardSource, CardText
from bettertavern.domain.world.views import EntityView, FactView, WorldSnapshot
from bettertavern.providers import ProviderError
from bettertavern.providers.errors import ErrorClass
from bettertavern.runtime.context.assembler import ContextAssembler
from bettertavern.runtime.context.cast import CastRole
from bettertavern.runtime.ports import HistoryTurn, Preferences, TurnContext, WorldBuildInput
from bettertavern.runtime.prompts import PromptLibrary
from tests.fakes.runtime import (
    FakeRoutes,
    FakeStore,
    StreamScript,
    header,
    make_route,
    result,
    scripted_hub,
)
from tests.unit.runtime.test_runner import pieces, run_turn

pytestmark = pytest.mark.anyio

CAST = (CastMember(0, "阿苓"), CastMember(1, "老周"))
CARDS = CardSource(
    cards=(
        CardText(
            name="阿苓",
            description="阿苓是酒馆帮工，嘴硬心软",
            examples="<START>\n阿苓：哼，外乡人。",
            system_prompt="阿苓说话短，常带反问",
            post_history_instructions="阿苓不提自己的过去",
        ),
        CardText(name="老周", description="老周是掌柜，欠着商会的钱", system_prompt="老周说话慢"),
    )
)
WORLD = WorldSnapshot(
    entities=(
        EntityView(
            id="w",
            kind="world",
            name="世界",
            data={"scene": {"location": "bar", "present": ["ling", "zhou"]}},
        ),
        EntityView(id="hero", kind="character", name="林川", is_protagonist=True),
        EntityView(id="ling", kind="character", name="阿苓", aliases=("苓丫头",)),
        EntityView(id="zhou", kind="character", name="老周", aliases=("掌柜",)),
        EntityView(id="bar", kind="location", name="灰石酒馆"),
    ),
    facts=(
        FactView(id="f1", text="老周欠商会三百两", visibility="secret", known_by=("zhou",)),
        FactView(id="f2", text="阿苓偷看过那封信", visibility="secret", known_by=("ling",)),
        FactView(id="f3", text="酒馆今晚不打烊"),
    ),
)


OPENING = "<narrative>\n雨夜。\n</narrative>\n<options>\n1. 进\n2. 退\n</options>"


def cast_store(action: PlayerAction) -> FakeStore:
    store = FakeStore(world=WORLD, cards=CARDS, action=action)
    store.cast = CAST
    return store


async def test_each_character_writes_their_own_part_in_turn() -> None:
    hub, adapters = scripted_hub("fake")
    fake = adapters["fake"]
    # 阿苓照着历史在开头写了名字：不推给玩家，也不存
    fake.streams.append(
        StreamScript(pieces("<narrative>\n【阿苓】\n外乡人？她瞟了老周一眼。\n</narrative>"))
    )
    fake.streams.append(StreamScript(pieces("<narrative>\n老周推开算盘。\n</narrative>")))
    fake.completions.append(result('{"options": ["追问阿苓", "看看老周"]}'))
    store = cast_store(PlayerAction("text", "我问阿苓，又看向老周"))
    events = await run_turn(store, FakeRoutes({RouteTask.DIRECTOR: make_route()}), hub)

    starts = [d for e, d in events if e == "speaker.started"]
    assert starts == [
        {"index": 0, "speaker": 0, "name": "阿苓"},
        {"index": 1, "speaker": 1, "name": "老周"},
    ]
    # 每个人开写之后的增量都是他这一段的
    parts: list[str] = []
    for event, data in events:
        if event == "speaker.started":
            parts.append("")
        elif event == "narrative.delta":
            parts[-1] += str(data["text"])
    assert parts == ["外乡人？她瞟了老周一眼。", "老周推开算盘。"]

    outcome = store.committed[0]
    assert [(s.speaker, s.text) for s in outcome.segments] == [(0, parts[0]), (1, parts[1])]
    assert outcome.narrative == f"【阿苓】\n{parts[0]}\n\n【老周】\n{parts[1]}"
    assert [o.text for o in outcome.options] == ["追问阿苓", "看看老周"]
    assert outcome.options_source == "repaired"
    assert [r.agent for r in outcome.runs] == ["director", "director", "options_repair"]
    assert [r.result["speaker"] for r in outcome.runs[:2]] == [0, 1]
    completed = events[-1][1]["turn"]
    assert isinstance(completed, dict)
    assert completed["segments"] == [
        {"speaker": 0, "text": parts[0]},
        {"speaker": 1, "text": parts[1]},
    ]

    first, second = fake.requests[:2]
    # 两次请求只有最后一条消息不同，前面整段能命中前缀缓存
    assert first.messages[:-1] == second.messages[:-1]
    system = first.messages[0].content
    assert "阿苓、老周" in system and "嘴硬心软" not in system and "说话慢" not in system
    mine = first.messages[-1].content
    assert "嘴硬心软" in mine and "常带反问" in mine and "哼，外乡人。" in mine
    assert "阿苓不提自己的过去" in mine
    assert "欠着商会的钱" not in mine and "说话慢" not in mine
    # 秘密只给知道的人看
    assert "阿苓偷看过那封信" in mine and "老周欠商会三百两" not in mine
    assert "酒馆今晚不打烊" in mine
    his = second.messages[-1].content
    assert "老周欠商会三百两" in his and "阿苓偷看过那封信" not in his
    assert "嘴硬心软" not in his and "阿苓不提自己的过去" not in his
    # 后说的人看得到前面的人刚写的
    assert "外乡人？她瞟了老周一眼。" in his


async def test_a_failure_midway_keeps_what_was_written_as_a_draft() -> None:
    hub, adapters = scripted_hub("fake")
    fake = adapters["fake"]
    fake.streams.append(StreamScript(pieces("<narrative>\n外乡人？\n</narrative>")))
    fake.streams.append(
        StreamScript(
            pieces("<narrative>\n老周叹了口气，", 4),
            error=ProviderError(ErrorClass.SERVER_ERROR, "boom"),
            error_after=4,
        )
    )
    store = cast_store(PlayerAction("text", "阿苓，老周，你们好"))
    events = await run_turn(store, FakeRoutes({RouteTask.DIRECTOR: make_route()}), hub)
    assert events[-1][0] == "turn.failed" and events[-1][1]["partial"] is True
    failure = store.failed[0]
    assert [s.speaker for s in failure.segments] == [0, 1]
    assert failure.narrative.startswith("【阿苓】\n外乡人？\n\n【老周】\n")
    # 已经花掉的两次请求都记下了
    assert [(r.agent, r.status) for r in failure.runs] == [
        ("director", "ok"),
        ("director", "failed"),
    ]
    assert not store.committed


async def test_letting_them_continue_and_the_narrator() -> None:
    hub, adapters = scripted_hub("fake")
    fake = adapters["fake"]
    fake.streams.append(StreamScript(pieces("<narrative>\n阿苓去了后屋。\n</narrative>")))
    fake.completions.append(result('{"options": ["跟上", "留下"]}'))
    store = cast_store(PlayerAction("continue", ""))
    # 上一回合老周最后说话：这回合换阿苓
    store.history = [
        HistoryTurn(seq=0, action=PlayerAction("opening", ""), narrative="开场", speakers=(0, 1))
    ]
    await run_turn(store, FakeRoutes({RouteTask.DIRECTOR: make_route()}), hub)
    assert [s.speaker for s in store.committed[0].segments] == [0]
    last = fake.requests[0].messages[-1].content
    assert "<player-action>" not in last and "这一回合我没有行动" in last

    # 点名旁白：最后一条消息里是每张卡的指令，没有哪张卡的原文，也没有对话示例
    fake.streams.append(StreamScript(pieces("<narrative>\n雨停了。\n</narrative>")))
    fake.completions.append(result('{"options": ["出门", "再坐会儿"]}'))
    store = cast_store(PlayerAction("text", "我等雨停", speakers=(None,)))
    await run_turn(store, FakeRoutes({RouteTask.DIRECTOR: make_route()}), hub)
    assert [s.speaker for s in store.committed[0].segments] == [None]
    assert store.committed[0].narrative == "【旁白】\n雨停了。"
    narrator = fake.requests[-2].messages[-1].content
    assert "常带反问" in narrator and "说话慢" in narrator
    assert "嘴硬心软" not in narrator and "哼，外乡人。" not in narrator
    assert "老周欠商会三百两" in narrator  # 旁白和导演一样看得到全部秘密


async def test_the_opening_and_ending_are_still_written_by_the_director() -> None:
    hub, adapters = scripted_hub("fake")
    fake = adapters["fake"]
    fake.streams.append(StreamScript(pieces("<narrative>\n故事结束了。\n</narrative>")))
    store = cast_store(PlayerAction("ending", ""))
    events = await run_turn(store, FakeRoutes({RouteTask.DIRECTOR: make_route()}), hub)
    assert "speaker.started" not in [e for e, _ in events]
    outcome = store.committed[0]
    assert outcome.ends_story and outcome.segments == ()
    last = fake.requests[0].messages[-1].content
    # 每张卡的指令和示例都在最后一条消息里
    assert "常带反问" in last and "说话慢" in last and "哼，外乡人。" in last


async def test_opening_a_story_with_two_cards_records_the_cast() -> None:
    hub, adapters = scripted_hub("fake")
    seed = {"world": {"title": "雨夜", "setting": "灰石镇"}, "protagonist": {"name": "林川"}}
    adapters["fake"].completions.append(result(json.dumps(seed, ensure_ascii=False)))
    adapters["fake"].streams.append(StreamScript(pieces(OPENING)))
    ling = CharacterCard(spec="card_v2", name="阿苓", description="帮工")
    zhou = CharacterCard(spec="card_v2", name=" 老周 ", description="掌柜")
    store = FakeStore(
        world_input=WorldBuildInput(
            card=ling,
            protagonist_name="林川",
            protagonist_summary="",
            preferences=Preferences(),
            cards=(ling, zhou),
            covers=("blob-1", None),
        ),
        action=PlayerAction("opening", ""),
    )
    routes = FakeRoutes({RouteTask.DIRECTOR: make_route()})
    await run_turn(store, routes, hub, seq=0, world_ready=False)
    assert store.saved_cast == [("阿苓", "blob-1"), ("老周", None)]
    # 一张卡的剧本不记
    one = FakeStore(
        world_input=WorldBuildInput(
            card=ling,
            protagonist_name="林川",
            protagonist_summary="",
            preferences=Preferences(),
            cards=(ling,),
        ),
        action=PlayerAction("opening", ""),
    )
    adapters["fake"].completions.append(result(json.dumps(seed, ensure_ascii=False)))
    adapters["fake"].streams.append(StreamScript(pieces(OPENING)))
    await run_turn(one, routes, hub, seq=0, world_ready=False)
    assert one.saved_cast == []


def test_history_of_a_continue_turn_says_the_player_held_back() -> None:
    ctx = TurnContext(
        header=header(2, language="en"),
        action=PlayerAction("text", "hm"),
        protagonist_name="林川",
        preferences=Preferences(),
        seed=None,
        history=(HistoryTurn(seq=1, action=PlayerAction("continue", ""), narrative="x"),),
        world=WORLD,
        cards=CARDS,
        cast=CAST,
    )
    assembler = ContextAssembler(PromptLibrary("en"))
    messages = assembler.assemble(ctx, 64_000, role=CastRole(0)).messages
    assert "I take no action this turn" in messages[1].content
    assert "Facts 阿苓 knows" in messages[-1].content
    assert "This part: 阿苓" in messages[-1].content
