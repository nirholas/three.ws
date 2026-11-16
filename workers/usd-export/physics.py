"""Collision, rigid body and mass for an exported asset (UsdPhysics).

Collision comes from CoACD (approximate convex decomposition, MIT licensed,
https://github.com/SarahWeiii/CoACD): the visual mesh is split into a small set
of convex hulls, each authored as a guide-purpose UsdGeom.Mesh with
PhysicsCollisionAPI and PhysicsMeshCollisionAPI (approximation "convexHull").
Convex hulls are what every PhysX-class solver collides fastest and most
robustly; a raw triangle mesh cannot be a dynamic collider at all.

Mass = volume x effective density (semantics.py). Volume comes from the
visual mesh when it is watertight (exact), otherwise from the union of the
hulls (the solid the simulator actually collides with). Centre of mass and
the inertia tensor are computed from the same solid and diagonalised into
`physics:diagonalInertia` + `physics:principalAxes`, so the solver never has
to guess. Every number and the method behind it is written to
`customData["threews:physics"]` on the root prim and to the layer metadata.
"""

from __future__ import annotations

import time
from dataclasses import dataclass

import numpy as np
from pxr import Gf, Sdf, Usd, UsdGeom, UsdPhysics, UsdShade, Vt

COACD_PARAMS = {
    "threshold": 0.08,
    "max_convex_hull": 24,
    "preprocess_mode": "auto",
    "preprocess_resolution": 50,
    "resolution": 2000,
    "mcts_nodes": 15,
    "mcts_iterations": 100,
    "mcts_max_depth": 2,
    "seed": 0,
}
# CoACD time grows with triangle count; above this the mesh is decimated by
# vertex clustering first. Collision needs shape, not texture-level detail.
MAX_COACD_TRIANGLES = 60000


@dataclass
class MassProps:
    mass: float
    volume: float
    center: np.ndarray
    inertia_diag: np.ndarray
    principal_axes: Gf.Quatf
    method: str


def _cluster_decimate(points: np.ndarray, tris: np.ndarray, target: int) -> tuple[np.ndarray, np.ndarray]:
    """Vertex-clustering decimation to roughly `target` triangles (shape-preserving, fast)."""
    lo, hi = points.min(axis=0), points.max(axis=0)
    size = float((hi - lo).max()) or 1.0
    cells = int(np.sqrt(target / 2.0) * 1.6)
    for _ in range(8):
        cell = size / max(cells, 4)
        key = np.floor((points - lo) / cell).astype(np.int64)
        uniq, inverse = np.unique(key, axis=0, return_inverse=True)
        inverse = inverse.reshape(-1)
        sums = np.zeros((len(uniq), 3))
        np.add.at(sums, inverse, points)
        counts = np.bincount(inverse, minlength=len(uniq))[:, None]
        new_pts = sums / counts
        new_tris = inverse[tris]
        keep = (new_tris[:, 0] != new_tris[:, 1]) & (new_tris[:, 1] != new_tris[:, 2]) & (new_tris[:, 0] != new_tris[:, 2])
        new_tris = new_tris[keep]
        if len(new_tris) <= target * 1.25:
            return new_pts, new_tris
        cells = int(cells * 0.8)
    return new_pts, new_tris


def decompose(points: np.ndarray, tris: np.ndarray) -> tuple[list, dict]:
    """CoACD convex decomposition. Returns ([(verts, faces)], info)."""
    import coacd

    coacd.set_log_level("error")
    from importlib.metadata import version

    info = {"tool": "CoACD", "version": version("coacd"), "params": dict(COACD_PARAMS)}
    src_pts, src_tris = points, tris
    if len(tris) > MAX_COACD_TRIANGLES:
        src_pts, src_tris = _cluster_decimate(points, tris, MAX_COACD_TRIANGLES)
        info["decimated_from_triangles"] = int(len(tris))
        info["decimated_to_triangles"] = int(len(src_tris))
    t0 = time.monotonic()
    mesh = coacd.Mesh(np.ascontiguousarray(src_pts, dtype=np.float64), np.ascontiguousarray(src_tris, dtype=np.int64))
    parts = coacd.run_coacd(mesh, **COACD_PARAMS)
    info["seconds"] = round(time.monotonic() - t0, 2)
    hulls = [(np.asarray(v, dtype=np.float64), np.asarray(f, dtype=np.int64)) for v, f in parts if len(f) >= 4]
    if not hulls:
        hulls = [_convex_hull(points)]
        info["fallback"] = "single convex hull (CoACD returned no parts)"
    info["hulls"] = len(hulls)
    return hulls, info


