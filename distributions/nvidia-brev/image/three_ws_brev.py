"""
Notebook helpers for the three.ws GPU quickstart.

Every function talks to the studio server running in the same container
(http://127.0.0.1:8000), which owns the GPU and the loaded TripoSR model. The
notebook stays light: no second copy of the model, no CUDA context of its own.
"""

from __future__ import annotations

import base64
import html
import json
import time
import urllib.error
import urllib.request
import uuid
from pathlib import Path

STUDIO = "http://127.0.0.1:8000"
MODEL_VIEWER_CDN = "https://cdn.jsdelivr.net/npm/@google/model-viewer@4.3.1/dist/model-viewer.min.js"

STAGE_LABELS = (
    ("background_removal_ms", "Background removal (U2-Net, ONNX Runtime CUDA)"),
    ("model_forward_ms", "TripoSR forward pass (image to triplane)"),
    ("mesh_extraction_ms", "Marching cubes on the GPU (torchmcubes)"),
    ("export_ms", "GLB export (trimesh)"),
    ("total_ms", "Total GPU pipeline"),
)


class StudioError(RuntimeError):
    pass


def _request(method: str, path: str, body: bytes | None = None, headers: dict | None = None, timeout: float = 600):
    req = urllib.request.Request(STUDIO + path, data=body, method=method, headers=headers or {})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as res:
            return res.status, res.read()
    except urllib.error.HTTPError as exc:
        return exc.code, exc.read()


def _json(method: str, path: str, **kw) -> dict:
    status, raw = _request(method, path, **kw)
    data = json.loads(raw or b"{}")
    if status >= 400:
        detail = data.get("detail", data)
        raise StudioError(f"{method} {path} returned {status}: {detail}")
    return data


def wait_until_ready(timeout_s: float = 600) -> dict:
    """Block until the model is resident on the GPU; return the /health body."""
    deadline = time.monotonic() + timeout_s
    last = None
    while time.monotonic() < deadline:
        try:
            status, raw = _request("GET", "/health", timeout=5)
            last = json.loads(raw)
            if status == 200:
                return last
            if last.get("status") == "failed":
                raise StudioError(f"the GPU engine failed to start: {last.get('error')}")
        except (urllib.error.URLError, ConnectionError, TimeoutError):
            last = {"status": "studio server not listening yet"}
        time.sleep(2)
    raise StudioError(f"the GPU engine was not ready after {timeout_s:.0f}s (last status: {last})")


def system() -> dict:
    return _json("GET", "/api/system")


def samples() -> list[str]:
    return [s["name"] for s in _json("GET", "/api/samples")["samples"]]


def _multipart(fields: dict, file_field: str | None = None, file_path: Path | None = None) -> tuple[bytes, str]:
    boundary = uuid.uuid4().hex
    parts = []
    for key, value in fields.items():
        parts.append(
            f'--{boundary}\r\nContent-Disposition: form-data; name="{key}"\r\n\r\n{value}\r\n'.encode()
        )
    if file_field and file_path:
        mime = {".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp"}.get(
            file_path.suffix.lower(), "application/octet-stream"
        )
        parts.append(
            (
                f'--{boundary}\r\nContent-Disposition: form-data; name="{file_field}"; '
                f'filename="{file_path.name}"\r\nContent-Type: {mime}\r\n\r\n'
            ).encode()
            + file_path.read_bytes()
            + b"\r\n"
        )
    parts.append(f"--{boundary}--\r\n".encode())
    return b"".join(parts), f"multipart/form-data; boundary={boundary}"


def generate(sample: str | None = None, image_path: str | None = None, resolution: int = 256) -> dict:
    """Generate a mesh from a bundled sample or a local image file."""
    fields = {"resolution": str(resolution)}
    if image_path:
        body, ctype = _multipart(fields, "image", Path(image_path))
    elif sample:
        body, ctype = _multipart({**fields, "sample": sample})
    else:
        raise ValueError("pass sample=<name> or image_path=<file>")
    return _json("POST", "/api/generate", body=body, headers={"Content-Type": ctype})


def fetch_glb(record: dict) -> bytes:
    status, raw = _request("GET", record["glb_url"])
    if status != 200:
        raise StudioError(f"could not fetch {record['glb_url']}: HTTP {status}")
    return raw


def viewer_html(glb: bytes, height: int = 480) -> str:
    """A self-contained, interactive viewer for one GLB, safe to display in JupyterLab.

    The GLB rides inside the page as a data URI, so the viewer works through any
    proxy or tunnel in front of JupyterLab (Brev secure links included): the
    browser never has to reach the container's port 8000 directly.
    """
    data_uri = "data:model/gltf-binary;base64," + base64.b64encode(glb).decode()
    page = f"""<!doctype html><html><head><meta charset="utf-8">
<script type="module" src="{MODEL_VIEWER_CDN}"></script>
<style>html,body{{margin:0;height:100%;background:#101418}}model-viewer{{width:100%;height:100%}}</style>
</head><body><model-viewer src="{data_uri}" camera-controls auto-rotate shadow-intensity="1"
environment-image="neutral" alt="Generated 3D model"></model-viewer></body></html>"""
    return (
        f'<iframe srcdoc="{html.escape(page, quote=True)}" style="width:100%;height:{height}px;'
        f'border:0;border-radius:8px" title="three.ws GLB viewer"></iframe>'
    )


def timings_table(record: dict) -> str:
    rows = []
    for key, label in STAGE_LABELS:
        if key in record["timings"]:
            weight = "font-weight:600" if key == "total_ms" else ""
            rows.append(
                f'<tr style="{weight}"><td style="padding:4px 16px 4px 0">{label}</td>'
                f'<td style="text-align:right">{record["timings"][key]:.0f} ms</td></tr>'
            )
    mesh = record["mesh"]
    rows.append(
        f'<tr><td style="padding:4px 16px 4px 0;color:#888">Mesh</td><td style="text-align:right;color:#888">'
        f'{mesh["vertices"]:,} vertices, {mesh["bytes"] / 1024:.0f} KB, peak {record["peak_gpu_memory_mb"]} MB GPU memory'
        f"</td></tr>"
    )
    return f"<table>{''.join(rows)}</table>"


def benchmark_table(summary: dict) -> str:
    rows = ['<tr><th style="text-align:left;padding-right:16px">Stage</th><th>median</th><th>min</th><th>max</th></tr>']
    for key, label in STAGE_LABELS:
        if key in summary:
            s = summary[key]
            rows.append(
                f'<tr><td style="padding:4px 16px 4px 0">{label}</td><td style="text-align:right">{s["median"]:.0f} ms</td>'
                f'<td style="text-align:right;padding-left:12px">{s["min"]:.0f}</td>'
                f'<td style="text-align:right;padding-left:12px">{s["max"]:.0f}</td></tr>'
            )
    return f"<table>{''.join(rows)}</table>"


def node_self_test() -> dict:
    """Run the three.ws inference node's proof workload on the GPU."""
    return _json("POST", "/api/node/self-test")
