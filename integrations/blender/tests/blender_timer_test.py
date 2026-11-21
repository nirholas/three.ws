"""Windowed Blender test: the 360 Capture panel never blocks the UI.

Run under Xvfb by ``run_blender_tests.sh`` (``bpy.app.timers`` only fire with a
window event loop, never under ``-b``). It starts the local server that speaks the
capture contract (``c4_server.C4Server``), points the installed extension at it and
drives the real operators from timers, exactly as a click would:

1. Send a 2:1 equirect mp4 (splat lane, trimmed, preview quality). The upload goes
   up in 8 KiB parts with a delay per part, so it takes seconds; the splat result
   is a real 3DGS PLY that gets imported.
2. Send a 2:1 equirect jpg (photo lane): the depth shell GLB is imported.
3. Refresh "Your captures", import a listed capture, add its preview video strip.
4. Send again with a job that never finishes, then Cancel: a DELETE reaches the
   server and the panel says "Cancelled.".

A 20 ms heartbeat timer runs the whole time. While any task is busy it records the
gap between ticks; one long gap would mean the main thread was blocked by network
or file work. The verdict is written to ``--result`` as JSON for the runner.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import threading
import time
import traceback

import addon_utils
import bpy

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
ap = argparse.ArgumentParser()
ap.add_argument("--tests-dir", required=True)
ap.add_argument("--video", required=True)
ap.add_argument("--photo", required=True)
ap.add_argument("--ply", required=True)
ap.add_argument("--glb", required=True)
ap.add_argument("--result", required=True)
ap.add_argument("--screenshot", default="")
ARGS = ap.parse_args(argv)
sys.path.insert(0, ARGS.tests_dir)
from c4_server import API_KEY, C4Server  # noqa: E402

MAX_GAP_S = 0.25           # floor for the stall budget; see redraw_cost()
HEARTBEAT_S = 0.02
DEADLINE_S = 600.0

STATE = {
    "checks": [],
    "max_gap_s": 0.0,
    "busy_ticks": 0,
    "progress_values": set(),
    "stage_texts": set(),
    "max_part_threads": 0,
    "last_tick": None,
    "own_work_until": 0.0,
    "pump_calls": 0,
    "pump_max_s": 0.0,
    "pump_max_finish_s": 0.0,
    "slow_ticks": [],
    "gaps": [],
    "redraw_s": 0.0,
    "viewport_draws_polling": 0,
    "polling_s": 0.0,
    "phase": "boot",
    "phase_started": 0.0,
}
START = time.monotonic()


def check(name, ok, detail=""):
    STATE["checks"].append({"name": name, "ok": bool(ok), "detail": str(detail)})
    print(f"{'PASS' if ok else 'FAIL'} {name}{': ' + str(detail) if detail else ''}")


def pkg_name():
    for mod in addon_utils.modules():
        if mod.__name__.startswith("bl_ext.") and mod.__name__.endswith(".three_ws"):
            if addon_utils.check(mod.__name__)[1]:
                return mod.__name__
    raise RuntimeError("three_ws extension is not enabled")


PKG = pkg_name()
UI = sys.modules[PKG + ".capture360_ui"]
CORE = sys.modules[PKG]
_REAL_PUMP = UI.pump


def timed_pump():
    """The add-on's own main-thread timer, timed. A call that ends the task also fills
    the scene (bpy is not thread-safe, so that one step must run on the main thread)."""
    t0 = time.monotonic()
    result = _REAL_PUMP()
    took = time.monotonic() - t0
    STATE["pump_calls"] += 1
    if result is None:
        STATE["pump_max_finish_s"] = max(STATE["pump_max_finish_s"], took)
        STATE["own_work_until"] = time.monotonic()
    else:
        STATE["pump_max_s"] = max(STATE["pump_max_s"], took)
    return result


UI.pump = timed_pump


def sample_part_threads():
    """Count upload part threads from a plain thread, independent of the UI loop."""
    while STATE["phase"] != "done":
        parts = sum(1 for t in threading.enumerate() if t.name.startswith("threews-part"))
        STATE["max_part_threads"] = max(STATE["max_part_threads"], parts)
        time.sleep(0.002)


def live():
    """The running task's progress as the panel shows it: ``(stage_text, fraction)``."""
    task = UI._task
    return (task.stage_text, task.fraction) if task is not None else ("", 0.0)


def polling():
    """True while the worker only waits on the job: nothing in the scene changes."""
    stage = live()[0]
    return UI.task_running() and bool(stage) and not stage.startswith(("Uploading", "Fetching", "Downloading", "Cancelling"))


