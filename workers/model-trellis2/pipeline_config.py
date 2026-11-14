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
import logging
import os
import shutil
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


def release_staged_weights(aux_root: str | os.PathLike[str]) -> int:
    """Delete the staged aux tensors once the pipeline holds them; return bytes freed.

    Cloud Run's /tmp is an in-memory filesystem, so the DINOv3 and BiRefNet
    safetensors (about 1.7 GB) stay charged against the instance's memory limit
    after both models are loaded. Their configs and BiRefNet's remote code stay:
    they are small, and an imported module may still read beside itself. A
    retried load stages everything again.
    """
    freed = 0
    for path in Path(aux_root).rglob("*.safetensors"):
        try:
            size = path.stat().st_size
            path.unlink()
            freed += size
        except OSError as exc:
            log.warning("could not release staged weight %s: %s", path, exc)
    return freed


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


log = logging.getLogger("trellis2")


class HubFallbackRefused(RuntimeError):
    """A model name reached the Hub loader instead of the staged tree."""


def make_streaming_loader(original, bucket, bucket_name, prefix, *, config_dir, scratch_root):
    """Wrap trellis2.models.from_pretrained so each checkpoint streams from GCS.

    Pipeline.from_pretrained resolves every model as `<config_dir>/<name>`. The
    wrapper fetches `<name>.json` and `<name>.safetensors` from the weights
    prefix, loads them and removes them, so disk and RAM hold one checkpoint.

    Upstream catches ANY exception from that call and retries with the bare
    `<name>`, which `original` treats as a Hub repo id and which raises the
    unhelpful "cannot find the requested files in the local cache". The first
    failure is therefore logged with its traceback, and the bare-name retry is
    refused with an error naming the model, so the real cause is what surfaces.
    """

    def streaming(path: str, **kwargs):
        if not path.startswith(config_dir + "/"):
            raise HubFallbackRefused(
                f"model {path!r} is not under the staged tree; refusing to load it from the "
                "Hugging Face Hub (the earlier error in this log is the real cause)"
            )
        name = path[len(config_dir) + 1:]
        scratch = os.path.join(scratch_root, "stream")
        local = os.path.join(scratch, name)
        os.makedirs(os.path.dirname(local), exist_ok=True)
        try:
            for ext in (".json", ".safetensors"):
                blob = bucket.get_blob(f"{prefix}/{name}{ext}")
                if blob is None:
                    raise FileNotFoundError(f"gs://{bucket_name}/{prefix}/{name}{ext} is not staged")
                blob.download_to_filename(local + ext)
            return original(local, **kwargs)
        except Exception:
            log.exception("loading staged model %s failed", name)
            raise
        finally:
            shutil.rmtree(scratch, ignore_errors=True)

    return streaming
