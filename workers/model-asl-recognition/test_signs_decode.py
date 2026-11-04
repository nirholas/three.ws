"""Unit tests for word-level sign decoding and the /recognize-signs endpoint.

Pure NumPy plus FastAPI's in-process client: no model runtime and no weights.
The endpoint tests inject a stub runner for the TFLite interpreter, which is the
only seam the real service has, so routing, auth, validation and the fail-closed
behaviour are exercised exactly as served.
"""

import numpy as np
import pytest
from fastapi.testclient import TestClient

import main
from decode import MIN_FRAMES, N_FEATURES
from signs import load_labels, softmax, top_k

LABELS = ["hello", "thankyou", "please", "dog", "cat", "yes"]


def test_softmax_is_a_distribution():
    p = softmax(np.array([[1.0, 2.0, 3.0]]))
    assert p.shape == (1, 3)
    assert p.sum() == pytest.approx(1.0)
    assert p[0].argmax() == 2


def test_softmax_survives_huge_logits():
    p = softmax(np.array([1000.0, 1001.0]))
    assert np.isfinite(p).all()
    assert p.sum() == pytest.approx(1.0)


def test_top_k_orders_by_probability_and_names_signs():
    logits = np.array([0.1, 5.0, 0.2, 3.0, 0.0, 1.0], dtype=np.float32)
    out = top_k(logits, LABELS, k=3)
    assert [o["sign"] for o in out] == ["thankyou", "dog", "yes"]
    probs = [o["probability"] for o in out]
    assert probs == sorted(probs, reverse=True)
    assert all(0.0 <= p <= 1.0 for p in probs)


def test_top_k_never_exceeds_the_label_count():
    assert len(top_k(np.zeros(2), ["a", "b"], k=5)) == 2


def test_top_k_rejects_a_logit_vector_that_does_not_match_the_labels():
    with pytest.raises(ValueError, match="labels"):
        top_k(np.zeros(4), LABELS, k=3)


def test_top_k_accepts_a_batch_of_one():
    out = top_k(np.array([[0.0, 4.0, 0.0, 0.0, 0.0, 0.0]]), LABELS, k=1)
    assert out[0]["sign"] == "thankyou"


def test_load_labels_reads_index_to_name(tmp_path):
    p = tmp_path / "labels.json"
    p.write_text('{"hello": 0, "dog": 2, "please": 1}')
    assert load_labels(p) == ["hello", "please", "dog"]


def test_load_labels_rejects_gaps(tmp_path):
    p = tmp_path / "labels.json"
    p.write_text('{"hello": 0, "dog": 2}')
    with pytest.raises(ValueError, match="contiguous"):
        load_labels(p)


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setattr(main, "API_KEY", "k")
    return TestClient(main.app)


def _frames(n=MIN_FRAMES + 4):
    return np.random.default_rng(1).uniform(0.2, 0.8, size=(n, N_FEATURES)).round(4).tolist()


def _auth():
    return {"authorization": "Bearer k"}


def test_signs_endpoint_requires_auth(client):
    assert client.post("/recognize-signs", json={"frames": _frames()}).status_code == 401
    assert client.get("/signs-schema").status_code == 401


def test_signs_endpoint_fails_closed_without_api_key(monkeypatch):
    monkeypatch.setattr(main, "API_KEY", "")
    c = TestClient(main.app)
    assert c.post("/recognize-signs", json={"frames": _frames()}, headers={"authorization": "Bearer "}).status_code == 401


def test_signs_endpoint_is_503_when_no_signs_model_is_loaded(client, monkeypatch):
    monkeypatch.setattr(main, "_signs_runner", None)
    r = client.post("/recognize-signs", json={"frames": _frames()}, headers=_auth())
    assert r.status_code == 503
    assert r.json()["detail"] == "signs_model_unavailable"


def test_signs_endpoint_returns_top5_with_a_confidence(client, monkeypatch):
    logits = np.array([0.0, 6.0, 1.0, 4.0, 2.0, 3.0], dtype=np.float32)
    monkeypatch.setattr(main, "_signs_labels", LABELS)
    monkeypatch.setattr(main, "_signs_runner", object())
    monkeypatch.setattr(main, "_signs_infer", lambda arr: logits)
    r = client.post("/recognize-signs", json={"frames": _frames()}, headers=_auth())
    assert r.status_code == 200
    body = r.json()
    assert [s["sign"] for s in body["signs"]] == ["thankyou", "dog", "yes", "cat", "please"]
    assert body["confidence"] == body["signs"][0]["probability"]
    assert body["frames"] == MIN_FRAMES + 4
    assert isinstance(body["ms"], int)


def test_signs_endpoint_validates_frames(client, monkeypatch):
    monkeypatch.setattr(main, "_signs_labels", LABELS)
    monkeypatch.setattr(main, "_signs_runner", object())
    r = client.post("/recognize-signs", json={"frames": _frames(2)}, headers=_auth())
    assert r.status_code == 400
    r = client.post("/recognize-signs", json={"frames": [[0.0] * 5] * 20}, headers=_auth())
    assert r.status_code == 400


def test_signs_schema_matches_the_fingerspelling_layout(client, monkeypatch):
    monkeypatch.setattr(main, "_signs_labels", LABELS)
    r = client.get("/signs-schema", headers=_auth())
    assert r.status_code == 200
    body = r.json()
    assert len(body["columns"]) == N_FEATURES
    assert body["labels"] == len(LABELS)
    assert body["top_k"] == 5
    assert client.get("/schema", headers=_auth()).json()["columns"] == body["columns"]


def test_fingerspelling_routes_are_unchanged(client):
    r = client.get("/health")
    assert r.status_code == 200
    assert "model_loaded" in r.json()
    assert client.post("/transcribe", json={"frames": _frames()}).status_code == 401
