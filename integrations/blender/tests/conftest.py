"""Load the extension's bpy-free modules as a package without running its __init__."""

import importlib
import os
import sys
import types

HERE = os.path.dirname(os.path.abspath(__file__))

# These run inside Blender (they import bpy); run_blender_tests.sh drives them.
collect_ignore = ["blender_import_test.py", "blender_timer_test.py"]
PKG_DIR = os.path.join(os.path.dirname(HERE), "three_ws")

if "three_ws" not in sys.modules:
    pkg = types.ModuleType("three_ws")
    pkg.__path__ = [PKG_DIR]
    sys.modules["three_ws"] = pkg
if HERE not in sys.path:
    sys.path.insert(0, HERE)

importlib.import_module("three_ws.three_ws_client")
