"""
One-shot sandbox process for a single CAD build.

The parent (main.py) spawns this as an unprivileged uid with a scrubbed
environment and hard resource limits, then keeps it parked: it imports
build123d (about 2.5 s of OpenCascade loading) and blocks on stdin, so the cost
is paid before a request arrives. When a job lands it:

  1. installs a seccomp filter: no sockets, no exec, no fork (threads stay
     allowed, OpenCascade meshes in parallel)
  2. vets the program with cad_policy and runs it under trimmed builtins
  3. resolves the program's ``result`` into one solid shape
  4. writes part.step, part.stl, part.glb, thumb.svg and drawing.svg into its
     working directory, plus result.json with the measurements

then exits. A process never runs a second program, so nothing one design does
can leak into the next.
"""

from __future__ import annotations

import errno
import faulthandler
import io
import json
import math
import os
import re
import sys
import time
import traceback

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import build123d as bd  # noqa: E402  (warm import is the point of this process)
from build123d import (  # noqa: E402
    BuildPart, BuildSketch, BuildLine, Color, Compound, ExportSVG, LineType, Shape, Solid, Unit,
    export_gltf, export_step, export_stl,
)

from cad_policy import PolicyViolation, check_source, safe_builtins  # noqa: E402

MAX_LOG_CHARS = 4_000
MAX_EXTENT_MM = 5_000.0
MIN_VOLUME_MM3 = 1e-6
DEFAULT_COLOR = (0.70, 0.74, 0.80)
CLONE_THREAD = 0x00010000

SECCOMP_DENY = (
    "socket", "socketpair", "connect", "bind", "listen", "accept", "accept4",
    "execve", "execveat", "fork", "vfork", "ptrace", "process_vm_readv",
    "process_vm_writev", "unshare", "setns", "mount", "umount2", "pivot_root",
    "chroot", "keyctl", "add_key", "request_key", "bpf", "perf_event_open",
    "userfaultfd", "personality", "kexec_load", "init_module", "finit_module",
)


# Edge treatments the kernel rejected and the smaller size that built instead.
ADJUSTMENTS: list[str] = []
EDGE_OP_SCALES = (0.5, 0.25)


def _unchanged_target(op_name: str, objects):
    """The shape a skipped edge treatment leaves behind, resolved the way
    build123d's own fillet/chamfer resolve their target: the active builder's
    part, else the part the selected edges came from."""
    from build123d.build_common import Builder

    context = Builder._get_context(op_name)
    if context is not None:
        return getattr(context, "_obj", None)
    if isinstance(objects, Shape):
        items = [objects]
    else:
        try:
            items = list(objects or [])
        except TypeError:
            return None
    return getattr(items[0], "topo_parent", None) if items else None


def _forgiving(op, size_kw: str):
    """Wrap fillet/chamfer: when the kernel rejects a size, retry smaller.

    A rejected fillet is the most common reason a valid design fails, and the
    kernel's own advice is "try a smaller value". Halving, then quartering, is
    that advice applied. When no size builds, the edges are left sharp: a
    cosmetic round is never worth failing a part over. Every reduction or skip
    is reported to the user next to the design.
    """

    def wrapper(*args, **kwargs):
        try:
            return op(*args, **kwargs)
        except Exception as original:  # noqa: BLE001  (OCCT raises several unrelated types)
            in_kwargs = size_kw in kwargs
            size = kwargs.get(size_kw) if in_kwargs else (args[1] if len(args) > 1 else None)
            if isinstance(size, bool) or not isinstance(size, (int, float)) or size <= 0:
                raise
            for scale in EDGE_OP_SCALES:
                smaller = size * scale
                try:
                    if in_kwargs:
                        out = op(*args, **{**kwargs, size_kw: smaller})
                    else:
                        out = op(args[0], smaller, *args[2:], **kwargs)
                except Exception:  # noqa: BLE001
                    continue
                ADJUSTMENTS.append(f"{op.__name__} {size:g} mm could not be built; used {smaller:g} mm")
                return out
            unchanged = _unchanged_target(op.__name__, args[0] if args else kwargs.get("objects"))
            if unchanged is None:
                raise original
            ADJUSTMENTS.append(f"{op.__name__} {size:g} mm could not be built at any size; left the edges sharp")
            return unchanged

    wrapper.__name__ = op.__name__
    wrapper.__doc__ = op.__doc__
    return wrapper


bd.fillet = _forgiving(bd.fillet, "radius")
bd.chamfer = _forgiving(bd.chamfer, "length")


