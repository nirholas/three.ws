"""three.ws Cloud for Modly.

One generator class serves every node in ``manifest.json``. Modly instantiates
it once per node and sets ``MODEL_NODE_ID`` (``image-to-3d``, ``text-to-3d``,
``sketch-to-3d``, ``rig``, ``remesh``, ``publish``), so ``generate`` dispatches
on that id.

The extension runs in Modly's direct mode: no venv, no setup step, no weights.
Everything it needs is the Python standard library plus the vendored
``three_ws_client.py`` beside this file. Work happens on three.ws Forge; the
mesh that comes back is written into the Modly workspace like any local model's
output, so it flows into Modly's viewer, mesh tools, exports and workflows.

Meshes that three.ws produced keep their cloud URL in a small index (keyed by
the SHA-256 of the GLB bytes), so chaining Image to 3D into Auto-Rig or Remesh
never re-uploads the file. A mesh made by a local Modly model is uploaded once
through the public GLB presign and then reused the same way.

Configuration (all optional):

* ``THREE_WS_BASE_URL``      deployment origin, default ``https://three.ws``
* ``THREE_WS_PROVIDER_KEY``  Meshy/Tripo/Rodin/Stability/Replicate key for BYOK engines
* ``THREE_WS_API_KEY``       three.ws key with ``avatars:write`` for the Publish node
"""

from __future__ import annotations

import contextlib
import hashlib
import json
import math
import os
import threading
import time
import uuid
import webbrowser
from pathlib import Path
from typing import Callable, Optional

from services.generators.base import BaseGenerator, GenerationCancelled, smooth_progress

from three_ws_client import DEFAULT_BASE_URL, ThreeWSClient, ThreeWSError, is_glb

_STATE_FILE = "three-ws-state.json"
_INDEX_LIMIT = 500

ProgressCb = Optional[Callable[[int, str], None]]


