"""The "360 Capture" sidebar panel: send 360 footage to three.ws, import the result.

All network work (upload, polling, downloads) runs on a worker thread that never
touches ``bpy.data``. It posts events to a queue; a ``bpy.app.timers`` callback on the
main thread drains the queue, updates the panel properties and, when a job finishes,
does the import. Paths that depend on ``bpy.data`` (the .blend directory, the
extension's user directory, preferences) are resolved on the main thread before the
worker starts.
"""

from __future__ import annotations

import os
import queue
import sys
import tempfile
import textwrap
import threading
import webbrowser

import bpy
from bpy.props import (
    BoolProperty,
    CollectionProperty,
    EnumProperty,
    FloatProperty,
    IntProperty,
    StringProperty,
)
from bpy.types import Operator, Panel, PropertyGroup, UIList

from . import capture360_import as importer
from . import ply_reader
from .capture360_client import (
    QUALITIES,
    Cancelled,
    Capture360Client,
    file_ext,
    lane_for,
    source_kind_for,
)
from .three_ws_client import ThreeWSError

STAGE_LABELS = {
    "download": "Fetching the file",
    "stitch": "Stitching the lenses",
    "frames": "Extracting frames",
    "sfm": "Solving camera positions",
    "train": "Training the splat",
    "export": "Exporting",
    "upload": "Saving the result",
    "queued": "Waiting for a GPU",
    "depth": "Estimating depth",
    "mesh": "Building the shell",
}
FILE_HELP = ".insv, .insp, a 2:1 mp4 or mov, or a 2:1 jpg, png or exr"
PUMP_INTERVAL = 0.2


def _core():
    """The extension package module (preferences helpers live there)."""
    return sys.modules[__package__]


# -- background task runner ------------------------------------------------------

class _Task:
    """One worker thread plus its event queue and cancel flag.

    Live progress (``stage_text``, ``fraction``) lives here, not on the scene: every
    Python write to a scene property repaints the whole window, so the panel reads
    these and the timer redraws only the sidebar.
    """

    def __init__(self, work, on_result):
        self.events = queue.Queue()
        self.cancel = threading.Event()
        self.on_result = on_result
        self.job_id = ""
        self.scene_name = ""
        self.stage_text = "Starting"
        self.fraction = 0.0
        self.thread = threading.Thread(target=self._run, args=(work,), daemon=True, name="threews-capture")

    def _run(self, work):
        try:
            self.events.put(("result", work(self)))
        except Cancelled:
            self.events.put(("cancelled", None))
        except ThreeWSError as exc:
            self.events.put(("error", exc.message))
        except Exception as exc:
            self.events.put(("error", f"{type(exc).__name__}: {exc}"))

    def progress(self, text, fraction=None):
        self.events.put(("progress", (text, fraction)))


_task = None


def task_running() -> bool:
    return _task is not None


def start_task(context, work, on_result):
    """Start ``work(task)`` on a thread and drive the UI from a main-thread timer."""
    global _task
    if _task is not None:
        raise RuntimeError("A capture task is already running.")
    props = context.scene.three_ws_capture
    props.busy = True
    props.message = ""
    props.message_error = False
    _task = _Task(work, on_result)
    _task.scene_name = context.scene.name
    _task.thread.start()
    bpy.app.timers.register(pump, first_interval=PUMP_INTERVAL)
    return _task


def _redraw():
    # Only the sidebar shows progress. Tagging the whole area would also repaint the
    # 3D viewport (and any splat in it) five times a second for the length of a job.
    wm = bpy.context.window_manager
    for win in wm.windows:
        for area in win.screen.areas:
            if area.type == "VIEW_3D":
                for region in area.regions:
                    if region.type == "UI":
                        region.tag_redraw()


