"""服务端配置：环境变量与默认值（也会读取当前目录的 .env）。"""

from __future__ import annotations

from pathlib import Path
from typing import Literal

from pydantic import Field, SecretStr, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    env: Literal["dev", "test", "prod"] = "dev"
    # 这个版本是从哪次提交构建的（镜像构建时写进 BUILD_ID）。/health 会返回它，
    # 部署脚本据此确认新版本已经起来
    build_id: str = "dev"
    host: str = "0.0.0.0"
    port: int = 8000
    # 反向代理的地址（逗号隔开，可以写网段）：只有来自这些地址的请求，
    # 才采信 X-Forwarded-For 里的真实 IP。注册、登录的限流按真实 IP 计数，
    # 这里漏了代理的地址，所有人会被算成同一个 IP、共用一份次数。
    # 默认只信本机；deploy/docker-compose.yml 另外加上了 Docker 的内网段
    forwarded_allow_ips: str = "127.0.0.1,::1"
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
    # 当作外网放行的“假 IP 段”，逗号分开，例如 198.18.0.0/15（Clash fake-ip）。
    # 用这类代理时不必为了联网打开 ALLOW_PRIVATE_ENDPOINTS
    fake_ip_ranges: str = ""
    # 出站代理（可选）。经代理时做不到 IP 钉住，见 providers/transport.py
    outbound_proxy: str | None = None

    # M0 的 SSE 探针接口。不设置时：开发环境打开，生产环境关闭
    enable_probe_endpoints: bool | None = None
    event_buffer_retention_s: float = Field(default=600.0, gt=0)

    # 热路径：租约 120 秒，生成期间每 30 秒续租
    turn_lease_s: float = Field(default=120.0, gt=0)
    turn_lease_renew_s: float = Field(default=30.0, gt=0)
    world_builder_timeout_s: float = Field(default=30.0, gt=0)
    options_repair_timeout_s: float = Field(default=5.0, gt=0)
    # 导演写一段的总时长上限，超过就停下、这一轮按失败结束（防止模型一直写不停）
    director_timeout_s: float = Field(default=600.0, gt=0)

    # 收到 SIGTERM 后等进行中的回合与任务的上限；容器的停止宽限期要比它长
    shutdown_grace_s: float = Field(default=60.0, ge=0)
    worker_shutdown_grace_s: float = Field(default=60.0, ge=0)

    credential_concurrency: int = Field(default=4, ge=1)
    worker_concurrency: int = Field(default=4, ge=1)
    # 世界状态 agent 整理一回合最多多久（包括最多 20 轮工具），超时算这一回合整理失败
    state_turn_timeout_s: float = Field(default=180.0, gt=0)
    # 切章（docs/agent-runtime.md 第 4 节“章节整理”）：这一章的原文超过 soft 个 token 以后，
    # 在下一个场景结束处切；一直没有场景结束，到 hard 时硬切
    chapter_soft_tokens: int = Field(default=8000, gt=0)
    chapter_hard_tokens: int = Field(default=16000, gt=0)
    # 章节整理一章最多多久，超时算失败（下一回合整理完会再试）
    chapter_timeout_s: float = Field(default=180.0, gt=0)
    # 每个存档能回退几次（以后按用户区分，例如充值用户 3 次）
    rollback_limit: int = Field(default=1, ge=0)
    job_lock_timeout_s: float = Field(default=300.0, gt=0)

    # 限流（每分钟次数）：登录与注册按 IP，提交行动与探测按用户
    rate_limit_auth_per_min: int = Field(default=5, ge=1)
    rate_limit_turns_per_min: int = Field(default=30, ge=1)
    rate_limit_probe_per_min: int = Field(default=5, ge=1)

    # 工作台（按用户）：开始、发消息、接着写、导入、上传、生成封面、测试外部服务合在一起，每分钟次数
    rate_limit_workbench_per_min: int = Field(default=20, ge=1)
    # 每个用户同时在写的 agent 最多几个、没保存的草稿最多几份、图片一共多大
    max_running_agents: int = Field(default=2, ge=1)
    max_open_drafts: int = Field(default=50, ge=1)
    max_image_bytes_per_user: int = Field(default=200 * 1024 * 1024, ge=1024 * 1024)

    # 内容边界：sfw 时，写故事和写卡的提示词里加上“不写露骨的性描写”，只管模型写什么，
    # 不审核用户存的卡（官方服务 bettertavern.com 用；自己部署的默认 open，不限制）
    content_policy: Literal["open", "sfw"] = "open"

    # 官方模型：服务器用运营方自己的 Key 调模型，用户不用配置（官方服务用）。
    # 不设 PLATFORM_API_KEY 就没有
    platform_api_key: SecretStr | None = None
    platform_provider: str = "deepseek"
    platform_model: str = "deepseek-flash"
    platform_base_url: str | None = None
    # 单价：每百万 token 多少元（输入没命中缓存、命中缓存、输出）。
    # 默认是 DeepSeek 的高峰价，宁可多算
    platform_price_input: float = Field(default=2.0, ge=0)
    platform_price_cached: float = Field(default=0.04, ge=0)
    platform_price_output: float = Field(default=8.0, ge=0)
    # 官方 Key 所有用户共用，同时最多几个请求
    platform_concurrency: int = Field(default=32, ge=2)
    # 新用户验证邮箱后送的体验点数（1 点 = 0.001 元的模型费用）
    trial_credits: int = Field(default=1500, ge=0)
    # 全站最近 24 小时在官方模型上最多花多少元，超过就暂停官方模型（并发报错提醒）
    platform_daily_budget: float = Field(default=50.0, gt=0)
    # 没有自己的记录时，估计每回合花多少点（给用户看“大约还能写多少回合”）
    platform_turn_points: int = Field(default=40, ge=1)

    # 官方搜索：工作台 agent 查资料用运营方的搜索 Key（只用免费额度），用户自己没配搜索时用它；
    # 次数用完了就查维基百科（不用 Key）。不设 PLATFORM_SEARCH_API_KEY 就只查维基百科
    platform_search_api_key: SecretStr | None = None
    platform_search_provider: str = "tavily"
    # 每个用户每天最多几次、全站每个月最多几次（Tavily 免费每月 1000 次，留一点余量）
    platform_search_daily: int = Field(default=30, ge=0)
    platform_search_monthly: int = Field(default=950, ge=0)

    # 账号
    # 能不能注册新账号（出问题时先关掉）
    registration_open: bool = True
    # 注册后要不要先验证邮箱。不设置时：配了发信服务（RESEND_API_KEY）就要，否则不要
    email_verification: bool | None = None
    # 发信：Resend 的 API key 和发件人（域名要先在 Resend 里验证）
    resend_api_key: SecretStr | None = None
    mail_from: str = "BetterTavern <noreply@localhost>"
    # 服务报错时发邮件提醒到这个地址（同一段时间里的报错合成一封，只写事件名和次数）。不设置就不发
    alert_email: str | None = None
    alert_interval_s: float = Field(default=900.0, ge=60)

    # 允许的跨域来源，逗号分隔。网页和接口同源部署时不需要；网页放在别的域名下时把网页的地址加进来，
    # 网页端的 Cookie 登录也只接受同源和这里列出的来源
    cors_origins: str = ""

    @field_validator(
        "resend_api_key",
        "alert_email",
        "platform_api_key",
        "platform_base_url",
        "platform_search_api_key",
        mode="before",
    )
    @classmethod
    def _blank_is_unset(cls, value: object) -> object:
        # compose 里没填的变量以空字符串传进来，当作没配置
        if isinstance(value, str) and not value.strip():
            return None
        return value

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
    def email_verification_required(self) -> bool:
        if self.email_verification is None:
            return self.resend_api_key is not None
        return self.email_verification

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]
