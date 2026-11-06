from bettertavern.services.playthrough_service import excerpt_of


def test_plain_turn_uses_the_narrative() -> None:
    assert excerpt_of("雨还在下。" * 40, []) == ("雨还在下。" * 40)[:120]


def test_cast_turn_drops_the_speaker_lines() -> None:
    """多角色的局：叙述里每段前面一行名字，列表里的开头不要带它。"""
    narrative = "【沈知微】\n先坐。\n\n【老周】\n这雨，今晚怕是走不成喽。"
    segments = [
        {"speaker": 0, "text": "先坐。"},
        {"speaker": 1, "text": "这雨，今晚怕是走不成喽。"},
    ]
    excerpt = excerpt_of(narrative, segments)
    assert "【" not in excerpt
    assert excerpt == "先坐。\n\n这雨，今晚怕是走不成喽。"
