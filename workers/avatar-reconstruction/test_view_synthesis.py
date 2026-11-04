"""
Tests for view_synthesis.py (Vertex client + identity gate) and view_texture.py
(projection, colour match, seam gate).

The Vertex call is injected at the HTTP boundary: an httpx.MockTransport answers
with a response envelope in the exact shape Vertex generateContent returns.
`fixtures/vertex_view_response.json` is the recorded REAL response (captured by
`python -m eval.capture_vertex_fixture`); when it is absent the envelope is built
here around a locally rendered image, and the one test that depends on the real
recording skips instead of pretending.

Run: pytest test_view_synthesis.py
"""

import base64
import io
import json
import os
import sys

import cv2
import httpx
import numpy as np
import pytest
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import face_projection as fpr  # noqa: E402
import view_synthesis as vs  # noqa: E402
import view_texture as vt  # noqa: E402
from test_face_projection import _sphere, _synthetic_landmarks  # noqa: E402

SKIN = (224, 172, 140)
BG = (235, 235, 235)
FIXTURE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "fixtures", "vertex_view_response.json")


def _disc_png(radius=250, size=800, skin=SKIN, rx=None) -> bytes:
    img = np.full((size, size, 3), BG, dtype=np.uint8)
    cv2.ellipse(img, (size // 2, size // 2), (rx or radius, radius), 0, 0, 360, skin, -1)
    buf = io.BytesIO()
    Image.fromarray(img).save(buf, "PNG")
    return buf.getvalue()


def _envelope(png: bytes) -> dict:
    return {
        "candidates": [{"content": {"role": "model", "parts": [
            {"inlineData": {"mimeType": "image/png", "data": base64.b64encode(png).decode()}}]}}],
        "usageMetadata": {"promptTokenCount": 300, "candidatesTokenCount": 1290},
    }


def _client(handler, **cfg_kw):
    cfg = vs.Config(project="test-proj", **cfg_kw)
    http = httpx.Client(transport=httpx.MockTransport(handler))
    sleeps = []
    return vs.VertexViewClient(cfg, http=http, token_provider=lambda: "tok", sleep=sleeps.append), sleeps


def _selfie():
    return Image.open(io.BytesIO(_disc_png()))


# ── Vertex client ───────────────────────────────────────────────────────────────

def test_flag_defaults_off(monkeypatch):
    monkeypatch.delenv("RECON_VIEW_SYNTHESIS", raising=False)
    assert vs.enabled() is False
    monkeypatch.setenv("RECON_VIEW_SYNTHESIS", "1")
    assert vs.enabled() is True


def test_request_shape_and_views_returned():
    seen = []

    def handler(req: httpx.Request):
        seen.append(req)
        return httpx.Response(200, json=_envelope(_disc_png()))

    client, _ = _client(handler)
    rep = vs.synthesize_views(_selfie(), client=client)
    assert len(rep.views) == 5 and rep.failed == 0 and not rep.stopped
    req = seen[0]
    assert req.url.host == "us-central1-aiplatform.googleapis.com"
    assert req.url.path.endswith("/publishers/google/models/gemini-2.5-flash-image:generateContent")
    assert req.headers["authorization"] == "Bearer tok"
    body = json.loads(req.content)
    parts = body["contents"][0]["parts"]
    assert parts[0]["inlineData"]["mimeType"] == "image/png" and "text" in parts[1]
    assert body["generationConfig"]["responseModalities"] == ["IMAGE"]
    assert rep.prompt_tokens == 300 * 5 and rep.output_tokens == 1290 * 5


@pytest.mark.skipif(not os.path.exists(FIXTURE), reason="no recorded real Vertex response yet (billing hold); run eval/capture_vertex_fixture.py")
def test_recorded_real_response_parses():
    payload = json.load(open(FIXTURE))
    found = vs.extract_image(payload)
    assert found is not None
    img = Image.open(io.BytesIO(found[0]))
    assert min(img.size) >= 256


def test_429_backs_off_once_then_succeeds():
    calls = {"n": 0}

    def handler(req):
        calls["n"] += 1
        if calls["n"] == 1:
            return httpx.Response(429, json={"error": {"code": 429}})
        return httpx.Response(200, json=_envelope(_disc_png()))

    client, sleeps = _client(handler)
    rep = vs.synthesize_views(_selfie(), targets=(vs.DEFAULT_TARGETS[0],), client=client)
    assert len(rep.views) == 1 and len(sleeps) == 1 and 1.0 <= sleeps[0] <= vs.Config().max_backoff_s


def test_persistent_429_degrades_to_zero_views_without_raising():
    client, sleeps = _client(lambda req: httpx.Response(429, json={}))
    rep = vs.synthesize_views(_selfie(), client=client)
    assert rep.views == [] and rep.stopped == "quota"


def test_403_billing_hold_stops_the_batch():
    n = {"c": 0}

    def handler(req):
        n["c"] += 1
        return httpx.Response(403, json={"error": {"message": "billing"}})

    client, _ = _client(handler)
    rep = vs.synthesize_views(_selfie(), client=client)
    assert rep.views == [] and rep.stopped == "denied"
    assert n["c"] < 5, "kept hammering Vertex after a 403"


def test_timeout_drops_the_view_and_keeps_going():
    n = {"c": 0}

    def handler(req):
        n["c"] += 1
        if n["c"] == 1:
            raise httpx.ReadTimeout("slow", request=req)
        return httpx.Response(200, json=_envelope(_disc_png()))

    client, _ = _client(handler)
    rep = vs.synthesize_views(_selfie(), targets=vs.DEFAULT_TARGETS[:2], client=client,
                              cfg=vs.Config(project="p"))
    assert len(rep.views) == 1 and rep.failed == 1


def test_safety_block_without_image_is_a_dropped_view():
    client, _ = _client(lambda req: httpx.Response(200, json={"candidates": [{"finishReason": "SAFETY"}]}))
    rep = vs.synthesize_views(_selfie(), client=client)
    assert rep.views == [] and rep.failed == 5


def test_model_404_falls_back_once():
    urls = []

    def handler(req):
        urls.append(str(req.url))
        if "gemini-2.5-flash-image" in str(req.url):
            return httpx.Response(404, json={})
        return httpx.Response(200, json=_envelope(_disc_png()))

    client, _ = _client(handler)
    rep = vs.synthesize_views(_selfie(), targets=(vs.DEFAULT_TARGETS[0],), client=client)
    assert len(rep.views) == 1 and "gemini-3.1-flash-image" in urls[-1]


def test_wall_clock_budget_bounds_the_batch():
    client, _ = _client(lambda req: httpx.Response(200, json=_envelope(_disc_png())), wall_clock_s=0.5)
    rep = vs.synthesize_views(_selfie(), client=client)
    assert rep.views == [] and rep.failed == 5


def test_no_project_means_no_call(monkeypatch):
    monkeypatch.delenv("GOOGLE_CLOUD_PROJECT", raising=False)
    monkeypatch.delenv("GCP_PROJECT", raising=False)
    rep = vs.synthesize_views(_selfie(), cfg=vs.Config())
    assert rep.views == [] and rep.stopped == "denied"


def test_invalid_region_never_builds_a_url():
    with pytest.raises(ValueError):
        vs._endpoint(vs.Config(project="p", location="evil.com/x"), "m")


# ── identity gate ───────────────────────────────────────────────────────────────

def _img(skin):
    a = np.full((400, 400, 3), BG, dtype=np.uint8)
    cv2.circle(a, (200, 200), 120, skin, -1)
    m = np.zeros((400, 400), np.float32)
    cv2.circle(m, (200, 200), 120, 1.0, -1)
    return a, m


def _lm():
    lm = np.random.RandomState(1).randn(468, 3).astype(np.float64) * 30
    lm[33], lm[263] = [-60, 0, 0], [60, 0, 0]
    lm[129], lm[358] = [-25, -40, 0], [25, -40, 0]
    lm[61], lm[291] = [-35, -80, 0], [35, -80, 0]
    lm[10], lm[152] = [0, 120, 0], [0, -140, 0]
    return lm


def test_gate_accepts_same_person():
    a, m = _img(SKIN)
    b, mb = _img((222, 170, 138))
    g = vs.identity_gate(a, m, _lm(), b, mb, _lm())
    assert g.accepted, g.reasons


def test_gate_rejects_complexion_drift():
    a, m = _img(SKIN)
    b, mb = _img((150, 100, 75))
    g = vs.identity_gate(a, m, None, b, mb, None)
    assert not g.accepted and "skin colour drift" in g.reasons[0]


def test_gate_rejects_different_face_proportions():
    a, m = _img(SKIN)
    other = _lm()
    other[61], other[291] = [-70, -80, 0], [70, -80, 0]
    g = vs.identity_gate(a, m, _lm(), a, m, other)
    assert not g.accepted and any("mouth_over_iod" in r for r in g.reasons)


def test_gate_rejects_when_skin_cannot_be_measured():
    a, m = _img(SKIN)
    blue = np.full((400, 400, 3), (20, 40, 200), dtype=np.uint8)
    g = vs.identity_gate(a, m, None, blue, np.ones((400, 400), np.float32), None)
    assert not g.accepted and "not measurable" in g.reasons[0]


def test_landmark_ratios_are_pose_invariant():
    lm = _lm()
    a = np.deg2rad(35)
    R = np.array([[np.cos(a), 0, np.sin(a)], [0, 1, 0], [-np.sin(a), 0, np.cos(a)]])
    r0, r1 = vs.landmark_ratios(lm), vs.landmark_ratios(lm @ R.T)
    for k in r0:
        assert abs(r0[k] - r1[k]) < 1e-9


# ── projection of synthesised views ─────────────────────────────────────────────

def _head(squash_x=1.0, seamed=False):
    if seamed:
        pos, uv, faces = _seamed_sphere()
        nrm = pos / np.linalg.norm(pos, axis=1, keepdims=True)
    else:
        pos, nrm, uv, faces = _sphere()
    pos = pos.copy()
    pos[:, 0] *= squash_x
    nrm = pos / np.linalg.norm(pos, axis=1, keepdims=True)
    return pos, nrm.astype(np.float32), uv, faces


def _setup(squash_x=1.0, seamed=False):
    pos, nrm, uv, faces = _head(squash_x, seamed)
    idx = np.arange(len(pos))
    pts, _, _ = _synthetic_landmarks(pos, idx, angle=0.0)
    cam = fpr.solve_camera(pts, idx, pos, 800, 800)
    assert cam is not None
    photo = np.zeros((800, 800, 3), dtype=np.uint8)
    photo[:] = SKIN
    primary = fpr.project_photo_to_uv(photo, None, pos, nrm, uv, faces, pts, idx, 128, 128)
    return pos, nrm, uv, faces, idx, pts, cam, photo, primary


def _run(report, setup, **kw):
    pos, nrm, uv, faces, idx, pts, cam, photo, primary = setup
    base = np.full((128, 128, 3), 90, dtype=np.uint8)
    bg_mask = lambda img: Image.fromarray(np.dstack([  # noqa: E731
        np.array(img.convert("RGB")),
        ((np.abs(np.array(img.convert("RGB")).astype(int) - BG).sum(axis=2)) > 30).astype(np.uint8) * 255]), "RGBA")
    return vt.enrich_with_views(
        report=report, selfie_rgb=photo, selfie_mask=np.ones((800, 800), np.float32),
        selfie_landmarks_3d=None, primary_camera=cam, primary=primary, base_skin_rgb=base,
        protect=None, positions=pos, normals=nrm, uvs=uv, faces=faces, landmark_vertex_indices=idx,
        detect_landmarks=lambda img: None, remove_background=bg_mask, **kw)


def _report(*pairs):
    r = vs.SynthesisReport()
    for tg, png in pairs:
        r.views.append(vs.SynthView(tg, Image.open(io.BytesIO(png)).convert("RGB"), 0.1, {}))
    r.requested = len(pairs)
    return r


def test_zero_views_is_exactly_the_single_photo_result():
    setup = _setup()
    res = _run(vs.SynthesisReport(), setup)
    base = np.full((128, 128, 3), 90, dtype=np.uint8)
    expected = fpr.blend_projection(base, setup[-1][0], setup[-1][1])
    assert np.array_equal(res.skin_rgb, expected) and res.accepted == []


def test_accepted_view_adds_coverage_and_leaves_geometry_untouched():
    setup = _setup()
    pos, nrm, uv, faces = (a.copy() for a in setup[:4])
    rep = _report((vs.ViewTarget("yaw_p65", 65.0, 0.0), _disc_png(radius=300)))
    res = _run(rep, setup)
    assert res.accepted == ["yaw_p65"], res.rejected
    assert res.coverage_after > res.coverage_before
    for a, b in zip((pos, nrm, uv, faces), setup[:4]):
        assert np.array_equal(a, b), "view enrichment mutated geometry"


def test_selfie_stays_authoritative_where_it_applies():
    setup = _setup()
    prim_rgb, prim_w, _ = setup[-1]
    strong = prim_w > 0.8 * fpr.MAX_BLEND
    assert strong.any()
    # A very different (but still gate-passing) skin tone must not move strong texels.
    rep = _report((vs.ViewTarget("yaw_p35", 35.0, 0.0), _disc_png(radius=300, skin=(214, 164, 134))))
    res = _run(rep, setup)
    base = np.full((128, 128, 3), 90, dtype=np.uint8)
    only = fpr.blend_projection(base, prim_rgb, prim_w)
    diff = np.abs(res.skin_rgb.astype(int) - only.astype(int)).max(axis=2)
    assert diff[strong].max() <= 12, f"selfie texels moved by {diff[strong].max()}"


def test_identity_drift_view_is_dropped_silently():
    setup = _setup()
    rep = _report((vs.ViewTarget("yaw_p35", 35.0, 0.0), _disc_png(radius=300, skin=(140, 95, 70))))
    res = _run(rep, setup)
    assert res.accepted == [] and "skin colour drift" in res.rejected["yaw_p35"]


def test_view_whose_silhouette_does_not_fit_the_requested_pose_is_dropped():
    setup = _setup()
    rep = _report((vs.ViewTarget("yaw_p65", 65.0, 0.0), _disc_png(radius=40)))
    res = _run(rep, setup)
    assert res.accepted == [] and "silhouette" in res.rejected["yaw_p65"]


def test_seam_gate_drops_a_view_that_breaks_continuity(monkeypatch):
    setup = _setup(seamed=True)
    rep = _report((vs.ViewTarget("yaw_p35", 35.0, 0.0), _disc_png(radius=300)))
    res = _run(rep, setup)
    assert res.seam_before is not None, "test mesh has no measurable seams"
    monkeypatch.setattr(vt, "SEAM_DELTA_E_MAX", -1e9)
    strict = _run(rep, setup)
    assert strict.accepted == [] and "seam" in strict.rejected["yaw_p35"]


def test_pose_prior_uses_the_requested_turn():
    setup = _setup(squash_x=0.6)
    pos, nrm, uv, faces, idx, pts, cam, photo, _ = setup
    mask = np.zeros((800, 800), np.float32)
    cv2.ellipse(mask, (400, 400), (300, 300), 0, 0, 360, 1.0, -1)   # width 300 = the head's depth at 90 deg
    _, iou_turned = fpr.camera_from_pose_prior(cam, 800, 800, 90.0, 0.0, mask, pos, faces)
    _, iou_front = fpr.camera_from_pose_prior(cam, 800, 800, 0.0, 0.0, mask, pos, faces)
    assert iou_turned > 0.85 and iou_turned > iou_front + 0.2


# ── colour match, composite, seams ──────────────────────────────────────────────

def test_skin_statistics_move_toward_the_selfie():
    ref = np.full((64, 64, 3), (200, 150, 120), np.float32)
    rng = np.random.RandomState(0)
    ref += rng.randn(64, 64, 3).astype(np.float32) * 4
    view = np.full((64, 64, 3), (150, 120, 110), np.float32) + rng.randn(64, 64, 3).astype(np.float32) * 4
    w = np.full((64, 64), 0.5, np.float32)
    out = fpr.match_skin_statistics(view, w, ref, w)
    assert np.abs(out.mean(axis=(0, 1)) - ref.mean(axis=(0, 1))).max() < 6


def test_composite_never_exceeds_max_blend_and_primary_wins():
    p_rgb = np.full((4, 4, 3), 200, np.float32)
    p_w = np.zeros((4, 4), np.float32)
    p_w[:, :2] = fpr.MAX_BLEND
    v_rgb = np.full((4, 4, 3), 50, np.float32)
    v_w = np.full((4, 4), fpr.SYNTH_MAX_BLEND, np.float32)
    rgb, w = fpr.composite_views(p_rgb, p_w, [(v_rgb, v_w)])
    assert w.max() <= fpr.MAX_BLEND + 1e-6
    assert np.allclose(rgb[:, :2], 200, atol=1)          # selfie texels unchanged
    assert np.allclose(rgb[:, 2:], 50, atol=1)           # unclaimed texels take the view


def _seamed_sphere():
    n_t, n_p = 20, 24
    th = np.linspace(0.01, np.pi - 0.01, n_t)
    ph = np.linspace(0, 2 * np.pi, n_p + 1)          # last column duplicates the first in 3D
    pos, uv = [], []
    for i, t in enumerate(th):
        for j, p in enumerate(ph):
            pos.append([np.sin(t) * np.sin(p), np.cos(t), np.sin(t) * np.cos(p)])
            uv.append([j / n_p, 1 - i / (n_t - 1)])
    faces = []
    for i in range(n_t - 1):
        for j in range(n_p):
            a = i * (n_p + 1) + j
            faces += [[a, a + n_p + 1, a + 1], [a + 1, a + n_p + 1, a + n_p + 2]]
    return np.array(pos, np.float32), np.array(uv, np.float32), np.array(faces, np.int32)


def test_uv_seams_found_and_continuity_scored():
    pos, uv, faces = _seamed_sphere()
    seams = fpr.uv_seams(pos, uv, faces)
    assert len(seams) > 10
    w = np.ones((64, 64), np.float32)
    flat = np.full((64, 64, 3), 128, np.uint8)
    assert fpr.seam_discontinuity(flat, w, seams) == pytest.approx(0.0, abs=1e-3)
    stepped = flat.copy()
    stepped[:, : 32] = (200, 120, 90)
    stepped[:, 32:] = (60, 120, 200)
    assert fpr.seam_discontinuity(stepped, w, seams) > 10