class BuildFailure(Exception):
    def __init__(self, kind: str, message: str, line: int | None = None):
        super().__init__(message)
        self.kind = kind
        self.message = message
        self.line = line


def install_seccomp() -> bool:
    """Deny network, exec and process creation for the rest of this process.

    Returns False when the kernel or runtime refuses seccomp (some local Docker
    setups); production refuses to build without it, see main.REQUIRE_SECCOMP.
    """
    try:
        import pyseccomp as seccomp
    except ImportError:
        return False
    try:
        flt = seccomp.SyscallFilter(seccomp.ALLOW)
        for name in SECCOMP_DENY:
            try:
                flt.add_rule(seccomp.ERRNO(errno.EPERM), name)
            except (ValueError, RuntimeError, OSError):
                continue
        # clone3 passes its flags in a struct seccomp cannot inspect; ENOSYS makes
        # glibc fall back to clone, whose flags we can: threads yes, processes no.
        try:
            flt.add_rule(seccomp.ERRNO(errno.ENOSYS), "clone3")
        except (ValueError, RuntimeError, OSError):
            pass
        flt.add_rule(seccomp.ERRNO(errno.EPERM), "clone", seccomp.Arg(0, seccomp.MASKED_EQ, CLONE_THREAD, 0))
        flt.load()
        return True
    except Exception:  # noqa: BLE001  (any failure means "not sandboxed", reported upstream)
        return False


def design_line(exc: BaseException) -> int | None:
    line = None
    for frame in traceback.extract_tb(exc.__traceback__):
        if frame.filename == "<design>":
            line = frame.lineno
    return line


def run_program(source: str, log: io.StringIO) -> object:
    try:
        tree = check_source(source)
    except SyntaxError as exc:
        raise BuildFailure("syntax", f"{exc.msg}", exc.lineno) from None
    except PolicyViolation as exc:
        raise BuildFailure("policy", exc.message, exc.line) from None

    code = compile(tree, "<design>", "exec")
    namespace = {"__builtins__": safe_builtins(), "__name__": "__design__"}
    real_stdout = sys.stdout
    sys.stdout = log
    try:
        exec(code, namespace)  # noqa: S102  (vetted program, sandboxed process)
    except BuildFailure:
        raise
    except MemoryError:
        raise BuildFailure("memory", "The design ran out of memory. Simplify the geometry.") from None
    except RecursionError:
        raise BuildFailure("runtime", "The design recursed too deeply.", None) from None
    except Exception as exc:  # noqa: BLE001  (the program's own error, reported with its line)
        message = f"{type(exc).__name__}: {exc}".strip()
        raise BuildFailure("runtime", message[:600], design_line(exc)) from None
    finally:
        sys.stdout = real_stdout
    return namespace


def resolve_result(namespace: dict) -> Shape:
    if "result" not in namespace:
        builders = [v for v in namespace.values() if isinstance(v, BuildPart)]
        if len(builders) == 1:
            namespace["result"] = builders[0]
        else:
            raise BuildFailure("result", "The program never assigned the finished shape to a variable named `result`.")
    value = namespace["result"]
    if isinstance(value, BuildPart):
        value = value.part
    if isinstance(value, (BuildSketch, BuildLine)):
        raise BuildFailure("result", "`result` is a 2D sketch. Extrude or revolve it into a solid.")
    if isinstance(value, (list, tuple)):
        shapes = [v.part if isinstance(v, BuildPart) else v for v in value]
        if not shapes or not all(isinstance(s, Shape) for s in shapes):
            raise BuildFailure("result", "`result` is a list that does not contain only shapes.")
        value = Compound(children=shapes)
    if not isinstance(value, Shape):
        raise BuildFailure("result", f"`result` must be a build123d shape, got {type(value).__name__}.")
    if not value.solids():
        raise BuildFailure("result", "`result` has no solid volume. Build a 3D part, not a surface or a wire.")
    return value


