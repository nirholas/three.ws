import pytest

import weights_sync as ws


def remote(**over):
    r = {n: 100 for n in ws.REQUIRED}
    r.update(over)
    return r


def test_everything_is_fetched_on_a_cold_instance():
    assert ws.plan_downloads(remote(), {}) == list(ws.REQUIRED)


def test_files_already_present_at_the_right_size_are_skipped():
    local = {n: 100 for n in ws.REQUIRED}
    local["tflow.pt"] = 50
    assert ws.plan_downloads(remote(), local) == ["tflow.pt"]


def test_a_missing_required_checkpoint_is_an_error_not_a_silent_skip():
    r = remote()
    del r["vvae.pt"]
    with pytest.raises(RuntimeError, match="vvae.pt"):
        ws.plan_downloads(r, {})


def test_extra_bucket_files_are_ignored():
    assert ws.plan_downloads(remote(**{"vdf_encoder.pt": 9}), {n: 100 for n in ws.REQUIRED}) == []


def test_find_key_walks_nested_configs():
    assert ws.find_key({"a": {"b": {"dino_version": "dinov2_vitl14"}}}, "dino_version") == "dinov2_vitl14"
    assert ws.find_key({"a": 1}, "dino_version") is None
