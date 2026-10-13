"""服务端配置：环境变量与默认值（也会读取当前目录的 .env）。"""

from __future__ import annotations

from typing import Literal

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    env: Literal["dev", "test", "prod"] = "dev"
    host: str = "0.0.0.0"
    port: int = 8000
    log_level: str = "INFO"
    # 日志默认不含故事文本
    log_story_text: bool = False

    database_url: str = "postgresql+asyncpg://bettertavern:bettertavern@localhost:5432/bettertavern"

    # 只允许 https 和公网地址；自己部署、想接本机 Ollama 时可以打开。多人共用的公开服务不要开
    allow_private_endpoints: bool = False
    # 出站代理（可选）。经代理时做不到 IP 钉住，见 providers/transport.py
    outbound_proxy: str | None = None

    # M0 的 SSE 探针接口。不设置时：开发环境打开，生产环境关闭
    enable_probe_endpoints: bool | None = None
    event_buffer_retention_s: float = Field(default=600.0, gt=0)

    # 收到 SIGTERM 后等进行中的回合与任务的上限；容器的停止宽限期要比它长
    shutdown_grace_s: float = Field(default=60.0, ge=0)
    worker_shutdown_grace_s: float = Field(default=60.0, ge=0)

    credential_concurrency: int = Field(default=4, ge=1)
    worker_concurrency: int = Field(default=4, ge=1)
    job_lock_timeout_s: float = Field(default=300.0, gt=0)

    @property
    def is_prod(self) -> bool:
        return self.env == "prod"

    @property
    def probe_endpoints_enabled(self) -> bool:
        if self.enable_probe_endpoints is None:
            return not self.is_prod
        return self.enable_probe_endpoints
