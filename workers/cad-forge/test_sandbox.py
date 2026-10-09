"""
Integration gate for the CAD sandbox: real builds through the warm pool and
real escape attempts against each isolation layer. Runs in the Docker build
(as root, like Cloud Run) and needs build123d installed.

    python test_sandbox.py
"""

import base64
import os
import subprocess
import sys
import textwrap
import unittest

os.environ.setdefault("API_KEY", "build-gate")
os.environ["BUILD_TIMEOUT_S"] = "10"

import main  # noqa: E402

BRACKET = """
from build123d import *

LENGTH = 60  # Length [30..200 mm]
WIDTH = 40  # Width [20..120 mm]
THICKNESS = 10  # Thickness [4..30 mm]

with BuildPart() as plate:
    Box(LENGTH, WIDTH, THICKNESS)
    fillet(plate.edges().filter_by(Axis.Z), radius=5)
    with Locations(plate.faces().sort_by(Axis.Z)[-1]):
        with GridLocations(LENGTH - 20, WIDTH - 20, 2, 2):
            CounterBoreHole(radius=2, counter_bore_radius=3.5, counter_bore_depth=2)

result = plate.part
print("built", LENGTH)
"""


def build(code):
    return main.run_build(textwrap.dedent(code))


class SandboxBuildTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        main.pool.refill()

    @classmethod
    def tearDownClass(cls):
        main.pool.close()

    def test_builds_a_real_part_with_every_artifact(self):
        out = build(BRACKET)
        self.assertTrue(out["ok"], out.get("error"))
        size = out["metrics"]["size_mm"]
        self.assertAlmostEqual(size[0], 60, places=2)
        self.assertAlmostEqual(size[1], 40, places=2)
        self.assertAlmostEqual(size[2], 10, places=2)
        self.assertTrue(out["metrics"]["valid"])
        self.assertEqual(out["metrics"]["solids"], 1)
        self.assertLess(out["metrics"]["volume_mm3"], 60 * 40 * 10)
        art = {k: base64.b64decode(v) for k, v in out["artifacts"].items()}
        self.assertTrue(art["glb"].startswith(b"glTF"))
        self.assertIn(b"ISO-10303-21", art["step"][:200])
        self.assertGreater(len(art["stl"]), 84)
        self.assertIn(b"<svg", art["thumb_svg"][:400])
        self.assertIn(b"ISOMETRIC", art["drawing_svg"])
        self.assertIn("built 60", out["log"])
        if main.REQUIRE_SECCOMP:
            self.assertTrue(out["seccomp"])

    def test_runtime_error_reports_the_program_line(self):
        out = build("from build123d import *\nx = 1\nresult = Box(10, 10, 10) / 0\n")
        self.assertFalse(out["ok"])
        self.assertEqual(out["error"]["kind"], "runtime")
        self.assertEqual(out["error"]["line"], 3)

    def test_missing_result_is_explained(self):
        out = build("from build123d import *\nshape = Box(1, 1, 1)\n")
        self.assertFalse(out["ok"])
        self.assertEqual(out["error"]["kind"], "result")

    def test_a_lone_builder_is_accepted_as_the_result(self):
        out = build("from build123d import *\nwith BuildPart() as p:\n    Box(5, 5, 5)\n")
        self.assertTrue(out["ok"], out.get("error"))

    def test_two_dimensional_result_is_refused(self):
        out = build("from build123d import *\nwith BuildSketch() as s:\n    Circle(5)\nresult = s\n")
        self.assertFalse(out["ok"])
        self.assertIn("2D", out["error"]["message"])

    def test_policy_refusal_is_reported(self):
        out = build("import os\nresult = os.listdir('/')\n")
        self.assertFalse(out["ok"])
        self.assertEqual(out["error"]["kind"], "policy")

    def test_builtins_handle_is_refused(self):
        out = build("from build123d import *\nimport math\nm = __builtins__\n")
        self.assertEqual(out["error"]["kind"], "policy")

    def test_infinite_loop_is_killed(self):
        out = build("x = 0\nwhile True:\n    x += 1\n")
        self.assertFalse(out["ok"])
        self.assertEqual(out["error"]["kind"], "timeout")

    def test_memory_bomb_is_contained(self):
        out = build("x = [0] * (10 ** 10)\n")
        self.assertFalse(out["ok"])
        self.assertEqual(out["error"]["kind"], "memory")

    def test_oversized_fillet_is_reduced_and_reported(self):
        out = build(
            "from build123d import *\n"
            "with BuildPart() as p:\n"
            "    Box(20, 20, 2)\n"
            "    fillet(p.edges().group_by(Axis.Z)[-1], radius=3)\n"
            "result = p.part\n"
        )
        self.assertTrue(out["ok"], out.get("error"))
        self.assertTrue(any("fillet 3 mm" in a for a in out["adjustments"]), out["adjustments"])

    def test_impossible_fillet_is_skipped_and_reported(self):
        out = build(
            "from build123d import *\n"
            "with BuildPart() as p:\n"
            "    Box(20, 20, 0.4)\n"
            "    fillet(p.edges(), radius=5)\n"
            "result = p.part\n"
        )
        self.assertTrue(out["ok"], out.get("error"))
        self.assertTrue(any("left the edges sharp" in a for a in out["adjustments"]), out["adjustments"])
        self.assertAlmostEqual(out["metrics"]["volume_mm3"], 160, places=1)

    def test_impossible_algebra_fillet_returns_the_part(self):
        out = build(
            "from build123d import *\n"
            "box = Box(20, 20, 0.4)\n"
            "result = fillet(box.edges(), radius=5)\n"
        )
        self.assertTrue(out["ok"], out.get("error"))
        self.assertAlmostEqual(out["metrics"]["volume_mm3"], 160, places=1)

    def test_standard_parts_from_bd_warehouse(self):
        out = build(
            "from build123d import *\n"
            "from bd_warehouse.gear import SpurGear\n"
            "result = SpurGear(module=2, tooth_count=20, pressure_angle=20, thickness=8, root_fillet=0.5)\n"
        )
        self.assertTrue(out["ok"], out.get("error"))
        self.assertAlmostEqual(out["metrics"]["size_mm"][0], 44, places=0)

    def test_module_object_import_is_refused_at_runtime(self):
        out = build("from build123d import exporters\n")
        self.assertFalse(out["ok"])
        self.assertIn("module", out["error"]["message"])

    def test_pool_recovers_after_failures(self):
        out = build(BRACKET)
        self.assertTrue(out["ok"], out.get("error"))


