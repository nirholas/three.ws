"""Rewrite Pixal3D's pipeline.json / pipeline_mv.json so every weight loads locally.

Pure stdlib, no torch, so it unit tests anywhere (test_pipeline_config.py).

Upstream's two configs (fetched from TencentARC/Pixal3D on Hugging Face) each
reach out to two places we do not want at serve time, and one of them is a
licence problem:

  * `image_cond_model` names `facebook/dinov3-vitl16-pretrain-lvd1689m`, which
    is gated on its original repo and would block a cold start on an
    interactive Hub license click. Pixal3D's own `inference.py` additionally
    rebuilds the four per-stage conditioners it actually uses from a hardcoded
    Hub id rather than this key, so both the declared key and the hardcoded
    id are pointed at the same local, pre-staged copy of the ungated mirror
    `camenduru/dinov3-vitl16-pretrain-lvd1689m` that workers/model-trellis2
    already ships (same DINOv3 weights, same license terms).
  * `rembg_model` names briaai/RMBG-2.0, which is licensed CC BY-NC and cannot
    ship in a commercial product. It is replaced with ZhengPeng7/BiRefNet
    (MIT), which the same BiRefNet wrapper class loads unchanged.
"""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Iterable

# Sub-trees of the staged weights, written by stage_weights.sh.
DINOV3_DIR = "dinov3"
BIREFNET_DIR = "birefnet"

# ckpts/ filenames exactly as published on TencentARC/Pixal3D. The *_mv
# variants are the multi-view flow models; the two decoders and the
# sparse-structure decoder are shared between the single- and multi-view
# pipelines (pipeline.json and pipeline_mv.json both name the unsuffixed path).
CKPT_FILES = (
    "ss_dec_conv3d_16l8_fp16",
    "ss_flow_img_dit_1_3B_64_bf16",
    "ss_flow_img_dit_1_3B_64_bf16_mv",
    "shape_dec_next_dc_f16c32_fp16",
    "slat_flow_img2shape_dit_1_3B_512_bf16",
    "slat_flow_img2shape_dit_1_3B_512_bf16_mv",
    "slat_flow_img2shape_dit_1_3B_1024_bf16",
    "slat_flow_img2shape_dit_1_3B_1024_bf16_mv",
    "tex_dec_next_dc_f16c32_fp16",
    "slat_flow_imgshape2tex_dit_1_3B_1024_bf16",
    "slat_flow_imgshape2tex_dit_1_3B_1024_bf16_mv",
)

REQUIRED_PATHS = (
    "pipeline.json",
    "pipeline_mv.json",
    *(f"ckpts/{name}.safetensors" for name in CKPT_FILES),
    *(f"ckpts/{name}.json" for name in CKPT_FILES),
    f"{DINOV3_DIR}/model.safetensors",
    f"{DINOV3_DIR}/config.json",
    f"{BIREFNET_DIR}/model.safetensors",
    f"{BIREFNET_DIR}/config.json",
)


def missing_weights(present: Iterable[str]) -> list[str]:
    """Every file either pipeline needs that is not in `present` (relative names)."""
    have = set(present)
    return [rel for rel in REQUIRED_PATHS if rel not in have]


def localize(config: dict, aux_root: str | os.PathLike[str]) -> dict:
    """Return a copy of `config` that loads the conditioner and matte locally.

    `aux_root` holds the dinov3/ and birefnet/ directories (shared by the
    single- and multi-view configs), small enough to keep on local disk for
    the instance's life.
    """
    base = str(Path(aux_root))
    out = json.loads(json.dumps(config))
    args = out["args"]
    args["image_cond_model"]["args"]["model_name"] = f"{base}/{DINOV3_DIR}"
    args["rembg_model"] = {
        "name": "BiRefNet",
        "args": {"model_name": f"{base}/{BIREFNET_DIR}"},
    }
    return out


def write_local_config(
    pipeline_json: str, aux_root: str | os.PathLike[str], out_path: str | os.PathLike[str]
) -> Path:
    """Write a localized copy of a pipeline json string to `out_path`."""
    target = Path(out_path)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(localize(json.loads(pipeline_json), aux_root), indent=2))
    return target


def link_weight_tree(root: str | os.PathLike[str], out_dir: str | os.PathLike[str]) -> None:
    """Symlink each top-level entry of a local weight tree into `out_dir`.

    The pipeline resolves every model as `<config dir>/<relative name>`, so a
    config dir holding the localized pipeline.json(s) plus these links loads
    straight from a mounted or pre-staged tree.
    """
    source = Path(root)
    target = Path(out_dir)
    target.mkdir(parents=True, exist_ok=True)
    for entry in source.iterdir():
        if entry.name in ("pipeline.json", "pipeline_mv.json"):
            continue
        link = target / entry.name
        if not link.exists() and not link.is_symlink():
            link.symlink_to(entry.resolve())
