"""认证与账户。"""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

from .common import Out


class RegisterIn(BaseModel):
    email: str = Field(max_length=254)
    password: str = Field(max_length=1024)
    display_name: str = Field(default="", max_length=40)
    # 界面语言（zh、en、ja）：记进账号，验证码邮件也用它
    locale: str | None = Field(default=None, max_length=16)


class LoginIn(BaseModel):
    email: str = Field(max_length=254)
    password: str = Field(max_length=1024)


class RefreshIn(BaseModel):
    refresh_token: str = Field(max_length=200)


class DeleteAccountIn(BaseModel):
    password: str = Field(max_length=1024)


class SendCodeIn(BaseModel):
    email: str = Field(max_length=254)
    # verify：重发注册验证码；reset：找回密码
    purpose: Literal["verify", "reset"]
    locale: str | None = Field(default=None, max_length=16)


class VerifyEmailIn(BaseModel):
    email: str = Field(max_length=254)
    code: str = Field(max_length=16)


class ResetPasswordIn(BaseModel):
    email: str = Field(max_length=254)
    code: str = Field(max_length=16)
    new_password: str = Field(max_length=1024)


class ChangePasswordIn(BaseModel):
    current_password: str = Field(max_length=1024)
    new_password: str = Field(max_length=1024)


class UserOut(Out):
    id: str
    email: str
    display_name: str
    locale: str
    created_at: datetime
    email_verified: bool


class AuthOut(BaseModel):
    user: UserOut
    access_token: str
    token_type: str = "Bearer"
    expires_in: int
    # Cookie 模式（网页端）下是 None：刷新令牌只在 Set-Cookie 里
    refresh_token: str | None
    refresh_expires_at: datetime


class RegisterOut(BaseModel):
    """要验证邮箱时（verification_required）还没登录：令牌字段都是 None，验证码已经发到邮箱。"""

    user: UserOut
    verification_required: bool
    access_token: str | None = None
    token_type: str = "Bearer"
    expires_in: int | None = None
    refresh_token: str | None = None
    refresh_expires_at: datetime | None = None