class FailureClassificationTests(unittest.TestCase):
    def test_kernel_segfault_names_the_program_line(self):
        stderr = 'Fatal Python error: Segmentation fault\n\nCurrent thread:\n  File "<design>", line 14 in <module>\n'
        failure = main._signal_failure(-11, stderr)
        self.assertEqual(failure["kind"], "crash")
        self.assertEqual(failure["line"], 14)
        self.assertIn("line 14", failure["message"])

    def test_cpu_and_memory_limits(self):
        self.assertEqual(main._signal_failure(-24, "")["kind"], "timeout")
        self.assertEqual(main._signal_failure(-9, "")["kind"], "memory")
        self.assertEqual(main._signal_failure(-6, "")["kind"], "memory")


PROBE = r"""
import errno, os, socket, sys
sys.path.insert(0, "/app" if os.path.isdir("/app") else os.getcwd())
from sandbox_child import install_seccomp
results = {"uid": os.getuid(), "seccomp": install_seccomp()}
try:
    socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    results["socket"] = "opened"
except OSError as exc:
    results["socket"] = exc.errno
try:
    os.execv("/bin/true", ["/bin/true"])
except OSError as exc:
    results["exec"] = exc.errno
try:
    pid = os.fork()
    if pid == 0:
        os._exit(0)
    results["fork"] = "forked"
except OSError as exc:
    results["fork"] = exc.errno
try:
    open("/proc/1/environ", "rb").read()
    results["parent_env"] = "read"
except OSError as exc:
    results["parent_env"] = exc.errno
import threading
t = threading.Thread(target=lambda: None); t.start(); t.join()
results["threads"] = "ok"
print(repr(results))
"""


class IsolationLayerTests(unittest.TestCase):
    """Each layer on its own, so a policy bypass would still hit a wall."""

    def test_seccomp_and_uid_drop(self):
        drop = os.geteuid() == 0
        proc = subprocess.run(
            [sys.executable, "-c", PROBE],
            capture_output=True,
            text=True,
            env={"PATH": "/usr/bin:/bin", "OMP_NUM_THREADS": "2", "OPENBLAS_NUM_THREADS": "2"},
            cwd=os.path.dirname(os.path.abspath(__file__)),
            user=main.SANDBOX_UID if drop else None,
            group=main.SANDBOX_UID if drop else None,
            extra_groups=[] if drop else None,
            preexec_fn=main._limits,
            timeout=60,
        )
        self.assertEqual(proc.returncode, 0, proc.stderr)
        results = eval(proc.stdout.strip())  # noqa: S307  (our own repr, test only)
        if not main.REQUIRE_SECCOMP and not results["seccomp"]:
            self.skipTest("seccomp unavailable on this host")
        self.assertTrue(results["seccomp"])
        self.assertEqual(results["socket"], 1)  # EPERM
        self.assertEqual(results["exec"], 1)
        self.assertEqual(results["fork"], 1)
        self.assertEqual(results["threads"], "ok")
        if drop:
            self.assertEqual(results["uid"], main.SANDBOX_UID)
            self.assertNotEqual(results["parent_env"], "read")


if __name__ == "__main__":
    unittest.main(verbosity=2)
