"""访问令牌（JWT，HS256，默认 15 分钟）与刷新令牌（随机串，库里只存哈希）。"""

from __future__ import annotations

import hashlib
import secrets
import time
from collections.abc import Callable
from dataclasses import dataclass

import jwt

ISSUER = "bettertavern"
REFRESH_PREFIX = "rt_"


class InvalidToken(Exception):
    pass


@dataclass(frozen=True, slots=True)
class AccessClaims:
    user_id: str
    expires_at: int


class AccessTokenSigner:
    def __init__(
        self, secret: bytes, *, ttl_s: int, clock: Callable[[], float] = time.time
    ) -> None:
        self._secret = secret
        self.ttl_s = ttl_s
        self._clock = clock

    def issue(self, user_id: str) -> tuple[str, int]:
        now = int(self._clock())
        exp = now + self.ttl_s
        token = jwt.encode(
            {"sub": user_id, "iat": now, "exp": exp, "iss": ISSUER, "typ": "access"},
            self._secret,
            algorithm="HS256",
        )
        return token, exp

    def verify(self, token: str) -> AccessClaims:
        try:
            claims = jwt.decode(
                token,
                self._secret,
                algorithms=["HS256"],
                issuer=ISSUER,
                options={"require": ["sub", "exp", "iat", "iss"], "verify_exp": False},
            )
        except jwt.PyJWTError as exc:
            raise InvalidToken(str(exc)) from exc
        if claims.get("typ") != "access":
            raise InvalidToken("令牌类型不对")
        exp = int(claims["exp"])
        if exp <= int(self._clock()):
            raise InvalidToken("令牌已过期")
        return AccessClaims(user_id=str(claims["sub"]), expires_at=exp)


def new_refresh_token() -> str:
    return REFRESH_PREFIX + secrets.token_urlsafe(32)


def hash_refresh_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()
