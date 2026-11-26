"""Forge by three.ws service: account checks, generation jobs and the model library.

Everything here is blocking, plain Python with no Kit imports, so it runs on a
worker thread (see ``controller.py``) and can be exercised outside Kit. The vendored
``three_ws_client`` speaks the Forge HTTP contract; this module adds what a
long-running DCC session needs on top of it:

* bearer auth on every three.ws API call (making a model needs an account on
  every lane), without ever sending the key to the CDN or a presigned storage URL;
* retries with exponential backoff on network errors and 429/502/503/504,
  including mid-poll, so a Wi-Fi blip does not lose a running job;
* real progress from the job's own ``eta_seconds`` / ``eta_remaining_seconds``;
* cancellation through a ``threading.Event`` checked between every request;
* error codes mapped to messages that say what to do next.
"""

from __future__ import annotations

import hashlib
import http.client
import logging
import os
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from dataclasses import dataclass, field
from typing import Callable, List, Optional, Tuple

from .three_ws_client import (
    ThreeWSClient,
    ThreeWSError,
    _is_finished,
    _urlopen,
    content_type_for_path,
    is_glb,
    slugify,
)

log = logging.getLogger("threews.forge")

USER_AGENT = "threews-forge-omniverse/1.0"
RETRY_STATUSES = frozenset({429, 502, 503, 504})
MAX_ATTEMPTS = 5
BASE_DELAY = 1.0
POLL_INTERVAL = 2.0
POLL_TIMEOUT = 900.0
MAX_CONSECUTIVE_POLL_FAILURES = 30

LANES = {
    "draft": {"label": "Draft (fast, low poly)", "credits": False},
    "standard": {"label": "Standard (textured)", "credits": False},
    "high": {"label": "High (dense mesh, PBR, credits)", "credits": True},
}

ProgressFn = Callable[["Progress"], None]


class ForgeError(Exception):
    """A failure with a message a user can act on.

    ``code`` is stable for tests and scripting; ``hint`` is the next step, and
    ``url`` (when set) is the page that fixes it.
    """

    def __init__(self, message: str, *, code: str = "", status: int = 0, hint: str = "", url: str = ""):
        super().__init__(message)
        self.message = message
        self.code = code
        self.status = status
        self.hint = hint
        self.url = url

    def __str__(self) -> str:
        return f"{self.message} {self.hint}".strip()


@dataclass
class Progress:
    stage: str
    fraction: Optional[float]
    elapsed: float
    message: str
    eta_remaining: Optional[float] = None


@dataclass
class GenerationRequest:
    prompt: str = ""
    image_path: str = ""
    lane: str = "standard"
    name: str = ""

    def display_name(self) -> str:
        if self.name.strip():
            return self.name.strip()
        if self.prompt.strip():
            return self.prompt.strip()[:60]
        if self.image_path:
            path = urllib.parse.urlparse(self.image_path).path if is_image_url(self.image_path) else self.image_path
            return os.path.splitext(os.path.basename(path))[0] or "model"
        return "model"


@dataclass
class GenerationResult:
    glb_url: str
    glb_path: str
    name: str
    lane: str
    job_id: str = ""
    backend: str = ""
    cached: bool = False
    seconds: float = 0.0
    size_bytes: int = 0
    preview_image_url: str = ""
    saved_model: Optional[dict] = None


@dataclass
class Account:
    balance_usd: float
    discount_bps: int
    tier_label: str
    high_price_usd: Optional[float]

    def can_afford_high(self) -> bool:
        return self.high_price_usd is None or self.balance_usd >= self.high_price_usd


@dataclass
class LibraryModel:
    id: str
    name: str
    size_bytes: int
    visibility: str
    created_at: str
    thumbnail_url: str = ""
    usdz_url: str = ""
    model_url: str = ""
    raw: dict = field(default_factory=dict)


