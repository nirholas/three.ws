"""
Synthesised camera views of the selfie, for texture only.

── Why this exists ────────────────────────────────────────────────────────────
A selfie sees one side of a face under one light. Projective texturing
(face_projection.py) lifted photographic coverage of the head from 10.4% to
about 41%, which leaves the scalp, the back of the ears, under the jaw, the far
cheek and the neck as tinted template. Measured in the fidelity program:

  • Do NOT inpaint the UV atlas directly. The result is UV-incoherent: islands
    that touch on the mesh do not touch in the atlas, so the model paints seams.
  • Synthesised views are unusable for GEOMETRY but fine for TEXTURE: same-pose
    control divergence 0.0069, and complexion, beard, hairline and ear survive a
    30 degree turn.

So the route is to synthesise extra camera views, gate each on identity, and feed
the survivors through the existing camera-and-mesh projection path. This module
owns the Vertex call and the identity gate. `view_texture.py` owns the
projection, colour matching and seam checks.

── Failure policy ─────────────────────────────────────────────────────────────
Every failure here degrades to FEWER views, never to a failed job. Zero views is
exactly the shipped single-photo behaviour. A 429 backs off once and then stops
the remaining requests (retrying a quota wall only deepens it); a 403 (billing
hold, missing role) stops them at once; a wall-clock deadline bounds the whole
batch. Nothing in here can raise into the pipeline: `synthesize_views` returns a
`SynthesisReport` and the caller reads `.views`.

── Credentials ────────────────────────────────────────────────────────────────
Application Default Credentials via the worker's runtime service account
(`three-ws@`), which needs `roles/aiplatform.user`. The endpoint is built from a
fixed host template and a validated region, never from caller input, so there is
no URL for an attacker to steer (worker_security's SSRF-safe fetch exists for
caller-supplied URLs; this is not one).
"""

from __future__ import annotations

import base64
import io
import logging
import os
import random
import re
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass, field
from typing import Callable, Optional

import cv2
import httpx
import numpy as np
from PIL import Image

from worker_security import open_caller_image

log = logging.getLogger("view_synthesis")


def enabled() -> bool:
    """Feature flag, read per call so tests and operators can flip it live."""
    return os.environ.get("RECON_VIEW_SYNTHESIS", "0").strip().lower() in ("1", "true", "on", "yes")


# ── Targets ─────────────────────────────────────────────────────────────────────

@dataclass(frozen=True)
class ViewTarget:
    name: str
    yaw: float      # degrees the head is turned from the selfie; sign is resolved by silhouette
    pitch: float    # degrees the camera is raised; the scalp view uses a high pitch


# Yaw 35 and 65 on both sides reach the cheeks, ears and temples; the high pitch
# reaches the crown. 35 degrees is inside the range the program measured as
# identity-stable, 65 is beyond it and is therefore held to the stricter silhouette
# test in view_texture rather than trusted.
DEFAULT_TARGETS: tuple[ViewTarget, ...] = (
    ViewTarget("yaw_p35", 35.0, 0.0),
    ViewTarget("yaw_m35", -35.0, 0.0),
    ViewTarget("yaw_p65", 65.0, 0.0),
    ViewTarget("yaw_m65", -65.0, 0.0),
    ViewTarget("top", 0.0, 55.0),
)


def _prompt(t: ViewTarget) -> str:
    base = (
        "Edit this photograph. Show the exact same person: identical face, skin tone, "
        "complexion, facial hair, hairline, hair colour and style, ears, expression, "
        "clothing and lighting, on the same plain background, framed at the same distance "
        "and zoom. Photorealistic, no stylisation, no accessories added or removed. "
    )
    if abs(t.pitch) >= 20:
        return base + (
            f"Move the camera up and tilt it down about {abs(t.pitch):.0f} degrees so it looks "
            "at the top of the head: the scalp, crown and hairline are clearly visible."
        )
    side = "right" if t.yaw > 0 else "left"
    return base + (
        f"Turn the head about {abs(t.yaw):.0f} degrees toward the camera's {side} so the "
        "opposite cheek, ear and temple are visible. The camera does not move."
    )


# ── Vertex client ───────────────────────────────────────────────────────────────

_REGION_RE = re.compile(r"^[a-z]+-[a-z]+[0-9]+$|^global$")


class QuotaExceeded(RuntimeError):
    """429 persisted after one backoff: stop the batch, degrade to fewer views."""


class SynthesisDenied(RuntimeError):
    """401/403: billing hold or missing role. Every remaining request would fail."""


class ViewError(RuntimeError):
    """One view failed (safety block, bad payload, 5xx). Other views may still work."""