def pump():
    """Main-thread timer: apply worker events. Returns the next interval, or None when idle."""
    global _task
    task = _task
    if task is None:
        return None
    scene = bpy.data.scenes.get(task.scene_name)
    props = scene.three_ws_capture if scene is not None else None
    finished = None
    shown = (task.stage_text, task.fraction)
    try:
        while True:
            kind, payload = task.events.get_nowait()
            if kind == "progress":
                text, fraction = payload
                task.stage_text = text
                if fraction is not None:
                    task.fraction = max(0.0, min(1.0, fraction))
            elif kind in ("result", "error", "cancelled"):
                finished = (kind, payload)
    except queue.Empty:
        pass
    if finished is not None:
        _task = None
        kind, payload = finished
        if props is not None:
            props.busy = False
        if kind == "result":
            try:
                message = task.on_result(bpy.context, payload)
                _set_message(props, message, False)
            except Exception as exc:
                _set_message(props, f"Import failed: {exc}", True)
        elif kind == "error":
            _set_message(props, payload, True)
        else:
            _set_message(props, "Cancelled.", False)
        _redraw()
        return None
    # Repaint only when the bar changed: with the sidebar open, a sidebar repaint also
    # repaints the 3D viewport, so idle polling ticks must not trigger one.
    if (task.stage_text, task.fraction) != shown:
        _redraw()
    return PUMP_INTERVAL


def _set_message(props, text, is_error):
    if props is None:
        return
    props.message = text or ""
    props.message_error = bool(is_error)
    print(f"three.ws 360 Capture: {text}")


# -- properties ------------------------------------------------------------------

class ThreeWSCaptureItem(PropertyGroup):
    job_id: StringProperty()
    status: StringProperty()
    created_at: StringProperty()
    source_kind: StringProperty()
    viewer_url: StringProperty()


class ThreeWSCaptureProps(PropertyGroup):
    filepath: StringProperty(
        name="File",
        description=f"A 360 file: {FILE_HELP}",
        subtype="FILE_PATH",
    )
    filepath2: StringProperty(
        name="Second file",
        description="The second lens file of a split-pair .insv recording (optional)",
        subtype="FILE_PATH",
    )
    quality: EnumProperty(
        name="Quality",
        items=[
            ("preview", "Preview", "Fast and rough: 1 fps, 120 frames, a short training run"),
            ("standard", "Standard", "2 fps, 300 frames, full training run"),
            ("high", "High", "3 fps, 600 frames, more Gaussians"),
        ],
        default="standard",
    )
    trim_in: FloatProperty(name="In", description="Start of the clip in seconds", default=0.0, min=0.0, unit="TIME_ABSOLUTE")
    trim_out: FloatProperty(
        name="Out", description="End of the clip in seconds (0 means the whole clip)", default=0.0, min=0.0, unit="TIME_ABSOLUTE"
    )
    up_axis: EnumProperty(
        name="Up axis",
        description="Orientation of the splat file. Captures from three.ws come out of the reconstruction Y down",
        items=[(key, label, desc) for key, (label, desc, _) in importer.UP_AXES.items()],
        default=importer.DEFAULT_UP_AXIS,
    )
    busy: BoolProperty(default=False)
    message: StringProperty()
    message_error: BoolProperty(default=False)
    captures: CollectionProperty(type=ThreeWSCaptureItem)
    active_capture: IntProperty(default=0)
    listed: BoolProperty(default=False)


# -- helpers ---------------------------------------------------------------------

def _make_client(context):
    core = _core()
    prefs = core._prefs(context)
    key = core._api_key(prefs)
    if not key:
        raise ThreeWSError(core._NO_KEY, code="sign_in_required")
    try:
        state_dir = bpy.utils.extension_path_user(__package__, create=True)
    except (ValueError, RuntimeError):
        state_dir = os.path.join(tempfile.gettempdir(), "three_ws_state")
    return Capture360Client(
        prefs.api_url,
        api_key=key,
        online_guard=core._offline_reason,
        state_dir=state_dir,
    )


