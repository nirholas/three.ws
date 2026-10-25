import asyncio
import os
from urllib.parse import urlparse

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from pathlib import Path
from typing import Optional

import services.generator_registry as reg_module

router = APIRouter(prefix="/settings", tags=["settings"])


class PathsUpdate(BaseModel):
    models_dir:    Optional[str] = None
    workspace_dir: Optional[str] = None


class TokenUpdate(BaseModel):
    token: str


def _checked_dir(value: Optional[str], field: str) -> Optional[Path]:
    """An absolute directory that is not a filesystem root; the workspace is served over HTTP."""
    if not value:
        return None
    path = Path(value)
    if not path.is_absolute() or path.parent == path:
        raise HTTPException(status_code=400, detail=f"{field} must be an absolute folder path below the filesystem root")
    return path


def _checked_base_url(value: str) -> str:
    """The account origin receives the API key, so it must be https (http only for loopback dev)."""
    parsed = urlparse(value)
    loopback = parsed.hostname in ("localhost", "127.0.0.1", "::1")
    if parsed.scheme == "https" or (parsed.scheme == "http" and loopback):
        if parsed.hostname and not parsed.username and not parsed.password:
            return value
    raise HTTPException(status_code=400, detail="base_url must be an https origin (http is allowed only for localhost)")


@router.get("/paths")
async def get_paths():
    return {
        "models_dir":    str(reg_module.MODELS_DIR),
        "workspace_dir": str(reg_module.WORKSPACE_DIR),
    }


@router.post("/paths")
async def update_paths(body: PathsUpdate):
    models_dir = _checked_dir(body.models_dir, "models_dir")
    workspace_dir = _checked_dir(body.workspace_dir, "workspace_dir")
    # Off the event loop: changing paths waits for any in-progress model load.
    await asyncio.to_thread(reg_module.generator_registry.update_paths, models_dir, workspace_dir)
    return {
        "models_dir":    str(reg_module.MODELS_DIR),
        "workspace_dir": str(reg_module.WORKSPACE_DIR),
    }


@router.post("/hf-token")
async def update_hf_token(body: TokenUpdate):
    """
    Update the HuggingFace token in this process's environment so that
    extension subprocesses spawned after this call inherit the new token.
    """
    if body.token:
        os.environ["HUGGING_FACE_HUB_TOKEN"] = body.token
        os.environ["HF_TOKEN"]               = body.token
    else:
        os.environ.pop("HUGGING_FACE_HUB_TOKEN", None)
        os.environ.pop("HF_TOKEN", None)
    return {"ok": True}


class ThreeWsAccountUpdate(BaseModel):
    api_key:  str
    base_url: Optional[str] = None


@router.post("/three-ws")
async def update_three_ws_account(body: ThreeWsAccountUpdate):
    """
    Point the bundled three.ws extensions at the account signed in through
    Settings → three.ws. The cloud generator runs inside this process and the
    publish node in a subprocess spawned after this call; both read the env.
    """
    base_url = _checked_base_url(body.base_url) if body.base_url else None
    if body.api_key:
        os.environ["THREE_WS_API_KEY"] = body.api_key
    else:
        os.environ.pop("THREE_WS_API_KEY", None)
    if base_url:
        os.environ["THREE_WS_BASE_URL"] = base_url
    return {"ok": True}
