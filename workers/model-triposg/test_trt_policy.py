"""Unit tests for trt_policy.py: the TensorRT serving flag, engine cache keys,
the shape gate and the parity verdict. Pure Python, no torch, no TensorRT, no
CUDA. Runs anywhere:

    python3 workers/model-triposg/test_trt_policy.py

These pin what must never go wrong: an unknown flag value never turns the
engine on, an engine is never loaded on a GPU, TensorRT version or checkpoint
it was not built for, only the exact static denoiser call reaches the engine,
and an engine is published only when every input clears every threshold.
"""

from __future__ import annotations

import sys

from trt_policy import (
    CONDITION_CHANNELS,
    CONDITION_TOKENS,
    DENOISER_BATCH,
    DENOISER_CHANNELS,
    DENOISER_TOKENS,
    PARITY_MAX_CHAMFER,
    PARITY_MIN_PSNR_DB,
    PARITY_MIN_SSIM,
    denoiser_call_supported,
    engine_key,
    engine_uri,
    parity_verdict,
    sm_tag,
    split_gcs_uri,
    trt_mode,
    trt_version_tag,
    weights_fingerprint,
)

HIDDEN = (DENOISER_BATCH, DENOISER_TOKENS, DENOISER_CHANNELS)
TIMESTEP = (DENOISER_BATCH,)
CONDITION = (DENOISER_BATCH, CONDITION_TOKENS, CONDITION_CHANNELS)
PARAMS = [("blocks.0.attn.to_q.weight", "2048x2048:aa"), ("proj_out.weight", "64x2048:bb")]


def _raises(fn, exc=ValueError):
    try:
        fn()
    except exc:
        return True
    return False


def test_flag_defaults_off():
    assert trt_mode({}) == "off"
    assert trt_mode({"TRT_MODE": ""}) == "off"


def test_flag_accepts_on_and_off_case_insensitively():
    assert trt_mode({"TRT_MODE": " ON "}) == "on"
    assert trt_mode({"TRT_MODE": "off"}) == "off"


def test_unknown_flag_values_never_enable_the_engine():
    for value in ("1", "true", "yes", "fp8", "auto", None, 1):
        assert trt_mode({"TRT_MODE": value}) == "off", value


def test_sm_tag_for_the_l4():
    assert sm_tag(8, 9) == "sm89"
    assert sm_tag(9, 0) == "sm90"


def test_trt_version_tag_rejects_garbage():
    assert trt_version_tag("10.13.3.9") == "trt10.13.3.9"
    for bad in ("", "10.x", "latest", None, "10.13/../x"):
        assert _raises(lambda b=bad: trt_version_tag(b)), bad


def test_engine_key_carries_every_compatibility_field():
    key = engine_key("dit", "abc123def456", "10.13.3.9", 8, 9, 2)
    assert key == "triposg-dit-abc123def456-trt10.13.3.9-sm89-b2-fp16.plan"


def test_engines_are_not_shared_across_gpus_versions_or_weights():
    base = engine_key("dit", "abc123def456", "10.13.3.9", 8, 9, 2)
    assert engine_key("dit", "abc123def456", "10.13.3.9", 9, 0, 2) != base
    assert engine_key("dit", "abc123def456", "10.14.1.48", 8, 9, 2) != base
    assert engine_key("dit", "000000000000", "10.13.3.9", 8, 9, 2) != base
    assert engine_key("dit", "abc123def456", "10.13.3.9", 8, 9, 1) != base
    assert engine_key("dit", "abc123def456", "10.13.3.9", 8, 9, 2, "fp8") != base


def test_engine_key_rejects_unknown_precision():
    assert _raises(lambda: engine_key("dit", "abc", "10.13.3.9", 8, 9, 2, "int4"))


def test_fingerprint_is_stable_and_order_independent():
    config = {"num_layers": 21, "width": 2048, "_diffusers_version": "0.31.0"}
    a = weights_fingerprint(config, PARAMS)
    assert a == weights_fingerprint(dict(reversed(list(config.items()))), list(reversed(PARAMS)))
    assert len(a) == 12