class ForgeClient(ThreeWSClient):
    """The vendored client with a Kit user agent and the panel's API key as a bearer."""

    def __init__(self, base_url: str, *, api_key: str = "", client_handle: Optional[str] = None, timeout: float = 30.0):
        # The base client sends the key on every API call: making a model needs an account.
        super().__init__(base_url, api_key=api_key or "", client_handle=client_handle, timeout=timeout)
        self._api_key = (api_key or "").strip()

    def __repr__(self) -> str:
        return f"ForgeClient(base_url={self.base_url!r}, key={'set' if self._api_key else 'none'})"

    @property
    def has_key(self) -> bool:
        return bool(self._api_key)

    def auth_headers(self) -> dict:
        if not self._api_key:
            raise ForgeError(
                "Making a model on three.ws needs your API key (a free account).",
                code="missing_api_key",
                hint="Create a key, then paste it in the Account section of the Forge by three.ws panel.",
                url=f"{self.base_url}/dashboard/api",
            )
        return {"authorization": f"Bearer {self._api_key}"}

    def _headers(self, extra: Optional[dict] = None) -> dict:
        headers = super()._headers(extra)
        headers["user-agent"] = USER_AGENT
        return headers

    def authed(self, method: str, path: str, **kwargs) -> dict:
        return self._request(method, path, headers=self.auth_headers(), **kwargs)

    def _request(self, method: str, path: str, **kwargs) -> dict:
        # urllib wraps errors raised while SENDING in URLError, but a connection
        # reset or read timeout while READING the response escapes as a bare
        # OSError / http.client exception. Treat both as the network failure
        # they are, so the retry layer sees them.
        try:
            return super()._request(method, path, **kwargs)
        except ThreeWSError:
            raise
        except (OSError, http.client.HTTPException) as exc:
            raise ThreeWSError(f"Could not reach {self.base_url}: {exc}", code="unreachable") from exc


TRANSIENT_CODES = frozenset({"unreachable", "download_failed", "rate_limited", "upstream_unavailable"})


class RetryAfter(ThreeWSError):
    """A transient refusal that named its own wait (``retry_after`` seconds)."""

    def __init__(self, message: str, *, code: str, status: int = 0, retry_after: float = 0.0):
        super().__init__(message, code=code, status=status)
        self.retry_after = retry_after


def _is_transient(exc: ThreeWSError) -> bool:
    return exc.code in TRANSIENT_CODES or exc.status in RETRY_STATUSES


def _cancelled() -> ForgeError:
    return ForgeError("Cancelled.", code="cancelled", hint="Nothing was imported.")


def with_retries(
    fn: Callable[[], object],
    *,
    cancel: Optional[threading.Event] = None,
    attempts: Optional[int] = None,
    base_delay: Optional[float] = None,
    on_retry: Optional[Callable[[int, float, ThreeWSError], None]] = None,
):
    """Run ``fn`` and retry transient failures with exponential backoff.

    The wait between attempts is interruptible: setting ``cancel`` ends it at
    once with a ``cancelled`` ForgeError.
    """
    attempts = attempts or MAX_ATTEMPTS
    base_delay = BASE_DELAY if base_delay is None else base_delay
    for attempt in range(1, attempts + 1):
        if cancel is not None and cancel.is_set():
            raise _cancelled()
        try:
            return fn()
        except ThreeWSError as exc:
            if not _is_transient(exc) or attempt == attempts:
                raise
            delay = base_delay * (2 ** (attempt - 1))
            if isinstance(exc, RetryAfter) and exc.retry_after > 0:
                delay = max(delay, min(exc.retry_after, 60.0))
            log.warning("three.ws request failed (%s), retry %d of %d in %.1fs", exc.code or exc.status, attempt, attempts - 1, delay)
            if on_retry:
                on_retry(attempt, delay, exc)
            if cancel is not None:
                if cancel.wait(delay):
                    raise _cancelled()
            else:
                time.sleep(delay)
    raise AssertionError("unreachable")


