"""Unit tests for request_policy.py (pure: no GPU, no network, no Modly)."""

import random

import httpx
import pytest

from request_policy import (
    HUNYUAN_MINI_TURBO,
    SEED_MAX,
    TRIPOSG,
    PolicyError,
    build_generation_params,
    call_with_retry,
    interpret_job,
    is_transient_fetch_error,
    normalize_tier,
    parse_model_list,
    parse_postprocess,
    readiness_problems,
    resolve_model,
    resolve_seed,
    retry_delays,
    summarize_traceback,
    workspace_relative,
)

ENABLED = [TRIPOSG, HUNYUAN_MINI_TURBO]


# ── Models ────────────────────────────────────────────────────────────────────

def test_parse_model_list_accepts_aliases_and_dedupes():
    assert parse_model_list("triposg, hunyuan3d-mini-turbo/generate,tripo") == ENABLED


@pytest.mark.parametrize("raw", ["", " , ", "sf3d/generate"])
def test_parse_model_list_refuses_empty_or_unknown(raw):
    with pytest.raises(PolicyError):
        parse_model_list(raw)


def test_resolve_model_defaults_and_aliases():
    assert resolve_model(None, ENABLED, TRIPOSG) == TRIPOSG
    assert resolve_model("  ", ENABLED, TRIPOSG) == TRIPOSG
    assert resolve_model("Hunyuan", ENABLED, TRIPOSG) == HUNYUAN_MINI_TURBO
    assert resolve_model(TRIPOSG, ENABLED, TRIPOSG) == TRIPOSG


def test_resolve_model_refuses_a_model_this_deployment_does_not_serve():
    with pytest.raises(PolicyError, match="not served"):
        resolve_model("hunyuan", [TRIPOSG], TRIPOSG)
    with pytest.raises(PolicyError):
        resolve_model("../../etc/passwd", ENABLED, TRIPOSG)


def test_normalize_tier():
    assert normalize_tier("HIGH") == "high"
    assert normalize_tier("fast") == "draft"
    assert normalize_tier("nonsense") is None
    assert normalize_tier(None) is None


# ── Generation params ─────────────────────────────────────────────────────────

def test_defaults_match_the_extension_schema_and_seed_is_concrete():
    params, dropped = build_generation_params(TRIPOSG, None, None, None, random.Random(1))
    assert params["num_inference_steps"] == 50
    assert params["guidance_scale"] == 7.0
    assert params["use_flash_decoder"] == "DiffDMC"
    assert 0 <= params["seed"] <= SEED_MAX
    assert dropped == []


def test_tier_preset_then_caller_override():
    params, _ = build_generation_params(TRIPOSG, "draft", None, 7)
    assert params["num_inference_steps"] == 20
    params, _ = build_generation_params(TRIPOSG, "draft", {"num_inference_steps": 40}, 7)
    assert params["num_inference_steps"] == 40
    assert params["seed"] == 7


def test_caller_values_are_clamped_and_unknown_keys_dropped():
    params, dropped = build_generation_params(
        TRIPOSG,
        None,
        {"num_inference_steps": 999, "guidance_scale": -4, "faces": 10_000_000, "enable_texture": True, "remesh": "quad"},
        1,
    )
    assert params["num_inference_steps"] == 50
    assert params["guidance_scale"] == 0.0
    assert params["faces"] == 500_000
    assert "enable_texture" not in params and "remesh" not in params
    assert dropped == ["enable_texture", "remesh"]


def test_numeric_choice_snaps_to_the_nearest_option():
    params, _ = build_generation_params(HUNYUAN_MINI_TURBO, None, {"num_inference_steps": 12, "octree_resolution": 500}, 3)
    assert params["num_inference_steps"] == 10
    assert params["octree_resolution"] == 512


def test_hunyuan_tiers_map_steps_and_octree():
    params, _ = build_generation_params(HUNYUAN_MINI_TURBO, "max", None, 3)
    assert params["num_inference_steps"] == 20 and params["octree_resolution"] == 512


@pytest.mark.parametrize("bad", [{"guidance_scale": "loud"}, {"guidance_scale": float("nan")}, {"use_flash_decoder": "Voxels"}])
def test_invalid_param_values_are_policy_errors(bad):
    with pytest.raises(PolicyError):
        build_generation_params(TRIPOSG, None, bad, 1)


def test_seed_in_params_is_honoured_when_no_top_level_seed():
    params, dropped = build_generation_params(TRIPOSG, None, {"seed": 99}, None)
    assert params["seed"] == 99 and dropped == []


def test_resolve_seed_bounds():
    assert resolve_seed(0) == 0
    assert resolve_seed(SEED_MAX) == SEED_MAX
    assert 0 <= resolve_seed(-1, random.Random(5)) <= SEED_MAX
    for bad in (-2, SEED_MAX + 1, "x"):
        with pytest.raises(PolicyError):
            resolve_seed(bad)


# ── Post-process plan ─────────────────────────────────────────────────────────

def test_postprocess_empty_means_no_steps():
    assert parse_postprocess(None) == []
    assert parse_postprocess({}) == []
    assert parse_postprocess({"repair": False, "smooth": None}) == []