def test_fingerprint_ignores_private_config_keys():
    a = weights_fingerprint({"width": 2048, "_name_or_path": "/tmp/a"}, PARAMS)
    b = weights_fingerprint({"width": 2048, "_name_or_path": "/srv/b"}, PARAMS)
    assert a == b


def test_fingerprint_changes_with_weights_or_config():
    base = weights_fingerprint({"width": 2048}, PARAMS)
    retrained = [(PARAMS[0][0], "2048x2048:ff"), PARAMS[1]]
    assert weights_fingerprint({"width": 2048}, retrained) != base
    assert weights_fingerprint({"width": 1024}, PARAMS) != base


def test_fingerprint_needs_parameters():
    assert _raises(lambda: weights_fingerprint({"width": 2048}, []))


def test_gcs_uri_helpers():
    assert engine_uri("gs://b/trt/", "k.plan") == "gs://b/trt/k.plan"
    assert split_gcs_uri("gs://bucket/a/b.plan") == ("bucket", "a/b.plan")
    assert _raises(lambda: split_gcs_uri("https://bucket/a"))
    assert _raises(lambda: split_gcs_uri("gs:///a"))


def test_only_the_exact_static_call_reaches_the_engine():
    assert denoiser_call_supported(HIDDEN, TIMESTEP, CONDITION, "float16", False)


def test_scribble_and_odd_calls_stay_on_pytorch():
    # scribble pipeline: batch 1 (no CFG) and a cross-attention scale
    assert not denoiser_call_supported((1, 2048, 64), (1,), (1, 257, 1024), "float16", False)
    assert not denoiser_call_supported(HIDDEN, TIMESTEP, CONDITION, "float16", True)
    assert not denoiser_call_supported(HIDDEN, TIMESTEP, CONDITION, "float32", False)
    assert not denoiser_call_supported((2, 4096, 64), TIMESTEP, CONDITION, "float16", False)
    assert not denoiser_call_supported(HIDDEN, (), CONDITION, "float16", False)
    assert not denoiser_call_supported(HIDDEN, TIMESTEP, (2, 77, 1024), "float16", False)


def _row(name, chamfer=0.001, psnr=40.0, ssim=0.99):
    return {"input": name, "chamfer": chamfer, "psnr": psnr, "ssim": ssim}


def test_parity_passes_when_every_input_clears_every_threshold():
    verdict = parity_verdict([_row("a"), _row("b", PARITY_MAX_CHAMFER, PARITY_MIN_PSNR_DB, PARITY_MIN_SSIM)])
    assert verdict["passed"] and not verdict["failures"]
    assert verdict["worst"] == {"chamfer": PARITY_MAX_CHAMFER, "psnr": PARITY_MIN_PSNR_DB, "ssim": PARITY_MIN_SSIM}


def test_one_bad_input_fails_the_gate():
    for bad in (_row("x", chamfer=0.02), _row("x", psnr=27.9), _row("x", ssim=0.94)):
        verdict = parity_verdict([_row("a"), bad])
        assert not verdict["passed"]
        assert verdict["failures"][0]["input"] == "x"


def test_missing_metrics_fail_and_do_not_crash():
    verdict = parity_verdict([{"input": "x", "chamfer": None, "psnr": None}])
    assert not verdict["passed"]
    assert len(verdict["failures"][0]["reasons"]) == 3
    assert verdict["worst"] == {"chamfer": None, "psnr": None, "ssim": None}


def test_no_evidence_is_not_parity():
    assert not parity_verdict([])["passed"]


def main() -> int:
    tests = [(name, fn) for name, fn in sorted(globals().items()) if name.startswith("test_") and callable(fn)]
    for name, fn in tests:
        try:
            fn()
        except AssertionError as exc:
            print(f"FAIL  {name}  {exc}")
            return 1
        print(f"ok    {name}")
    print(f"\n{len(tests)} passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