@dataclass
class Config:
    project: str = field(default_factory=lambda: os.environ.get("GOOGLE_CLOUD_PROJECT", "") or os.environ.get("GCP_PROJECT", ""))
    location: str = field(default_factory=lambda: os.environ.get("RECON_VIEW_LOCATION", "us-central1"))
    model: str = field(default_factory=lambda: os.environ.get("RECON_VIEW_MODEL", "gemini-2.5-flash-image"))
    # Used only when Vertex says the primary model does not exist (404).
    fallback_model: str = field(default_factory=lambda: os.environ.get("RECON_VIEW_FALLBACK_MODEL", "gemini-3.1-flash-image"))
    wall_clock_s: float = field(default_factory=lambda: float(os.environ.get("RECON_VIEW_BUDGET_S", "45")))
    request_timeout_s: float = field(default_factory=lambda: float(os.environ.get("RECON_VIEW_REQUEST_TIMEOUT_S", "30")))
    max_views: int = field(default_factory=lambda: int(os.environ.get("RECON_VIEW_MAX", "5")))
    max_response_bytes: int = 16 * 1024 * 1024
    max_backoff_s: float = 4.0


def _default_token() -> str:
    import google.auth
    import google.auth.transport.requests

    creds, _ = google.auth.default(scopes=["https://www.googleapis.com/auth/cloud-platform"])
    creds.refresh(google.auth.transport.requests.Request())
    return creds.token


def _endpoint(cfg: Config, model: str) -> str:
    if not _REGION_RE.match(cfg.location):
        raise ValueError(f"invalid region {cfg.location!r}")
    if not re.match(r"^[a-z0-9][a-z0-9.\-]*$", model):
        raise ValueError(f"invalid model id {model!r}")
    host = "aiplatform.googleapis.com" if cfg.location == "global" else f"{cfg.location}-aiplatform.googleapis.com"
    return (
        f"https://{host}/v1/projects/{cfg.project}/locations/{cfg.location}"
        f"/publishers/google/models/{model}:generateContent"
    )


def extract_image(payload: dict) -> Optional[tuple[bytes, dict]]:
    """First inline image in a generateContent response, plus its usage metadata."""
    for cand in payload.get("candidates") or []:
        for part in (cand.get("content") or {}).get("parts") or []:
            inline = part.get("inlineData") or part.get("inline_data")
            if inline and inline.get("data"):
                return base64.b64decode(inline["data"]), payload.get("usageMetadata") or {}
    return None


class VertexViewClient:
    """
    One generateContent call per view. The HTTP boundary is `http` (an
    httpx.Client), so tests inject an httpx.MockTransport carrying recorded
    response bytes, and nothing above this class knows about the network.
    """

    def __init__(self, cfg: Config, http: Optional[httpx.Client] = None,
                 token_provider: Callable[[], str] = _default_token,
                 sleep: Callable[[float], None] = time.sleep):
        self.cfg = cfg
        self.http = http or httpx.Client()
        self._token_provider = token_provider
        self._sleep = sleep
        self._token: Optional[str] = None
        self._lock = threading.Lock()

    def _auth(self) -> dict:
        with self._lock:
            if self._token is None:
                self._token = self._token_provider()
            return {"Authorization": f"Bearer {self._token}"}

    def request_view(self, selfie_png: bytes, target: ViewTarget, deadline: float) -> tuple[bytes, dict]:
        body = {
            "contents": [{"role": "user", "parts": [
                {"inlineData": {"mimeType": "image/png", "data": base64.b64encode(selfie_png).decode()}},
                {"text": _prompt(target)},
            ]}],
            "generationConfig": {"responseModalities": ["IMAGE"]},
        }
        model = self.cfg.model
        tried_fallback = False
        attempt = 0
        while True:
            remaining = deadline - time.monotonic()
            if remaining <= 1.0:
                raise ViewError("wall-clock budget exhausted")
            try:
                resp = self.http.post(
                    _endpoint(self.cfg, model), json=body, headers=self._auth(),
                    timeout=min(self.cfg.request_timeout_s, remaining),
                )
            except httpx.TimeoutException as exc:
                raise ViewError(f"timeout after {self.cfg.request_timeout_s:.0f}s") from exc
            except httpx.HTTPError as exc:
                raise ViewError(f"transport error {type(exc).__name__}") from exc

            if resp.status_code in (401, 403):
                raise SynthesisDenied(f"vertex {resp.status_code}")
            if resp.status_code == 404 and not tried_fallback and self.cfg.fallback_model and model != self.cfg.fallback_model:
                tried_fallback = True
                model = self.cfg.fallback_model
                continue
            if resp.status_code == 429:
                if attempt >= 1:
                    raise QuotaExceeded("vertex 429 after backoff")
                attempt += 1
                wait = min(self.cfg.max_backoff_s, 1.5 + random.random()) 
                if deadline - time.monotonic() <= wait + 1.0:
                    raise QuotaExceeded("vertex 429 and no budget left to back off")
                self._sleep(wait)
                continue
            if resp.status_code != 200:
                raise ViewError(f"vertex {resp.status_code}")
            if len(resp.content) > self.cfg.max_response_bytes:
                raise ViewError("response too large")
            try:
                found = extract_image(resp.json())
            except ValueError as exc:
                raise ViewError("response is not JSON") from exc
            if found is None:
                raise ViewError("no image in response (safety block or refusal)")
            return found


