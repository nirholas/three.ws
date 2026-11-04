"""
Record ONE real Vertex generateContent response for the view-synthesis tests.

Takes a reference face, asks Vertex for a 35 degree view exactly as the worker does
(same request body, same model), and stores the raw JSON response at
`fixtures/vertex_view_response.json`. `test_view_synthesis.py::test_recorded_real_response_parses`
runs against it when present. The response contains a generated synthetic face, not
a real person.

    python -m eval.capture_vertex_fixture eval/refs/<face>.png

Needs Vertex access (`gcloud auth application-default login`, project set via
GOOGLE_CLOUD_PROJECT).
"""

import io
import json
import os
import sys

import httpx
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import view_synthesis as vs  # noqa: E402


def main(argv):
    if len(argv) != 2:
        print(__doc__)
        return 2
    cfg = vs.Config()
    raw = {}

    def tap(req, resp):
        raw["body"] = resp.json()

    http = httpx.Client(event_hooks={"response": [lambda r: (r.read(), tap(None, r))]})
    client = vs.VertexViewClient(cfg, http=http)
    selfie = Image.open(argv[1]).convert("RGB")
    buf = io.BytesIO()
    selfie.save(buf, "PNG")
    import time
    client.request_view(buf.getvalue(), vs.DEFAULT_TARGETS[0], time.monotonic() + cfg.wall_clock_s)
    out = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "fixtures", "vertex_view_response.json")
    os.makedirs(os.path.dirname(out), exist_ok=True)
    json.dump(raw["body"], open(out, "w"))
    print(f"recorded {os.path.getsize(out)} bytes to {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
