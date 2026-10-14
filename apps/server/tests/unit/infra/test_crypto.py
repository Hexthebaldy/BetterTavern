from __future__ import annotations

import json
from pathlib import Path

import pytest

from bettertavern.infra.crypto import passwords
from bettertavern.infra.crypto.envelope import (
    DecryptionError,
    key_id_of,
    seal_text,
    unseal_text,
)
from bettertavern.infra.crypto.keyring import (
    KeyringError,
    load_secrets,
    new_master_key_entry,
    parse_master_keys,
)
from bettertavern.infra.crypto.tokens import (
    AccessTokenSigner,
    InvalidToken,
    hash_refresh_token,
    new_refresh_token,
)


def test_keyring_first_key_is_active_and_rest_decrypt_only() -> None:
    old = new_master_key_entry("k1")
    new = new_master_key_entry("k2")
    sealed_with_old = seal_text(parse_master_keys(old), "sk-old", aad="credential:1:api_key")
    rotated = parse_master_keys(f"{new},{old}")
    assert rotated.active_kid == "k2"
    assert unseal_text(rotated, sealed_with_old, aad="credential:1:api_key") == "sk-old"
    assert key_id_of(seal_text(rotated, "sk-new", aad="x")) == "k2"


@pytest.mark.parametrize(
    "value",
    ["", "k1", "k1:AAAA", "bad kid:" + "A" * 43, "k1:" + "A" * 43 + ",k1:" + "B" * 43],
)
def test_keyring_rejects_bad_config(value: str) -> None:
    with pytest.raises(KeyringError):
        parse_master_keys(value)


def test_envelope_binds_ciphertext_to_its_row_and_field() -> None:
    keyring = parse_master_keys(new_master_key_entry("k1"))
    token = seal_text(keyring, "sk-secret-1234", aad="credential:a:api_key")
    assert "sk-secret" not in token
    assert unseal_text(keyring, token, aad="credential:a:api_key") == "sk-secret-1234"
    with pytest.raises(DecryptionError):
        unseal_text(keyring, token, aad="credential:b:api_key")  # 挪到别的行
    with pytest.raises(DecryptionError):
        unseal_text(keyring, token, aad="credential:a:headers")  # 挪到别的字段
    tampered = token[:-4] + ("AAAA" if not token.endswith("AAAA") else "BBBB")
    with pytest.raises(DecryptionError):
        unseal_text(keyring, tampered, aad="credential:a:api_key")
    other = parse_master_keys(new_master_key_entry("k1"))
    with pytest.raises(DecryptionError):
        unseal_text(other, token, aad="credential:a:api_key")  # 主密钥不对
    # 同样的明文每次密文都不同
    assert seal_text(keyring, "x", aad="a") != seal_text(keyring, "x", aad="a")


def test_unknown_key_id_is_a_decryption_error() -> None:
    token = seal_text(parse_master_keys(new_master_key_entry("gone")), "x", aad="a")
    with pytest.raises(DecryptionError):
        unseal_text(parse_master_keys(new_master_key_entry("k1")), token, aad="a")


def test_dev_secrets_are_generated_once_and_reused(tmp_path: Path) -> None:
    first = load_secrets(
        master_keys=None, auth_secret=None, allow_dev_fallback=True, data_dir=tmp_path
    )
    assert first.generated_dev_file is not None
    assert first.generated_dev_file.stat().st_mode & 0o777 == 0o600
    second = load_secrets(
        master_keys=None, auth_secret=None, allow_dev_fallback=True, data_dir=tmp_path
    )
    assert second.keyring.keys == first.keyring.keys
    assert second.auth_secret == first.auth_secret
    assert "dev1" in json.loads(first.generated_dev_file.read_text())["master_keys"]


def test_production_requires_explicit_secrets(tmp_path: Path) -> None:
    with pytest.raises(KeyringError):
        load_secrets(
            master_keys=None, auth_secret=None, allow_dev_fallback=False, data_dir=tmp_path
        )
    with pytest.raises(KeyringError):
        load_secrets(
            master_keys=new_master_key_entry(),
            auth_secret="too-short",
            allow_dev_fallback=False,
            data_dir=tmp_path,
        )
    assert not list(tmp_path.iterdir())


def test_password_hash_roundtrip_and_rehash_policy() -> None:
    encoded = passwords.hash_password("correct horse")
    assert encoded.startswith("$argon2id$v=19$")
    assert passwords.verify_password("correct horse", encoded)
    assert not passwords.verify_password("wrong horse", encoded)
    assert not passwords.verify_password("correct horse", "not-a-hash")
    assert not passwords.needs_rehash(encoded)
    assert passwords.needs_rehash(encoded.replace("m=19456", "m=4096"))
    assert passwords.hash_password("correct horse") != encoded  # 每次随机盐


def test_access_token_lifecycle() -> None:
    now = [1_000_000.0]
    signer = AccessTokenSigner(b"s" * 40, ttl_s=900, clock=lambda: now[0])
    token, exp = signer.issue("user-1")
    assert exp == 1_000_900
    assert signer.verify(token).user_id == "user-1"
    now[0] += 901
    with pytest.raises(InvalidToken):
        signer.verify(token)
    other = AccessTokenSigner(b"t" * 40, ttl_s=900, clock=lambda: now[0])
    fresh, _ = other.issue("user-1")
    with pytest.raises(InvalidToken):
        signer.verify(fresh)  # 别的密钥签的
    with pytest.raises(InvalidToken):
        signer.verify("not.a.token")


def test_refresh_tokens_are_random_and_stored_as_hashes() -> None:
    a, b = new_refresh_token(), new_refresh_token()
    assert a != b and a.startswith("rt_")
    assert hash_refresh_token(a) == hash_refresh_token(a) != hash_refresh_token(b)
    assert a not in hash_refresh_token(a)