def _downloads_base():
    """Resolve on the main thread: <blend dir>/three_ws_captures, or a temp dir."""
    if bpy.data.filepath:
        return os.path.join(os.path.dirname(bpy.data.filepath), "three_ws_captures"), True
    return os.path.join(tempfile.gettempdir(), "three_ws_captures"), False


def _job_dir(base, job_id):
    safe = "".join(c for c in job_id if c.isalnum() or c in "-_")[:64] or "capture"
    path = os.path.join(base, safe)
    os.makedirs(path, exist_ok=True)
    return path


def _stage_text(body):
    stage = body.get("stage") or body.get("status") or ""
    label = STAGE_LABELS.get(stage, stage.replace("_", " ").capitalize() or "Working")
    return label


def _fetch_results(client, task, kind, job_id, body, base, preread):
    """Download the result files of a finished job. Runs on the worker thread."""
    result = body.get("result") or {}
    folder = _job_dir(base, job_id)
    files = {"lane": kind, "job_id": job_id, "folder": folder}
    if kind == "splat":
        ply_url = result.get("ply_url")
        if not ply_url:
            raise ThreeWSError("The capture finished without a splat file.", code="no_result")
        task.progress("Downloading the splat", 0.0)
        files["ply"] = client.download(
            ply_url,
            os.path.join(folder, "scene.ply"),
            progress=lambda f: task.progress("Downloading the splat", f),
            should_cancel=task.cancel.is_set,
        )
        files["viewer_url"] = result.get("viewer_url") or ""
        if preread:
            task.progress("Reading the splat", None)
            files["points"] = ply_reader.read_points(files["ply"], importer.POINT_LIMIT)
    else:
        glb_url = result.get("glb_url")
        if not glb_url:
            raise ThreeWSError("The scene finished without a GLB.", code="no_result")
        task.progress("Downloading the depth shell", 0.0)
        files["glb"] = client.download(
            glb_url,
            os.path.join(folder, "scene.glb"),
            progress=lambda f: task.progress("Downloading the depth shell", f),
            should_cancel=task.cancel.is_set,
        )
        files["viewer_url"] = result.get("viewer_url") or ""
    return files


def _finish_import(context, files):
    """Main thread: put downloaded files into the scene. Returns the user message."""
    props = context.scene.three_ws_capture
    saved_note = ""
    if not bpy.data.filepath:
        saved_note = f" Save the .blend so the files in {files['folder']} are kept next to it."
    if files["lane"] == "splat":
        obj, message = importer.import_splat(context, files["ply"], props.up_axis, name=f"three.ws splat {files['job_id'][:8]}", points=files.get("points"))
        return f"{message}{saved_note}"
    objects = importer.import_glb(context, files["glb"])
    return f"Imported the depth shell ({len(objects)} objects, metres).{saved_note}"


def _send_work(client, path, path2, quality, trim, base, preread):
    def work(task):
        lane = lane_for(path)
        total_files = 2 if path2 else 1
        urls = []
        for index, current in enumerate([path] + ([path2] if path2 else [])):
            def up(fraction, done, count, index=index):
                task.progress(
                    f"Uploading {os.path.basename(current)} ({done}/{count} parts)",
                    (index + fraction) / total_files,
                )
            task.progress(f"Uploading {os.path.basename(current)}", index / total_files)
            urls.append(client.upload_file(current, progress=up, should_cancel=task.cancel.is_set)["source_url"])
        if lane == "shell":
            created = client.create_scene(urls[0], source_kind_for(path))
            fetch = lambda: client.get_scene(created["job_id"])
        else:
            kind = source_kind_for(path)
            created = client.create_capture(
                urls[0], kind, source_urls=urls if len(urls) > 1 else None, trim=trim, quality=quality
            )
            fetch = lambda: client.get_capture(created["job_id"])
        job_id = created["job_id"]
        task.job_id = job_id

        def update(body):
            task.progress(_stage_text(body), float(body.get("progress") or 0.0))

        try:
            body = client.wait_for_job(fetch, on_update=update, should_cancel=task.cancel.is_set)
        except Cancelled:
            if lane == "splat":
                try:
                    client.cancel_capture(job_id)
                except ThreeWSError:
                    pass
            raise
        return _fetch_results(client, task, "shell" if lane == "shell" else "splat", job_id, body, base, preread)

    return work


