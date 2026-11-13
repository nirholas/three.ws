"""
The owned parametric reconstruction template (templates/parametric.glb).

Run: python3 -m pytest -q test_parametric_template.py

Pins what the pipeline relies on when RECON_TEMPLATE=parametric: the template
describes itself (head mesh, skin meshes, materials, anchors, body presets), the
head carries the full ARKit and viseme rig, body_type bakes three different
bodies onto the floor, the face looks down +Z, the identity morph keeps the head's
topology and leaves the neck seam welded to the body, and the precomputed UV map
lands every landmark on the head's front.
"""

import json

import numpy as np

import face_geometry as fg
import glb_ops
import recon_templates as rt

SPEC = rt.PARAMETRIC

# Apple's ARKit blendshape set, the contract every three.ws avatar face speaks.
ARKIT_52 = [
    "browDownLeft", "browDownRight", "browInnerUp", "browOuterUpLeft", "browOuterUpRight",
    "cheekPuff", "cheekSquintLeft", "cheekSquintRight",
    "eyeBlinkLeft", "eyeBlinkRight", "eyeLookDownLeft", "eyeLookDownRight",
    "eyeLookInLeft", "eyeLookInRight", "eyeLookOutLeft", "eyeLookOutRight",
    "eyeLookUpLeft", "eyeLookUpRight", "eyeSquintLeft", "eyeSquintRight",
    "eyeWideLeft", "eyeWideRight",
    "jawForward", "jawLeft", "jawOpen", "jawRight",
    "mouthClose", "mouthDimpleLeft", "mouthDimpleRight", "mouthFrownLeft", "mouthFrownRight",
    "mouthFunnel", "mouthLeft", "mouthLowerDownLeft", "mouthLowerDownRight",
    "mouthPressLeft", "mouthPressRight", "mouthPucker", "mouthRight",
    "mouthRollLower", "mouthRollUpper", "mouthShrugLower", "mouthShrugUpper",
    "mouthSmileLeft", "mouthSmileRight", "mouthStretchLeft", "mouthStretchRight",
    "mouthUpperUpLeft", "mouthUpperUpRight", "noseSneerLeft", "noseSneerRight",
    "tongueOut",
]
# The Oculus/Meta 15-viseme set the talking-head runtime drives.
VISEMES_15 = [
    "viseme_sil", "viseme_PP", "viseme_FF", "viseme_TH", "viseme_DD", "viseme_kk",
    "viseme_CH", "viseme_SS", "viseme_nn", "viseme_RR", "viseme_aa", "viseme_E",
    "viseme_I", "viseme_O", "viseme_U",
]


def _mesh(glb, name):
    return next(m for m in glb.meshes if m.name == name)


def _all_positions(glb, mesh_name):
    blob = glb.binary_blob()
    return np.concatenate([glb_ops._read_accessor(glb, blob, p.attributes.POSITION)
                           for p in _mesh(glb, mesh_name).primitives])


def test_template_describes_itself():
    glb = rt.load(SPEC, "neutral")
    info = glb_ops.template_info(glb)
    assert info["headMesh"] == SPEC.head_mesh == glb_ops.head_mesh_name(glb)
    assert info["materials"]["skin"] == SPEC.skin_material
    assert info["materials"]["eyes"] == SPEC.eye_material
    assert set(info["bodyTypes"]) == set(rt.BODY_TYPES)
    names = {m.name for m in glb.materials}
    assert {SPEC.skin_material, SPEC.eye_material} <= names
    assert glb_ops.get_material_texture(glb, SPEC.skin_material) is not None


def test_head_carries_52_arkit_and_15_visemes():
    glb = rt.load(SPEC, "neutral")
    head = _mesh(glb, SPEC.head_mesh)
    names = head.extras["targetNames"]
    prim = glb_ops._find_head_prim(glb)
    assert len(names) == len(prim.targets), "targetNames out of step with the morph targets"
    missing = [n for n in ARKIT_52 + VISEMES_15 if n not in names]
    assert not missing, f"head is missing face shapes: {missing}"
    assert len(set(names)) == len(names), "duplicate morph target names on the head"


