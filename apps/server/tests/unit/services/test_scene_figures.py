"""配图时“画里可能有谁”（services/illustration_store.py 的 scene_figures）：
主角在最前面、带人设头像；卡里的角色按名字找封面；世界状态里此刻在场、又不是卡里角色的人
排在后面，没有参考图；名字重复的只留一个。"""

from __future__ import annotations

from bettertavern.domain.world.card_source import CardText
from bettertavern.domain.world.views import EntityView, WorldSnapshot
from bettertavern.services.illustration_store import scene_figures


def test_protagonist_cards_then_people_present() -> None:
    world = WorldSnapshot(
        entities=(
            EntityView(
                id="w",
                kind="world",
                name="青石渡",
                data={"scene": {"location": "l1", "present": ["c1", "c2", "c3"]}},
            ),
            EntityView(id="l1", kind="location", name="渡口", summary="青石铺的码头"),
            EntityView(id="me", kind="character", name="林川", is_protagonist=True),
            EntityView(id="c1", kind="character", name="沈 知微", summary="世界状态里的她"),
            EntityView(id="c2", kind="character", name="老船夫", summary="戴斗笠的老人"),
            EntityView(id="c3", kind="character", name="阿七", aliases=("林川",)),
        )
    )
    figures = scene_figures(
        protagonist=("林川", "灰色斗篷的信使", "avatar-1"),
        cards=[CardText(name="沈知微", description="十九岁，深蓝长裙")],
        covers={"沈知微": "cover-1"},
        world=world,
    )
    assert [(f.name, f.description, f.blob_id, f.protagonist) for f in figures] == [
        ("林川", "灰色斗篷的信使", "avatar-1", True),
        ("沈知微", "十九岁，深蓝长裙", "cover-1", False),
        # “沈 知微”是卡里的她，阿七的别名和主角重名：都不再列
        ("老船夫", "戴斗笠的老人", None, False),
    ]


def test_old_saves_without_card_snapshot_still_have_the_protagonist() -> None:
    figures = scene_figures(
        protagonist=("林川", "", None), cards=(), covers={}, world=WorldSnapshot()
    )
    assert [(f.name, f.protagonist) for f in figures] == [("林川", True)]