def count_viewport_draw():
    if polling():
        STATE["viewport_draws_polling"] += 1


threading.Thread(target=sample_part_threads, daemon=True, name="test-part-sampler").start()
VIEWPORT_DRAW = bpy.types.SpaceView3D.draw_handler_add(count_viewport_draw, (), "WINDOW", "POST_PIXEL")


def read(path):
    with open(path, "rb") as fh:
        return fh.read()


SERVER = C4Server(part_size=8 * 1024, put_delay=0.05, polls_to_finish=6).start()
SERVER.files["results/scene.ply"] = read(ARGS.ply)
SERVER.files["results/scene.glb"] = read(ARGS.glb)
SERVER.files["results/preview.mp4"] = read(ARGS.video)
SERVER.results = {
    "capture": {"ply_url": "results/scene.ply", "preview_url": "results/preview.mp4"},
    "scene": {"glb_url": "results/scene.glb"},
}


def props():
    return bpy.context.scene.three_ws_capture


def view3d_override():
    win = bpy.context.window_manager.windows[0]
    area = next(a for a in win.screen.areas if a.type == "VIEW_3D")
    region = next(r for r in area.regions if r.type == "WINDOW")
    return {"window": win, "area": area, "region": region}


def run_op(op, **kwargs):
    try:
        with bpy.context.temp_override(**view3d_override()):
            return op(**kwargs)
    finally:
        STATE["own_work_until"] = time.monotonic()


def show_panel():
    ov = view3d_override()
    space = ov["area"].spaces.active
    space.show_region_ui = True
    ui_region = next(r for r in ov["area"].regions if r.type == "UI")
    try:
        ui_region.active_panel_category = "three.ws"
    except (AttributeError, TypeError):
        pass


CALIBRATE_S = 1.5


def calibrate(next_phase):
    """Measure a full window repaint through the normal loop: for a moment with no task
    running, every tick tags every area and the longest tick gap is recorded. Under
    Xvfb there is no GPU, so a repaint of a scene holding splats takes a few hundred
    ms; a gap within two repaints is the loop drawing, a longer one means something
    else held the main thread."""
    STATE["after_calibrate"] = next_phase
    STATE["calibrate_last"] = None
    enter("calibrate")


def calibrate_tick():
    now = time.monotonic()
    if STATE["calibrate_last"] is not None:
        STATE["redraw_s"] = max(STATE["redraw_s"], now - STATE["calibrate_last"])
    STATE["calibrate_last"] = now
    for area in bpy.context.window_manager.windows[0].screen.areas:
        area.tag_redraw()
    return now - STATE["phase_started"] >= CALIBRATE_S


def stall_budget():
    return max(MAX_GAP_S, 2.0 * STATE["redraw_s"])


def screenshot():
    if not ARGS.screenshot:
        return
    os.makedirs(os.path.dirname(ARGS.screenshot), exist_ok=True)
    win = bpy.context.window_manager.windows[0]
    with bpy.context.temp_override(window=win):
        bpy.ops.screen.screenshot(filepath=ARGS.screenshot)
    STATE["own_work_until"] = time.monotonic()


def heartbeat():
    now = time.monotonic()
    last = STATE["last_tick"]
    STATE["last_tick"] = now
    if UI.task_running():
        STATE["busy_ticks"] += 1
        # A gap that spans this test's own work (an operator call, the screenshot) or
        # the add-on's final scene fill is accounted for; any other gap is a stall.
        if last is not None and last >= STATE["own_work_until"]:
            STATE["gaps"].append(now - last)
            STATE["max_gap_s"] = max(STATE["max_gap_s"], now - last)
            if now - last > 0.1:
                STATE["slow_ticks"].append(
                    {"phase": STATE["phase"], "stage": live()[0], "gap_ms": round((now - last) * 1000)})
        stage, fraction = live()
        STATE["progress_values"].add(round(fraction, 3))
        if stage:
            STATE["stage_texts"].add(stage)
        if polling() and last is not None:
            STATE["polling_s"] += now - last
    if now - START > DEADLINE_S:
        check("finished before the deadline", False, f"stuck in phase {STATE['phase']}")
        finish()
        return None
    try:
        step()
    except Exception:
        traceback.print_exc()
        check(f"phase {STATE['phase']} raised", False)
        finish()
        return None
    return None if STATE["phase"] == "done" else HEARTBEAT_S


def enter(phase):
    STATE["phase"] = phase
    STATE["phase_started"] = time.monotonic()
    print(f"-- phase {phase}")


