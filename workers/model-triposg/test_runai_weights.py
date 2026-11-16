"""Unit tests for runai_weights.py: loader selection, tree planning and the
staging prefix. Pure logic, no torch, no CUDA, no weights, no network:

    python3 workers/model-triposg/test_runai_weights.py

(also collectable by pytest).
"""

from __future__ import annotations

import sys

from runai_weights import (
    LOADER_RUNAI,
    LOADER_STAGE,
    NotStreamable,
    choose_loader,
    config_files,
    gcs_split,
    load_with_fallback,
    plan_pipeline,
    select_tree_objects,
)

# The real layout of gs://three-ws-model-weights: the TripoSG image tree and
# the scribble tree share the "triposg" string prefix.
BUCKET_NAMES = [
    "triposg/model_index.json",
    "triposg/transformer/config.json",
    "triposg/transformer/diffusion_pytorch_model.safetensors",
    "triposg/vae/diffusion_pytorch_model.safetensors",
    "triposg-scribble/model_index.json",
    "triposg-scribble/transformer/diffusion_pytorch_model.safetensors",
    "triposg-scribble/image_encoder_dinov2/model.safetensors",
]


def test_gcs_split():
    assert gcs_split("gs://three-ws-model-weights/triposg") == ("three-ws-model-weights", "triposg")
    assert gcs_split("gs://b/a/b/") == ("b", "a/b")
    try:
        gcs_split("/weights/triposg")
    except ValueError:
        pass
    else:
        raise AssertionError("a local path must be refused")


def test_tree_selection_excludes_sibling_tree_sharing_the_prefix():
    """Staging gs://.../triposg must not pull gs://.../triposg-scribble.

    Production log, every cold boot of model-triposg: "triposg weights staged
    ... (90 objects, 11.78 GiB)" for a 7.4 GiB tree, because the listing
    matched the scribble tree too and wrote it under triposg/-scribble/.
    """
    picked = select_tree_objects("triposg", BUCKET_NAMES)
    assert picked == [
        "model_index.json",
        "transformer/config.json",
        "transformer/diffusion_pytorch_model.safetensors",
        "vae/diffusion_pytorch_model.safetensors",
    ], picked
    assert not any("scribble" in p for p in picked)


def test_tree_selection_scribble_tree():
    assert select_tree_objects("triposg-scribble", BUCKET_NAMES) == [
        "model_index.json",
        "transformer/diffusion_pytorch_model.safetensors",
        "image_encoder_dinov2/model.safetensors",
    ]


# model_index.json of gs://three-ws-model-weights/triposg, verbatim.
TRIPOSG_INDEX = {
    "_class_name": "TripoSGPipeline",
    "_diffusers_version": "0.33.1",
    "feature_extractor_dinov2": ["transformers", "BitImageProcessor"],
    "image_encoder_dinov2": ["transformers", "Dinov2Model"],
    "scheduler": ["triposg.schedulers.scheduling_rectified_flow", "RectifiedFlowScheduler"],
    "transformer": ["triposg.models.transformers.triposg_transformer", "TripoSGDiTModel"],
    "vae": ["triposg.models.autoencoders.autoencoder_kl_triposg", "TripoSGVAEModel"],
}
TRIPOSG_TREE = [
    ".cache/huggingface/download/transformer/diffusion_pytorch_model.safetensors.metadata",
    ".gitattributes",
    "README.md",
    "feature_extractor_dinov2/preprocessor_config.json",
    "image_encoder_dinov2/config.json",
    "image_encoder_dinov2/model.safetensors",
    "model_index.json",
    "scheduler/scheduler_config.json",
    "transformer/config.json",
    "transformer/diffusion_pytorch_model.safetensors",
    "vae/config.json",
    "vae/diffusion_pytorch_model.safetensors",
]
GS = "gs://three-ws-model-weights/triposg"


def test_loader_defaults_to_the_streamer():
    assert choose_loader(None, GS, True)[0] == LOADER_RUNAI
    assert choose_loader("", GS, True)[0] == LOADER_RUNAI
    assert choose_loader(" RunAI ", GS, True)[0] == LOADER_RUNAI


def test_loader_stage_override_wins():
    loader, reason = choose_loader("stage", GS, True)
    assert loader == LOADER_STAGE and "WEIGHTS_LOADER=stage" in reason


