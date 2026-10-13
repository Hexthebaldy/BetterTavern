from __future__ import annotations

from collections.abc import Iterator

import pytest

from tests.fakes.llm_server import FakeLLMServer, RunningFakeLLM


@pytest.fixture
def anyio_backend() -> str:
    return "asyncio"


@pytest.fixture(scope="session")
def fake_llm_session() -> Iterator[RunningFakeLLM]:
    server = FakeLLMServer()
    running = server.start()
    try:
        yield running
    finally:
        server.stop()


@pytest.fixture
def fake_llm(fake_llm_session: RunningFakeLLM) -> Iterator[RunningFakeLLM]:
    fake_llm_session.app.reset()
    yield fake_llm_session
    fake_llm_session.app.reset()
