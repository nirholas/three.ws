"""Unit tests for the pipeline.json rewrite: stdlib only, runs anywhere.

    cd workers/model-trellis2 && python3 -m pytest test_pipeline_config.py -q

The rewrite is what keeps the non-commercial RMBG-2.0 matte out of the served
pipeline and keeps the model load off the Hugging Face Hub, so both are asserted.
"""

import json

import pipeline_config

# The shape of microsoft/TRELLIS.2-4B's pipeline.json, reduced to the fields the
# rewrite touches plus the sampler block that must pass through unchanged.
UPSTREAM = {
    "name": "Trellis2ImageTo3DPipeline",
    "args": {
        "models": {
            "sparse_structure_decoder": "microsoft/TRELLIS-image-large/ckpts/ss_dec_conv3d_16l8_fp16",
            "sparse_structure_flow_model": "ckpts/ss_flow_img_dit_1_3B_64_bf16",
            "shape_slat_decoder": "ckpts/shape_dec_next_dc_f16c32_fp16",
        },
        "shape_slat_sampler": {"name": "FlowEulerGuidanceIntervalSampler", "params": {"steps": 12}},
        "image_cond_model": {
            "name": "DinoV3FeatureExtractor",
            "args": {"model_name": "facebook/dinov3-vitl16-pretrain-lvd1689m"},
        },
        "rembg_model": {"name": "BiRefNet", "args": {"model_name": "briaai/RMBG-2.0"}},
        "default_pipeline_type": "1024_cascade",
    },
}


def test_matte_is_replaced_by_the_mit_birefnet_checkpoint():
    out = pipeline_config.localize(UPSTREAM, "/aux")
    assert "RMBG" not in json.dumps(out)
    assert out["args"]["rembg_model"] == {"name": "BiRefNet", "args": {"model_name": "/aux/birefnet"}}


def test_conditioner_loads_from_the_staged_copy_not_the_hub():
    out = pipeline_config.localize(UPSTREAM, "/aux")
    assert out["args"]["image_cond_model"]["args"]["model_name"] == "/aux/dinov3"
    assert "facebook/" not in json.dumps(out)


def test_ss_decoder_points_inside_the_staged_tree():
    out = pipeline_config.localize(UPSTREAM, "/aux")
    assert out["args"]["models"]["sparse_structure_decoder"] == "ss_dec/ckpts/ss_dec_conv3d_16l8_fp16"


def test_unrelated_fields_pass_through_and_input_is_not_mutated():
    before = json.dumps(UPSTREAM)
    out = pipeline_config.localize(UPSTREAM, "/aux")
    assert json.dumps(UPSTREAM) == before
    assert out["args"]["shape_slat_sampler"] == UPSTREAM["args"]["shape_slat_sampler"]
    assert out["args"]["default_pipeline_type"] == "1024_cascade"
    assert out["args"]["models"]["shape_slat_decoder"] == "ckpts/shape_dec_next_dc_f16c32_fp16"


def test_missing_weights_names_every_absent_file():
    present = set(pipeline_config.REQUIRED_PATHS) - {"dinov3/model.safetensors", "birefnet/config.json"}
    assert pipeline_config.missing_weights(present) == ["dinov3/model.safetensors", "birefnet/config.json"]
    assert pipeline_config.missing_weights(pipeline_config.REQUIRED_PATHS) == []


def test_required_paths_cover_every_checkpoint_the_resolutions_use():
    needed = {
        "ckpts/slat_flow_img2shape_dit_1_3B_512_bf16.safetensors",
        "ckpts/slat_flow_img2shape_dit_1_3B_1024_bf16.safetensors",
        "ckpts/slat_flow_imgshape2tex_dit_1_3B_512_bf16.safetensors",
        "ckpts/slat_flow_imgshape2tex_dit_1_3B_1024_bf16.safetensors",
    }
    assert needed <= set(pipeline_config.REQUIRED_PATHS)


def test_write_local_config_and_link_tree(tmp_path):
    root = tmp_path / "weights"
    (root / "ckpts").mkdir(parents=True)
    (root / "pipeline.json").write_text(json.dumps(UPSTREAM))
    out_dir = tmp_path / "cfg"
    path = pipeline_config.write_local_config((root / "pipeline.json").read_text(), "/aux", out_dir)
    pipeline_config.link_weight_tree(root, out_dir)
    written = json.loads(path.read_text())
    assert written["args"]["rembg_model"]["args"]["model_name"] == "/aux/birefnet"
    assert (out_dir / "ckpts").is_symlink()
    assert not (out_dir / "pipeline.json").is_symlink()
    # Idempotent: a load retry re-links without raising.
    pipeline_config.link_weight_tree(root, out_dir)


