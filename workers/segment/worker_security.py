"""
Shared security helpers for the three.ws GPU/CPU workers.

This module is intentionally dependency-light (stdlib only) so it can be
COPYed verbatim into every worker's Docker build context. The same canonical
file lives in each worker directory; keep them byte-identical when editing.

It provides three primitives that every worker needs:

  1. ``require_api_key`` — constant-time bearer-token check (timing-safe).
  2. ``fetch_remote_bytes`` — SSRF-hardened HTTP(S) fetch of caller-supplied
     URLs: https-only, DNS resolution with private/loopback/link-local/metadata
     IP rejection, per-hop redirect re-validation, and a bounded response size.
  3. ``safe_error`` — turns an exception into an opaque, correlation-id-tagged
     message safe to persist/return to callers, after logging the full
     traceback server-side only.
"""

from __future__ import annotations

import hmac
import ipaddress
import logging
import socket
import uuid
from typing import Iterable, Optional
from urllib.parse import urlsplit

import httpx

log = logging.getLogger("worker_security")

# ── auth ────────────────────────────────────────────────────────────────────────


def require_api_key(authorization: Optional[str], api_key: str) -> None:
    """Validate a ``Bearer <token>`` header in constant time.

    Raises ``PermissionError`` on any failure so callers can translate it into
    the framework's 401 (FastAPI workers map this to HTTPException(401)).
    """
    # Fail closed on an empty configured key: with api_key == "" a bare
    # "Bearer " header would otherwise strip to "" and compare equal.
    if not api_key:
        raise PermissionError("worker api key not configured")
    if not authorization or not authorization.startswith("Bearer "):
        raise PermissionError("missing bearer token")
    token = authorization[len("Bearer "):].strip()
    if not token:
        raise PermissionError("missing bearer token")
    # Compare bytes: hmac.compare_digest is timing-safe, and on str operands it
    # raises TypeError for non-ASCII input, which would surface as a 500.
    if not hmac.compare_digest(token.encode("utf-8"), api_key.encode("utf-8")):
        raise PermissionError("invalid api key")


# ── SSRF-hardened fetch ─────────────────────────────────────────────────────────

# Default cap on a fetched response. Avatar selfies / driving audio / raw meshes
# are comfortably under this; anything larger is almost certainly abuse.
DEFAULT_MAX_BYTES = 64 * 1024 * 1024  # 64 MiB
_MAX_REDIRECTS = 4

# Hosts that enforce a User-Agent policy refuse httpx's default
# "python-httpx/<version>": upload.wikimedia.org answers it with 403 Forbidden
# and serves the same image to a descriptive agent (measured 2026-10-09, when
# model-triposg failed every job whose reference photo was a Wikimedia link).
# Callers may still pass their own User-Agent; it replaces this one.
DEFAULT_USER_AGENT = "three.ws-worker/1.0 (+https://three.ws)"


def _fetch_headers(headers: Optional[dict]) -> dict:
    """Caller headers over the default User-Agent, matched case-insensitively."""
    merged = dict(headers or {})
    if not any(str(k).lower() == "user-agent" for k in merged):
        merged["User-Agent"] = DEFAULT_USER_AGENT
    return merged


class UnsafeUrlError(ValueError):
    """Raised when a URL targets a disallowed scheme or a private/internal IP."""


def _is_blocked_ip(ip: ipaddress._BaseAddress) -> bool:
    """Reject any address that could reach internal infrastructure.

    Covers loopback, RFC1918 private ranges, link-local (incl. the cloud
    metadata server at 169.254.169.254), unique-local IPv6 (fc00::/7),
    multicast, reserved, unspecified, and any other non-global address (CGNAT
    100.64.0.0/10 included). IPv4-mapped IPv6 addresses
    are unwrapped first so a mapped private v4 can't slip through.
    """
    if isinstance(ip, ipaddress.IPv6Address) and ip.ipv4_mapped is not None:
        ip = ip.ipv4_mapped
    return (
        ip.is_private
        or ip.is_loopback
        or ip.is_link_local
        or ip.is_multicast
        or ip.is_reserved
        or ip.is_unspecified
        # Anything not globally routable, which also covers the CGNAT shared
        # space 100.64.0.0/10 that is_private does not flag.
        or not ip.is_global
    )


def _resolve_safe_host(host: str) -> None:
    """DNS-resolve ``host`` and raise UnsafeUrlError if ANY address is internal.

    Resolving and checking every returned address closes the gap where a name
    resolves to both a public and a private address.
    """
    if not host:
        raise UnsafeUrlError("missing host")
    try:
        infos = socket.getaddrinfo(host, None, proto=socket.IPPROTO_TCP)
    except socket.gaierror as exc:
        raise UnsafeUrlError(f"could not resolve host: {host}") from exc

    addrs = {info[4][0] for info in infos}
    if not addrs:
        raise UnsafeUrlError(f"no addresses for host: {host}")
    for addr in addrs:
        ip = ipaddress.ip_address(addr)
        if _is_blocked_ip(ip):
            raise UnsafeUrlError(f"host resolves to a disallowed address: {host}")


