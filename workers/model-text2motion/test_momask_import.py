"""Tests for momask_sampler's upstream import preparation.

Reproduces the production failure measured 2026-11-14 on
model-text2motion-00002-sqf (us-east4): every `model: "momask"` request died
in `_load()` with `AttributeError: module 'numpy' has no attribute 'float'`,
raised by momask-codes' `common/quaternion.py` line 13
(`_FLOAT_EPS = np.finfo(np.float).eps`). NumPy 1.24 removed the `np.float`
alias and the image installs `numpy>=1.24.0`, so MoMask could never load.

The fixture repo below carries that exact upstream line (and the
`.astype(np.float)` form from `utils/motion_process.py`) so the test needs no
network, torch, GPU or checkpoint.

Run (from this directory):
    python3 -m unittest discover -p 'test_*.py'
"""

from __future__ import annotations

import os
import sys
import tempfile
import unittest

import numpy as np

import momask_sampler

QUATERNION_PY = """import numpy as np

_EPS4 = np.finfo(float).eps * 4.0

_FLOAT_EPS = np.finfo(np.float).eps
"""

MOTION_PROCESS_PY = """import numpy as np

from common.quaternion import _FLOAT_EPS


def foot_contacts(velocities, velfactor):
    return (velocities < velfactor).astype(np.float)
"""


class MomaskUpstreamImportTest(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        repo = self._tmp.name
        for pkg in ("common", "utils"):
            os.makedirs(os.path.join(repo, pkg))
            open(os.path.join(repo, pkg, "__init__.py"), "w").close()
        with open(os.path.join(repo, "common", "quaternion.py"), "w") as f:
            f.write(QUATERNION_PY)
        with open(os.path.join(repo, "utils", "motion_process.py"), "w") as f:
            f.write(MOTION_PROCESS_PY)
        self.repo = repo
        self._saved_path = list(sys.path)
        self._had_float = "float" in np.__dict__
        self._purge()

    def tearDown(self):
        self._purge()
        sys.path[:] = self._saved_path
        if not self._had_float:
            np.__dict__.pop("float", None)
        self._tmp.cleanup()

    @staticmethod
    def _purge():
        for name in list(sys.modules):
            if name in ("common", "utils") or name.startswith(("common.", "utils.")):
                del sys.modules[name]

    def test_installed_numpy_has_no_float_alias(self):
        # Guards the premise: on the NumPy the image ships, the upstream line
        # really does fail without preparation.
        np.__dict__.pop("float", None)
        sys.path.insert(0, self.repo)
        with self.assertRaisesRegex(AttributeError, "has no attribute 'float'"):
            __import__("common.quaternion")

    def test_prepared_import_loads_upstream_modules(self):
        np.__dict__.pop("float", None)
        momask_sampler.prepare_upstream_imports(self.repo)

        from utils.motion_process import _FLOAT_EPS, foot_contacts

        self.assertEqual(_FLOAT_EPS, np.finfo(np.float64).eps)
        contacts = foot_contacts(np.array([0.01, 0.5]), 0.1)
        self.assertEqual(contacts.dtype, np.float64)
        self.assertEqual(contacts.tolist(), [1.0, 0.0])

    def test_prepared_import_pins_repo_first_and_purges_stale_utils(self):
        stale = type(sys)("utils")
        sys.modules["utils"] = stale
        sys.path.append(self.repo)

        momask_sampler.prepare_upstream_imports(self.repo)

        self.assertEqual(sys.path[0], self.repo)
        self.assertEqual(sys.path.count(self.repo), 1)
        self.assertNotIn("utils", sys.modules)


if __name__ == "__main__":
    unittest.main()
