"""AES-256-GCM 信封加密：每个密文一个随机数据密钥（DEK），DEK 再由主密钥（KEK）加密。

密文格式：v1.<kid>.<base64(nonce + 包裹的 DEK)>.<base64(nonce + 密文)>
附加数据（AAD）绑定到具体的行和用途（例如 credential:<id>:api_key），把密文挪到别的行或字段
会解密失败。只在 provider 层请求前解密，用完不缓存明文。
"""

from __future__ import annotations

import os

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from .keyring import Keyring, KeyringError, b64decode, b64encode

VERSION = "v1"
_NONCE = 12


class DecryptionError(ValueError):
    """密文损坏、主密钥不对，或密文被挪到了别的行。"""


def _dek_aad(kid: str, aad: bytes) -> bytes:
    return b"bettertavern/dek|" + kid.encode() + b"|" + aad


def seal(keyring: Keyring, plaintext: bytes, *, aad: bytes) -> str:
    kid, kek = keyring.active
    dek = AESGCM.generate_key(bit_length=256)
    dek_nonce = os.urandom(_NONCE)
    wrapped = AESGCM(kek).encrypt(dek_nonce, dek, _dek_aad(kid, aad))
    data_nonce = os.urandom(_NONCE)
    ciphertext = AESGCM(dek).encrypt(data_nonce, plaintext, aad)
    return ".".join(
        (VERSION, kid, b64encode(dek_nonce + wrapped), b64encode(data_nonce + ciphertext))
    )


def key_id_of(token: str) -> str:
    parts = token.split(".")
    if len(parts) != 4 or parts[0] != VERSION:
        raise DecryptionError("密文格式无效")
    return parts[1]


def unseal(keyring: Keyring, token: str, *, aad: bytes) -> bytes:
    parts = token.split(".")
    if len(parts) != 4 or parts[0] != VERSION:
        raise DecryptionError("密文格式无效")
    _, kid, wrapped_part, data_part = parts
    try:
        kek = keyring.get(kid)
        wrapped = b64decode(wrapped_part)
        data = b64decode(data_part)
    except KeyringError as exc:
        raise DecryptionError(str(exc)) from exc
    try:
        dek = AESGCM(kek).decrypt(wrapped[:_NONCE], wrapped[_NONCE:], _dek_aad(kid, aad))
        return AESGCM(dek).decrypt(data[:_NONCE], data[_NONCE:], aad)
    except (InvalidTag, ValueError) as exc:
        raise DecryptionError("解密失败") from exc


def seal_text(keyring: Keyring, text: str, *, aad: str) -> str:
    return seal(keyring, text.encode("utf-8"), aad=aad.encode("utf-8"))


def unseal_text(keyring: Keyring, token: str, *, aad: str) -> str:
    return unseal(keyring, token, aad=aad.encode("utf-8")).decode("utf-8")
