import asyncio
import os
from fastapi import APIRouter
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


@router.get("/paths")
async def get_paths():
    return {
        "models_dir":    str(reg_module.MODELS_DIR),
        "workspace_dir": str(reg_module.WORKSPACE_DIR),
    }


@router.post("/paths")
async def update_paths(body: PathsUpdate):
    # Off the event loop: changing paths waits for any in-progress model load.
    await asyncio.to_thread(
        reg_module.generator_registry.update_paths,
        Path(body.models_dir)    if body.models_dir    else None,
        Path(body.workspace_dir) if body.workspace_dir else None,
    )
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
    if body.api_key:
        os.environ["THREE_WS_API_KEY"] = body.api_key
    else:
        os.environ.pop("THREE_WS_API_KEY", None)
    if body.base_url:
        os.environ["THREE_WS_BASE_URL"] = body.base_url
    return {"ok": True}