def test_loader_needs_a_gcs_tree_and_the_package():
    assert choose_loader(None, "", True) == (LOADER_STAGE, "no gs:// weights URI")
    assert choose_loader(None, "/weights/triposg", True)[0] == LOADER_STAGE
    loader, reason = choose_loader(None, GS, False)
    assert loader == LOADER_STAGE and "not importable" in reason


def test_loader_unknown_value_is_reported_not_silently_honoured():
    loader, reason = choose_loader("fast", GS, True)
    assert loader == LOADER_RUNAI and "ignored unknown WEIGHTS_LOADER='fast'" in reason


def test_config_files_skip_weights_and_hf_bookkeeping():
    assert config_files(TRIPOSG_TREE) == [
        ".gitattributes",
        "README.md",
        "feature_extractor_dinov2/preprocessor_config.json",
        "image_encoder_dinov2/config.json",
        "model_index.json",
        "scheduler/scheduler_config.json",
        "transformer/config.json",
        "vae/config.json",
    ]


def test_plan_streams_weighted_components_and_configures_the_rest():
    plan = {c.name: c for c in plan_pipeline(TRIPOSG_INDEX, TRIPOSG_TREE)}
    assert sorted(plan) == [
        "feature_extractor_dinov2", "image_encoder_dinov2", "scheduler", "transformer", "vae",
    ]
    assert plan["transformer"].weight_files == ["transformer/diffusion_pytorch_model.safetensors"]
    assert plan["transformer"].class_name == "TripoSGDiTModel"
    assert plan["image_encoder_dinov2"].weight_files == ["image_encoder_dinov2/model.safetensors"]
    assert plan["scheduler"].weight_files == []
    assert plan["feature_extractor_dinov2"].weight_files == []


def test_plan_refuses_a_pickle_only_component():
    tree = [n for n in TRIPOSG_TREE if not n.startswith("vae/diffusion")] + ["vae/diffusion_pytorch_model.bin"]
    try:
        plan_pipeline(TRIPOSG_INDEX, tree)
    except NotStreamable as exc:
        assert "vae" in str(exc)
    else:
        raise AssertionError("a .bin-only component must send the load to the staged loader")


def test_plan_ignores_unset_optional_components():
    index = dict(TRIPOSG_INDEX, safety_checker=[None, None])
    assert "safety_checker" not in {c.name for c in plan_pipeline(index, TRIPOSG_TREE)}


def test_fallback_runs_the_staged_loader_when_the_streamer_fails():
    calls = []

    def stream():
        calls.append("stream")
        raise OSError("GCS range read reset")

    def stage():
        calls.append("stage")
        return "staged-pipeline"

    result, used, err = load_with_fallback(LOADER_RUNAI, stream, stage, "triposg")
    assert (result, used) == ("staged-pipeline", LOADER_STAGE)
    assert err == "OSError: GCS range read reset"
    assert calls == ["stream", "stage"]


def test_streamer_success_never_touches_the_staged_loader():
    def stage():
        raise AssertionError("staged loader must not run")

    assert load_with_fallback(LOADER_RUNAI, lambda: "streamed", stage, "triposg") == (
        "streamed", LOADER_RUNAI, None,
    )


def test_stage_choice_skips_the_streamer():
    def stream():
        raise AssertionError("streamer must not run")

    assert load_with_fallback(LOADER_STAGE, stream, lambda: "staged", "triposg") == (
        "staged", LOADER_STAGE, None,
    )


def test_staged_loader_failure_propagates():
    def stage():
        raise RuntimeError("bucket missing")

    try:
        load_with_fallback(LOADER_RUNAI, lambda: (_ for _ in ()).throw(OSError("x")), stage, "t")
    except RuntimeError as exc:
        assert "bucket missing" in str(exc)
    else:
        raise AssertionError("with nothing older to fall back to, the error must surface")


def _run():
    failed = 0
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and callable(fn):
            try:
                fn()
                print(f"PASS {name}")
            except Exception as exc:  # noqa: BLE001
                failed += 1
                print(f"FAIL {name}: {exc!r}")
    return failed


if __name__ == "__main__":
    sys.exit(1 if _run() else 0)
