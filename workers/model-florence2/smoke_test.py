"""Build-gate smoke test: the baked Florence-2 weights describe an image offline.

Draws a simple scene (a red ball on a wooden table) so the gate needs no network
and no fixture file, then checks that every output field is populated.
"""

import sys

from PIL import Image, ImageDraw

import describe


def scene() -> Image.Image:
    img = Image.new("RGB", (512, 512), (235, 235, 240))
    d = ImageDraw.Draw(img)
    d.rectangle([60, 330, 452, 360], fill=(140, 90, 50))
    d.rectangle([90, 360, 110, 480], fill=(120, 75, 40))
    d.rectangle([402, 360, 422, 480], fill=(120, 75, 40))
    d.ellipse([196, 200, 316, 320], fill=(210, 30, 30))
    return img


def main() -> int:
    out = describe.describe(scene())
    print(out)
    ok = bool(out["caption"]) and bool(out["detailed"]) and isinstance(out["tags"], list) and out["latency_ms"] > 0
    print("smoke:", "OK" if ok else "FAILED")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