def test_body_types_bake_three_bodies_standing_on_the_floor():
    heights, sigs = {}, {}
    for bt in rt.BODY_TYPES:
        glb = rt.load(SPEC, bt)
        body = _all_positions(glb, "Body")
        assert abs(float(body[:, 1].min())) < 0.005, f"{bt}: feet are off the floor"
        heights[bt] = float(np.concatenate([body, _all_positions(glb, "Head")])[:, 1].max())
        sigs[bt] = glb_ops.save_glb(glb)
    assert len(set(sigs.values())) == 3, "body_type did not change the output"
    assert heights["male"] > heights["neutral"] > heights["female"], heights
    for bt in ("male", "female"):
        assert abs(heights[bt] - heights["neutral"]) < 0.15, f"{bt} stature is implausible: {heights}"


def test_invalid_body_type_is_the_neutral_body():
    a = glb_ops.save_glb(rt.load(SPEC, "neutral"))
    b = glb_ops.save_glb(rt.load(SPEC, "robot"))
    assert a == b


def test_skeleton_follows_the_baked_body():
    """A baked body whose joints stayed at the neutral rest pose skins wrongly."""
    neutral, male = rt.load(SPEC, "neutral"), rt.load(SPEC, "male")
    skin_n, skin_m = neutral.skins[0], male.skins[0]
    ibm_n = glb_ops._read_accessor(neutral, neutral.binary_blob(), skin_n.inverseBindMatrices)
    ibm_m = glb_ops._read_accessor(male, male.binary_blob(), skin_m.inverseBindMatrices)
    assert ibm_n.shape == ibm_m.shape
    assert not np.allclose(ibm_n, ibm_m), "inverse bind matrices ignore the body type"


def test_face_points_down_positive_z():
    """
    The camera fit and the UV precompute both assume the face looks toward +Z.
    A template exported facing -Z would project the photo onto the back of the head.
    """
    glb = rt.load(SPEC, "neutral")
    head, _, _ = glb_ops.get_head_mesh_data(glb)
    anchors = glb_ops.template_info(glb)["anchors"]
    nose = np.array(anchors["noseTip"])
    z_min, z_max = float(head[:, 2].min()), float(head[:, 2].max())
    assert nose[2] > (z_min + z_max) / 2 + 0.05, "nose tip is not in front of the head"
    assert z_max - nose[2] < 0.01, "something on the head sits further forward than the nose"
    assert nose[2] > anchors["eyeLeft"][2] and nose[2] > anchors["eyeRight"][2]
    assert anchors["eyeLeft"][0] > 0 > anchors["eyeRight"][0], "left/right are mirrored"
    nearest = head[np.argmin(np.linalg.norm(head - nose, axis=1))]
    assert np.linalg.norm(nearest - nose) < 0.01, "nose anchor does not sit on the head mesh"


def test_uv_map_puts_landmarks_on_the_face():
    uv = json.loads(SPEC.uv_map_path.read_text())
    assert uv["template"] == SPEC.key and uv["uv_alignment"] == "anchors"
    glb = rt.load(SPEC, "neutral")
    head, _, _ = glb_ops.get_head_mesh_data(glb)
    vtx = np.asarray(uv["landmark_vtx"])
    assert len(vtx) == 468 and int(vtx.max()) < len(head)
    front = head[vtx, 2] > np.median(head[:, 2])
    assert front.all(), f"{int((~front).sum())} landmarks snapped to the back of the head"
    # MediaPipe 1 is the nose tip, 152 the chin: the chin sits well below the nose.
    assert head[vtx[152], 1] < head[vtx[1], 1] - 0.05


