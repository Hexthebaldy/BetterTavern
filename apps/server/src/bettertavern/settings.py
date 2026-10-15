"""服务端配置：环境变量与默认值（也会读取当前目录的 .env）。"""

from __future__ import annotations

from pathlib import Path
from typing import Literal

from pydantic import Field, SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    env: Literal["dev", "test", "prod"] = "dev"
    host: str = "0.0.0.0"
    port: int = 8000
    log_level: str = "INFO"
    # 终端里的日志格式：auto 在终端里是带颜色的单行、否则是 JSON；也可以固定成 console 或 json
    log_format: Literal["auto", "console", "json"] = "auto"
    # 是否把日志另写一份 JSON 到 data_dir/logs/<进程>.log（vis 读的就是它）。
    # 不设置时：开发环境写，生产环境不写
    log_to_file: bool | None = None
    # 日志默认不含故事文本；打开后只在开发环境生效
    log_story_text: bool = False

    database_url: str = "postgresql+asyncpg://bettertavern:bettertavern@localhost:5432/bettertavern"
    # 本地数据目录：开发环境自动生成的密钥放在这里
    data_dir: Path = Path(".data")

    # 密钥。生产环境必须显式配置（`bettertavern keygen` 生成）；开发环境不配置时自动生成并保存在
    # data_dir/dev-secrets.json，重启后不变
    # MASTER_KEYS：加密模型密钥用的主密钥，格式 "kid:base64密钥,kid2:..."；
    # 第一个用于加密，其余只用于解密（轮换）
    master_keys: SecretStr | None = None
    # AUTH_SECRET：签发访问令牌（HS256）
    auth_secret: SecretStr | None = None
    access_token_ttl_s: int = Field(default=900, ge=60)
    refresh_token_ttl_s: int = Field(default=30 * 86400, ge=3600)
    # 网页端放刷新令牌的 Cookie 带不带 Secure（只走 https）。不设置时：开发环境不带
    # （Safari 在 http://localhost 上不保存带 Secure 的 Cookie），其他环境都带
    auth_cookie_secure: bool | None = None

    # 只允许 https 和公网地址；自己部署、想接本机 Ollama 时可以打开。多人共用的公开服务不要开
    allow_private_endpoints: bool = False
    # 出站代理（可选）。经代理时做不到 IP 钉住，见 providers/transport.py
    outbound_proxy: str | None = None

    # M0 的 SSE 探针接口。不设置时：开发环境打开，生产环境关闭
    enable_probe_endpoints: bool | None = None
    event_buffer_retention_s: float = Field(default=600.0, gt=0)

    # 热路径：租约 120 秒，生成期间每 30 秒续租；屏障最多等 8 秒
    turn_lease_s: float = Field(default=120.0, gt=0)
    turn_lease_renew_s: float = Field(default=30.0, gt=0)
    state_barrier_timeout_s: float = Field(default=8.0, ge=0)
    world_builder_timeout_s: float = Field(default=30.0, gt=0)
    options_repair_timeout_s: float = Field(default=5.0, gt=0)

    # 收到 SIGTERM 后等进行中的回合与任务的上限；容器的停止宽限期要比它长
    shutdown_grace_s: float = Field(default=60.0, ge=0)
    worker_shutdown_grace_s: float = Field(default=60.0, ge=0)

    credential_concurrency: int = Field(default=4, ge=1)
    worker_concurrency: int = Field(default=4, ge=1)
    job_lock_timeout_s: float = Field(default=300.0, gt=0)

    # 限流（每分钟次数）：登录与注册按 IP，提交行动与探测按用户
    rate_limit_auth_per_min: int = Field(default=5, ge=1)
    rate_limit_turns_per_min: int = Field(default=30, ge=1)
    rate_limit_probe_per_min: int = Field(default=5, ge=1)

    # 允许的跨域来源，逗号分隔。网页和接口同源部署时不需要；网页放在别的域名下时把网页的地址加进来，
    # 网页端的 Cookie 登录也只接受同源和这里列出的来源
    cors_origins: str = ""

    @property
    def is_prod(self) -> bool:
        return self.env == "prod"

    @property
    def log_file_enabled(self) -> bool:
        if self.log_to_file is None:
            return not self.is_prod
        return self.log_to_file

    @property
    def probe_endpoints_enabled(self) -> bool:
        if self.enable_probe_endpoints is None:
            return not self.is_prod
        return self.enable_probe_endpoints

    @property
    def refresh_cookie_secure(self) -> bool:
        if self.auth_cookie_secure is None:
            return self.env != "dev"
        return self.auth_cookie_secure

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]
