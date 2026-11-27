"""
The baked material a Game-Ready export ships must show the bake as baked.

Measured on 2026-11-27 from a live quad export of a public Forge model: the
source GLB had baseColorFactor [1, 1, 1, 1], the retopologized GLB came back
with [0.4, 0.4, 0.4, 1] and no metallicFactor (which glTF reads as 1.0). In
every engine the baked texture rendered at 40% brightness on a fully metallic
surface. The cause was trimesh's SimpleMaterial, whose default diffuse is
102/255 and which writes no metalness.

This drives the low-poly pipeline end to end on a textured sphere, exports the
GLB the worker uploads, and checks the material in the file's own JSON.

    python test_baked_material.py
"""

from __future__ import annotations

import json
import os
import struct
import sys

os.environ.setdefault("API_KEY", "test-key")
os.environ.setdefault("GCS_BUCKET", "test-bucket")

import numpy as np
from PIL import Image
import trimesh

import main as remesh

PASSED = 0


def check(name: str, condition: bool, detail: str = "") -> None:
    global PASSED
    if not condition:
        print(f"FAIL  {name}  {detail}")
        sys.exit(1)
    PASSED += 1
    print(f"ok    {name}")


def glb_json(data: bytes) -> dict:
    (length,) = struct.unpack_from("<I", data, 12)
    return json.loads(data[20:20 + length])


def textured_sphere():
    mesh = trimesh.creation.icosphere(subdivisions=4)
    uv = np.stack([
        0.5 + np.arctan2(mesh.vertices[:, 2], mesh.vertices[:, 0]) / (2 * np.pi),
        0.5 + np.arcsin(np.clip(mesh.vertices[:, 1], -1, 1)) / np.pi,
    ], axis=1)
    image = Image.new("RGB", (64, 64), (200, 120, 40))
    mesh.visual = trimesh.visual.TextureVisuals(uv=uv, image=image)
    return mesh


def main() -> None:
    for mode in ("lowpoly", "direct"):
        if mode == "lowpoly":
            artifacts, meta = remesh._process_lowpoly(textured_sphere(), 1000, "glb", 512, "mat")
            check("low-poly pipeline baked a texture", meta["textured"] is True, str(meta))
            data = artifacts[0].data
        else:
            sphere = trimesh.creation.icosphere(subdivisions=2)
            uv = np.zeros((len(sphere.vertices), 2))
            mesh = remesh._build_textured_trimesh(
                sphere.vertices, sphere.faces, uv, Image.new("RGB", (8, 8), (255, 0, 0)),
            )
            data = mesh.export(file_type="glb")

        doc = glb_json(data)
        pbr = doc["materials"][0].get("pbrMetallicRoughness", {})
        check(f"{mode}: material carries the baked texture", "baseColorTexture" in pbr, json.dumps(pbr))
        factor = pbr.get("baseColorFactor", [1, 1, 1, 1])
        check(f"{mode}: base colour is not tinted", all(abs(c - 1) < 1e-6 for c in factor), str(factor))
        metallic = pbr.get("metallicFactor", 1.0)
        check(f"{mode}: baked albedo is not metallic", metallic == 0, f"metallicFactor={metallic}")

    print(f"\n{PASSED} checks passed")


if __name__ == "__main__":
    main()