class ThreeWSGenerator(BaseGenerator):
    MODEL_ID = "three-ws"
    DISPLAY_NAME = "three.ws Cloud"
    VRAM_GB = 0

    def __init__(self, model_dir: Path, outputs_dir: Path) -> None:
        super().__init__(model_dir, outputs_dir)
        self._state_lock = threading.Lock()
        self._catalog: Optional[dict] = None
        self._catalog_at = 0.0

    # ------------------------------------------------------------------ #
    # Lifecycle: nothing to download, nothing to hold in VRAM
    # ------------------------------------------------------------------ #

    def is_downloaded(self) -> bool:
        return True

    def load(self) -> None:
        self._model = ThreeWSClient(
            os.environ.get("THREE_WS_BASE_URL") or DEFAULT_BASE_URL,
            client_handle=self._client_handle(),
            timeout=60.0,
        )

    def unload(self) -> None:
        self._model = None

    # ------------------------------------------------------------------ #
    # Dispatch
    # ------------------------------------------------------------------ #

    def generate(
        self,
        image_bytes: bytes,
        params: dict,
        progress_cb: ProgressCb = None,
        cancel_event: Optional[threading.Event] = None,
    ) -> Path:
        if self._model is None:
            self.load()
        node = self.MODEL_NODE_ID or "image-to-3d"
        handlers = {
            "image-to-3d": self._image_to_3d,
            "text-to-3d": self._text_to_3d,
            "sketch-to-3d": self._sketch_to_3d,
            "rig": self._rig,
            "remesh": self._remesh,
            "publish": self._publish,
        }
        handler = handlers.get(node)
        if handler is None:
            raise ValueError(f"Unknown three.ws node '{node}'.")
        try:
            return handler(image_bytes or b"", params or {}, progress_cb, cancel_event)
        except ThreeWSError as exc:
            if exc.code == "cancelled":
                raise GenerationCancelled() from exc
            raise RuntimeError(_explain(exc)) from exc

    # ------------------------------------------------------------------ #
    # Generation nodes
    # ------------------------------------------------------------------ #

    def _image_to_3d(self, image_bytes, params, progress_cb, cancel_event) -> Path:
        if is_glb(image_bytes) or not image_bytes:
            raise ValueError("three.ws Image to 3D needs an image input.")
        client = self._client_for(params)
        content_type = _sniff_image_type(image_bytes)
        backend, note = self._resolve_engine(params.get("engine"), "image", client)
        with _easing(progress_cb, 2, 8, note or "Sending image to three.ws"):
            image_url = client.upload_image(image_bytes, content_type)
            self._check_cancelled(cancel_event)
            job = client.submit_image_to_3d(
                image_url,
                prompt=str(params.get("prompt") or ""),
                tier=_tier(params),
                backend=backend,
                path="image",
            )
        label = f"Generating on {job.get('backend') or backend or 'three.ws'}"
        url = client.poll(
            job["job_id"],
            on_progress=_ticker(self, progress_cb, 8, 90, 120.0, label),
            should_cancel=_canceller(cancel_event),
            timeout=600.0,
        )
        return self._download(client, url, progress_cb, "image-to-3d")

    def _text_to_3d(self, image_bytes, params, progress_cb, cancel_event) -> Path:
        prompt = str(params.get("prompt") or params.get("text") or "").strip()
        if len(prompt) < 3:
            raise ValueError("Connect a text node with a prompt of at least 3 characters.")
        client = self._client_for(params)
        path = "geometry" if params.get("route") == "geometry" else "image"
        backend, note = self._resolve_engine(params.get("engine"), path, client)
        with _easing(progress_cb, 2, 8, note or "Sending prompt to three.ws"):
            job = client.submit_text_to_3d(
                prompt,
                tier=_tier(params),
                backend=backend,
                path=path,
                aspect_ratio=str(params.get("aspect_ratio") or "1:1"),
            )
        label = f"Generating on {job.get('backend') or backend or 'three.ws'}"
        url = client.poll(
            job["job_id"],
            on_progress=_ticker(self, progress_cb, 8, 90, 150.0, label),
            should_cancel=_canceller(cancel_event),
            timeout=900.0,
        )
        return self._download(client, url, progress_cb, "text-to-3d")

    def _sketch_to_3d(self, image_bytes, params, progress_cb, cancel_event) -> Path:
        if is_glb(image_bytes) or not image_bytes or _is_placeholder_png(image_bytes):
            raise ValueError("three.ws Sketch to 3D needs a drawing as its image input.")
        prompt = str(params.get("prompt") or params.get("text") or "").strip()
        if len(prompt) < 3:
            raise ValueError(
                "Say what the sketch shows (for example: a wooden chair with curved legs), "
                "either in the node's field or from a connected text node."
            )
        client = self._client_for(params)
        with _easing(progress_cb, 2, 8, "Sending sketch to three.ws"):
            sketch_url = client.upload_image(image_bytes, _sniff_image_type(image_bytes))
            self._check_cancelled(cancel_event)
            job = client.submit_image_to_3d(sketch_url, prompt=prompt, tier=_tier(params), path="sketch")
        url = client.poll(
            job["job_id"],
            on_progress=_ticker(self, progress_cb, 8, 90, 90.0, "Lifting the sketch to 3D"),
            should_cancel=_canceller(cancel_event),
            timeout=600.0,
        )
        return self._download(client, url, progress_cb, "sketch-to-3d")

    # ------------------------------------------------------------------ #
    # Mesh nodes
    # ------------------------------------------------------------------ #

    def _rig(self, image_bytes, params, progress_cb, cancel_event) -> Path:
        client = self._client_for(params)
        mesh_url = self._mesh_url(client, image_bytes, params, progress_cb)
        self._check_cancelled(cancel_event)
        url = client.rig(
            mesh_url,
            on_progress=_ticker(self, progress_cb, 15, 90, 60.0, "Fitting a humanoid skeleton"),
            should_cancel=_canceller(cancel_event),
        )
        return self._download(client, url, progress_cb, "rigged")

    def _remesh(self, image_bytes, params, progress_cb, cancel_event) -> Path:
        client = self._client_for(params)
        mesh_url = self._mesh_url(client, image_bytes, params, progress_cb)
        self._check_cancelled(cancel_event)
        mode = str(params.get("remesh_mode") or "quad")
        url = client.remesh(
            mesh_url,
            remesh_mode=mode,
            operation=str(params.get("operation") or "full"),
            target_faces=_int(params.get("target_faces"), 0),
            texture_size=_int(params.get("texture_size"), 1024),
            on_progress=_ticker(self, progress_cb, 15, 90, 120.0, f"Remeshing to {mode}"),
            should_cancel=_canceller(cancel_event),
        )
        return self._download(client, url, progress_cb, f"remesh-{mode}")

    def _publish(self, image_bytes, params, progress_cb, cancel_event) -> Path:
        api_key = str(params.get("api_key") or os.environ.get("THREE_WS_API_KEY") or "").strip()
        glb = self._mesh_bytes(image_bytes, params)
        client = self._client_for(params)
        self._report(progress_cb, 10, "Publishing to three.ws")
        avatar = client.publish_glb(
            glb,
            api_key=api_key,
            name=str(params.get("name") or "Made in Modly"),
            visibility=str(params.get("visibility") or "unlisted"),
            tags=("modly",),
            source_meta={"tool": "modly", "extension": "three-ws"},
        )
        self._check_cancelled(cancel_event)
        page = client.avatar_page_url(avatar)
        print(f"[three.ws] Published: {page}")
        if params.get("open_page", "yes") == "yes":
            webbrowser.open(page)
        self._report(progress_cb, 95, f"Published: {page}")
        out = self._new_output_path("published")
        out.write_bytes(glb)
        return out

    # ------------------------------------------------------------------ #
    # Mesh resolution and the cloud URL index
    # ------------------------------------------------------------------ #

    def _mesh_bytes(self, image_bytes: bytes, params: dict) -> bytes:
        mesh_path = params.get("mesh_path")
        if mesh_path:
            path = self._resolve_workspace_path(str(mesh_path))
            data = path.read_bytes()
        else:
            data = image_bytes
        if not is_glb(data):
            raise ValueError(
                "This node needs a GLB mesh input. Connect it after a model node, or convert "
                "OBJ/STL/PLY to GLB with Modly's export first."
            )
        return data

    def _mesh_url(self, client: ThreeWSClient, image_bytes: bytes, params: dict, progress_cb) -> str:
        glb = self._mesh_bytes(image_bytes, params)
        digest = hashlib.sha256(glb).hexdigest()
        known = self._state().get("urls", {}).get(digest)
        if known:
            self._report(progress_cb, 10, "Mesh already on three.ws")
            return known
        self._report(progress_cb, 5, f"Uploading mesh ({len(glb) // 1024} KB)")
        url = client.upload_glb(glb)
        self._remember(digest, url)
        return url

    def _resolve_workspace_path(self, raw: str) -> Path:
        workspace = self._workspace_dir().resolve()
        cleaned = raw.replace("\\", "/")
        if cleaned.startswith("/workspace/"):
            cleaned = cleaned[len("/workspace/"):]
        candidate = Path(cleaned)
        if not candidate.is_absolute():
            candidate = (workspace / candidate).resolve()
            if workspace != candidate and workspace not in candidate.parents:
                raise ValueError("mesh_path points outside the Modly workspace.")
        if not candidate.is_file():
            raise ValueError(f"Mesh file not found: {raw}")
        return candidate

    def _workspace_dir(self) -> Path:
        env = os.environ.get("WORKSPACE_DIR")
        if env:
            return Path(env)
        # Modly points outputs_dir at WORKSPACE_DIR/<collection> for each job.
        return Path(self.outputs_dir).parent

    def _state_path(self) -> Path:
        # model_dir is MODELS_DIR/three-ws/<node>; the parent is shared by every
        # node of this extension, so a mesh made by one node is known to the rest.
        return Path(self.model_dir).parent / _STATE_FILE

    def _state(self) -> dict:
        with self._state_lock:
            try:
                data = json.loads(self._state_path().read_text(encoding="utf-8"))
                return data if isinstance(data, dict) else {}
            except (OSError, ValueError):
                return {}

    def _write_state(self, state: dict) -> None:
        path = self._state_path()
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(".tmp")
        tmp.write_text(json.dumps(state, indent=1), encoding="utf-8")
        os.replace(tmp, path)

    def _remember(self, digest: str, url: str) -> None:
        state = self._state()
        urls = state.get("urls") or {}
        urls.pop(digest, None)
        urls[digest] = url
        while len(urls) > _INDEX_LIMIT:
            urls.pop(next(iter(urls)))
        state["urls"] = urls
        with self._state_lock:
            self._write_state(state)

    def _client_handle(self) -> str:
        """A stable anonymous handle so every generation from this machine is
        scoped together on three.ws (rate limits, the creations list)."""
        state = self._state()
        handle = state.get("client_handle")
        if isinstance(handle, str) and len(handle) >= 16:
            return handle
        state["client_handle"] = handle = uuid.uuid4().hex
        with self._state_lock:
            self._write_state(state)
        return handle

    # ------------------------------------------------------------------ #
    # Engines, clients, output
    # ------------------------------------------------------------------ #

    def _client_for(self, params: dict) -> ThreeWSClient:
        base: ThreeWSClient = self._model
        key = str(params.get("provider_key") or os.environ.get("THREE_WS_PROVIDER_KEY") or "").strip()
        if not key:
            return base
        return ThreeWSClient(base.base_url, provider_key=key, client_handle=base.client_handle, timeout=base.timeout)

    def _live_catalog(self, client: ThreeWSClient) -> dict:
        if self._catalog is None or time.monotonic() - self._catalog_at > 600:
            self._catalog = client.get_catalog()
            self._catalog_at = time.monotonic()
        return self._catalog

    def _resolve_engine(self, engine, path: str, client: ThreeWSClient):
        """Validate an engine against the live catalog.

        Returns ``(backend_or_None, note)``. ``None`` lets the server pick its
        default lane. An engine that is not live for this path falls back to the
        default instead of failing the run, and ``note`` tells the user why.
        """
        engine = str(engine or "auto")
        if engine == "auto":
            return None, ""
        try:
            backends = self._live_catalog(client).get("backends") or []
        except ThreeWSError:
            return engine, ""
        entry = next((b for b in backends if b.get("id") == engine), None)
        if not entry or not entry.get("configured") or path not in (entry.get("paths") or []):
            return None, f"{engine} is not available for this route on three.ws yet, using the default engine"
        if entry.get("byok") and not client.provider_key:
            raise ValueError(
                f"{entry.get('label') or engine} runs on your own provider account. Paste the key "
                "into the node's Provider key field or set THREE_WS_PROVIDER_KEY, or pick a free engine."
            )
        return engine, ""

    def _new_output_path(self, tag: str) -> Path:
        out_dir = Path(self.outputs_dir)
        out_dir.mkdir(parents=True, exist_ok=True)
        return out_dir / f"{int(time.time())}_{uuid.uuid4().hex[:8]}_three-ws-{tag}.glb"

    def _download(self, client: ThreeWSClient, url: str, progress_cb, tag: str) -> Path:
        self._report(progress_cb, 92, "Downloading mesh")
        out = self._new_output_path(tag)
        client.download(url, str(out))
        data = out.read_bytes()
        if not is_glb(data):
            out.unlink(missing_ok=True)
            raise RuntimeError("three.ws returned a file that is not a valid GLB.")
        self._remember(hashlib.sha256(data).hexdigest(), url)
        self._report(progress_cb, 99, "Done")
        return out


