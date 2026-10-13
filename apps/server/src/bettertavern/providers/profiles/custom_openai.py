"""玩家自定义的 OpenAI 兼容端点：没有默认基址，能力全靠探测，窗口由玩家在路由里确认。"""

from __future__ import annotations

from ..profile import ProviderProfile

PROFILE = ProviderProfile(
    id="custom_openai",
    display_name="自定义 OpenAI 兼容端点",
    default_base_url=None,
    requires_base_url=True,
)
