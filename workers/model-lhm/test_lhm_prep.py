"""CPU-only guard for lhm_prep: run `python test_lhm_prep.py` (also a Docker build step)."""

import base64
import io
import os
import tempfile
import time

from PIL import Image

import lhm_prep as p


def _png() -> bytes:
    b = io.BytesIO()
    Image.new("RGB", (8, 8), (10, 20, 30)).save(b, "PNG")
    return b.getvalue()


def _raises(fn, exc=ValueError):
    try:
        fn()
    except exc:
        return
    raise AssertionError("expected " + exc.__name__)


def main() -> None:
    uri = "data:image/png;base64," + base64.b64encode(_png()).decode()
    assert p.decode_image(uri, fetch=lambda u: b"").size == (8, 8)
    assert p.decode_image("https://x.test/a.png", fetch=lambda u: _png()).mode == "RGB"
    _raises(lambda: p.decode_image("http://x.test/a.png", fetch=lambda u: b""))
    _raises(lambda: p.decode_image("data:image/png;base64,@@@", fetch=lambda u: b""))
    _raises(lambda: p.decode_image("data:image/png;base64," + base64.b64encode(b"nope").decode(), fetch=lambda u: b""))
    assert p.validate_model(None) == "LHM-500M-HF"
    _raises(lambda: p.validate_model("../../etc"))
    tid = "123e4567-e89b-42d3-a456-426614174000"
    assert p.blob_name(tid, "ply") == f"raw-splats/lhm/{tid}.ply"
    _raises(lambda: p.blob_name("../x", "ply"))
    _raises(lambda: p.blob_name(tid, "exe"))
    with tempfile.TemporaryDirectory() as d:
        _raises(lambda: p.find_output_ply(d), RuntimeError)
        old, new = os.path.join(d, "a.ply"), os.path.join(d, "n", "b.ply")
        os.makedirs(os.path.dirname(new))
        open(old, "w").close()
        time.sleep(0.02)
        open(new, "w").close()
        assert p.find_output_ply(d) == new
    print("lhm_prep ok")


if __name__ == "__main__":
    main()
