"""three.ws Forge client, shared by the Blender add-on, the ComfyUI nodes and the Modly extension.

Single source of truth for the public Forge generation contract
(``api/forge.js`` + ``api/forge-upload.js``). Stdlib-only (``urllib``) so it
runs unmodified inside Blender's bundled Python and inside ComfyUI without
forcing a ``pip install`` into either host.

Public contract this wraps
---------------------------
* ``POST /api/forge``            ``{prompt, aspect_ratio?, path?, tier?, backend?}``  → text→3D
* ``POST /api/forge``            ``{image_urls[], prompt?, path?, tier?, backend?}``  → image→3D
* ``GET  /api/forge?job=<id>``   → poll ``{status, glb_url?, error?, backend?, ...}``
* ``GET  /api/forge?catalog``    → tier/backend/cost matrix
* ``POST /api/forge-upload``     ``{content_type, size_bytes, checksum_sha256?}`` → presigned PUT
* ``POST /api/scene-glb-upload`` ``{content_type, size_bytes}``                 → presigned PUT for a GLB
* ``POST /api/forge?action=rig`` ``{glb_url}``                                  → auto-rig, polled on ``?job=``
* ``POST /api/forge-remesh``     ``{mesh_url, remesh_mode?, operation?, ...}``    → retopology job
* ``GET  /api/forge-remesh?job=`` → poll ``{status, result_url?, face_count?, error?}``
* ``POST /api/avatars/upload``   raw GLB body, bearer ``avatars:write``          → ``{storage_key, ...}``
* ``POST /api/avatars/presign``  ``{size_bytes, content_type, checksum_sha256}``  → presigned PUT (large GLBs)
* ``POST /api/avatars``          ``{name, storage_key, size_bytes, ...}``        → the saved avatar

Generation is auth-free (IP rate-limited, scoped to an anonymous client handle).
The geometry path (Meshy/Tripo) is BYOK: pass ``provider_key`` and it travels as
the ``x-forge-provider-key`` header. Publishing a GLB into an account
(``publish_glb``) is the one authenticated call: it takes an API key from
three.ws/dashboard/api carrying the ``avatars:write`` scope.

This file is vendored byte-for-byte into each plugin package; the canonical copy
lives at ``integrations/_pyclient/three_ws_client.py`` and a drift test keeps the
vendored copies identical.
"""

from __future__ import annotations

import hashlib
import json
import ssl
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from typing import Callable, Optional

DEFAULT_BASE_URL = "https://three.ws"
DEFAULT_TIMEOUT = 30.0          # per HTTP request
DEFAULT_POLL_INTERVAL = 2.0     # seconds between job polls
DEFAULT_POLL_TIMEOUT = 300.0    # overall ceiling for a generation

# Mirrors api/_lib/forge-tiers.js so the plugins can present choices without a
# network round-trip. ``get_catalog()`` fetches the live matrix when needed.
TIERS = ("draft", "standard", "high")
PATHS = ("image", "geometry", "sketch")
BACKENDS = (
    "trellis2",
    "hunyuan3d",
    "nvidia",
    "trellis_selfhost",
    "huggingface",
    "trellis",
    "triposg",
    "meshy",
    "tripo",
    "rodin",
    "stability",
    "replicate_byok",
)
ASPECT_RATIOS = ("1:1", "4:3", "3:4", "16:9", "9:16")
AVATAR_VISIBILITIES = ("private", "unlisted", "public")
REMESH_MODES = ("triangle", "quad", "lowpoly")
REMESH_OPERATIONS = ("full", "simplify", "repair", "convert")
REMESH_TEXTURE_SIZES = (512, 1024, 2048)
MAX_SCENE_GLB_BYTES = 200 * 1024 * 1024

# The upload proxy (``/api/avatars/upload``) accepts bodies up to 50 MB and
# canonicalizes humanoid bone names at ingest. Anything larger goes through the
# presigned direct-to-storage path instead.
MAX_PROXY_UPLOAD_BYTES = 50 * 1024 * 1024
MAX_AVATAR_BYTES = 500 * 1024 * 1024

