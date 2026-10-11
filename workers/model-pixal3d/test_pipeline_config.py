"""Unit tests for the pipeline.json / pipeline_mv.json rewrite: stdlib only.

    cd workers/model-pixal3d && python3 -m pytest test_pipeline_config.py -q

The rewrite is what keeps the non-commercial RMBG-2.0 matte out of the served
pipeline and keeps the DINOv3 conditioner load off the gated Hugging Face Hub
repo, so both are asserted against the real shape of TencentARC/Pixal3D's
published configs (fields the rewrite does not touch are trimmed for brevity).
"""

import json

import pipeline_config

UPSTREAM = {
    "name": "Trellis2ImageTo3DPipeline",
    "args": {
        "models": {
            "sparse_structure_decoder": "ckpts/ss_dec_conv3d_16l8_fp16",
            "sparse_structure_flow_model": "ckpts/ss_flow_img_dit_1_3B_64_bf16",
            "shape_slat_decoder": "ckpts/shape_dec_next_dc_f16c32_fp16",
        },
        "shape_slat_sampler": {"name": "FlowEulerGuidanceIntervalSampler", "params": {"steps": 12}},
        "image_cond_model": {
            "name": "DinoV3FeatureExtractor",
            "args": {"model_name": "facebook/dinov3-vitl16-pretrain-lvd1689m"},
        },
        "rembg_model": {"name": "BiRefNet", "args": {"model_name": "briaai/RMBG-2.0"}},
        "default_pipeline_type": "1536_cascade",
    },
}

UPSTREAM_MV = json.loads(json.dumps(UPSTREAM))
UPSTREAM_MV["name"] = "Pixal3DMVImageTo3DPipeline"
UPSTREAM_MV["args"]["models"]["sparse_structure_flow_model"] = "ckpts/ss_flow_img_dit_1_3B_64_bf16_mv"


def test_matte_is_replaced_by_the_mit_birefnet_checkpoint():
    out = pipeline_config.localize(UPSTREAM, "/aux")
    assert "RMBG" not in json.dumps(out)
    assert out["args"]["rembg_model"] == {"name": "BiRefNet", "args": {"model_name": "/aux/birefnet"}}


def test_conditioner_loads_from_the_staged_copy_not_the_gated_hub_repo():
    out = pipeline_config.localize(UPSTREAM, "/aux")
    assert out["args"]["image_cond_model"]["args"]["model_name"] == "/aux/dinov3"
    assert "facebook/" not in json.dumps(out)


def test_mv_config_localizes_the_same_way_as_the_single_view_config():
    out = pipeline_config.localize(UPSTREAM_MV, "/aux")
    assert out["args"]["rembg_model"]["args"]["model_name"] == "/aux/birefnet"
    assert out["args"]["image_cond_model"]["args"]["model_name"] == "/aux/dinov3"
    # The mv-suffixed flow model name is untouched: it already resolves inside ckpts/.
    assert out["args"]["models"]["sparse_structure_flow_model"] == "ckpts/ss_flow_img_dit_1_3B_64_bf16_mv"


def test_model_paths_are_left_alone_pixal3d_ships_them_already_local():
    out = pipeline_config.localize(UPSTREAM, "/aux")
    assert out["args"]["models"] == UPSTREAM["args"]["models"]


def test_unrelated_fields_pass_through_and_input_is_not_mutated():
    before = json.dumps(UPSTREAM)
    out = pipeline_config.localize(UPSTREAM, "/aux")
    assert json.dumps(UPSTREAM) == before
    assert out["args"]["shape_slat_sampler"] == UPSTREAM["args"]["shape_slat_sampler"]
    assert out["args"]["default_pipeline_type"] == "1536_cascade"


def test_missing_weights_names_every_absent_file():
    present = set(pipeline_config.REQUIRED_PATHS) - {"dinov3/model.safetensors", "birefnet/config.json"}
    assert pipeline_config.missing_weights(present) == ["dinov3/model.safetensors", "birefnet/config.json"]
    assert pipeline_config.missing_weights(pipeline_config.REQUIRED_PATHS) == []


def test_required_paths_cover_every_mv_and_single_view_checkpoint():
    needed = {
        "ckpts/ss_flow_img_dit_1_3B_64_bf16.safetensors",
        "ckpts/ss_flow_img_dit_1_3B_64_bf16_mv.safetensors",
        "ckpts/slat_flow_img2shape_dit_1_3B_512_bf16_mv.safetensors",
        "ckpts/slat_flow_img2shape_dit_1_3B_1024_bf16_mv.safetensors",
        "ckpts/slat_flow_imgshape2tex_dit_1_3B_1024_bf16_mv.safetensors",
        "pipeline.json",
        "pipeline_mv.json",
    }
    assert needed <= set(pipeline_config.REQUIRED_PATHS)


def test_write_local_config_and_link_tree(tmp_path):
    root = tmp_path / "weights"
    (root / "ckpts").mkdir(parents=True)
    (root / "pipeline.json").write_text(json.dumps(UPSTREAM))
    (root / "pipeline_mv.json").write_text(json.dumps(UPSTREAM_MV))
    out_dir = tmp_path / "cfg"
    single = pipeline_config.write_local_config(
        (root / "pipeline.json").read_text(), "/aux", out_dir / "pipeline.json"
    )
    mv = pipeline_config.write_local_config(
        (root / "pipeline_mv.json").read_text(), "/aux", out_dir / "pipeline_mv.json"
    )
    pipeline_config.link_weight_tree(root, out_dir)
    assert json.loads(single.read_text())["args"]["rembg_model"]["args"]["model_name"] == "/aux/birefnet"
    assert json.loads(mv.read_text())["name"] == "Pixal3DMVImageTo3DPipeline"
    assert (out_dir / "ckpts").is_symlink()
    assert not (out_dir / "pipeline.json").is_symlink()
    assert not (out_dir / "pipeline_mv.json").is_symlink()
    # Idempotent: a load retry re-links without raising.
    pipeline_config.link_weight_tree(root, out_dir)
