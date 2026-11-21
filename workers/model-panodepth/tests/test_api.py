import pytest
from fastapi.testclient import TestClient

import main
import pano_io

client = TestClient(main.app)
AUTH = {"Authorization": "Bearer test-key"}


def test_infer_requires_bearer():
    r = client.post("/infer", json={"image_url": "https://example.com/a.jpg"})
    assert r.status_code == 401
    r = client.post("/infer", json={"image_url": "https://example.com/a.jpg"}, headers={"Authorization": "Bearer nope"})
    assert r.status_code == 401


def test_tasks_requires_bearer():
    assert client.get("/tasks/abc").status_code == 401


@pytest.mark.parametrize(
    "url",
    [
        "http://169.254.169.254/latest/meta-data/",
        "http://127.0.0.1:8080/x.jpg",
        "http://localhost/x.jpg",
        "file:///etc/passwd",
        "http://10.0.0.5/x.jpg",
    ],
)
def test_infer_rejects_unsafe_urls(url):
    r = client.post("/infer", json={"image_url": url}, headers=AUTH)
    assert r.status_code == 400
    assert r.json()["detail"]["error"] == "unsafe_url" or r.json().get("error") == "unsafe_url"


def test_unknown_task_is_404():
    assert client.get("/tasks/does-not-exist", headers=AUTH).status_code == 404


def test_health_is_public_and_shaped():
    body = client.get("/health").json()
    assert set(["ok", "gpu_available", "model", "weights_present"]) <= set(body)


def test_non_equirect_aspect_rejected():
    with pytest.raises(pano_io.NotEquirectError):
        pano_io.check_equirect(4000, 3000)
    pano_io.check_equirect(4096, 2048)


def test_classify_maps_error_codes():
    assert main.classify(pano_io.NotEquirectError("2:1 only"), "t")["code"] == "not_equirect"
    assert main.classify(RuntimeError("boom"), "t")["code"] == "internal"
