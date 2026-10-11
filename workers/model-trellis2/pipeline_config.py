"""Rewrite TRELLIS.2's pipeline.json so every weight loads from the staged tree.

Pure stdlib, no torch, so it unit tests anywhere (test_pipeline_config.py).

Upstream's pipeline.json reaches out to three places we do not want at serve
time, and one of them is a licence problem:

  * `sparse_structure_decoder` names a repo path in microsoft/TRELLIS-image-large
    (MIT). We stage that one checkpoint inside the main tree, so the name is
    rewritten to the staged copy.
  * `image_cond_model` names the DINOv3 conditioner by Hub id. It is loaded from
    the staged copy instead, so the load never touches the Hub. (DINOv3 is
    gated on its original repo; the staged bytes come from an ungated mirror
    and ship with the DINOv3 License text, see README.md.)
  * `rembg_model` names briaai/RMBG-2.0, which is licensed CC BY-NC and cannot
    ship in a commercial product. It is replaced with ZhengPeng7/BiRefNet (MIT),
    which the same BiRefNet wrapper class loads unchanged.
"""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Iterable

# Sub-trees of the staged weights, written by stage_weights.sh.
SS_DECODER_DIR = "ss_dec/ckpts/ss_dec_conv3d_16l8_fp16"
DINOV3_DIR = "dinov3"
BIREFNET_DIR = "birefnet"

REQUIRED_PATHS = (
    "pipeline.json",
    "ckpts/ss_flow_img_dit_1_3B_64_bf16.safetensors",
    "ckpts/shape_dec_next_dc_f16c32_fp16.safetensors",
    "ckpts/slat_flow_img2shape_dit_1_3B_512_bf16.safetensors",
    "ckpts/slat_flow_img2shape_dit_1_3B_1024_bf16.safetensors",
    "ckpts/tex_dec_next_dc_f16c32_fp16.safetensors",
    "ckpts/slat_flow_imgshape2tex_dit_1_3B_512_bf16.safetensors",
    "ckpts/slat_flow_imgshape2tex_dit_1_3B_1024_bf16.safetensors",
    SS_DECODER_DIR + ".safetensors",
    DINOV3_DIR + "/model.safetensors",
    DINOV3_DIR + "/config.json",
    BIREFNET_DIR + "/model.safetensors",
    BIREFNET_DIR + "/config.json",
)


def missing_weights(present: Iterable[str]) -> list[str]:
    """Every file the pipeline needs that is not in `present` (relative names)."""
    have = set(present)
    return [rel for rel in REQUIRED_PATHS if rel not in have]


def localize(config: dict, aux_root: str | os.PathLike[str]) -> dict:
    """Return a copy of `config` that loads the conditioner and matte locally.

    `aux_root` holds the dinov3/ and birefnet/ directories, which are small
    enough (about 1.7 GB together) to keep on local disk for the instance's life.
    """
    base = str(Path(aux_root))
    out = json.loads(json.dumps(config))
    args = out["args"]
    args["models"]["sparse_structure_decoder"] = SS_DECODER_DIR
    args["image_cond_model"]["args"]["model_name"] = f"{base}/{DINOV3_DIR}"
    args["rembg_model"] = {
        "name": "BiRefNet",
        "args": {"model_name": f"{base}/{BIREFNET_DIR}"},
    }
    return out


def write_local_config(
    pipeline_json: str, aux_root: str | os.PathLike[str], out_dir: str | os.PathLike[str]
) -> Path:
    """Write the localized pipeline.json into `out_dir` and return its path."""
    target = Path(out_dir)
    target.mkdir(parents=True, exist_ok=True)
    path = target / "pipeline.json"
    path.write_text(json.dumps(localize(json.loads(pipeline_json), aux_root), indent=2))
    return path


def link_weight_tree(root: str | os.PathLike[str], out_dir: str | os.PathLike[str]) -> None:
    """Symlink each top-level entry of a local weight tree into `out_dir`.

    The pipeline resolves every model as `<config dir>/<relative name>`, so a
    config dir holding the localized pipeline.json plus these links loads
    straight from a mounted or pre-staged tree.
    """
    source = Path(root)
    target = Path(out_dir)
    target.mkdir(parents=True, exist_ok=True)
    for entry in source.iterdir():
        if entry.name == "pipeline.json":
            continue
        link = target / entry.name
        if not link.exists() and not link.is_symlink():
            link.symlink_to(entry.resolve())
