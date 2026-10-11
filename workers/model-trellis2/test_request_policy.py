"""Unit tests for the TRELLIS.2 request policy: resolutions and transient-fetch retry.

Pure stdlib plus httpx, no torch and no CUDA, so this runs anywhere:

    cd workers/model-trellis2 && python3 -m pytest test_request_policy.py -q
"""

import httpx
import pytest

from request_policy import (
    DEFAULT_RESOLUTION,
    FETCH_ATTEMPTS,
    PIPELINE_TYPES,
    RESOLUTIONS,
    RESOLUTION_PRESETS,
    bake_params,
    call_with_retry,
    clamp_to_ceiling,
    is_transient_fetch_error,
    resolve_resolution,
    retry_delays,
    step_down,
)


def test_default_is_1024():
    assert resolve_resolution(None) == DEFAULT_RESOLUTION == 1024


@pytest.mark.parametrize("wanted,expected", [(512, 512), (1024, 1024), (1536, 1536), (2048, 1536), (700, 512), (900, 1024), (1, 512)])
def test_explicit_resolution_snaps_to_a_supported_size(wanted, expected):
    assert resolve_resolution(wanted) == expected


def test_garbage_resolution_falls_back_to_the_default():
    assert resolve_resolution("big") == 1024
    assert resolve_resolution([]) == 1024


@pytest.mark.parametrize("tier,expected", [("draft", 512), ("standard", 1024), ("high", 1024), ("max", 1536), (" MAX ", 1536), ("nonsense", 1024), (None, 1024)])
def test_tier_maps_to_a_resolution(tier, expected):
    assert resolve_resolution(None, tier) == expected


def test_explicit_resolution_beats_the_tier():
    assert resolve_resolution(512, "max") == 512


def test_every_resolution_has_a_pipeline_type_and_a_preset():
    for r in RESOLUTIONS:
        assert r in PIPELINE_TYPES and r in RESOLUTION_PRESETS
    assert PIPELINE_TYPES == {512: "512", 1024: "1024_cascade", 1536: "1536_cascade"}


def test_ceiling_caps_the_request():
    assert clamp_to_ceiling(1536, 1024) == 1024
    assert clamp_to_ceiling(512, 1024) == 512
    assert clamp_to_ceiling(1536, None) == 1536
    assert clamp_to_ceiling(1536, 100) == 512


def test_step_down_walks_the_ladder_and_stops():
    assert step_down(1536) == 1024
    assert step_down(1024) == 512
    assert step_down(512) is None


def test_bake_params_default_to_the_preset():
    assert bake_params(1024) == {"texture_size": 4096, "decimation_target": 1_000_000}
    assert bake_params(512)["texture_size"] == 2048


def test_texture_size_snaps_down_to_a_power_of_two_inside_the_envelope():
    assert bake_params(1024, texture_size=3072)["texture_size"] == 2048
    assert bake_params(1024, texture_size=100000)["texture_size"] == 4096
    assert bake_params(1024, texture_size=10)["texture_size"] == 512


def test_decimation_is_bounded_and_garbage_falls_back():
    assert bake_params(1024, decimation_target=10)["decimation_target"] == 50_000
    assert bake_params(1024, decimation_target=10**9)["decimation_target"] == 2_000_000
    assert bake_params(1024, decimation_target="lots")["decimation_target"] == 1_000_000
    assert bake_params(1024, texture_size="x")["texture_size"] == 4096


def test_retry_delays_double():
    assert retry_delays(3, 1.0) == [1.0, 2.0]


def _status_error(code):
    request = httpx.Request("GET", "https://example.com/a.png")
    return httpx.HTTPStatusError("x", request=request, response=httpx.Response(code, request=request))


def test_transient_classification():
    assert is_transient_fetch_error(httpx.ReadTimeout("t"))
    assert is_transient_fetch_error(_status_error(503))
    assert not is_transient_fetch_error(_status_error(404))
    assert not is_transient_fetch_error(ValueError("nope"))


def test_call_with_retry_recovers_from_a_blip():
    calls = []
    sleeps = []

    def flaky():
        calls.append(1)
        if len(calls) < 2:
            raise httpx.ReadTimeout("slow")
        return "ok"

    assert call_with_retry(flaky, sleep=sleeps.append) == "ok"
    assert len(calls) == 2 and sleeps == [1.0]


def test_call_with_retry_gives_up_on_a_permanent_error_immediately():
    calls = []

    def gone():
        calls.append(1)
        raise _status_error(404)

    with pytest.raises(httpx.HTTPStatusError):
        call_with_retry(gone, sleep=lambda s: None)
    assert len(calls) == 1


def test_call_with_retry_spends_the_budget_then_raises():
    calls = []

    def down():
        calls.append(1)
        raise httpx.ConnectError("down")

    with pytest.raises(httpx.ConnectError):
        call_with_retry(down, sleep=lambda s: None)
    assert len(calls) == FETCH_ATTEMPTS
