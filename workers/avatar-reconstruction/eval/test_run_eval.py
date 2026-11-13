"""
run_eval must be safe to run twice at once into the same reports directory.

The dense-fit acceptance runs the 40 references against the dense-off and the
dense-on worker side by side (`--out eval/reports/dense-off.json` and
`--out eval/reports/dense-on.json`). Each sample's GLB used to be written to
`<reports>/<photo>.glb` and deleted after scoring, so the two runs shared that
path: one run deleted the file the other was about to read, and the dense-on run
died on its first face with FileNotFoundError. Each run must keep its sample GLBs
under a path derived from its own report.

Run:  python -m pytest eval/test_run_eval.py -q
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import eval.run_eval as run_eval  # noqa: E402


@pytest.fixture
def stubbed_pipeline(monkeypatch, tmp_path):
    """Replace the reconstruction and the scorer so run() only exercises its file handling."""
    seen: list[Path] = []

    def fake_floor(template, body_type, out):
        path = out.parent / f"{out.stem}-floor.glb"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(b"floor")
        return path

    def fake_evaluate(photo, glb_path, floor_glb, uv_map):
        assert glb_path.read_bytes() == b"glb:" + photo.name.encode()
        seen.append(glb_path)
        return {"selfie": photo.name, "ise": 0.1, "template_floor": 0.4,
                "improvement": 0.75, "regions": {"jaw": 0.1}}

    monkeypatch.setattr(run_eval, "local_health", lambda: {"template": "wolf3d"})
    monkeypatch.setattr(run_eval, "reconstruct_local",
                        lambda photo, body_type: (b"glb:" + photo.name.encode(), None))
    monkeypatch.setattr(run_eval, "template_floor_glb", fake_floor)
    monkeypatch.setattr(run_eval, "evaluate", fake_evaluate)

    photos = tmp_path / "refs"
    photos.mkdir()
    for name in ("a.png", "b.png"):
        (photos / name).write_bytes(b"png")
    return photos, tmp_path / "reports", seen


def test_two_reports_in_one_directory_never_share_a_sample_glb(stubbed_pipeline):
    photos, reports, seen = stubbed_pipeline
    run_eval.run(photos, None, None, reports / "dense-off.json", "neutral", keep_glb=False)
    off = list(seen)
    seen.clear()
    run_eval.run(photos, None, None, reports / "dense-on.json", "neutral", keep_glb=False)
    on = list(seen)
    assert len(off) == len(on) == 2
    assert not set(off) & set(on), f"both runs wrote the same sample GLBs: {sorted(set(off) & set(on))}"


def test_scratch_glbs_are_removed_unless_kept(stubbed_pipeline):
    photos, reports, seen = stubbed_pipeline
    run_eval.run(photos, None, None, reports / "r.json", "neutral", keep_glb=False)
    assert all(not p.exists() for p in seen)
    assert sorted(p.name for p in reports.iterdir()) == ["r.json"]


def test_keep_glb_keeps_every_sample(stubbed_pipeline):
    photos, reports, seen = stubbed_pipeline
    run_eval.run(photos, None, None, reports / "r.json", "neutral", keep_glb=True)
    assert all(p.exists() for p in seen)
    assert {p.parent for p in seen} == {reports / "r-glb"}
