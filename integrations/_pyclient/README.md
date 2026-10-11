# three.ws Forge Python client (canonical copy)

`three_ws_client.py` is the single source of truth for the Python wrapper around
the public Forge generation contract (`api/forge.js` + `api/forge-upload.js`).
It is stdlib-only (`urllib`), so it runs unmodified inside Blender's bundled
Python and inside ComfyUI without a `pip install` into either host.

The [Blender add-on](../blender/), the [ComfyUI nodes](../comfyui/) and the two
[Modly extensions](../modly/) each vendor a byte-identical copy of this file.
Edit the canonical copy here, then re-copy it into every plugin;
[test_no_drift.py](./test_no_drift.py) fails the suite if any vendored copy
diverges.

## Contract wrapped

| Call | Endpoint |
|---|---|
| Text to 3D | `POST /api/forge` with `{prompt, aspect_ratio?, path?, tier?, backend?}` |
| Image to 3D | `POST /api/forge` with `{image_urls[], prompt?, path?, tier?, backend?}` |
| Poll a job | `GET /api/forge?job=<id>` returning `{status, glb_url?, error?, backend?, ...}` |
| Tier/backend/cost matrix | `GET /api/forge?catalog` |
| Image upload presign | `POST /api/forge-upload` with `{content_type, size_bytes, checksum_sha256?}` |
| GLB upload presign | `POST /api/scene-glb-upload` with `{content_type, size_bytes}` (200 MB cap) |
| Auto-rig | `POST /api/forge?action=rig` with `{glb_url}`, polled on `GET /api/forge?job=<id>` |
| Remesh | `POST /api/forge-remesh` with `{mesh_url, remesh_mode, operation, target_faces, texture_size, output_format}`, polled on `GET /api/forge-remesh?job=<id>` |
| Publish to an account | `POST /api/avatars/upload` or `/api/avatars/presign`, then `POST /api/avatars`, with a bearer API key carrying `avatars:write` |

Generation is auth-free (IP rate-limited, scoped to an anonymous client handle
sent as `x-forge-client`). The geometry path (Meshy/Tripo) is BYOK: pass
`provider_key` and it travels as the `x-forge-provider-key` header.

## Public API

- `ThreeWSClient(base_url="https://three.ws", *, provider_key=None, client_handle=None, timeout=30.0)`
  - `generate_text_to_3d(prompt, *, tier, backend, path, aspect_ratio, on_progress, should_cancel, poll_timeout) -> glb_url`
  - `generate_image_to_3d(image_bytes, content_type, *, prompt, tier, backend, path, ...) -> glb_url`
  - `rig(glb_url, *, on_progress, should_cancel, poll_timeout) -> rigged_glb_url`
  - `remesh(mesh_url, *, remesh_mode, operation, target_faces, texture_size, on_progress, should_cancel, poll_timeout) -> result_url`
  - `upload_glb(glb_bytes) -> public_url`: puts a local GLB where rig and remesh can read it
  - `publish_glb(glb_bytes, *, api_key, name, description, visibility, tags, source_meta) -> avatar`, and `avatar_page_url(avatar)`
  - Lower-level steps: `submit_text_to_3d(...)`, `submit_image_to_3d(...)`, `submit_rig(glb_url)`, `submit_remesh(mesh_url, ...)`, `upload_image(image_bytes, content_type) -> public_url`, `poll(job_id, ...) -> glb_url`, `download(url, dest_path)`, `get_catalog()`
  - Polling retries a 502, 503 or 504 from the poll endpoint instead of failing the job, since a long GPU job outlives the odd gateway hiccup.
- `ThreeWSError`: every failure path raises this with a user-safe `message`, a machine `code` (`needs_key`, `unconfigured`, `timeout`, `cancelled`, `failed`, ...), and the HTTP `status` when applicable.
- `content_type_for_path(path)`: maps `.png` / `.jpg` / `.jpeg` / `.webp` to the content type Forge accepts, or raises.
- Constants mirroring the server: `TIERS`, `PATHS`, `BACKENDS`, `ASPECT_RATIOS` (from `api/_lib/forge-tiers.js`), and `REMESH_MODES`, `REMESH_OPERATIONS`, `REMESH_TEXTURE_SIZES`, `MAX_SCENE_GLB_BYTES`.
- HTTPS uses `certifi`'s CA bundle when it is importable, which fixes certificate errors in hosts whose bundled Python has no system CA store; otherwise the platform default is used.

## Example

```python
from three_ws_client import ThreeWSClient, ThreeWSError

client = ThreeWSClient()
try:
    glb_url = client.generate_text_to_3d(
        "a weathered bronze astrolabe",
        tier="standard",
        on_progress=lambda status, elapsed: print(f"{status} ({elapsed:.0f}s)"),
    )
    client.download(glb_url, "astrolabe.glb")
except ThreeWSError as exc:
    print(f"generation failed [{exc.code}]: {exc.message}")
```

## Tests

```bash
python -m pytest integrations/_pyclient
# or directly:
python integrations/_pyclient/test_three_ws_client.py
python integrations/_pyclient/test_no_drift.py
```

- [test_three_ws_client.py](./test_three_ws_client.py) runs a real in-process HTTP server that mimics the Forge contract (no live network) and exercises submit, upload, poll, download, and every error path end to end.
- [test_no_drift.py](./test_no_drift.py) byte-compares the vendored copies in `integrations/blender/three_ws/`, `integrations/comfyui/three_ws_nodes/`, `integrations/modly/three-ws/` and `integrations/modly/three-ws-publish/` against this canonical file and prints the exact `cp` command to fix a drift.

## Editing workflow

1. Change `three_ws_client.py` here.
2. Copy it over every vendored path:

   ```bash
   for d in blender/three_ws comfyui/three_ws_nodes modly/three-ws modly/three-ws-publish; do
     cp integrations/_pyclient/three_ws_client.py "integrations/$d/three_ws_client.py"
   done
   ```
3. Run the tests above.