# ---------------------------------------------------------------------- #
# Helpers
# ---------------------------------------------------------------------- #

_PLACEHOLDER_MAX_BYTES = 128


def _is_placeholder_png(data: bytes) -> bool:
    """Modly sends a 1x1 PNG to model nodes that have no image connected."""
    return data[:8] == b"\x89PNG\r\n\x1a\n" and len(data) <= _PLACEHOLDER_MAX_BYTES


def _sniff_image_type(data: bytes) -> str:
    if data[:8] == b"\x89PNG\r\n\x1a\n":
        return "image/png"
    if data[:3] == b"\xff\xd8\xff":
        return "image/jpeg"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp"
    raise ValueError("three.ws accepts PNG, JPEG or WebP images.")


def _tier(params: dict) -> str:
    tier = str(params.get("tier") or "standard")
    return tier if tier in ("draft", "standard", "high") else "standard"


def _int(value, default: int) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def _canceller(cancel_event: Optional[threading.Event]):
    return (lambda: cancel_event.is_set()) if cancel_event is not None else None


@contextlib.contextmanager
def _easing(progress_cb, start: int, end: int, label: str):
    """Keep the bar moving through a blocking upload or submit: a cold lane can
    take tens of seconds to accept a job and reports nothing meanwhile."""
    if progress_cb:
        progress_cb(start, label)
    stop = threading.Event()
    worker = None
    if progress_cb:
        worker = threading.Thread(
            target=smooth_progress, args=(progress_cb, start, end, label, stop, 2.0), daemon=True
        )
        worker.start()
    try:
        yield
    finally:
        stop.set()
        if worker:
            worker.join(timeout=1)


def _ticker(gen: BaseGenerator, progress_cb, start: int, end: int, expected_s: float, label: str):
    """Map elapsed seconds onto Modly's percent bar. Forge reports a status, not
    a percentage, so progress eases toward ``end`` over the lane's typical time."""

    def tick(status: str, elapsed: float) -> None:
        frac = 1.0 - math.exp(-elapsed / max(expected_s, 1.0))
        pct = int(start + (end - start) * frac)
        gen._report(progress_cb, pct, f"{label} ({int(elapsed)}s)")

    return tick


def _explain(exc: ThreeWSError) -> str:
    if exc.code == "rate_limited" or exc.status == 429:
        return "three.ws is rate limiting this machine. Wait a minute and run again."
    if exc.code == "unreachable":
        return f"{exc.message}. Check your internet connection."
    if exc.code == "needs_key":
        return "That engine needs your provider key. Set it on the node or in THREE_WS_PROVIDER_KEY."
    if exc.code == "missing_api_key":
        return "Publishing needs a three.ws API key with avatars:write. Create one at three.ws/dashboard/api."
    return exc.message