# ── Results ─────────────────────────────────────────────────────────────────────

@dataclass
class SynthView:
    target: ViewTarget
    image: Image.Image
    latency_s: float
    usage: dict


@dataclass
class SynthesisReport:
    views: list[SynthView] = field(default_factory=list)
    requested: int = 0
    failed: int = 0
    stopped: str = ""          # "", "quota", "denied", "budget"
    elapsed_s: float = 0.0
    prompt_tokens: int = 0
    output_tokens: int = 0

    def summary(self) -> str:
        return (f"{len(self.views)}/{self.requested} views in {self.elapsed_s:.1f}s, "
                f"tokens in={self.prompt_tokens} out={self.output_tokens}"
                + (f", stopped={self.stopped}" if self.stopped else ""))


def _png(img: Image.Image, max_side: int = 1024) -> bytes:
    img = img.convert("RGB")
    if max(img.size) > max_side:
        img.thumbnail((max_side, max_side), Image.LANCZOS)
    buf = io.BytesIO()
    img.save(buf, "PNG")
    return buf.getvalue()


def synthesize_views(
    selfie: Image.Image,
    targets: tuple[ViewTarget, ...] = DEFAULT_TARGETS,
    client: Optional[VertexViewClient] = None,
    cfg: Optional[Config] = None,
) -> SynthesisReport:
    """Request the target views concurrently. Never raises."""
    cfg = cfg or (client.cfg if client else Config())
    report = SynthesisReport()
    targets = tuple(targets)[: cfg.max_views]
    report.requested = len(targets)
    t0 = time.monotonic()
    try:
        if client is None:
            if not cfg.project:
                report.stopped = "denied"
                log.warning("view synthesis skipped: no GOOGLE_CLOUD_PROJECT")
                return report
            client = VertexViewClient(cfg)
        deadline = t0 + cfg.wall_clock_s
        png = _png(selfie)
        stop = threading.Event()

        def one(tg: ViewTarget):
            if stop.is_set():
                return tg, None, 0.0, {}, "skipped"
            s = time.monotonic()
            try:
                raw, usage = client.request_view(png, tg, deadline)
                img = open_caller_image(raw, "RGB")
                return tg, img, time.monotonic() - s, usage, ""
            except QuotaExceeded:
                stop.set()
                return tg, None, 0.0, {}, "quota"
            except SynthesisDenied:
                stop.set()
                return tg, None, 0.0, {}, "denied"
            except Exception as exc:  # noqa: BLE001 - one bad view never fails the batch
                return tg, None, 0.0, {}, f"error:{exc}"

        with ThreadPoolExecutor(max_workers=min(3, max(1, len(targets)))) as pool:
            for fut in as_completed([pool.submit(one, t) for t in targets]):
                tg, img, lat, usage, why = fut.result()
                if img is not None:
                    report.views.append(SynthView(tg, img, lat, usage))
                    report.prompt_tokens += int(usage.get("promptTokenCount", 0) or 0)
                    report.output_tokens += int(usage.get("candidatesTokenCount", 0) or 0)
                else:
                    report.failed += 1
                    if why in ("quota", "denied"):
                        report.stopped = report.stopped or why
                    elif why.startswith("error:"):
                        log.warning("view %s dropped: %s", tg.name, why[6:])
        order = {t.name: i for i, t in enumerate(targets)}
        report.views.sort(key=lambda v: order.get(v.target.name, 99))
        if not report.stopped and time.monotonic() - t0 >= cfg.wall_clock_s:
            report.stopped = "budget"
    except Exception as exc:  # noqa: BLE001 - synthesis must never fail a reconstruction
        log.warning("view synthesis aborted: %s", exc)
        report.stopped = report.stopped or "error"
    report.elapsed_s = time.monotonic() - t0
    log.info("view synthesis: %s", report.summary())
    return report