def measure(shape: Shape) -> dict:
    box = shape.bounding_box()
    size = (box.size.X, box.size.Y, box.size.Z)
    if not all(math.isfinite(v) for v in size):
        raise BuildFailure("result", "The part has an infinite or undefined extent.")
    if max(size) > MAX_EXTENT_MM:
        raise BuildFailure("result", f"The part is {max(size):.0f} mm across; the limit is {MAX_EXTENT_MM:.0f} mm.")
    volume = float(shape.volume)
    if volume < MIN_VOLUME_MM3:
        raise BuildFailure("result", "The part has no volume.")
    center = shape.center()
    return {
        "size_mm": [round(v, 4) for v in size],
        "min_mm": [round(box.min.X, 4), round(box.min.Y, 4), round(box.min.Z, 4)],
        "volume_mm3": round(volume, 4),
        "area_mm2": round(float(shape.area), 4),
        "center_mm": [round(center.X, 4), round(center.Y, 4), round(center.Z, 4)],
        "solids": len(shape.solids()),
        "faces": len(shape.faces()),
        "edges": len(shape.edges()),
        "valid": bool(shape.is_valid),
    }


def _project(shape: Shape, origin, up):
    visible, hidden = shape.project_to_viewport(origin, up, (0, 0, 0))
    return Compound(children=list(visible)), Compound(children=list(hidden))


PAPER = "rgb(246,247,249)"
VIEWBOX = re.compile(r'viewBox="([-\d.e]+) ([-\d.e]+) ([-\d.e]+) ([-\d.e]+)"')


def add_paper(path: str) -> None:
    """Give an exported SVG an opaque paper background so its dark linework
    reads on any page, dark themes included."""
    with open(path, "r", encoding="utf-8") as fh:
        text = fh.read()
    match = VIEWBOX.search(text)
    if not match:
        return
    x, y, w, h = match.groups()
    rect = f'<rect x="{x}" y="{y}" width="{w}" height="{h}" fill="{PAPER}"/>'
    head_end = text.index(">", match.end()) + 1
    with open(path, "w", encoding="utf-8") as fh:
        fh.write(text[:head_end] + rect + text[head_end:])


def write_thumbnail(shape: Shape, path: str) -> None:
    centered = shape.moved(bd.Location(-shape.center()))
    extent = max(centered.bounding_box().size.X, centered.bounding_box().size.Y, centered.bounding_box().size.Z) or 1.0
    distance = extent * 6
    visible, hidden = _project(centered, (distance, -distance, distance * 0.8), (0, 0, 1))
    svg = ExportSVG(scale=100.0 / extent, margin=4)
    svg.add_layer("hidden", line_color=(150, 160, 175), line_type=LineType.ISO_DOT, line_weight=0.2)
    svg.add_layer("visible", line_color=(20, 24, 32), line_weight=0.45)
    if hidden.edges():
        svg.add_shape(hidden, layer="hidden")
    svg.add_shape(visible, layer="visible")
    svg.write(path)
    add_paper(path)


def write_drawing(shape: Shape, size_mm, path: str) -> None:
    """Third-angle sheet: front, top and right orthographic views plus an iso."""
    centered = shape.moved(bd.Location(-shape.center()))
    extent = max(size_mm) or 1.0
    d = extent * 6
    views = [
        ("FRONT", (0, -d, 0), (0, 0, 1), (0, 0)),
        ("RIGHT", (d, 0, 0), (0, 0, 1), (1, 0)),
        ("TOP", (0, 0, d), (0, 1, 0), (0, 1)),
        ("ISOMETRIC", (d, -d, d * 0.8), (0, 0, 1), (1, 1)),
    ]
    cell = extent * 1.6
    svg = ExportSVG(scale=180.0 / (cell * 2), margin=6)
    svg.add_layer("hidden", line_color=(150, 160, 175), line_type=LineType.ISO_DASH, line_weight=0.18)
    svg.add_layer("visible", line_color=(20, 24, 32), line_weight=0.4)
    labels = []
    for name, origin, up, (col, row) in views:
        visible, hidden = _project(centered, origin, up)
        offset = bd.Location((col * cell, -row * cell, 0))
        if hidden.edges():
            svg.add_shape(hidden.moved(offset), layer="hidden")
        svg.add_shape(visible.moved(offset), layer="visible")
        labels.append((name, col * cell, -row * cell - cell * 0.42))
    svg.write(path)

    # View captions in drawing units. ExportSVG flips Y with scale(1,-1), so each
    # caption is placed at -y inside an un-flipped group.
    with open(path, "r", encoding="utf-8") as fh:
        text = fh.read()
    font = cell * 0.055
    captions = "".join(
        f'<text x="{x:.3f}" y="{-y:.3f}" font-family="ui-monospace, Menlo, monospace" '
        f'font-size="{font:.3f}" fill="rgb(90,100,115)" text-anchor="middle">{name}</text>'
        for name, x, y in labels
    )
    dims = " x ".join(f"{v:.2f}" for v in size_mm)
    captions += (
        f'<text x="{cell * 0.5:.3f}" y="{cell * 1.62:.3f}" font-family="ui-monospace, Menlo, monospace" '
        f'font-size="{font * 0.9:.3f}" fill="rgb(90,100,115)" text-anchor="middle">'
        f"OVERALL {dims} mm  |  three.ws CAD Forge</text>"
    )
    text = text.replace("</svg>", f'<g transform="scale(1,-1)"><g transform="scale(1,-1)">{captions}</g></g></svg>', 1)
    with open(path, "w", encoding="utf-8") as fh:
        fh.write(text)
    add_paper(path)