# --- streaming loader: the Hub fallback must never mask the real failure -----
#
# trellis2's Pipeline.from_pretrained wraps `models.from_pretrained(<dir>/<name>)`
# in try/except and, on ANY exception, retries `models.from_pretrained(<name>)`,
# which treats the bare name as a Hub repo and raises huggingface_hub's "cannot
# find the requested files in the local cache". That second error is all the
# worker used to report, so the real first failure (a missing extension import, a
# bad checkpoint) was invisible. The streaming loader must log the first failure
# and must refuse the Hub fallback with an error that names it.

import logging

import pytest


class _Blob:
    def __init__(self, name):
        self.name = name

    def download_to_filename(self, dest):
        open(dest, "w").write(self.name)


class _Bucket:
    def __init__(self, present):
        self.present = present

    def get_blob(self, name):
        return _Blob(name) if name in self.present else None


def _loader(original, tmp_path, present=()):
    return pipeline_config.make_streaming_loader(
        original,
        _Bucket(set(present)),
        "bkt",
        "pfx",
        config_dir=str(tmp_path / "config"),
        scratch_root=str(tmp_path),
    )


def test_hub_fallback_is_refused_with_an_error_that_names_the_model(tmp_path):
    def original(path, **kw):
        raise AssertionError("the Hub path must not be reached")

    streaming = _loader(original, tmp_path)
    with pytest.raises(pipeline_config.HubFallbackRefused) as err:
        streaming("ckpts/shape_dec_next_dc_f16c32_fp16")
    assert "ckpts/shape_dec_next_dc_f16c32_fp16" in str(err.value)


def test_first_failure_is_logged_with_the_underlying_exception(tmp_path, caplog):
    def original(path, **kw):
        raise ImportError("No module named 'flex_gemm'")

    names = ("pfx/ckpts/m.json", "pfx/ckpts/m.safetensors")
    streaming = _loader(original, tmp_path, names)
    with caplog.at_level(logging.ERROR, logger="trellis2"):
        with pytest.raises(ImportError):
            streaming(str(tmp_path / "config") + "/ckpts/m")
    assert "flex_gemm" in caplog.text
    assert "ckpts/m" in caplog.text


def test_staged_model_streams_through_and_cleans_scratch(tmp_path):
    seen = {}

    def original(path, **kw):
        seen["json"] = open(path + ".json").read()
        return "model"

    names = ("pfx/ckpts/m.json", "pfx/ckpts/m.safetensors")
    streaming = _loader(original, tmp_path, names)
    assert streaming(str(tmp_path / "config") + "/ckpts/m") == "model"
    assert seen["json"] == "pfx/ckpts/m.json"
    assert not (tmp_path / "stream").exists()


def test_release_staged_weights_frees_loaded_tensors_but_keeps_code_and_config(tmp_path):
    # Cloud Run's /tmp is RAM: the staged DINOv3 and BiRefNet tensors stay
    # charged against the 32 GiB ceiling after both models are already loaded.
    aux = tmp_path / "aux"
    (aux / "dinov3").mkdir(parents=True)
    (aux / "birefnet").mkdir(parents=True)
    (aux / "dinov3" / "model.safetensors").write_bytes(b"x" * 1000)
    (aux / "dinov3" / "config.json").write_text("{}")
    (aux / "birefnet" / "model.safetensors").write_bytes(b"y" * 500)
    (aux / "birefnet" / "birefnet.py").write_text("# remote code")

    freed = pipeline_config.release_staged_weights(aux)

    assert freed == 1500
    assert not (aux / "dinov3" / "model.safetensors").exists()
    assert not (aux / "birefnet" / "model.safetensors").exists()
    assert (aux / "dinov3" / "config.json").exists()
    assert (aux / "birefnet" / "birefnet.py").exists()


def test_release_staged_weights_on_a_missing_tree_frees_nothing(tmp_path):
    assert pipeline_config.release_staged_weights(tmp_path / "absent") == 0
