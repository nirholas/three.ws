"""Guard the single-source invariant for the vendored Forge client.

``three_ws_client.py`` is the one source of truth for the Forge contract. Each
plugin ships a byte-identical copy so it stays self-contained and distributable
(a Blender add-on zip, a ComfyUI custom_nodes clone, a Modly extension folder). This test fails if any
copy drifts from the canonical file. Re-copy it and the contract stays in lockstep.
"""

from __future__ import annotations

import os
import unittest

_HERE = os.path.dirname(os.path.abspath(__file__))
_ROOT = os.path.dirname(_HERE)  # integrations/
_CANONICAL = os.path.join(_HERE, "three_ws_client.py")
_VENDORED = [
    os.path.join(_ROOT, "blender", "three_ws", "three_ws_client.py"),
    os.path.join(_ROOT, "comfyui", "three_ws_nodes", "three_ws_client.py"),
    os.path.join(_ROOT, "modly", "three-ws", "three_ws_client.py"),
    os.path.join(_ROOT, "modly", "three-ws-publish", "three_ws_client.py"),
]


class NoDriftTest(unittest.TestCase):
    def test_vendored_copies_match_canonical(self):
        with open(_CANONICAL, "rb") as fh:
            canonical = fh.read()
        for path in _VENDORED:
            self.assertTrue(os.path.isfile(path), f"missing vendored copy: {path}")
            with open(path, "rb") as fh:
                copy = fh.read()
            self.assertEqual(
                canonical,
                copy,
                f"{path} drifted from the canonical three_ws_client.py. "
                f"re-copy it: cp {_CANONICAL} {path}",
            )


if __name__ == "__main__":
    unittest.main()