_CONTENT_TYPE_BY_EXT = {
    "png": "image/png",
    "jpg": "image/jpeg",
    "jpeg": "image/jpeg",
    "webp": "image/webp",
}


def _ssl_context() -> ssl.SSLContext:
    """CA bundle for HTTPS. Embedded Pythons (Blender, Modly, python.org macOS
    builds) often ship without system roots, so prefer certifi when present."""
    try:
        import certifi  # type: ignore

        return ssl.create_default_context(cafile=certifi.where())
    except ImportError:
        return ssl.create_default_context()


_SSL = _ssl_context()


def _urlopen(req: urllib.request.Request, timeout: float):
    if req.full_url.startswith("https://"):
        return urllib.request.urlopen(req, timeout=timeout, context=_SSL)
    return urllib.request.urlopen(req, timeout=timeout)


class ThreeWSError(Exception):
    """A Forge request failed. ``message`` is safe to show a user."""

    def __init__(self, message: str, *, code: str = "", status: int = 0):
        super().__init__(message)
        self.message = message
        self.code = code
        self.status = status


def content_type_for_path(path: str) -> str:
    """Map an image filename to the content-type Forge accepts, or raise."""
    ext = path.rsplit(".", 1)[-1].lower() if "." in path else ""
    ct = _CONTENT_TYPE_BY_EXT.get(ext)
    if not ct:
        raise ThreeWSError(
            f"Unsupported image type '.{ext}'. Use PNG, JPEG, or WebP.",
            code="invalid_content_type",
        )
    return ct