def test_identity_morph_keeps_topology_and_welds_the_neck():
    glb = rt.load(SPEC, "neutral")
    base, uvs, faces = glb_ops.get_head_mesh_data(glb)
    fmap = fg.FaceMap.load(SPEC.uv_map_path)
    assert fmap is not None
    wide = fmap.canonical_norm.copy()
    wide[:, 0] *= 1.2
    morphed = fg.morph_head_to_landmarks(base.astype(np.float64), fmap, wide, strength=1.0)
    assert np.linalg.norm(morphed - base, axis=1).max() > 1e-3, "morph did nothing"

    body = _all_positions(glb, "Body")
    body_keys = {tuple(k) for k in np.round(body * 1e5).astype(np.int64)}
    seam = np.array([tuple(k) in body_keys for k in np.round(base * 1e5).astype(np.int64)])
    assert seam.any(), "head shares no vertices with the body; the seam test is vacuous"

    glb_ops.set_head_geometry(glb, morphed, faces=faces)
    out = glb_ops.load_glb(glb_ops.save_glb(glb))
    pos2, uvs2, faces2 = glb_ops.get_head_mesh_data(out)
    assert pos2.shape == base.shape, "head vertex count changed"
    np.testing.assert_array_equal(faces2, faces)
    np.testing.assert_allclose(uvs2, uvs, atol=1e-6)
    np.testing.assert_allclose(pos2[seam], base[seam], atol=1e-6,
                               err_msg="neck seam vertices moved: the head tore off the body")
    np.testing.assert_allclose(pos2[~seam], morphed[~seam].astype(np.float32), atol=1e-5)
    prim = glb_ops._find_head_prim(out)
    assert len(prim.targets) == len(glb_ops._find_head_prim(glb).targets)
    assert prim.attributes.JOINTS_0 is not None and prim.attributes.WEIGHTS_0 is not None


def test_iris_recolour_leaves_the_sclera_white():
    import face_pipeline as fp

    glb = rt.load(SPEC, "neutral")
    tex = glb_ops.get_material_texture(glb, SPEC.eye_material)
    iris = glb_ops.template_info(glb)["eyeIris"]
    out = np.asarray(fp._recolour_iris(tex, np.array([40.0, 110.0, 200.0]), iris), dtype=np.float32)
    src = np.asarray(tex.convert("RGB"), dtype=np.float32)
    h, w = src.shape[:2]
    yy, xx = np.mgrid[0:h, 0:w]
    r = np.hypot((xx + 0.5) / w - iris["centerUv"][0], (yy + 0.5) / h - iris["centerUv"][1])
    sclera = r > iris["radiusUv"] * 1.2
    ring = (r > iris["pupilRadiusUv"] * 1.5) & (r < iris["radiusUv"] * 0.8)
    pupil = r < iris["pupilRadiusUv"] * 0.5
    np.testing.assert_array_equal(out[sclera], src[sclera])
    np.testing.assert_allclose(out[pupil], src[pupil], atol=1.0)
    blue = out[ring].mean(axis=0)
    assert blue[2] > blue[0] + 40, f"iris did not take the eye colour: mean {blue}"


def test_saved_glb_stays_spec_valid():
    """
    pygltflib fills spec defaults in on load and writes them back on save, two of
    them illegally: byteOffset on the template's sparse morph accessors (which
    have no bufferView; validator UNSATISFIED_DEPENDENCY) and alphaCutoff on
    opaque materials (MATERIAL_ALPHA_CUTOFF_INVALID_MODE).
    """
    import struct

    data = glb_ops.save_glb(rt.load(SPEC, "male"))
    # Read the JSON chunk off the wire: reloading through pygltflib would put
    # its byteOffset default straight back and hide the bug.
    (json_len,) = struct.unpack_from("<I", data, 12)
    doc = json.loads(data[20:20 + json_len])
    sparse = [a for a in doc["accessors"] if "sparse" in a]
    assert sparse, "template has no sparse accessors; this test no longer guards anything"
    bad = [i for i, a in enumerate(doc["accessors"]) if "bufferView" not in a and "byteOffset" in a]
    assert not bad, f"{len(bad)} accessors carry byteOffset without a bufferView, e.g. #{bad[0]}"
    # Same default leak on materials: alphaCutoff is only legal in MASK mode.
    cutoff = [m["name"] for m in doc["materials"]
              if "alphaCutoff" in m and m.get("alphaMode", "OPAQUE") != "MASK"]
    assert not cutoff, f"alphaCutoff written on non-MASK materials: {cutoff}"


if __name__ == "__main__":
    import sys

    tests = [v for k, v in sorted(globals().items()) if k.startswith("test_")]
    try:
        for t in tests:
            t()
            print(f"ok  {t.__name__}")
    except AssertionError as e:
        print("FAIL:", e)
        sys.exit(1)
    print(f"\nall {len(tests)} parametric-template tests passed")
