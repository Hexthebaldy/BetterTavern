"""日志脱敏：密钥、令牌、密码不会原样出现；故事文本字段默认丢掉；邮箱打码；过长的值截断。"""

from __future__ import annotations

import json

from bettertavern.infra.observability.redact import EVENT_MAX_CHARS, REDACTED, redact_event


def flat(event: dict[str, object]) -> str:
    return json.dumps(event, ensure_ascii=False, default=str)


def test_secret_fields_are_replaced_whatever_their_spelling() -> None:
    out = redact_event(
        {
            "event": "credential.created",
            "api_key": "sk-abcdefghijklmnop",
            "Authorization": "Bearer abc",
            "refresh-token": "r1",
            "headers": {"x-api-key": "k", "accept": "json"},
        }
    )
    assert out["api_key"] == REDACTED
    assert out["Authorization"] == REDACTED
    assert out["refresh-token"] == REDACTED
    assert out["headers"] == {"x-api-key": REDACTED, "accept": "json"}


def test_secrets_inside_free_text_are_scrubbed() -> None:
    secrets = [
        "sk-live1234567890abcdef",
        "hf_AbCdEfGhIjKlMnOp",
        "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1In0.c2lnbmF0dXJlX2hlcmU",
    ]
    out = redact_event(
        {
            "event": "provider.error",
            "detail": f"upstream said: Authorization: Bearer {secrets[0]} rejected",
            "url": f"https://example.com/v1/models?key={secrets[1]}&page=2",
            "exception": f"Traceback ...\nValueError: token={secrets[2]}",
        }
    )
    text = flat(out)
    for secret in secrets:
        assert secret not in text
    assert "page=2" in out["url"]


def test_story_fields_are_dropped_unless_explicitly_kept() -> None:
    event = {"event": "turn.committed", "narrative": "她终于抬起眼。", "seq": 3, "text": "我坐下"}
    out = redact_event(event)
    assert "narrative" not in out and "text" not in out
    assert out["seq"] == 3
    kept = redact_event(event, keep_story=True)
    assert kept["narrative"] == "她终于抬起眼。"


def test_emails_are_masked() -> None:
    out = redact_event({"event": "auth.login", "note": "login by alice.smith@example.com failed"})
    assert "alice.smith" not in out["note"]
    assert "a***@example.com" in out["note"]


def test_long_values_and_event_names_are_truncated() -> None:
    out = redact_event({"event": "x" * 1000, "blob": "y" * 10_000, "items": list(range(500))})
    assert len(out["event"]) < EVENT_MAX_CHARS + 50
    assert len(out["blob"]) < 2_100
    assert len(out["items"]) == 51


def test_original_event_is_not_modified_and_internal_fields_pass_through() -> None:
    record = object()
    event = {"event": "e", "password": "p", "_record": record}
    out = redact_event(event)
    assert event["password"] == "p"
    assert out["_record"] is record