class ThreeWSClient:
    """Submit, poll, and download three.ws Forge generations.

    Parameters
    ----------
    base_url:       deployment origin (default ``https://three.ws``).
    provider_key:   optional Meshy/Tripo key for the BYOK geometry path.
    client_handle:  anonymous handle that scopes creations; generated if omitted.
    timeout:        per-request timeout in seconds.
    """

    def __init__(
        self,
        base_url: str = DEFAULT_BASE_URL,
        *,
        provider_key: Optional[str] = None,
        client_handle: Optional[str] = None,
        timeout: float = DEFAULT_TIMEOUT,
    ):
        self.base_url = (base_url or DEFAULT_BASE_URL).rstrip("/")
        self.provider_key = (provider_key or "").strip() or None
        self.client_handle = client_handle or uuid.uuid4().hex
        self.timeout = timeout

    # -- low-level HTTP ------------------------------------------------------

    def _headers(self, extra: Optional[dict] = None) -> dict:
        headers = {
            "accept": "application/json",
            "x-forge-client": self.client_handle,
            "user-agent": "three-ws-plugin/1.0",
        }
        if self.provider_key:
            headers["x-forge-provider-key"] = self.provider_key
        if extra:
            headers.update(extra)
        return headers

    def _request(
        self,
        method: str,
        path: str,
        *,
        body: Optional[dict] = None,
        raw: Optional[bytes] = None,
        headers: Optional[dict] = None,
        timeout: Optional[float] = None,
    ) -> dict:
        url = f"{self.base_url}{path}"
        data = None
        merged = self._headers(headers)
        if body is not None:
            data = json.dumps(body).encode("utf-8")
            merged["content-type"] = "application/json"
        elif raw is not None:
            data = raw
        req = urllib.request.Request(url, data=data, headers=merged, method=method)
        try:
            with _urlopen(req, timeout or self.timeout) as resp:
                payload = resp.read()
        except urllib.error.HTTPError as exc:
            payload = exc.read()
            parsed = _safe_json(payload)
            raise ThreeWSError(
                parsed.get("message") or parsed.get("error") or f"HTTP {exc.code}",
                code=parsed.get("error", ""),
                status=exc.code,
            ) from exc
        except urllib.error.URLError as exc:
            raise ThreeWSError(
                f"Could not reach {self.base_url}: {exc.reason}",
                code="unreachable",
            ) from exc
        return _safe_json(payload)

    # -- catalog -------------------------------------------------------------

    def get_catalog(self) -> dict:
        """Live tier/backend/cost matrix from ``GET /api/forge?catalog``."""
        return self._request("GET", "/api/forge?catalog")

    # -- image upload (image→3D needs a public URL) --------------------------

    def upload_image(self, image_bytes: bytes, content_type: str) -> str:
        """Presign + PUT an image, returning its public URL for image→3D.

        Raises ThreeWSError with actionable guidance if storage is not
        configured on the deployment (the caller may pass a public URL instead).
        """
        if not image_bytes:
            raise ThreeWSError("Image is empty.", code="invalid_size")
        checksum = hashlib.sha256(image_bytes).hexdigest()
        presign = self._request(
            "POST",
            "/api/forge-upload",
            body={
                "content_type": content_type,
                "size_bytes": len(image_bytes),
                "checksum_sha256": checksum,
            },
        )
        return self._put_presigned(presign, image_bytes, content_type, "Image")

    def upload_glb(self, glb_bytes: bytes) -> str:
        """Presign + PUT a binary glTF, returning its public URL.

        Rigging and remeshing take a public mesh URL, so a mesh that exists only
        on the caller's disk goes up through ``/api/scene-glb-upload`` first.
        """
        if not is_glb(glb_bytes):
            raise ThreeWSError("Mesh must be a binary glTF 2.0 (.glb) file.", code="invalid_glb")
        if len(glb_bytes) > MAX_SCENE_GLB_BYTES:
            raise ThreeWSError("Mesh is larger than the 200 MB upload limit.", code="too_large")
        presign = self._request(
            "POST",
            "/api/scene-glb-upload",
            body={"content_type": "model/gltf-binary", "size_bytes": len(glb_bytes)},
        )
        return self._put_presigned(presign, glb_bytes, "model/gltf-binary", "Mesh")

    def _put_presigned(self, presign: dict, data: bytes, content_type: str, label: str) -> str:
        upload_url = presign.get("upload_url")
        public_url = presign.get("public_url")
        if not upload_url or not public_url:
            raise ThreeWSError("Upload presign returned no URL.", code="presign_failed")
        put_headers = presign.get("headers") or {"content-type": content_type}
        put_req = urllib.request.Request(upload_url, data=data, headers=put_headers, method="PUT")
        try:
            with _urlopen(put_req, max(self.timeout, 60)) as resp:
                resp.read()
        except urllib.error.HTTPError as exc:
            raise ThreeWSError(
                f"{label} upload failed (HTTP {exc.code}).", code="upload_failed", status=exc.code
            ) from exc
        except urllib.error.URLError as exc:
            raise ThreeWSError(f"{label} upload failed: {exc.reason}", code="upload_failed") from exc
        return public_url

    # -- submit --------------------------------------------------------------

    def submit_text_to_3d(
        self,
        prompt: str,
        *,
        tier: str = "standard",
        backend: Optional[str] = None,
        path: str = "image",
        aspect_ratio: str = "1:1",
    ) -> dict:
        prompt = (prompt or "").strip()
        if len(prompt) < 3:
            raise ThreeWSError("Describe one subject in at least 3 characters.", code="invalid_prompt")
        body = {"prompt": prompt, "tier": tier, "path": path, "aspect_ratio": aspect_ratio}
        if backend:
            body["backend"] = backend
        return self._submit(body)

    def submit_image_to_3d(
        self,
        image_urls,
        *,
        prompt: str = "",
        tier: str = "standard",
        backend: Optional[str] = None,
        path: str = "image",
    ) -> dict:
        if isinstance(image_urls, str):
            image_urls = [image_urls]
        image_urls = [u for u in image_urls if isinstance(u, str) and u.startswith("https://")]
        if not image_urls:
            raise ThreeWSError("image_to_3d needs at least one public https image URL.", code="invalid_image_urls")
        body = {"image_urls": image_urls, "tier": tier, "path": path}
        if prompt.strip():
            body["prompt"] = prompt.strip()
        if backend:
            body["backend"] = backend
        return self._submit(body)

    def _submit(self, body: dict) -> dict:
        result = self._request("POST", "/api/forge", body=body)
        err = result.get("error")
        if err == "needs_key":
            raise ThreeWSError(
                "This backend (Meshy/Tripo) needs your provider API key. "
                "Set it in the add-on preferences / node input.",
                code="needs_key",
            )
        if err == "backend_unconfigured":
            raise ThreeWSError(
                result.get("message") or "That backend is not configured on this deployment.",
                code="backend_unconfigured",
            )
        if err == "unconfigured":
            raise ThreeWSError(
                result.get("message") or "Generation is not configured on this deployment.",
                code="unconfigured",
            )
        if err:
            raise ThreeWSError(result.get("message") or err, code=err)
        job_id = result.get("job_id")
        if not job_id:
            raise ThreeWSError("Forge returned no job id.", code="no_job")
        return result

    # -- poll ----------------------------------------------------------------

    def poll(
        self,
        job_id: str,
        *,
        on_progress: Optional[Callable[[str, float], None]] = None,
        interval: float = DEFAULT_POLL_INTERVAL,
        timeout: float = DEFAULT_POLL_TIMEOUT,
        should_cancel: Optional[Callable[[], bool]] = None,
        _now: Callable[[], float] = time.monotonic,
        _sleep: Callable[[float], None] = time.sleep,
    ) -> str:
        """Block until the job is done; return its GLB URL.

        ``on_progress(status, elapsed_seconds)`` is called each tick. Raises
        ThreeWSError on failure or timeout. ``should_cancel`` lets a host abort.
        """
        return self._poll_until(
            f"/api/forge?job={urllib.parse.quote(job_id)}",
            "glb_url",
            "Generation",
            on_progress=on_progress,
            interval=interval,
            timeout=timeout,
            should_cancel=should_cancel,
            _now=_now,
            _sleep=_sleep,
        )

    def _poll_until(
        self,
        path: str,
        result_key: str,
        label: str,
        *,
        on_progress: Optional[Callable[[str, float], None]],
        interval: float,
        timeout: float,
        should_cancel: Optional[Callable[[], bool]],
        _now: Callable[[], float],
        _sleep: Callable[[float], None],
    ) -> str:
        start = _now()
        while True:
            if should_cancel and should_cancel():
                raise ThreeWSError(f"{label} cancelled.", code="cancelled")
            elapsed = _now() - start
            if elapsed > timeout:
                raise ThreeWSError(f"{label} timed out after {int(elapsed)}s.", code="timeout")
            try:
                result = self._request("GET", path)
            except ThreeWSError as exc:
                # A 502/503/504 on a poll is a transient upstream hiccup (the
                # remesh worker answers 502 while it cold-starts); keep polling.
                if exc.status in (502, 503, 504):
                    _sleep(interval)
                    continue
                raise
            status = result.get("status") or "running"
            if on_progress:
                on_progress(status, elapsed)
            if status == "done" and result.get(result_key):
                return result[result_key]
            if status == "failed":
                raise ThreeWSError(result.get("error") or f"{label} failed.", code="failed")
            _sleep(interval)

    # -- rig -----------------------------------------------------------------

    def submit_rig(self, glb_url: str) -> dict:
        """Start auto-rigging a public GLB; returns ``{job_id, ...}``."""
        if not _is_web_url(glb_url):
            raise ThreeWSError("Rigging needs a public GLB URL.", code="invalid_glb_url")
        result = self._request("POST", "/api/forge?action=rig", body={"glb_url": glb_url})
        if result.get("error"):
            raise ThreeWSError(result.get("message") or result["error"], code=result["error"])
        if not result.get("job_id"):
            raise ThreeWSError("The rigger returned no job id.", code="no_job")
        return result

    def rig(
        self,
        glb_url: str,
        *,
        on_progress: Optional[Callable[[str, float], None]] = None,
        should_cancel: Optional[Callable[[], bool]] = None,
        poll_timeout: float = 600.0,
        _now: Callable[[], float] = time.monotonic,
        _sleep: Callable[[float], None] = time.sleep,
    ) -> str:
        """Auto-rig a GLB with a humanoid skeleton; return the rigged GLB URL."""
        job = self.submit_rig(glb_url)
        return self._poll_until(
            f"/api/forge?job={urllib.parse.quote(job['job_id'])}",
            "glb_url",
            "Rigging",
            on_progress=on_progress,
            interval=DEFAULT_POLL_INTERVAL,
            timeout=poll_timeout,
            should_cancel=should_cancel,
            _now=_now,
            _sleep=_sleep,
        )

    # -- remesh --------------------------------------------------------------

    def submit_remesh(
        self,
        mesh_url: str,
        *,
        remesh_mode: str = "triangle",
        operation: str = "full",
        target_faces: Optional[int] = None,
        texture_size: int = 1024,
    ) -> dict:
        """Start a remesh/retopology job on a public GLB; returns ``{job_id, ...}``."""
        if not _is_web_url(mesh_url):
            raise ThreeWSError("Remeshing needs a public mesh URL.", code="invalid_mesh_url")
        if remesh_mode not in REMESH_MODES:
            raise ThreeWSError(
                f"remesh_mode must be one of: {', '.join(REMESH_MODES)}.", code="invalid_mode"
            )
        if operation not in REMESH_OPERATIONS:
            raise ThreeWSError(
                f"operation must be one of: {', '.join(REMESH_OPERATIONS)}.", code="invalid_operation"
            )
        if texture_size not in REMESH_TEXTURE_SIZES:
            raise ThreeWSError("texture_size must be 512, 1024 or 2048.", code="invalid_texture_size")
        body = {
            "mesh_url": mesh_url,
            "remesh_mode": remesh_mode,
            "operation": operation,
            "texture_size": texture_size,
            "output_format": "glb",
        }
        if target_faces and int(target_faces) > 0:
            body["target_faces"] = int(target_faces)
        result = self._request("POST", "/api/forge-remesh", body=body)
        if result.get("error"):
            raise ThreeWSError(result.get("message") or result["error"], code=result["error"])
        if not result.get("job_id"):
            raise ThreeWSError("Mesh processing returned no job id.", code="no_job")
        return result

    def remesh(
        self,
        mesh_url: str,
        *,
        remesh_mode: str = "triangle",
        operation: str = "full",
        target_faces: Optional[int] = None,
        texture_size: int = 1024,
        on_progress: Optional[Callable[[str, float], None]] = None,
        should_cancel: Optional[Callable[[], bool]] = None,
        poll_timeout: float = 900.0,
        _now: Callable[[], float] = time.monotonic,
        _sleep: Callable[[float], None] = time.sleep,
    ) -> str:
        """Remesh a GLB on the remesh worker; return the processed GLB URL."""
        job = self.submit_remesh(
            mesh_url,
            remesh_mode=remesh_mode,
            operation=operation,
            target_faces=target_faces,
            texture_size=texture_size,
        )
        return self._poll_until(
            f"/api/forge-remesh?job={urllib.parse.quote(job['job_id'])}",
            "result_url",
            "Mesh processing",
            on_progress=on_progress,
            interval=DEFAULT_POLL_INTERVAL,
            timeout=poll_timeout,
            should_cancel=should_cancel,
            _now=_now,
            _sleep=_sleep,
        )

    # -- download ------------------------------------------------------------

    def download(self, url: str, dest_path: str) -> str:
        """Stream a GLB (or any URL) to ``dest_path``; return the path."""
        req = urllib.request.Request(url, headers={"user-agent": "three-ws-plugin/1.0"})
        try:
            with _urlopen(req, max(self.timeout, 120)) as resp, open(
                dest_path, "wb"
            ) as out:
                while True:
                    chunk = resp.read(64 * 1024)
                    if not chunk:
                        break
                    out.write(chunk)
        except (urllib.error.HTTPError, urllib.error.URLError) as exc:
            raise ThreeWSError(f"Download failed: {exc}", code="download_failed") from exc
        return dest_path

    # -- publish into an account --------------------------------------------

    def publish_glb(
        self,
        glb_bytes: bytes,
        *,
        api_key: str,
        name: str,
        description: str = "",
        visibility: str = "private",
        tags=(),
        source_meta: Optional[dict] = None,
    ) -> dict:
        """Save a GLB into the API key owner's three.ws account; return the avatar.

        The returned dict is the ``avatar`` object from ``POST /api/avatars``
        (``id``, ``name``, ``slug``, ``visibility``, ...). Its page lives at
        ``avatar_page_url(avatar)``. Static meshes are auto-rigged server-side
        when they are humanoid, exactly like a dashboard upload.
        """
        api_key = (api_key or "").strip()
        if not api_key:
            raise ThreeWSError(
                "Publishing needs a three.ws API key with the avatars:write scope. "
                "Create one at three.ws/dashboard/api.",
                code="missing_api_key",
            )
        name = (name or "").strip()[:120] or "Untitled model"
        if visibility not in AVATAR_VISIBILITIES:
            raise ThreeWSError(
                f"visibility must be one of: {', '.join(AVATAR_VISIBILITIES)}.",
                code="invalid_visibility",
            )
        if not is_glb(glb_bytes):
            raise ThreeWSError(
                "That file is not a binary glTF 2.0 (.glb). Export the mesh as GLB first.",
                code="invalid_glb",
            )
        if len(glb_bytes) > MAX_AVATAR_BYTES:
            raise ThreeWSError("GLB is larger than the 500 MB account limit.", code="too_large")

        auth = {"authorization": f"Bearer {api_key}"}
        checksum = hashlib.sha256(glb_bytes).hexdigest()
        slug = slugify(name)
        if len(glb_bytes) <= MAX_PROXY_UPLOAD_BYTES:
            query = urllib.parse.urlencode(
                {"slug": slug, "content_type": "model/gltf-binary", "sha256": checksum}
            )
            stored = self._request(
                "POST",
                f"/api/avatars/upload?{query}",
                raw=glb_bytes,
                headers={**auth, "content-type": "model/gltf-binary"},
                timeout=max(self.timeout, 120),
            )
            storage_key = stored.get("storage_key")
            size_bytes = stored.get("size_bytes") or len(glb_bytes)
            checksum = stored.get("checksum_sha256") or checksum
        else:
            presign = self._request(
                "POST",
                "/api/avatars/presign",
                body={
                    "size_bytes": len(glb_bytes),
                    "content_type": "model/gltf-binary",
                    "checksum_sha256": checksum,
                    "slug": slug,
                },
                headers=auth,
            )
            storage_key = presign.get("storage_key")
            upload_url = presign.get("upload_url")
            if not storage_key or not upload_url:
                raise ThreeWSError("Upload presign returned no URL.", code="presign_failed")
            put_headers = presign.get("headers") or {"content-type": "model/gltf-binary"}
            put_req = urllib.request.Request(
                upload_url, data=glb_bytes, headers=put_headers, method="PUT"
            )
            try:
                with _urlopen(put_req, max(self.timeout, 600)) as resp:
                    resp.read()
            except urllib.error.HTTPError as exc:
                raise ThreeWSError(
                    f"GLB upload failed (HTTP {exc.code}).", code="upload_failed", status=exc.code
                ) from exc
            except urllib.error.URLError as exc:
                raise ThreeWSError(f"GLB upload failed: {exc.reason}", code="upload_failed") from exc
            size_bytes = len(glb_bytes)
        if not storage_key:
            raise ThreeWSError("Upload returned no storage key.", code="upload_failed")

        body = {
            "name": name,
            "storage_key": storage_key,
            "size_bytes": size_bytes,
            "content_type": "model/gltf-binary",
            "checksum_sha256": checksum,
            "visibility": visibility,
            "tags": [t.strip()[:40] for t in tags if isinstance(t, str) and t.strip()][:20],
            "source": "upload",
            "source_meta": dict(source_meta or {}),
        }
        if description.strip():
            body["description"] = description.strip()[:2000]
        created = self._request("POST", "/api/avatars", body=body, headers=auth)
        avatar = created.get("avatar")
        if not isinstance(avatar, dict) or not avatar.get("id"):
            raise ThreeWSError("three.ws did not return the saved model.", code="create_failed")
        return avatar

    def avatar_page_url(self, avatar: dict) -> str:
        """Public page for an avatar returned by ``publish_glb``."""
        return f"{self.base_url}/avatars/{urllib.parse.quote(str(avatar.get('id', '')))}"

    # -- high-level convenience ---------------------------------------------

    def generate_text_to_3d(
        self,
        prompt: str,
        *,
        tier: str = "standard",
        backend: Optional[str] = None,
        path: str = "image",
        aspect_ratio: str = "1:1",
        on_progress: Optional[Callable[[str, float], None]] = None,
        should_cancel: Optional[Callable[[], bool]] = None,
        poll_timeout: float = DEFAULT_POLL_TIMEOUT,
    ) -> str:
        job = self.submit_text_to_3d(
            prompt, tier=tier, backend=backend, path=path, aspect_ratio=aspect_ratio
        )
        return self.poll(
            job["job_id"], on_progress=on_progress, should_cancel=should_cancel, timeout=poll_timeout
        )

    def generate_image_to_3d(
        self,
        image_bytes: bytes,
        content_type: str,
        *,
        prompt: str = "",
        tier: str = "standard",
        backend: Optional[str] = None,
        path: str = "image",
        on_progress: Optional[Callable[[str, float], None]] = None,
        should_cancel: Optional[Callable[[], bool]] = None,
        poll_timeout: float = DEFAULT_POLL_TIMEOUT,
    ) -> str:
        public_url = self.upload_image(image_bytes, content_type)
        job = self.submit_image_to_3d(public_url, prompt=prompt, tier=tier, backend=backend, path=path)
        return self.poll(
            job["job_id"], on_progress=on_progress, should_cancel=should_cancel, timeout=poll_timeout
        )


