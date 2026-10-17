"""密码哈希：Argon2id（由 cryptography 提供，不另加依赖），PHC 字符串格式存储。

参数取 OWASP 的推荐基线（19 MiB、2 轮、1 路并行）；参数调整后旧哈希在下次登录时重算。
"""

from __future__ import annotations

import os
import re

from cryptography.exceptions import InvalidKey
from cryptography.hazmat.primitives.kdf.argon2 import Argon2id

MEMORY_KIB = 19 * 1024
ITERATIONS = 2
LANES = 1
HASH_LEN = 32
SALT_LEN = 16
MAX_PASSWORD_CHARS = 1024

_PARAMS = re.compile(r"^\$argon2id\$v=19\$m=(\d+),t=(\d+),p=(\d+)\$")


def _kdf(salt: bytes) -> Argon2id:
    return Argon2id(
        salt=salt, length=HASH_LEN, iterations=ITERATIONS, lanes=LANES, memory_cost=MEMORY_KIB
    )


def hash_password(password: str) -> str:
    if len(password) > MAX_PASSWORD_CHARS:
        raise ValueError("Password too long")
    return _kdf(os.urandom(SALT_LEN)).derive_phc_encoded(password.encode("utf-8"))


def verify_password(password: str, encoded: str) -> bool:
    if len(password) > MAX_PASSWORD_CHARS or not encoded.startswith("$argon2id$"):
        return False
    try:
        Argon2id.verify_phc_encoded(password.encode("utf-8"), encoded)
    except (InvalidKey, ValueError):
        return False
    return True


def needs_rehash(encoded: str) -> bool:
    match = _PARAMS.match(encoded)
    if match is None:
        return True
    memory, iterations, lanes = (int(g) for g in match.groups())
    return (memory, iterations, lanes) != (MEMORY_KIB, ITERATIONS, LANES)


# 账号不存在时也做一次同等开销的校验，避免按响应时间判断邮箱是否注册过
DUMMY_HASH = hash_password("bettertavern-dummy-password")