def _convex_hull(points: np.ndarray):
    import trimesh

    h = trimesh.convex.convex_hull(points)
    return np.asarray(h.vertices, dtype=np.float64), np.asarray(h.faces, dtype=np.int64)


def _solid_props(points: np.ndarray, tris: np.ndarray):
    """Volume, centroid and inertia tensor (unit density) of a closed triangle mesh."""
    import trimesh

    m = trimesh.Trimesh(points, tris, process=False)
    if m.volume < 0:
        m.invert()
    return float(m.volume), np.asarray(m.center_mass, dtype=np.float64), np.asarray(m.moment_inertia, dtype=np.float64), m


def mass_properties(points: np.ndarray, tris: np.ndarray, hulls: list, density: float) -> MassProps:
    import trimesh

    visual = trimesh.Trimesh(points, tris, process=True)
    if visual.is_watertight and visual.is_winding_consistent and visual.volume > 1e-9:
        vol, com, inertia, _ = _solid_props(np.asarray(visual.vertices), np.asarray(visual.faces))
        method = "visual mesh volume (watertight)"
    else:
        vol, first_moment, inertia_sum = 0.0, np.zeros(3), np.zeros((3, 3))
        parts = []
        for hv, hf in hulls:
            v, c, i, _ = _solid_props(hv, hf)
            if v <= 0:
                continue
            parts.append((v, c, i))
            vol += v
            first_moment += v * c
        if vol <= 0:
            raise ValueError("collision hulls enclose no volume")
        com = first_moment / vol
        for v, c, i in parts:
            d = c - com
            # inertia (unit density) about the part centroid, shifted to the overall centroid
            inertia_sum += i + v * (np.dot(d, d) * np.eye(3) - np.outer(d, d))
        inertia = inertia_sum
        method = "sum of convex hull volumes (visual mesh is not watertight)"
    mass = vol * density
    inertia = inertia * density
    evals, evecs = np.linalg.eigh(inertia)
    if np.linalg.det(evecs) < 0:
        evecs[:, 0] = -evecs[:, 0]
    from gltf_reader import matrix_to_quat

    q = matrix_to_quat(evecs)  # x, y, z, w
    floor = mass * 1e-6
    evals = np.maximum(evals, floor)
    return MassProps(mass, vol, com, evals, Gf.Quatf(float(q[3]), float(q[0]), float(q[1]), float(q[2])), method)