def export_part(shape: Shape, metrics: dict) -> dict:
    if getattr(shape, "color", None) is None:
        shape.color = Color(*DEFAULT_COLOR)
    timings = {}
    t = time.perf_counter()
    export_step(shape, "part.step", unit=Unit.MM)
    timings["step"] = time.perf_counter() - t
    # Deflection scales with the part so a 5 mm clip and a 2 m frame both mesh
    # smoothly without the large part exploding into millions of triangles.
    deflection = max(0.005, max(metrics["size_mm"]) / 1500.0)
    t = time.perf_counter()
    export_stl(shape, "part.stl", tolerance=deflection, angular_tolerance=0.15)
    export_gltf(shape, "part.glb", unit=Unit.MM, binary=True, linear_deflection=deflection, angular_deflection=0.15)
    timings["mesh"] = time.perf_counter() - t
    return {"files": ["part.step", "part.stl", "part.glb"], "timings_s": {k: round(v, 3) for k, v in timings.items()}}


def export_drawings(shape: Shape, metrics: dict) -> list[str]:
    """Hidden-line views. Optional: the part is already reported before this
    runs, so a slow or failing projection only costs the drawings."""
    try:
        write_thumbnail(shape, "thumb.svg")
        write_drawing(shape, metrics["size_mm"], "drawing.svg")
        return ["thumb.svg", "drawing.svg"]
    except Exception:  # noqa: BLE001  (hidden-line removal can fail on exotic B-reps; the part itself is fine)
        for leftover in ("thumb.svg", "drawing.svg"):
            if os.path.exists(leftover):
                os.remove(leftover)
        return []


def write_result(out: dict) -> None:
    tmp = "result.json.tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(out, fh)
    os.replace(tmp, "result.json")


def main() -> int:
    # A segfault inside OpenCascade prints the Python stacks to stderr, which is
    # how the parent learns which program line crashed the kernel. All threads,
    # because OCCT often faults on one of its own worker threads while the
    # program line that called it sits on the main thread.
    faulthandler.enable(file=sys.stderr, all_threads=True)
    sys.stdout.write("READY\n")
    sys.stdout.flush()
    raw = sys.stdin.readline()
    started = time.perf_counter()
    log = io.StringIO()
    shape = None
    out: dict
    try:
        job = json.loads(raw or "{}")
        sandboxed = install_seccomp()
        if job.get("require_seccomp") and not sandboxed:
            raise BuildFailure("sandbox", "The build sandbox could not be established.")
        namespace = run_program(str(job.get("code") or ""), log)
        shape = resolve_result(namespace)
        metrics = measure(shape)
        exported = export_part(shape, metrics)
        out = {"ok": True, "metrics": metrics, "seccomp": sandboxed, "adjustments": ADJUSTMENTS[:20], **exported}
    except BuildFailure as exc:
        out = {"ok": False, "error": {"kind": exc.kind, "message": exc.message, "line": exc.line}}
    except MemoryError:
        out = {"ok": False, "error": {"kind": "memory", "message": "The design ran out of memory. Simplify the geometry.", "line": None}}
    except Exception as exc:  # noqa: BLE001  (export or measurement fault on a valid program)
        out = {"ok": False, "error": {"kind": "export", "message": f"{type(exc).__name__}: {exc}"[:600], "line": None}}
    out["log"] = log.getvalue()[-MAX_LOG_CHARS:]
    out["elapsed_s"] = round(time.perf_counter() - started, 3)
    write_result(out)
    if out["ok"]:
        t = time.perf_counter()
        out["files"] += export_drawings(shape, out["metrics"])
        out["timings_s"]["drawing"] = round(time.perf_counter() - t, 3)
        out["elapsed_s"] = round(time.perf_counter() - started, 3)
        write_result(out)
    return 0


if __name__ == "__main__":
    sys.exit(main())
