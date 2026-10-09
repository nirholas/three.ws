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