def author_physics(stage: Usd.Stage, root_path: Sdf.Path, points: np.ndarray, tris: np.ndarray,
                   cls, *, kinematic: bool) -> dict:
    """Write collision hulls, physics material, rigid body and mass. Returns the metadata record."""
    hulls, deco = decompose(points, tris)
    col_path = root_path.AppendChild("Collisions")
    UsdGeom.Xform.Define(stage, col_path)

    phys_mat_path = root_path.AppendChild("Looks").AppendChild("PhysicsMaterial")
    phys_mat = UsdShade.Material.Define(stage, phys_mat_path)
    pm = UsdPhysics.MaterialAPI.Apply(phys_mat.GetPrim())
    pm.CreateStaticFrictionAttr(float(cls.static_friction))
    pm.CreateDynamicFrictionAttr(float(cls.dynamic_friction))
    pm.CreateRestitutionAttr(float(cls.restitution))
    pm.CreateDensityAttr(float(cls.density))

    for i, (hv, hf) in enumerate(hulls):
        mesh = UsdGeom.Mesh.Define(stage, col_path.AppendChild(f"Hull_{i:02d}"))
        mesh.CreatePointsAttr(Vt.Vec3fArray.FromNumpy(np.ascontiguousarray(hv, dtype=np.float32)))
        mesh.CreateFaceVertexCountsAttr(Vt.IntArray.FromNumpy(np.full(len(hf), 3, dtype=np.int32)))
        mesh.CreateFaceVertexIndicesAttr(Vt.IntArray.FromNumpy(hf.reshape(-1).astype(np.int32)))
        mesh.CreateSubdivisionSchemeAttr(UsdGeom.Tokens.none)
        mesh.CreatePurposeAttr(UsdGeom.Tokens.guide)
        mesh.CreateExtentAttr(Vt.Vec3fArray([Gf.Vec3f(*hv.min(axis=0).tolist()), Gf.Vec3f(*hv.max(axis=0).tolist())]))
        normals = _face_normals_faceVarying(hv, hf)
        mesh.CreateNormalsAttr(Vt.Vec3fArray.FromNumpy(normals))
        mesh.SetNormalsInterpolation(UsdGeom.Tokens.faceVarying)
        prim = mesh.GetPrim()
        UsdPhysics.CollisionAPI.Apply(prim)
        UsdPhysics.MeshCollisionAPI.Apply(prim).CreateApproximationAttr(UsdPhysics.Tokens.convexHull)
        UsdShade.MaterialBindingAPI.Apply(prim).Bind(
            phys_mat, UsdShade.Tokens.weakerThanDescendants, "physics")

    record = {
        "collision": {
            "method": "convex decomposition",
            **deco,
            "approximation": "convexHull",
        },
        "material": cls.material,
        "density_kg_m3": cls.density,
        "static_friction": cls.static_friction,
        "dynamic_friction": cls.dynamic_friction,
        "restitution": cls.restitution,
    }
    root = stage.GetPrimAtPath(root_path)
    if cls.static_body:
        record["body"] = "static collider (no rigid body: architecture, terrain and trees do not move)"
        return record

    props = mass_properties(points, tris, hulls, cls.density)
    UsdPhysics.RigidBodyAPI.Apply(root)
    rb = UsdPhysics.RigidBodyAPI(root)
    rb.CreateRigidBodyEnabledAttr(True)
    if kinematic:
        rb.CreateKinematicEnabledAttr(True)
    mapi = UsdPhysics.MassAPI.Apply(root)
    mapi.CreateMassAttr(float(props.mass))
    mapi.CreateCenterOfMassAttr(Gf.Vec3f(*props.center.tolist()))
    mapi.CreateDiagonalInertiaAttr(Gf.Vec3f(*props.inertia_diag.tolist()))
    mapi.CreatePrincipalAxesAttr(props.principal_axes)
    record.update({
        "body": "kinematic rigid body (animated character drives it)" if kinematic else "dynamic rigid body",
        "mass_kg": round(props.mass, 4),
        "volume_m3": round(props.volume, 6),
        "mass_method": f"volume x density; volume from {props.method}",
        "center_of_mass_m": [round(float(x), 4) for x in props.center],
        "diagonal_inertia_kg_m2": [float(f"{x:.6g}") for x in props.inertia_diag],
    })
    return record


def _face_normals_faceVarying(v: np.ndarray, f: np.ndarray) -> np.ndarray:
    a, b, c = v[f[:, 0]], v[f[:, 1]], v[f[:, 2]]
    n = np.cross(b - a, c - a)
    ln = np.linalg.norm(n, axis=1, keepdims=True)
    n = n / np.where(ln == 0, 1, ln)
    return np.ascontiguousarray(np.repeat(n, 3, axis=0), dtype=np.float32)
