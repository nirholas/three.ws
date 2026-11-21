"""Live check: the installed extension sends a real 360 clip to a real three.ws server.

Runs inside a windowed Blender (timers need the event loop; use Xvfb on a server) with
the extension installed and enabled. It points the add-on at ``--api-url`` with a real
API key, clicks Send on the 360 Capture panel, waits for the job, and checks that the
splat was imported and that "Your captures" lists the job. Nothing here is simulated:
the upload, the job and the result all go through the server named on the command line.

    xvfb-run -a -s "-screen 0 1600x1000x24" blender --online-mode --python-exit-code 1 \\
      --python integrations/blender/tests/blender_live_check.py -- \\
      --api-url https://three.ws --api-key-file ~/.config/three-ws/key \\
      --video clip-2to1.mp4 --result live.json

``--api-key-file`` may be left out when ``THREE_WS_API_KEY`` is set. ``--expect-vertices``
pins the Gaussian count when the server's result is known in advance (a local proof
server serving a fixed PLY); against production it only has to be above zero.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
import traceback

import addon_utils
import bpy

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
ap = argparse.ArgumentParser()
ap.add_argument("--api-url", required=True)
ap.add_argument("--api-key-file", default="")
ap.add_argument("--video", required=True)
ap.add_argument("--quality", default="preview", choices=["preview", "standard", "high"])
ap.add_argument("--expect-vertices", type=int, default=0)
ap.add_argument("--timeout", type=float, default=1800.0, help="seconds to wait for the job")
ap.add_argument("--result", required=True)
ARGS = ap.parse_args(argv)

if ARGS.api_key_file:
    with open(os.path.expanduser(ARGS.api_key_file), encoding="utf-8") as fh:
        API_KEY = fh.read().strip()
else:
    API_KEY = os.environ.get("THREE_WS_API_KEY", "").strip()
if not API_KEY:
    sys.exit("blender_live_check: pass --api-key-file or set THREE_WS_API_KEY")

CHECKS = []
STATE = {"phase": "boot", "started": time.monotonic(), "sent": 0.0}


def check(name, ok, detail=""):
    CHECKS.append({"name": name, "ok": bool(ok), "detail": str(detail)})
    print(f"{'PASS' if ok else 'FAIL'} {name}{': ' + str(detail) if detail else ''}")


def enabled_package():
    for mod in addon_utils.modules():
        if mod.__name__.startswith("bl_ext.") and mod.__name__.endswith(".three_ws"):
            if addon_utils.check(mod.__name__)[1]:
                return mod.__name__
    raise RuntimeError("the three_ws extension is not installed and enabled")


PKG = enabled_package()
CORE = sys.modules[PKG]
UI = sys.modules[PKG + ".capture360_ui"]


def props():
    return bpy.context.scene.three_ws_capture


def run_op(op):
    win = bpy.context.window_manager.windows[0]
    area = next(a for a in win.screen.areas if a.type == "VIEW_3D")
    region = next(r for r in area.regions if r.type == "WINDOW")
    with bpy.context.temp_override(window=win, area=area, region=region):
        return op()


def idle():
    return not UI.task_running() and not props().busy


def splats():
    return [o for o in bpy.data.objects if o.name.startswith("three.ws splat")]


def finish():
    ok = bool(CHECKS) and all(c["ok"] for c in CHECKS)
    with open(ARGS.result, "w", encoding="utf-8") as fh:
        json.dump({
            "ok": ok,
            "blender": bpy.app.version_string,
            "extension": PKG,
            "api_url": ARGS.api_url,
            "job_s": round(STATE.get("job_s", 0.0), 1),
            "checks": CHECKS,
        }, fh, indent=2)
    STATE["phase"] = "done"
    bpy.app.timers.register(lambda: bpy.ops.wm.quit_blender() and None, first_interval=0.2)


def step():
    phase = STATE["phase"]
    p = props()
    if phase == "boot":
        prefs = CORE._prefs(bpy.context)
        prefs.api_url = ARGS.api_url
        prefs.api_key = API_KEY
        check("online access is on", bpy.app.online_access)
        p.filepath = os.path.abspath(ARGS.video)
        p.quality = ARGS.quality
        STATE["sent"] = time.monotonic()
        check("Send accepted", run_op(bpy.ops.threews.capture_send) == {"FINISHED"}, p.message)
        STATE["phase"] = "waiting"
        return
    if phase == "waiting":
        if not idle():
            if time.monotonic() - STATE["sent"] > ARGS.timeout:
                run_op(bpy.ops.threews.capture_cancel)
                check("job finished before the timeout", False, f"{ARGS.timeout:.0f}s; cancelled")
                STATE["phase"] = "cancelling"
            return
        STATE["job_s"] = time.monotonic() - STATE["sent"]
        check("capture finished without an error", not p.message_error, p.message)
        objs = splats()
        check("one splat imported", len(objs) == 1, [o.name for o in objs])
        if objs:
            count = len(objs[0].data.vertices)
            want = ARGS.expect_vertices
            check("splat holds the result's Gaussians", count == want if want else count > 0,
                  f"{count} vertices" + (f", expected {want}" if want else ""))
        run_op(bpy.ops.threews.capture_refresh)
        STATE["phase"] = "listing"
        return
    if phase == "listing":
        if not idle():
            return
        statuses = [(c.job_id, c.status) for c in p.captures]
        check("Your captures lists a succeeded capture", any(s == "succeeded" for _, s in statuses), statuses)
        finish()
        return
    if phase == "cancelling" and idle():
        finish()


def tick():
    if STATE["phase"] == "done":
        return None
    try:
        step()
    except Exception:
        traceback.print_exc()
        check("live check ran without an exception", False, traceback.format_exc().splitlines()[-1])
        finish()
        return None
    return 0.1


bpy.context.preferences.view.show_splash = False
bpy.app.timers.register(tick, first_interval=1.0, persistent=True)
