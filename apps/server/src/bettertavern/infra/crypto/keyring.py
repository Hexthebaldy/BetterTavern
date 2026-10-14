"""主密钥环与开发环境的密钥自举。

MASTER_KEYS 的格式是 "kid:base64密钥,kid2:base64密钥"：第一个用于加密，其余只用于解密，
轮换时把新密钥放在最前面，旧密钥留在后面直到数据全部重新加密。主密钥不进数据库。

生产环境必须显式配置 MASTER_KEYS 与 AUTH_SECRET（`bettertavern keygen` 生成）。
开发环境没配置时，在 data_dir/dev-secrets.json 里生成一次并复用，重启后已保存的密钥仍能解密。
"""

from __future__ import annotations

import base64
import binascii
import json
import os
import re
import secrets
from dataclasses import dataclass
from pathlib import Path

KEY_BYTES = 32
_KID = re.compile(r"^[A-Za-z0-9_-]{1,32}$")
DEV_SECRETS_FILE = "dev-secrets.json"


class KeyringError(ValueError):
    """密钥配置无效或缺失。"""


def b64encode(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode().rstrip("=")


def b64decode(text: str) -> bytes:
    padded = text + "=" * (-len(text) % 4)
    try:
        return base64.urlsafe_b64decode(padded.encode())
    except (binascii.Error, ValueError) as exc:
        raise KeyringError("base64 解码失败") from exc


@dataclass(frozen=True)
class Keyring:
    keys: dict[str, bytes]
    active_kid: str

    def __post_init__(self) -> None:
        if self.active_kid not in self.keys:
            raise KeyringError("当前密钥不在密钥环里")
        for kid, key in self.keys.items():
            if not _KID.match(kid):
                raise KeyringError(f"密钥编号 {kid!r} 只能用字母、数字、下划线和连字符")
            if len(key) != KEY_BYTES:
                raise KeyringError(f"密钥 {kid} 必须是 {KEY_BYTES} 字节")

    @property
    def active(self) -> tuple[str, bytes]:
        return self.active_kid, self.keys[self.active_kid]

    def get(self, kid: str) -> bytes:
        try:
            return self.keys[kid]
        except KeyError:
            raise KeyringError(f"密钥环里没有 {kid}，可能已被移除") from None

    def __repr__(self) -> str:  # 不把密钥打进日志
        return f"Keyring(kids={list(self.keys)}, active={self.active_kid!r})"


def parse_master_keys(value: str) -> Keyring:
    keys: dict[str, bytes] = {}
    order: list[str] = []
    for part in value.split(","):
        part = part.strip()
        if not part:
            continue
        kid, sep, encoded = part.partition(":")
        if not sep:
            raise KeyringError("MASTER_KEYS 的每一项应该是 kid:base64密钥")
        kid = kid.strip()
        if kid in keys:
            raise KeyringError(f"密钥编号 {kid} 重复")
        keys[kid] = b64decode(encoded.strip())
        order.append(kid)
    if not order:
        raise KeyringError("MASTER_KEYS 为空")
    return Keyring(keys=keys, active_kid=order[0])


def new_master_key_entry(kid: str | None = None) -> str:
    kid = kid or "k" + secrets.token_hex(3)
    return f"{kid}:{b64encode(secrets.token_bytes(KEY_BYTES))}"


def new_auth_secret() -> str:
    return b64encode(secrets.token_bytes(48))


@dataclass(frozen=True)
class AppSecrets:
    keyring: Keyring
    auth_secret: bytes
    generated_dev_file: Path | None = None  # 开发环境自动生成时的文件位置

    def __repr__(self) -> str:
        return f"AppSecrets(keyring={self.keyring!r})"


def _load_or_create_dev_secrets(data_dir: Path) -> tuple[str, str, Path]:
    path = data_dir / DEV_SECRETS_FILE
    if path.exists():
        data = json.loads(path.read_text("utf-8"))
        return str(data["master_keys"]), str(data["auth_secret"]), path
    data_dir.mkdir(parents=True, exist_ok=True)
    data = {"master_keys": new_master_key_entry("dev1"), "auth_secret": new_auth_secret()}
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as handle:
        json.dump(data, handle)
    return data["master_keys"], data["auth_secret"], path


def load_secrets(
    *,
    master_keys: str | None,
    auth_secret: str | None,
    allow_dev_fallback: bool,
    data_dir: Path,
) -> AppSecrets:
    generated: Path | None = None
    if not master_keys or not auth_secret:
        if not allow_dev_fallback:
            raise KeyringError(
                "生产环境必须配置 MASTER_KEYS 和 AUTH_SECRET（运行 `bettertavern keygen` 生成）"
            )
        dev_master, dev_auth, generated = _load_or_create_dev_secrets(data_dir)
        master_keys = master_keys or dev_master
        auth_secret = auth_secret or dev_auth
    # 原样当作 HMAC 密钥使用（keygen 生成的是 64 个字符的随机串）
    secret = auth_secret.encode("utf-8")
    if len(secret) < 32:
        raise KeyringError("AUTH_SECRET 至少需要 32 个字符")
    return AppSecrets(
        keyring=parse_master_keys(master_keys), auth_secret=secret, generated_dev_file=generated
    )
