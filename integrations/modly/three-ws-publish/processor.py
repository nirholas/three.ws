"""Publish to three.ws: a Modly process extension.

Takes the GLB coming out of any Modly mesh node and saves it into the three.ws
account that owns the API key. The mesh passes through unchanged so the node
can sit in the middle of a workflow; the new model's page URL is returned as the
node's text output and written to the run log.

Modly's Python process protocol (electron/main/process-runner.ts):
  stdin:  one JSON line  {input: {filePath?, text?}, params, workspaceDir, tempDir}
  stdout: JSON lines     {type: progress|log|done|error, ...}

Stdlib only, so it runs on Modly's bundled Python with no setup step. The API
contract lives in the vendored ``three_ws_client.py``.

API key resolution order: the node's ``api_key`` field (saved to the user
profile on first use), the ``THREE_WS_API_KEY`` environment variable, then the
saved key file. ``THREE_WS_BASE_URL`` points at another deployment.
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path
from typing import Optional

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from three_ws_client import (  # noqa: E402
    AVATAR_VISIBILITIES,
    DEFAULT_BASE_URL,
    ThreeWSClient,
    ThreeWSError,
)


def key_file() -> Path:
    """Per-user location of the saved API key, outside any workflow file."""
    if os.name == "nt":
        root = Path(os.environ.get("APPDATA") or Path.home() / "AppData" / "Roaming")
    else:
        root = Path(os.environ.get("XDG_CONFIG_HOME") or Path.home() / ".config")
    return root / "three-ws" / "modly-api-key"


def resolve_api_key(param_value: str) -> str:
    typed = (param_value or "").strip()
    if typed:
        path = key_file()
        try:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(typed, encoding="utf-8")
            if os.name != "nt":
                path.chmod(0o600)
        except OSError:
            pass
        return typed
    env = os.environ.get("THREE_WS_API_KEY", "").strip()
    if env:
        return env
    try:
        return key_file().read_text(encoding="utf-8").strip()
    except OSError:
        return ""


def resolve_mesh_path(file_path: Optional[str], workspace_dir: str) -> Path:
    if not file_path:
        raise ThreeWSError(
            "Publish to three.ws needs a mesh. Connect a mesh node to its input.",
            code="no_input",
        )
    path = Path(file_path)
    if not path.is_absolute():
        path = Path(workspace_dir or ".") / path
    if not path.is_file():
        raise ThreeWSError(f"Mesh file not found: {path}", code="no_input")
    if path.suffix.lower() != ".glb":
        raise ThreeWSError(
            f"three.ws stores GLB files and this mesh is {path.suffix or 'unknown'}. "
            "Place this node before any export to another format.",
            code="invalid_glb",
        )
    return path


def parse_tags(raw) -> list:
    if isinstance(raw, list):
        items = raw
    else:
        items = str(raw or "").split(",")
    return [t.strip() for t in items if isinstance(t, str) and t.strip()][:20]


def run(message: dict, emit) -> dict:
    params = message.get("params") or {}
    node_input = message.get("input") or {}
    mesh = resolve_mesh_path(node_input.get("filePath"), message.get("workspaceDir", ""))

    api_key = resolve_api_key(str(params.get("api_key") or ""))
    visibility = params.get("visibility")
    if visibility not in AVATAR_VISIBILITIES:
        visibility = "private"
    name = str(params.get("name") or "").strip() or mesh.stem.replace("_", " ")

    base_url = os.environ.get("THREE_WS_BASE_URL", "").strip() or DEFAULT_BASE_URL
    client = ThreeWSClient(base_url)

    emit({"type": "progress", "percent": 10, "label": "Reading mesh"})
    data = mesh.read_bytes()
    emit({"type": "progress", "percent": 30, "label": "Uploading to three.ws"})
    avatar = client.publish_glb(
        data,
        api_key=api_key,
        name=name,
        visibility=visibility,
        tags=parse_tags(params.get("tags")),
        source_meta={"generator": "modly", "client": "modly-three-ws-publish"},
    )
    url = client.avatar_page_url(avatar)
    emit({"type": "progress", "percent": 100, "label": "Published"})
    emit({"type": "log", "message": f"Published to three.ws: {url}"})
    return {"filePath": str(mesh), "text": url}


def main() -> int:
    def emit(obj: dict) -> None:
        sys.stdout.write(json.dumps(obj) + "\n")
        sys.stdout.flush()

    try:
        message = json.loads(sys.stdin.readline() or "{}")
        result = run(message, emit)
    except ThreeWSError as exc:
        text = exc.message.rstrip()
        if text and text[-1] not in ".!?":
            text += "."
        if exc.status == 401 or exc.code in ("unauthorized", "insufficient_scope"):
            text += (
                " The API key was refused: it may be revoked, expired, or missing the"
                " avatars:write scope. Create a key with that scope at"
                " https://three.ws/dashboard/api and paste it into the node."
            )
        emit({"type": "error", "message": f"three.ws: {text}"})
        return 1
    except Exception as exc:  # the runner shows this message in the node
        emit({"type": "error", "message": f"Publish to three.ws failed: {exc}"})
        return 1
    emit({"type": "done", "result": result})
    return 0


if __name__ == "__main__":
    sys.exit(main())