def test_postprocess_runs_in_fixed_order_whatever_the_key_order():
    plan = parse_postprocess({"smooth": True, "bake": {"texture_size": 2048}, "decimate": 5000, "repair": True})
    assert [name for name, _ in plan] == ["repair", "decimate", "smooth", "uv_unwrap", "bake"]
    assert dict(plan)["decimate"] == {"target_faces": 5000}
    assert dict(plan)["bake"] == {"texture_size": 2048}


def test_bake_true_uses_the_default_size_and_implies_unwrap():
    plan = dict(parse_postprocess({"bake": True}))
    assert plan == {"uv_unwrap": {}, "bake": {"texture_size": 1024}}


def test_repair_and_smooth_options_are_validated():
    plan = dict(parse_postprocess({
        "repair": {"fill_holes": False, "max_hole_size": 500},
        "smooth": {"iterations": 10, "lambda": 0.3, "mode": "laplacian"},
    }))
    assert plan["repair"] == {"fill_holes": False, "max_hole_size": 500}
    assert plan["smooth"] == {"iterations": 10, "lambda_": 0.3, "mode": "laplacian"}


@pytest.mark.parametrize(
    "raw",
    [
        "repair",
        {"explode": True},
        {"repair": {"weld": True}},
        {"repair": {"fill_holes": "yes"}},
        {"decimate": 50},
        {"decimate": 2_000_000},
        {"decimate": {}},
        {"decimate": 1000.5},
        {"decimate": True},
        {"smooth": {"iterations": 0}},
        {"smooth": {"lambda_": 2.0}},
        {"smooth": {"mode": "bilateral"}},
        {"bake": {"texture_size": 1000}},
        {"bake": {"texture_size": 8192}},
        {"uv_unwrap": "please"},
    ],
)
def test_postprocess_refuses_bad_input(raw):
    with pytest.raises(PolicyError):
        parse_postprocess(raw)


# ── Modly job status ──────────────────────────────────────────────────────────

def test_interpret_job_states():
    assert interpret_job({"status": "pending"}) == ("running", None)
    assert interpret_job({"status": "running", "step": "Loading"}) == ("running", "Loading")
    assert interpret_job({"status": "done", "output_url": "/workspace/a/b.glb"}) == ("done", "/workspace/a/b.glb")
    assert interpret_job({"status": "done"})[0] == "failed"
    assert interpret_job({"status": "cancelled"}) == ("failed", "generation was cancelled")
    assert interpret_job({"status": "weird"})[0] == "failed"


def test_interpret_job_keeps_only_the_exception_line_of_a_traceback():
    tb = 'Traceback (most recent call last):\n  File "/opt/x.py", line 3, in f\nRuntimeError: CUDA out of memory'
    assert interpret_job({"status": "error", "error": tb}) == ("failed", "RuntimeError: CUDA out of memory")
    assert summarize_traceback("") == "generation failed without an error message"
    assert len(summarize_traceback("E" * 1000)) == 300


@pytest.mark.parametrize("url", ["/workspace/three-ws/x.glb", "/workspace/a.glb"])
def test_workspace_relative_accepts_plain_paths(url):
    assert workspace_relative(url) == url[len("/workspace/"):]


@pytest.mark.parametrize(
    "url",
    ["/workspace/", "/workspace/../etc/passwd", "/workspace/a//b.glb", "/workspace/a/./b", "/etc/passwd", "https://x/y", None, "/workspace/a\\b"],
)
def test_workspace_relative_refuses_escapes(url):
    with pytest.raises(PolicyError):
        workspace_relative(url)


def test_readiness_problems():
    status = [
        {"id": TRIPOSG, "downloaded": True, "loaded": False},
        {"id": HUNYUAN_MINI_TURBO, "downloaded": False, "loaded": False},
    ]
    assert readiness_problems([TRIPOSG], status, {}) == []
    problems = readiness_problems(ENABLED, status, {})
    assert problems == [f"{HUNYUAN_MINI_TURBO}: weights missing from MODELS_DIR"]
    problems = readiness_problems([TRIPOSG], [], {"triposg": "Traceback\nImportError: no diso"})
    assert problems == [f"{TRIPOSG}: extension error: ImportError: no diso"]
    assert readiness_problems([TRIPOSG], [], {}) == [f"{TRIPOSG}: not registered by Modly"]


# ── Retry ─────────────────────────────────────────────────────────────────────

def _status_error(code: int) -> httpx.HTTPStatusError:
    request = httpx.Request("GET", "https://example.com/a.png")
    return httpx.HTTPStatusError("x", request=request, response=httpx.Response(code, request=request))


def test_retry_delays_and_transience():
    assert retry_delays(3, 1.0) == [1.0, 2.0]
    assert is_transient_fetch_error(_status_error(503))
    assert not is_transient_fetch_error(_status_error(404))
    assert is_transient_fetch_error(httpx.ConnectTimeout("t"))
    assert not is_transient_fetch_error(ValueError("x"))


def test_call_with_retry_recovers_then_gives_up():
    calls, sleeps = [], []

    def flaky():
        calls.append(1)
        if len(calls) < 3:
            raise httpx.ConnectError("blip")
        return "ok"

    assert call_with_retry(flaky, sleep=sleeps.append) == "ok"
    assert sleeps == [1.0, 2.0]

    def broken():
        raise _status_error(404)

    with pytest.raises(httpx.HTTPStatusError):
        call_with_retry(broken, sleep=sleeps.append)