# -- operators -------------------------------------------------------------------

def _poll_online(cls, context):
    reason = _core()._offline_reason()
    if reason:
        cls.poll_message_set(reason)
        return False
    if task_running():
        cls.poll_message_set("A capture task is already running.")
        return False
    return True


class THREEWS_OT_capture_send(Operator):
    """Upload the 360 file to three.ws and import the finished result"""

    bl_idname = "threews.capture_send"
    bl_label = "Send to three.ws"

    @classmethod
    def poll(cls, context):
        return _poll_online(cls, context)

    def execute(self, context):
        reason = _core()._offline_reason()
        if reason:
            self.report({"ERROR"}, f"three.ws: {reason}")
            return {"CANCELLED"}
        props = context.scene.three_ws_capture
        path = bpy.path.abspath(props.filepath or "")
        if not path or not os.path.isfile(path):
            self.report({"ERROR"}, f"Choose a 360 file ({FILE_HELP}).")
            return {"CANCELLED"}
        path2 = bpy.path.abspath(props.filepath2 or "") if props.filepath2 else ""
        if path2 and not os.path.isfile(path2):
            self.report({"ERROR"}, "The second file was not found.")
            return {"CANCELLED"}
        try:
            source_kind_for(path)
        except ThreeWSError as exc:
            self.report({"ERROR"}, exc.message)
            return {"CANCELLED"}
        trim = None
        if lane_for(path) == "splat" and (props.trim_in > 0 or props.trim_out > 0):
            if props.trim_out and props.trim_out <= props.trim_in:
                self.report({"ERROR"}, "Out must be later than In (or 0 for the whole clip).")
                return {"CANCELLED"}
            trim = {"start_s": props.trim_in}
            if props.trim_out:
                trim["end_s"] = props.trim_out
        try:
            client = _make_client(context)
        except ThreeWSError as exc:
            self.report({"ERROR"}, f"three.ws: {exc.message}")
            return {"CANCELLED"}
        base, _saved = _downloads_base()
        start_task(context, _send_work(client, path, path2, props.quality, trim, base, not importer.kiri_available()), _finish_import)
        return {"FINISHED"}


class THREEWS_OT_capture_cancel(Operator):
    """Cancel the running capture task"""

    bl_idname = "threews.capture_cancel"
    bl_label = "Cancel"

    @classmethod
    def poll(cls, context):
        return task_running()

    def execute(self, context):
        if _task:
            _task.cancel.set()
            _task.stage_text = "Cancelling"
            _redraw()
        return {"FINISHED"}


class THREEWS_OT_capture_refresh(Operator):
    """Load your captures from three.ws"""

    bl_idname = "threews.capture_refresh"
    bl_label = "Refresh"

    @classmethod
    def poll(cls, context):
        return _poll_online(cls, context)

    def execute(self, context):
        reason = _core()._offline_reason()
        if reason:
            self.report({"ERROR"}, f"three.ws: {reason}")
            return {"CANCELLED"}
        try:
            client = _make_client(context)
        except ThreeWSError as exc:
            self.report({"ERROR"}, f"three.ws: {exc.message}")
            return {"CANCELLED"}

        def work(task):
            task.progress("Loading your captures", None)
            return client.list_captures()

        def done(ctx, captures):
            props = ctx.scene.three_ws_capture
            props.captures.clear()
            for entry in captures:
                item = props.captures.add()
                item.job_id = str(entry.get("job_id", ""))
                item.status = str(entry.get("status", ""))
                item.created_at = str(entry.get("created_at", ""))
                item.source_kind = str(entry.get("source_kind", ""))
                item.viewer_url = str(entry.get("viewer_url", ""))
            props.listed = True
            return f"{len(captures)} capture(s)." if captures else "You have no captures yet."

        start_task(context, work, done)
        return {"FINISHED"}