def friendly(exc: Exception, base_url: str) -> ForgeError:
    """Translate a client error into a ForgeError that says what to do."""
    if isinstance(exc, ForgeError):
        return exc
    if not isinstance(exc, ThreeWSError):
        return ForgeError(f"Unexpected error: {exc}", code="internal")
    code, status, msg = exc.code, exc.status, exc.message
    keys_url = f"{base_url}/dashboard/api"
    if code == "sign_in_required":
        return ForgeError(
            "Making a model on three.ws needs a free account.",
            code="sign_in_required",
            status=status or 401,
            hint="Create an API key and paste it in the Account section of the Forge by three.ws panel.",
            url=keys_url,
        )
    if code == "invalid_api_key" or (status == 401 and code in ("unauthorized", "invalid_token", "")):
        return ForgeError(
            "three.ws did not accept that API key.",
            code="invalid_api_key",
            status=status,
            hint="It may be mistyped, expired or revoked. Create a new key and paste it in the Account section.",
            url=keys_url,
        )
    if code == "insufficient_scope" or status == 403:
        return ForgeError(
            "That API key is missing a permission this action needs.",
            code="insufficient_scope",
            status=status,
            hint="Create a key with the avatars:read and avatars:write scopes (the default).",
            url=keys_url,
        )
    if code == "insufficient_credits":
        return ForgeError(
            msg or "Your three.ws credit balance is too low for the High lane.",
            code="insufficient_credits",
            status=status,
            hint="Top up, or switch to the Draft or Standard lane, which need no balance.",
            url=f"{base_url}/credits",
        )
    if status == 402:
        return ForgeError(
            msg or "The High lane is not available to this account.",
            code=code or "payment_required",
            status=status,
            hint="Draft and Standard always work without an account balance.",
            url=f"{base_url}/credits",
        )
    if status == 429 or code == "rate_limited":
        return ForgeError(
            "three.ws is rate limiting this machine.",
            code="rate_limited",
            status=status,
            hint="Wait a minute and try again.",
        )
    if code == "unreachable":
        return ForgeError(
            msg,
            code="unreachable",
            hint="Check the network connection or proxy, then try again. The job was retried automatically first.",
        )
    if code == "timeout":
        return ForgeError(msg, code="timeout", hint="The GPU queue is busy. Try again or use the Draft lane.")
    if code == "storage_unavailable":
        return ForgeError(
            msg or "three.ws cannot accept image uploads right now.",
            code=code,
            status=status,
            hint="Paste a public https:// image URL in the image field instead; it needs no upload.",
        )
    if code == "invalid_prompt":
        return ForgeError(msg, code=code, hint="Describe one subject, for example 'a brass desk lamp'.")
    if code == "failed":
        return ForgeError(f"Generation failed: {msg}", code="failed", hint="Rephrase the prompt or try another lane.")
    return ForgeError(msg or f"HTTP {status}", code=code or "error", status=status)