def is_glb(data: bytes) -> bool:
    """True when ``data`` starts with a well-formed binary glTF 2.0 header."""
    if not isinstance(data, (bytes, bytearray)) or len(data) < 12:
        return False
    magic = bytes(data[0:4])
    version = int.from_bytes(data[4:8], "little")
    length = int.from_bytes(data[8:12], "little")
    return magic == b"glTF" and version == 2 and length == len(data)


def slugify(text: str) -> str:
    """Lowercase ``[a-z0-9_-]`` slug (max 64) that ``/api/avatars`` accepts."""
    out = []
    for ch in (text or "").lower():
        if ch.isascii() and (ch.isalnum() or ch in "-_"):
            out.append(ch)
        elif out and out[-1] != "-":
            out.append("-")
    slug = "".join(out).strip("-_")[:64].strip("-_")
    return slug or "model"


def _is_web_url(url) -> bool:
    """An http(s) URL. The server decides what is publicly reachable (it
    SSRF-checks every mesh URL); this only stops local paths early."""
    return isinstance(url, str) and url.startswith(("https://", "http://"))


def _safe_json(payload: bytes) -> dict:
    try:
        parsed = json.loads(payload.decode("utf-8"))
        return parsed if isinstance(parsed, dict) else {"value": parsed}
    except (ValueError, UnicodeDecodeError):
        return {}