class THREEWS_OT_capture_import(Operator):
    """Download a finished capture and import it"""

    bl_idname = "threews.capture_import"
    bl_label = "Import"

    job_id: StringProperty()

    @classmethod
    def poll(cls, context):
        return _poll_online(cls, context)

    def execute(self, context):
        reason = _core()._offline_reason()
        if reason:
            self.report({"ERROR"}, f"three.ws: {reason}")
            return {"CANCELLED"}
        if not self.job_id:
            self.report({"ERROR"}, "Pick a capture in the list.")
            return {"CANCELLED"}
        try:
            client = _make_client(context)
        except ThreeWSError as exc:
            self.report({"ERROR"}, f"three.ws: {exc.message}")
            return {"CANCELLED"}
        base, _saved = _downloads_base()
        job_id = self.job_id
        preread = not importer.kiri_available()

        def work(task):
            task.progress("Checking the capture", None)
            body = client.get_capture(job_id)
            status = str(body.get("status", ""))
            if status not in ("succeeded", "completed", "complete", "done", "ready"):
                raise ThreeWSError(
                    f"This capture is {status or 'not finished'}, so there is nothing to import yet.",
                    code="not_ready",
                )
            return _fetch_results(client, task, "splat", job_id, body, base, preread)

        start_task(context, work, _finish_import)
        return {"FINISHED"}


class THREEWS_OT_capture_preview(Operator):
    """Add the flythrough preview video to the sequencer"""

    bl_idname = "threews.capture_preview"
    bl_label = "Add preview video"

    job_id: StringProperty()

    @classmethod
    def poll(cls, context):
        return _poll_online(cls, context)

    def execute(self, context):
        reason = _core()._offline_reason()
        if reason:
            self.report({"ERROR"}, f"three.ws: {reason}")
            return {"CANCELLED"}
        try:
            client = _make_client(context)
        except ThreeWSError as exc:
            self.report({"ERROR"}, f"three.ws: {exc.message}")
            return {"CANCELLED"}
        base, _saved = _downloads_base()
        job_id = self.job_id

        def work(task):
            body = client.get_capture(job_id)
            url = (body.get("result") or {}).get("preview_url")
            if not url:
                raise ThreeWSError("This capture has no preview video.", code="no_preview")
            dest = os.path.join(_job_dir(base, job_id), "preview.mp4")
            task.progress("Downloading the preview video", 0.0)
            client.download(
                url, dest, progress=lambda f: task.progress("Downloading the preview video", f),
                should_cancel=task.cancel.is_set,
            )
            return dest

        def done(ctx, dest):
            importer.add_preview_strip(ctx, dest)
            return "Added the preview video to the sequencer."

        start_task(context, work, done)
        return {"FINISHED"}


class THREEWS_OT_capture_open(Operator):
    """Open the capture in the three.ws viewer"""

    bl_idname = "threews.capture_open"
    bl_label = "Open in browser"

    url: StringProperty()

    def execute(self, context):
        url = self.url
        if url.startswith("/"):
            url = _core()._prefs(context).api_url.rstrip("/") + url
        if not url.startswith(("https://", "http://")):
            self.report({"ERROR"}, "This capture has no viewer link.")
            return {"CANCELLED"}
        webbrowser.open(url)
        return {"FINISHED"}


# -- panel -----------------------------------------------------------------------

class THREEWS_UL_captures(UIList):
    def draw_item(self, context, layout, data, item, icon, active_data, active_propname, index):
        row = layout.row(align=True)
        row.label(text=f"{item.job_id[:8]}  {item.status}", icon="SEQUENCE" if item.status in ("succeeded", "completed") else "SORTTIME")
        if item.created_at:
            row.label(text=item.created_at[:10])


