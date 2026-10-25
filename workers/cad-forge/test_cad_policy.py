"""Unit tests for cad_policy. Stdlib only: `python test_cad_policy.py`."""

import unittest

from cad_policy import PolicyViolation, check_source, guarded_import, safe_builtins

GOOD = """
from build123d import *
import math

WIDTH = 60  # Width [20..200 mm]
HOLE = 4  # Hole diameter [2..10 mm]

def ring(r):
    return Cylinder(r, 5) - Cylinder(r - 2, 5)

with BuildPart() as bracket:
    Box(WIDTH, 40, 8)
    fillet(bracket.edges().filter_by(Axis.Z), radius=4)
    with GridLocations(WIDTH - 15, 25, 2, 2):
        Hole(HOLE / 2)

result = bracket.part + ring(10).moved(Location((0, 0, 8)))
label = f"{WIDTH} mm bracket, {math.pi:.2f}"
"""


class PolicyTests(unittest.TestCase):
    def test_accepts_a_real_parametric_part(self):
        check_source(GOOD)

    def assertRefused(self, source, fragment=""):
        with self.assertRaises(PolicyViolation) as ctx:
            check_source(source)
        self.assertIn(fragment, str(ctx.exception))

    def test_refuses_foreign_imports(self):
        self.assertRefused("import os", "import of 'os'")
        self.assertRefused("import subprocess as s", "subprocess")
        self.assertRefused("from socket import socket", "socket")
        self.assertRefused("import build123d.topology._private", "_private")
        self.assertRefused("from build123d._internal import x", "_internal")
        self.assertRefused("from . import x", "relative")

    def test_cad_libraries_only_through_from_imports(self):
        self.assertRefused("import build123d", "from build123d import")
        self.assertRefused("import build123d as bd", "from build123d import")
        self.assertRefused("import bd_warehouse.gear", "from bd_warehouse.gear import")
        self.assertRefused("from bd_warehouse.gear import *", "import *")
        check_source("from bd_warehouse.gear import SpurGear\nimport math\n")

    def test_runtime_guard_refuses_module_objects(self):
        with self.assertRaises(ImportError):
            guarded_import("math", fromlist=("*",))
        with self.assertRaises(ImportError):
            guarded_import("build123d")
        with self.assertRaises(ImportError):
            guarded_import("os.path", fromlist=("join",))

    def test_refuses_private_imports_from_allowed_modules(self):
        self.assertRefused("from build123d import _private", "_private")

    def test_refuses_dunder_walks(self):
        self.assertRefused("x = ().__class__.__base__.__subclasses__()", "is not allowed")
        self.assertRefused("f = (lambda: 0).__globals__", "__globals__")
        self.assertRefused("y = Box._private", "_private")

    def test_refuses_dangerous_builtins(self):
        for name in ("eval", "exec", "open", "compile", "getattr", "globals", "vars", "__import__", "type", "object"):
            self.assertRefused(f"{name}('x')", name)

    def test_refuses_string_format_attribute_lookups(self):
        self.assertRefused("s = '{0.__class__}'.format(1)", "format")
        self.assertRefused("s = '{a}'.format_map({})", "format_map")

    def test_refuses_dunder_definitions_and_names(self):
        self.assertRefused("def __init__(self): pass", "__init__")
        self.assertRefused("__builtins__", "__builtins__")
        self.assertRefused("def f(__x): pass", "__x")

    def test_refuses_async(self):
        self.assertRefused("async def f():\n    pass", "async")

    def test_syntax_errors_propagate_with_a_line(self):
        with self.assertRaises(SyntaxError) as ctx:
            check_source("x = (\n")
        self.assertTrue(ctx.exception.lineno)

    def test_refuses_empty_and_oversized(self):
        self.assertRefused("   ", "empty")
        self.assertRefused("x = 1\n" * 10_000, "longer")

    def test_runtime_import_guard(self):
        self.assertIs(guarded_import("math"), __import__("math"))
        with self.assertRaises(ImportError):
            guarded_import("os")
        with self.assertRaises(ImportError):
            guarded_import("math", fromlist=("_private",))

    def test_safe_builtins_exclude_escape_hatches(self):
        table = safe_builtins()
        for name in ("open", "eval", "exec", "getattr", "__loader__", "compile", "globals"):
            self.assertNotIn(name, table)
        self.assertIs(table["__import__"], guarded_import)

    def test_refuses_frame_and_generator_introspection(self):
        for attr in ("gi_frame", "f_back", "f_globals", "f_builtins", "f_locals",
                     "gi_code", "cr_frame", "tb_frame", "tb_next", "co_consts"):
            self.assertRefused(f"x = y.{attr}", f"'.{attr}'")
        self.assertRefused("g = (i for i in range(1))\nx = g.gi_frame.f_back.f_globals\n", "is not allowed")

    def test_refuses_yield(self):
        self.assertRefused("def g():\n    yield 1\n", "yield")
        self.assertRefused("def g():\n    yield from range(2)\n", "yield")

    def test_accepts_comprehensions_and_generator_expressions(self):
        check_source("total = sum(i * 2 for i in range(4))\nxs = [i for i in range(3)]\n")

    def test_refuses_path_taking_io_names(self):
        # These write or read an arbitrary path with the sandbox uid, which
        # every sibling job's workdir shares. The runner exports by itself.
        for name in ("export_step", "export_stl", "export_gltf", "export_svg",
                     "import_step", "import_stl", "import_svg", "Mesher",
                     "ExportSVG", "ExportDXF", "ImportSVG", "ImportDXF"):
            self.assertRefused(f"from build123d import {name}\n", "is not allowed")
            self.assertRefused(f"x = {name}\n", "is not available")
        self.assertRefused("part.export_step('/tmp/cad-x/part.step')\n", "is not allowed")
        self.assertRefused("part.import_stl('/tmp/a')\n", "is not allowed")
        self.assertRefused("part.write('/tmp/a')\n", "is not allowed")
        self.assertRefused("part.read('/tmp/a')\n", "is not allowed")

    def test_still_accepts_plain_modeling(self):
        check_source("from build123d import *\nwith BuildPart() as p:\n    Box(1, 2, 3)\nresult = p.part\n")


if __name__ == "__main__":
    unittest.main(verbosity=1)
