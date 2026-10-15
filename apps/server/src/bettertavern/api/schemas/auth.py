"""认证与账户。"""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field

from .common import Out


class RegisterIn(BaseModel):
    email: str = Field(max_length=254)
    password: str = Field(max_length=1024)
    display_name: str = Field(default="", max_length=40)


class LoginIn(BaseModel):
    email: str = Field(max_length=254)
    password: str = Field(max_length=1024)


class RefreshIn(BaseModel):
    refresh_token: str = Field(max_length=200)


class DeleteAccountIn(BaseModel):
    password: str = Field(max_length=1024)


class UserOut(Out):
    id: str
    email: str
    display_name: str
    locale: str
    created_at: datetime


class AuthOut(BaseModel):
    user: UserOut
    access_token: str
    token_type: str = "Bearer"
    expires_in: int
    # Cookie 模式（网页端）下是 None：刷新令牌只在 Set-Cookie 里
    refresh_token: str | None
    refresh_expires_at: datetime
