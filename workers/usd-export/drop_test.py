"""Physics drop test: does an exported asset fall, collide and come to rest?

    python drop_test.py path/to/asset.usd [--height 1.0] [--tilt-deg 17] [--seconds 4]

Loads the exported USD into Newton (NVIDIA's open-source, Warp-based physics
engine, which reads UsdPhysics directly: RigidBodyAPI, MassAPI,
CollisionAPI + MeshCollisionAPI convexHull, PhysicsMaterialAPI) on CPU, drops
it from `height` meters with a tilt onto a ground plane, and steps the XPBD
solver. Nothing about the asset is re-specified here: mass, inertia, collision
shapes and friction all come from the exported file.

Pass criteria, printed as JSON:
  * imported mass equals the authored physics:mass
  * the body fell (its lowest point reached the ground)
  * it settled: linear and angular speed below 0.05 over the last 0.5 s
  * no tunnelling: the lowest collision point stays above -1 cm

This is a Warp/Newton check, not Isaac Sim. Isaac Sim's PhysX reads the same
schemas; the asset-side contract (convex hulls, mass, material) is identical.
"""

from __future__ import annotations

import argparse
import json
import math
import sys

import numpy as np


def run(path: str, height: float = 1.0, tilt_deg: float = 17.0, seconds: float = 4.0, fps: int = 120,
        substeps: int = 8) -> dict:
    import warp as wp

    wp.config.quiet = True
    import newton
    from pxr import Usd, UsdGeom, UsdPhysics

    stage = Usd.Stage.Open(path)
    root = stage.GetDefaultPrim()
    authored_mass = UsdPhysics.MassAPI(root).GetMassAttr().Get()
    hull_points = []
    cache = UsdGeom.XformCache()
    for prim in stage.Traverse():
        if prim.HasAPI(UsdPhysics.CollisionAPI) and prim.IsA(UsdGeom.Mesh):
            m = np.array(cache.GetLocalToWorldTransform(prim))
            pts = np.array(UsdGeom.Mesh(prim).GetPointsAttr().Get(), dtype=np.float64)
            hull_points.append(np.c_[pts, np.ones(len(pts))] @ m)
    hull_points = np.concatenate(hull_points)[:, :3]

    builder = newton.ModelBuilder()
    builder.add_ground_plane()
    q = wp.quat_from_axis_angle(wp.vec3(1.0, 0.0, 0.0), math.radians(tilt_deg))
    builder.add_usd(path, xform=wp.transform((0.0, 0.0, height), q), floating=True, load_visual_shapes=False)
    model = builder.finalize(device="cpu")
    imported_mass = float(model.body_mass.numpy()[0])

    solver = newton.solvers.SolverXPBD(model, iterations=10)
    s0, s1 = model.state(), model.state()
    control = model.control()
    dt = 1.0 / fps / substeps
    frames = int(seconds * fps)
    trace = []

    def lowest(state) -> float:
        tf = state.body_q.numpy()[0]
        pos, rot = tf[:3], tf[3:7]  # warp quat is x, y, z, w
        x, y, z, w = rot
        r = np.array([[1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
                      [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
                      [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]])
        return float((hull_points @ r.T + pos)[:, 2].min())

    start_low = lowest(s0)
    min_low = start_low
    for f in range(frames):
        for _ in range(substeps):
            s0.clear_forces()
            contacts = model.collide(s0)
            solver.step(s0, s1, control, contacts, dt)
            s0, s1 = s1, s0
        qd = s0.body_qd.numpy()[0]
        low = lowest(s0)
        min_low = min(min_low, low)
        trace.append((f / fps, low, float(np.linalg.norm(qd[:3])), float(np.linalg.norm(qd[3:]))))

    tail = [t for t in trace if t[0] >= seconds - 0.5]
    settled_lin = max(t[2] for t in tail)
    settled_ang = max(t[3] for t in tail)
    first_contact = next((t[0] for t in trace if t[1] <= 0.01), None)
    result = {
        "engine": f"Newton {newton.__version__} (Warp {wp.__version__}, XPBD, CPU)",
        "asset": path,
        "authored_mass_kg": round(float(authored_mass), 4),
        "imported_mass_kg": round(imported_mass, 4),
        "collision_shapes": int(model.shape_count - 1),
        "drop_height_m": height,
        "start_lowest_point_m": round(start_low, 4),
        "first_contact_s": first_contact,
        "min_lowest_point_m": round(min_low, 4),
        "final_lowest_point_m": round(trace[-1][1], 4),
        "final_linear_speed_m_s": round(trace[-1][2], 5),
        "final_angular_speed_rad_s": round(trace[-1][3], 5),
        "settled_max_linear_speed_last_0_5s": round(settled_lin, 5),
        "settled_max_angular_speed_last_0_5s": round(settled_ang, 5),
    }
    result["checks"] = {
        "mass_imported": abs(imported_mass - authored_mass) <= 1e-3 * max(1.0, authored_mass),
        "fell_and_collided": first_contact is not None,
        "settled": settled_lin < 0.05 and settled_ang < 0.05,
        "no_tunnelling": min_low > -0.01,
    }
    result["passed"] = all(result["checks"].values())
    return result


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("usd")
    ap.add_argument("--height", type=float, default=1.0)
    ap.add_argument("--tilt-deg", type=float, default=17.0)
    ap.add_argument("--seconds", type=float, default=4.0)
    args = ap.parse_args(argv)
    res = run(args.usd, args.height, args.tilt_deg, args.seconds)
    print(json.dumps(res, indent=2))
    return 0 if res["passed"] else 1


if __name__ == "__main__":
    sys.exit(main())