def assert_safe_url(url: str, *, allow_http: bool = False) -> str:
    """Validate scheme + resolved IPs for a single URL. Returns it unchanged.

    https is required by default; ``allow_http`` exists only for callers that
    legitimately need cleartext (not used by the workers).
    """
    parts = urlsplit(url)
    scheme = parts.scheme.lower()
    allowed = ("https", "http") if allow_http else ("https",)
    if scheme not in allowed:
        raise UnsafeUrlError(f"scheme not allowed: {scheme or '(none)'}")
    if not parts.hostname:
        raise UnsafeUrlError("missing host")
    _resolve_safe_host(parts.hostname)
    return url


def fetch_remote_bytes(
    url: str,
    *,
    timeout: float = 30.0,
    max_bytes: int = DEFAULT_MAX_BYTES,
    allow_http: bool = False,
    headers: Optional[dict] = None,
) -> bytes:
    """Fetch ``url`` safely and return its body bytes.

    Hardening applied:
      * https-only (unless ``allow_http``).
      * every URL — including each redirect target — is DNS-resolved and
        rejected if it maps to a private/loopback/link-local/metadata address.
      * redirects are followed manually (max ``_MAX_REDIRECTS``) so each hop is
        re-validated; httpx's own redirect following is disabled.
      * the response body is streamed and aborted once it exceeds ``max_bytes``.

    Raises ``UnsafeUrlError`` for disallowed targets and ``httpx.HTTPError`` /
    ``ValueError`` for transport or size failures.
    """
    current = assert_safe_url(url, allow_http=allow_http)
    with httpx.Client(follow_redirects=False, timeout=timeout) as client:
        for _ in range(_MAX_REDIRECTS + 1):
            with client.stream("GET", current, headers=_fetch_headers(headers)) as resp:
                if resp.is_redirect:
                    location = resp.headers.get("location")
                    if not location:
                        raise UnsafeUrlError("redirect without Location header")
                    current = assert_safe_url(
                        str(resp.url.join(location)), allow_http=allow_http
                    )
                    continue
                resp.raise_for_status()
                declared = resp.headers.get("content-length")
                if declared is not None and declared.isdigit() and int(declared) > max_bytes:
                    raise ValueError(f"response too large: {declared} bytes")
                chunks: list[bytes] = []
                total = 0
                for chunk in resp.iter_bytes(65536):
                    total += len(chunk)
                    if total > max_bytes:
                        raise ValueError(f"response exceeded {max_bytes} bytes")
                    chunks.append(chunk)
                return b"".join(chunks)
    raise UnsafeUrlError(f"too many redirects (>{_MAX_REDIRECTS})")


async def fetch_remote_bytes_async(
    client: "httpx.AsyncClient",
    url: str,
    *,
    max_bytes: int = DEFAULT_MAX_BYTES,
    allow_http: bool = False,
    headers: Optional[dict] = None,
) -> bytes:
    """Async variant of ``fetch_remote_bytes`` using a caller-provided client.

    The provided ``client`` MUST be constructed with ``follow_redirects=False``
    so this function can re-validate each redirect hop itself.
    """
    current = assert_safe_url(url, allow_http=allow_http)
    for _ in range(_MAX_REDIRECTS + 1):
        async with client.stream("GET", current, headers=_fetch_headers(headers)) as resp:
            if resp.is_redirect:
                location = resp.headers.get("location")
                if not location:
                    raise UnsafeUrlError("redirect without Location header")
                current = assert_safe_url(
                    str(resp.url.join(location)), allow_http=allow_http
                )
                continue
            resp.raise_for_status()
            declared = resp.headers.get("content-length")
            if declared is not None and declared.isdigit() and int(declared) > max_bytes:
                raise ValueError(f"response too large: {declared} bytes")
            chunks: list[bytes] = []
            total = 0
            async for chunk in resp.aiter_bytes(65536):
                total += len(chunk)
                if total > max_bytes:
                    raise ValueError(f"response exceeded {max_bytes} bytes")
                chunks.append(chunk)
            return b"".join(chunks)
    raise UnsafeUrlError(f"too many redirects (>{_MAX_REDIRECTS})")


# ── opaque error handling ───────────────────────────────────────────────────────


def safe_error(exc: BaseException, *, context: str = "") -> str:
    """Log the full traceback server-side and return an opaque client message.

    Never leak ``traceback.format_exc()`` (absolute paths, library versions,
    internal hostnames, fragments of upstream responses) to callers. A short
    correlation id is embedded in both the log line and the returned string so
    operators can join a client-reported failure to the server log.
    """
    correlation_id = uuid.uuid4().hex[:12]
    label = f"{context} " if context else ""
    log.exception("%serror [correlation_id=%s]", label, correlation_id)
    return f"internal error (ref {correlation_id})"
