"""Persistent settings for the three.ws Forge extension.

Values live under ``/persistent/exts/threews.forge/`` in carb settings, so Kit
writes them to the user's ``user.config.json`` and they survive restarts. The
API key is read through ``api_key()`` and no part of it is ever written to the Kit
log. ``redact()`` gives the masked form the panel shows the user.

A farm or CI node can supply the key through the ``THREEWS_API_KEY``
environment variable instead; the stored setting wins when both are present.
"""

from __future__ import annotations

import os
import uuid

import carb.settings

EXT_ID = "threews.forge"
_ROOT = f"/persistent/exts/{EXT_ID}"

API_KEY = f"{_ROOT}/apiKey"
BASE_URL = f"{_ROOT}/baseUrl"
LANE = f"{_ROOT}/lane"
PLACEMENT = f"{_ROOT}/placement"
CLIENT_HANDLE = f"{_ROOT}/clientHandle"
SAVE_TO_ACCOUNT = f"{_ROOT}/saveToAccount"

DEFAULT_BASE_URL = "https://three.ws"
KEY_PREFIXES = ("sk_live_", "sk_test_")


def _settings():
    return carb.settings.get_settings()


def _get_str(path: str, default: str = "") -> str:
    value = _settings().get(path)
    return value if isinstance(value, str) else default


def api_key() -> str:
    """The stored key, or ``THREEWS_API_KEY``, or an empty string."""
    stored = _get_str(API_KEY).strip()
    if stored:
        return stored
    return os.environ.get("THREEWS_API_KEY", "").strip()


def key_source() -> str:
    """Where ``api_key()`` came from: ``settings``, ``environment`` or ``none``."""
    if _get_str(API_KEY).strip():
        return "settings"
    if os.environ.get("THREEWS_API_KEY", "").strip():
        return "environment"
    return "none"


def set_api_key(value: str) -> None:
    _settings().set_string(API_KEY, (value or "").strip())


def clear_api_key() -> None:
    _settings().set_string(API_KEY, "")


def looks_like_key(value: str) -> bool:
    """A cheap shape check so a pasted URL or nvapi- key is caught before a request."""
    value = (value or "").strip()
    return value.startswith(KEY_PREFIXES) and len(value) > len("sk_live_") + 8


def redact(value: str) -> str:
    """Safe form for logs and UI: the public prefix and nothing of the secret."""
    value = (value or "").strip()
    if not value:
        return "(none)"
    for prefix in KEY_PREFIXES:
        if value.startswith(prefix):
            return f"{prefix}{value[len(prefix):len(prefix) + 4]}****"
    return "****"


def base_url() -> str:
    return (_get_str(BASE_URL) or DEFAULT_BASE_URL).rstrip("/")


def set_base_url(value: str) -> None:
    _settings().set_string(BASE_URL, (value or DEFAULT_BASE_URL).strip().rstrip("/"))


def lane() -> str:
    value = _get_str(LANE, "standard")
    return value if value in ("draft", "standard", "high") else "standard"


def set_lane(value: str) -> None:
    _settings().set_string(LANE, value)


def placement() -> str:
    value = _get_str(PLACEMENT, "origin")
    return value if value in ("origin", "selection", "camera") else "origin"


def set_placement(value: str) -> None:
    _settings().set_string(PLACEMENT, value)


def save_to_account() -> bool:
    return bool(_settings().get(SAVE_TO_ACCOUNT))


def set_save_to_account(value: bool) -> None:
    _settings().set_bool(SAVE_TO_ACCOUNT, bool(value))


def client_handle() -> str:
    """A stable anonymous handle. Forge scopes job polls to it, so keeping it
    across restarts lets a job started before a restart still be polled."""
    handle = _get_str(CLIENT_HANDLE)
    if not handle:
        handle = uuid.uuid4().hex
        _settings().set_string(CLIENT_HANDLE, handle)
    return handle