def idle():
    return not UI.task_running() and not props().busy


def splat_objects():
    return [o for o in bpy.data.objects if o.name.startswith("three.ws splat")]


def step():
    phase = STATE["phase"]
    p = props()

    if phase == "boot":
        if time.monotonic() - START < 1.0:
            return
        check("online access is on", bpy.app.online_access)
        prefs = CORE._prefs(bpy.context)
        prefs.api_url = SERVER.url
        prefs.api_key = API_KEY
        show_panel()
        calibrate("send-video")
        return

    if phase == "calibrate":
        if calibrate_tick():
            enter(STATE["after_calibrate"])
        return

    if phase == "send-video":
        p.filepath = ARGS.video
        p.quality = "preview"
        p.trim_in = 0.5
        p.trim_out = 2.5
        STATE["t_send"] = time.monotonic()
        result = run_op(bpy.ops.threews.capture_send)
        check("Send returns at once (work moved to a thread)", result == {"FINISHED"}
              and time.monotonic() - STATE["t_send"] < MAX_GAP_S, f"{time.monotonic() - STATE['t_send']:.3f}s")
        check("a task is running after Send", UI.task_running())
        enter("video")
        return

    if phase == "video":
        if not STATE.get("shot") and p.busy and live()[1] > 0.2:
            screenshot()
            STATE["shot"] = True
        if not idle():
            return
        check("video lane finished without an error", not p.message_error, p.message)
        objs = splat_objects()
        check("video lane imported one splat", len(objs) == 1, [o.name for o in objs])
        if objs:
            check("splat has every Gaussian of the result PLY", len(objs[0].data.vertices) == 14526,
                  len(objs[0].data.vertices))
        uploads = [u for u in SERVER.uploads.values() if u["filename"] == os.path.basename(ARGS.video)]
        stored = SERVER.files.get(uploads[0]["key"]) if uploads else None
        check("uploaded bytes equal the source file", stored == read(ARGS.video),
              f"{len(stored or b'')} of {os.path.getsize(ARGS.video)} bytes")
        part_count = -(-os.path.getsize(ARGS.video) // SERVER.part_size)
        rate = STATE["viewport_draws_polling"] / max(STATE["polling_s"], 1e-6)
        check("3D viewport repaints at most once per job update while polling, not five times a second",
              STATE["polling_s"] > 3 and rate < 1.0 / 3.0 + 0.05,
              f"{STATE['viewport_draws_polling']} viewport draws in {STATE['polling_s']:.1f}s of polling")
        check("upload went in parts, four at a time", part_count > 4 and 2 <= STATE["max_part_threads"] <= 4,
              f"{part_count} parts, up to {STATE['max_part_threads']} in flight")
        job = next(j for j in SERVER.jobs.values() if j["api"] == "capture")
        body = job["body"]
        check("capture job carries kind, quality and trim",
              body.get("source_kind") == "equirect_video" and body.get("quality") == "preview"
              and body.get("trim") == {"start_s": 0.5, "end_s": 2.5}, body)
        check("panel showed real stages from the job", any("Training" in s or "Solving" in s for s in STATE["stage_texts"]),
              sorted(STATE["stage_texts"]))
        check("progress bar moved through many values", len(STATE["progress_values"]) >= 5,
              len(STATE["progress_values"]))
        check("unsaved file warning shown", "Save the .blend" in p.message, p.message)
        p.filepath = ARGS.photo
        run_op(bpy.ops.threews.capture_send)
        enter("photo")
        return

    if phase == "photo":
        if not idle():
            return
        check("photo lane finished without an error", not p.message_error, p.message)
        job = next((j for j in SERVER.jobs.values() if j["api"] == "scene"), None)
        check("photo went to the pano-scene lane as an equirect image",
              job is not None and job["body"].get("source_kind") == "equirect_image", job and job["body"])
        meshes = [o for o in bpy.data.objects if o.type == "MESH" and not o.name.startswith("three.ws splat")]
        check("depth shell GLB imported", len(meshes) >= 1, [o.name for o in meshes])
        run_op(bpy.ops.threews.capture_refresh)
        enter("refresh")
        return

    if phase == "refresh":
        if not idle():
            return
        check("Your captures lists the capture job", len(p.captures) == 1 and p.captures[0].status == "succeeded",
              [(c.job_id, c.status) for c in p.captures])
        STATE["listed_job"] = p.captures[0].job_id if len(p.captures) else ""
        run_op(bpy.ops.threews.capture_import, job_id=STATE["listed_job"])
        enter("import")
        return

    if phase == "import":
        if not idle():
            return
        check("Import from the list adds a second splat", len(splat_objects()) == 2, p.message)
        run_op(bpy.ops.threews.capture_preview, job_id=STATE["listed_job"])
        enter("preview")
        return

    if phase == "preview":
        if not idle():
            return
        editor = bpy.context.scene.sequence_editor
        strips = list((getattr(editor, "strips", None) or editor.sequences) if editor else [])
        check("preview video added as a movie strip", any(s.type == "MOVIE" for s in strips), p.message)
        calibrate("send-cancel")   # the heaviest scene of the run: two splats and the shell
        return

    if phase == "send-cancel":
        SERVER.polls_to_finish = 10_000
        STATE["jobs_before_cancel"] = set(SERVER.jobs)
        p.filepath = ARGS.video
        run_op(bpy.ops.threews.capture_send)
        enter("cancel-wait")
        return

    if phase == "cancel-wait":
        running = [j for j in SERVER.jobs.values()
                   if j["id"] not in STATE["jobs_before_cancel"] and j["api"] == "capture" and j["polls"] >= 2]
        if not running:
            return
        STATE["cancel_job"] = running[-1]["id"]
        STATE["t_cancel"] = time.monotonic()
        run_op(bpy.ops.threews.capture_cancel)
        enter("cancelling")
        return

    if phase == "cancelling":
        if not idle():
            return
        took = time.monotonic() - STATE["t_cancel"]
        check("Cancel stops the task within a second", took < 1.0, f"{took:.2f}s")
        check("Cancel sent DELETE for the job",
              ("DELETE", f"/api/pano-capture?job={STATE['cancel_job']}") in SERVER.log
              and SERVER.jobs[STATE["cancel_job"]]["cancelled"], STATE["cancel_job"])
        check("panel says Cancelled", p.message == "Cancelled.", p.message)
        finish()


def finish():
    check("main thread never stalled while a task ran",
          STATE["busy_ticks"] > 50 and STATE["max_gap_s"] < stall_budget(),
          f"{STATE['busy_ticks']} busy ticks, longest gap {STATE['max_gap_s'] * 1000:.0f} ms, "
          f"budget {stall_budget() * 1000:.0f} ms (two window redraws of {STATE['redraw_s'] * 1000:.0f} ms)")
    gaps = sorted(STATE["gaps"])
    p95 = gaps[int(0.95 * (len(gaps) - 1))] if gaps else 1.0
    STATE["p95_gap_s"] = p95
    check("95% of UI ticks while busy arrive within 100 ms (heartbeat 20 ms)", p95 < 0.1,
          f"p95 {p95 * 1000:.0f} ms over {len(gaps)} ticks; slow ticks are repaints: {STATE['slow_ticks']}")
    check("the add-on's progress timer stays tiny", STATE["pump_calls"] > 20 and STATE["pump_max_s"] < 0.05,
          f"{STATE['pump_calls']} calls, longest {STATE['pump_max_s'] * 1000:.1f} ms")
    ok = bool(STATE["checks"]) and all(c["ok"] for c in STATE["checks"])
    with open(ARGS.result, "w", encoding="utf-8") as fh:
        json.dump({
            "ok": ok,
            "blender": bpy.app.version_string,
            "busy_ticks": STATE["busy_ticks"],
            "max_gap_ms": round(STATE["max_gap_s"] * 1000, 1),
            "p95_gap_ms": round(STATE.get("p95_gap_s", 0) * 1000, 1),
            "window_redraw_ms": round(STATE["redraw_s"] * 1000, 1),
            "stall_budget_ms": round(stall_budget() * 1000, 1),
            "max_parts_in_flight": STATE["max_part_threads"],
            "pump_calls": STATE["pump_calls"],
            "pump_max_ms": round(STATE["pump_max_s"] * 1000, 2),
            "scene_fill_max_ms": round(STATE["pump_max_finish_s"] * 1000, 1),
            "slow_ticks": STATE["slow_ticks"],
            "screenshot": ARGS.screenshot if STATE.get("shot") else "",
            "checks": STATE["checks"],
        }, fh, indent=2)
    STATE["phase"] = "done"
    bpy.types.SpaceView3D.draw_handler_remove(VIEWPORT_DRAW, "WINDOW")
    SERVER.stop()
    bpy.app.timers.register(lambda: bpy.ops.wm.quit_blender() and None, first_interval=0.2)


bpy.app.timers.register(heartbeat, first_interval=HEARTBEAT_S, persistent=True)
