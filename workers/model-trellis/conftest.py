"""Make `import torch` resolvable on a dev box that has no CUDA wheel at all.

Production runs this service in a GPU image where torch is real; this sandbox
has no GPU and no torch package, which is a stricter version of the same
"no GPU available" case the unit tests must already tolerate (see
instance_health.py's own pure-stdlib design). A real torch import, if one is
already installed, is left completely alone.
"""

from __future__ import annotations

import sys
import types


def _install_torch_stub() -> None:
    try:
        import torch  # noqa: F401

        return
    except ImportError:
        pass

    torch_stub = types.ModuleType("torch")

    class _CudaStub:
        @staticmethod
        def is_available() -> bool:
            return False

        @staticmethod
        def mem_get_info():
            raise RuntimeError("no GPU device in this environment")

        @staticmethod
        def empty_cache() -> None:
            pass

        @staticmethod
        def ipc_collect() -> None:
            pass

        @staticmethod
        def get_device_name(index: int = 0) -> str:
            return "stub"

    hub_stub = types.ModuleType("torch.hub")
    hub_stub.load = lambda *args, **kwargs: None

    torch_stub.cuda = _CudaStub()
    torch_stub.hub = hub_stub

    sys.modules["torch"] = torch_stub
    sys.modules["torch.hub"] = hub_stub


_install_torch_stub()