class THREEWS_PT_capture(Panel):
    bl_label = "360 Capture"
    bl_idname = "THREEWS_PT_capture"
    bl_space_type = "VIEW_3D"
    bl_region_type = "UI"
    bl_category = "three.ws"

    def draw(self, context):
        layout = self.layout
        props = context.scene.three_ws_capture
        core = _core()

        reason = core._offline_reason()
        if reason:
            box = layout.box()
            box.alert = True
            col = box.column(align=True)
            col.label(text="Online access is off", icon="ERROR")
            for line in textwrap.wrap(reason, 34):
                col.label(text=line)

        col = layout.column(align=True)
        col.prop(props, "filepath")
        ext = file_ext(bpy.path.abspath(props.filepath)) if props.filepath else ""
        if ext == "insv":
            col.prop(props, "filepath2")
        is_footage = ext in ("", "insv", "mp4", "mov")
        if is_footage:
            col = layout.column(align=True)
            col.prop(props, "quality")
            row = col.row(align=True)
            row.prop(props, "trim_in")
            row.prop(props, "trim_out")
        else:
            layout.label(text="One photo becomes a depth shell.", icon="INFO")
        layout.prop(props, "up_axis")

        row = layout.row()
        row.scale_y = 1.4
        row.operator(THREEWS_OT_capture_send.bl_idname, icon="EXPORT")

        task = _task
        if props.busy and task is not None:
            box = layout.box()
            box.progress(factor=task.fraction, type="BAR", text=task.stage_text or "Working")
            box.operator(THREEWS_OT_capture_cancel.bl_idname, icon="CANCEL")
        if props.message:
            box = layout.box()
            box.alert = props.message_error
            col = box.column(align=True)
            for line in textwrap.wrap(props.message, 36):
                col.label(text=line)
            if not props.message_error and not importer.kiri_available() and "KIRI" in props.message:
                col.operator("wm.url_open", text="Get KIRI 3DGS Render", icon="URL").url = importer.KIRI_URL

        layout.separator()
        header = layout.row(align=True)
        header.label(text="Your captures")
        header.operator(THREEWS_OT_capture_refresh.bl_idname, text="", icon="FILE_REFRESH")
        if props.listed and not len(props.captures):
            layout.label(text="Nothing here yet. Send a clip above.", icon="INFO")
        elif len(props.captures):
            layout.template_list("THREEWS_UL_captures", "", props, "captures", props, "active_capture", rows=3)
            if 0 <= props.active_capture < len(props.captures):
                item = props.captures[props.active_capture]
                row = layout.row(align=True)
                op = row.operator(THREEWS_OT_capture_import.bl_idname, text="Import", icon="IMPORT")
                op.job_id = item.job_id
                op = row.operator(THREEWS_OT_capture_preview.bl_idname, text="Preview video", icon="SEQUENCE")
                op.job_id = item.job_id
                op = row.operator(THREEWS_OT_capture_open.bl_idname, text="", icon="URL")
                op.url = item.viewer_url
        else:
            layout.label(text="Press refresh to load your captures.")


CLASSES = (
    ThreeWSCaptureItem,
    ThreeWSCaptureProps,
    THREEWS_OT_capture_send,
    THREEWS_OT_capture_cancel,
    THREEWS_OT_capture_refresh,
    THREEWS_OT_capture_import,
    THREEWS_OT_capture_preview,
    THREEWS_OT_capture_open,
    THREEWS_UL_captures,
    THREEWS_PT_capture,
)


def register():
    for cls in CLASSES:
        bpy.utils.register_class(cls)
    bpy.types.Scene.three_ws_capture = bpy.props.PointerProperty(type=ThreeWSCaptureProps)


def unregister():
    global _task
    if _task is not None:
        _task.cancel.set()
        _task = None
    if bpy.app.timers.is_registered(pump):
        bpy.app.timers.unregister(pump)
    del bpy.types.Scene.three_ws_capture
    for cls in reversed(CLASSES):
        bpy.utils.unregister_class(cls)