class ForgeService:
    """Blocking operations against one three.ws deployment."""

    def __init__(self, base_url: str, api_key: str = "", client_handle: Optional[str] = None, cache_dir: str = ""):
        self.client = ForgeClient(base_url, api_key=api_key, client_handle=client_handle)
        self.cache_dir = cache_dir or os.path.join(os.path.expanduser("~"), ".cache", "threews-forge")

    def __repr__(self) -> str:
        return f"ForgeService({self.client!r})"

    @property
    def base_url(self) -> str:
        return self.client.base_url

    # -- account ----------------------------------------------------------

    def account(self, cancel: Optional[threading.Event] = None) -> Account:
        """Validate the key and read the credit balance (``GET /api/credits``)."""
        try:
            data = with_retries(lambda: self.client.authed("GET", "/api/credits"), cancel=cancel)
        except Exception as exc:
            raise friendly(exc, self.base_url) from exc
        holder = data.get("holder") or {}
        tier = holder.get("tier") or {}
        price = None
        for item in data.get("buys") or []:
            if isinstance(item, dict) and item.get("id") == "forge.high":
                try:
                    price = float(item.get("usd"))
                except (TypeError, ValueError):
                    price = None
        return Account(
            balance_usd=float(data.get("balance_usd") or 0),
            discount_bps=int(holder.get("discount_bps") or 0),
            tier_label=str(tier.get("label") or ""),
            high_price_usd=price,
        )

    # -- library ----------------------------------------------------------

    def list_models(self, cursor: str = "", limit: int = 24, cancel: Optional[threading.Event] = None) -> Tuple[List[LibraryModel], str]:
        """One page of the key owner's saved models, newest first."""
        query = {"limit": str(max(1, min(int(limit), 100)))}
        if cursor:
            query["cursor"] = cursor
        path = "/api/avatars?" + urllib.parse.urlencode(query)
        try:
            data = with_retries(lambda: self.client.authed("GET", path), cancel=cancel)
        except Exception as exc:
            raise friendly(exc, self.base_url) from exc
        models = []
        for row in data.get("avatars") or []:
            if not isinstance(row, dict) or not row.get("id"):
                continue
            models.append(
                LibraryModel(
                    id=str(row["id"]),
                    name=str(row.get("name") or row.get("slug") or "Untitled"),
                    size_bytes=int(row.get("size_bytes") or 0),
                    visibility=str(row.get("visibility") or ""),
                    created_at=str(row.get("created_at") or ""),
                    thumbnail_url=str(row.get("thumbnail_url") or ""),
                    usdz_url=str(row.get("usdz_url") or ""),
                    model_url=str(row.get("model_url") or ""),
                    raw=row,
                )
            )
        return models, str(data.get("next_cursor") or "")

    def fetch_library_model(self, model: LibraryModel, cancel: Optional[threading.Event] = None) -> str:
        """Download a saved model's GLB (private ones included) and return the local path.

        ``GET /api/avatars/<id>/glb`` streams the owner's file with the bearer,
        so private models work. The bytes are checked to be a real glTF 2.0
        binary before anything touches the stage.
        """
        dest_dir = os.path.join(self.cache_dir, "library", model.id)
        os.makedirs(dest_dir, exist_ok=True)
        dest = os.path.join(dest_dir, f"{slugify(model.name)}.glb")
        url = f"{self.base_url}/api/avatars/{urllib.parse.quote(model.id)}/glb"
        headers = {"user-agent": USER_AGENT, **self.client.auth_headers()}
        try:
            self._download(url, dest, headers=headers, cancel=cancel)
        except Exception as exc:
            raise friendly(exc, self.base_url) from exc
        return dest

    # -- generation -------------------------------------------------------

    def generate(
        self,
        request: GenerationRequest,
        *,
        on_progress: Optional[ProgressFn] = None,
        cancel: Optional[threading.Event] = None,
        poll_timeout: float = POLL_TIMEOUT,
        save_to_account: bool = False,
    ) -> GenerationResult:
        """Submit, poll and download one generation. Blocking."""
        cancel = cancel or threading.Event()
        started = time.monotonic()
        emit = _emitter(on_progress, started)
        lane = request.lane if request.lane in LANES else "standard"
        try:
            # Every lane needs a three.ws account; ask before uploading anything.
            self.client.auth_headers()
            emit("submitting", 0.02, "Sending the request to three.ws")
            body = self._build_body(request, lane, cancel, emit)
            submission = self._submit(body, lane, cancel, emit)
            job_id = submission.get("job_id") or ""
            backend = str(submission.get("backend") or "")
            if _is_finished(submission):
                glb_url = submission["glb_url"]
                preview = str(submission.get("preview_image_url") or "")
                cached = bool(submission.get("cached"))
                emit("done", 0.85, "Ready (served from the Forge cache)" if cached else "Ready")
            else:
                if not job_id:
                    raise ForgeError("Forge returned no job id.", code="no_job")
                glb_url, preview, backend = self._poll(job_id, cancel, emit, poll_timeout, backend)
                cached = False
            emit("downloading", 0.9, "Downloading the model")
            # Production job ids are signed tokens of several hundred characters,
            # longer than a file name may be, so the folder is named by a digest.
            dest_dir = os.path.join(self.cache_dir, "generations", hashlib.sha1((job_id or glb_url).encode()).hexdigest()[:16])
            os.makedirs(dest_dir, exist_ok=True)
            dest = os.path.join(dest_dir, f"{slugify(request.display_name())}.glb")
            self._download(glb_url, dest, headers={"user-agent": USER_AGENT}, cancel=cancel)
            result = GenerationResult(
                glb_url=glb_url,
                glb_path=dest,
                name=request.display_name(),
                lane=lane,
                job_id=job_id,
                backend=backend,
                cached=cached,
                seconds=round(time.monotonic() - started, 2),
                size_bytes=os.path.getsize(dest),
                preview_image_url=preview,
            )
            if save_to_account and self.client.has_key:
                emit("saving", 0.95, "Saving to your three.ws models")
                result.saved_model = self.save_to_account(dest, request, lane, cancel)
            return result
        except Exception as exc:
            raise friendly(exc, self.base_url) from exc

    def save_to_account(self, glb_path: str, request: GenerationRequest, lane: str, cancel: Optional[threading.Event] = None) -> dict:
        with open(glb_path, "rb") as fh:
            data = fh.read()
        return with_retries(
            lambda: self.client.publish_glb(
                data,
                api_key=self.client._api_key,
                name=request.display_name(),
                description=request.prompt.strip(),
                visibility="private",
                tags=("omniverse", "forge", lane),
                source_meta={"client": "omniverse-kit", "lane": lane},
            ),
            cancel=cancel,
        )

    def _build_body(self, request: GenerationRequest, lane: str, cancel: threading.Event, emit) -> dict:
        prompt = (request.prompt or "").strip()
        if is_image_url(request.image_path):
            # A public image URL goes to Forge as-is: no upload, nothing stored.
            body = {"image_urls": [request.image_path.strip()], "tier": lane, "path": "image"}
            if prompt:
                body["prompt"] = prompt
            return body
        if request.image_path:
            content_type = content_type_for_path(request.image_path)
            with open(request.image_path, "rb") as fh:
                image = fh.read()
            emit("uploading", 0.05, "Uploading the reference image")
            url = with_retries(lambda: self.client.upload_image(image, content_type), cancel=cancel)
            body = {"image_urls": [url], "tier": lane, "path": "image"}
            if prompt:
                body["prompt"] = prompt
            return body
        if len(prompt) < 3:
            raise ForgeError("Describe one subject in at least 3 characters.", code="invalid_prompt")
        return {"prompt": prompt, "tier": lane, "path": "image", "aspect_ratio": "1:1"}

    def _submit(self, body: dict, lane: str, cancel: threading.Event, emit) -> dict:
        headers = None
        if LANES[lane]["credits"]:
            # One ref per request: the credit debit is idempotent on it, so a
            # retry after a dropped connection can never charge twice.
            body = {**body, "pay_with": "credits", "ref_id": f"kit-{uuid.uuid4().hex}"}
            headers = self.client.auth_headers()

        def attempt():
            result = self.client._request("POST", "/api/forge", body=body, headers=headers)
            err = result.get("error")
            if err:
                if err == "rate_limited":
                    raise RetryAfter(result.get("message") or err, code=err, retry_after=_num(result.get("retry_after")) or 10.0)
                raise ThreeWSError(result.get("message") or err, code=err)
            return result

        def on_retry(n, delay, exc):
            emit("submitting", 0.02, f"Network problem, retrying in {delay:.0f}s (attempt {n + 1})")

        return with_retries(attempt, cancel=cancel, on_retry=on_retry)

    def _poll(self, job_id: str, cancel: threading.Event, emit, timeout: float, backend: str):
        path = f"/api/forge?job={urllib.parse.quote(job_id)}"
        started = time.monotonic()
        failures = 0
        while True:
            if cancel.is_set():
                raise _cancelled()
            if time.monotonic() - started > timeout:
                raise ThreeWSError(f"Generation timed out after {int(timeout)}s.", code="timeout")
            try:
                result = self.client._request("GET", path)
                failures = 0
            except ThreeWSError as exc:
                if not _is_transient(exc):
                    raise
                failures += 1
                if failures >= MAX_CONSECUTIVE_POLL_FAILURES:
                    raise
                delay = min(BASE_DELAY * (2 ** min(failures - 1, 4)), 16.0)
                emit("waiting", None, f"Connection lost, still waiting for the job (retry in {delay:.0f}s)")
                if cancel.wait(delay):
                    raise _cancelled()
                continue
            status = result.get("status") or "running"
            backend = str(result.get("backend") or backend)
            if status == "done" and result.get("glb_url"):
                return result["glb_url"], str(result.get("preview_image_url") or ""), backend
            if status == "failed":
                raise ThreeWSError(result.get("error") or "Generation failed.", code="failed")
            eta = _num(result.get("eta_seconds"))
            remaining = _num(result.get("eta_remaining_seconds"))
            fraction = None
            if eta and remaining is not None and eta > 0:
                fraction = 0.1 + 0.75 * max(0.0, min(1.0, 1.0 - remaining / eta))
            label = "Queued for a GPU" if status in ("queued", "starting", "pending") else "Generating on the GPU"
            if remaining is not None:
                label += f", about {int(remaining)}s left"
            emit(status, fraction, label, remaining)
            if cancel.wait(POLL_INTERVAL):
                raise _cancelled()

    def fetch_usdz(self, model: LibraryModel, cancel: Optional[threading.Event] = None) -> str:
        """Download a saved model's USDZ (served publicly from the CDN, no key sent)."""
        dest_dir = os.path.join(self.cache_dir, "library", model.id)
        os.makedirs(dest_dir, exist_ok=True)
        dest = os.path.join(dest_dir, f"{slugify(model.name)}.usdz")
        try:
            self._download(
                model.usdz_url,
                dest,
                headers={"user-agent": USER_AGENT},
                cancel=cancel,
                validate=lambda data: data[:4] == b"PK\x03\x04",
                kind="USDZ",
            )
        except Exception as exc:
            raise friendly(exc, self.base_url) from exc
        return dest

    def _download(
        self,
        url: str,
        dest: str,
        *,
        headers: dict,
        cancel: Optional[threading.Event],
        validate: Callable[[bytes], bool] = is_glb,
        kind: str = "GLB",
    ) -> None:
        def attempt():
            req = urllib.request.Request(url, headers=headers)
            tmp = dest + ".part"
            try:
                with _urlopen(req, 300) as resp, open(tmp, "wb") as out:
                    while True:
                        if cancel is not None and cancel.is_set():
                            raise _cancelled()
                        chunk = resp.read(256 * 1024)
                        if not chunk:
                            break
                        out.write(chunk)
            except urllib.error.HTTPError as exc:
                raise ThreeWSError(f"Download failed (HTTP {exc.code}).", code="download_failed" if exc.code >= 500 else "download_refused", status=exc.code) from exc
            except urllib.error.URLError as exc:
                raise ThreeWSError(f"Download failed: {exc.reason}", code="download_failed") from exc
            except (OSError, http.client.HTTPException) as exc:
                raise ThreeWSError(f"Download interrupted: {exc}", code="download_failed") from exc
            with open(tmp, "rb") as fh:
                data = fh.read()
            if not validate(data):
                os.remove(tmp)
                raise ThreeWSError(f"The downloaded file is not a valid {kind}.", code=f"invalid_{kind.lower()}")
            os.replace(tmp, dest)

        with_retries(attempt, cancel=cancel)


def is_image_url(value: str) -> bool:
    """True for an http(s) URL, which Forge fetches itself instead of an upload."""
    value = (value or "").strip().lower()
    return value.startswith("https://") or value.startswith("http://")


def _num(value) -> Optional[float]:
    try:
        f = float(value)
    except (TypeError, ValueError):
        return None
    return f if f == f else None


def _emitter(on_progress: Optional[ProgressFn], started: float):
    def emit(stage: str, fraction: Optional[float], message: str, eta_remaining: Optional[float] = None) -> None:
        if on_progress:
            on_progress(Progress(stage, fraction, round(time.monotonic() - started, 1), message, eta_remaining))

    return emit