# ── Identity gate ───────────────────────────────────────────────────────────────

# MediaPipe face-mesh indices: outer eye corners, nose alae, mouth corners,
# forehead top and chin. 3D distances between them are pose-invariant, so the same
# face turned 35 degrees should give the same ratios.
_LM = {"eye_l": 33, "eye_r": 263, "nose_l": 129, "nose_r": 358,
       "mouth_l": 61, "mouth_r": 291, "top": 10, "chin": 152}


def landmark_ratios(lm: np.ndarray) -> Optional[dict]:
    """Pose-invariant facial proportions from a (>=468, 3) landmark array."""
    if lm is None or len(lm) <= max(_LM.values()):
        return None
    d = lambda a, b: float(np.linalg.norm(lm[_LM[a]] - lm[_LM[b]]))  # noqa: E731
    iod, height = d("eye_l", "eye_r"), d("top", "chin")
    if iod < 1e-6 or height < 1e-6:
        return None
    return {"iod_over_height": iod / height,
            "nose_over_iod": d("nose_l", "nose_r") / iod,
            "mouth_over_iod": d("mouth_l", "mouth_r") / iod}


def skin_lab(rgb: np.ndarray, mask: Optional[np.ndarray]) -> Optional[np.ndarray]:
    """Median Lab of skin-coloured foreground pixels, None if too few to trust."""
    ycc = cv2.cvtColor(rgb, cv2.COLOR_RGB2YCrCb)
    cr, cb = ycc[..., 1], ycc[..., 2]
    skin = (cr >= 133) & (cr <= 173) & (cb >= 77) & (cb <= 127)
    if mask is not None:
        skin &= mask > 0.5
    if int(skin.sum()) < 200:
        return None
    lab = cv2.cvtColor(rgb, cv2.COLOR_RGB2LAB).astype(np.float32)
    return np.median(lab[skin], axis=0)


@dataclass(frozen=True)
class GateThresholds:
    # PROVISIONAL until calibrated on the 40-face reference set with live Vertex
    # output (`python -m eval.texture_eval --calibrate`). The program's same-pose
    # control floor is 0.0069 divergence; a turned view legitimately sits above
    # it, so these are bounds on drift, not on equality.
    max_ratio_rel_dev: float = 0.22
    max_skin_delta_e: float = 16.0
    min_silhouette_iou: float = 0.55
    max_yaw_error_deg: float = 25.0


@dataclass
class GateResult:
    accepted: bool
    reasons: list[str]
    metrics: dict


def identity_gate(
    selfie_rgb: np.ndarray,
    selfie_mask: Optional[np.ndarray],
    selfie_landmarks: Optional[np.ndarray],
    view_rgb: np.ndarray,
    view_mask: Optional[np.ndarray],
    view_landmarks: Optional[np.ndarray],
    th: GateThresholds = GateThresholds(),
) -> GateResult:
    """
    Accept or reject one synthesised view on identity. A rejected view is dropped
    by the caller without ceremony; this only explains why.

    Two independent checks, because each alone has a blind spot:
      • Skin colour: median Lab of skin pixels must stay within `max_skin_delta_e`
        of the selfie's. Catches complexion drift and re-lit or recoloured faces,
        and works for views with no detectable face (scalp, profile).
      • Landmark proportions (when the view has a detectable face): eye spacing,
        nose width and mouth width ratios must stay within `max_ratio_rel_dev` of
        the selfie's. Catches a different face.
    A view with no skin pixels to measure is rejected: unmeasurable is not safe.
    """
    reasons: list[str] = []
    metrics: dict = {}

    a = skin_lab(selfie_rgb, selfie_mask)
    b = skin_lab(view_rgb, view_mask)
    if a is None or b is None:
        reasons.append("skin colour not measurable")
    else:
        de = float(np.linalg.norm(a - b))
        metrics["skin_delta_e"] = de
        if de > th.max_skin_delta_e:
            reasons.append(f"skin colour drift dE={de:.1f} > {th.max_skin_delta_e}")

    ra, rb = landmark_ratios(selfie_landmarks), landmark_ratios(view_landmarks)
    if ra is not None and rb is not None:
        devs = {k: abs(rb[k] - ra[k]) / ra[k] for k in ra}
        metrics["ratio_rel_dev"] = max(devs.values())
        for k, v in devs.items():
            if v > th.max_ratio_rel_dev:
                reasons.append(f"landmark ratio {k} off by {v:.2f} > {th.max_ratio_rel_dev}")
    return GateResult(not reasons, reasons, metrics)
