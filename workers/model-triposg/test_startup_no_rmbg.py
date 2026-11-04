"""The service must start with no RMBG weights anywhere.

briaai/RMBG-1.4 ships under a non-commercial licence, so this worker no longer
stages, imports, or loads it: image-mode background removal is done by the
rembg-service matte (matte.py). This test runs main._load_models with a stub
TripoSG pipeline and a `briarmbg` module that fails on import, and asserts that
only the TripoSG weight tree is staged and that the image path hands upstream's
prepare_image no remover. Reuses test_prepare_photo's heavy-module stubs:

    python3 workers/model-triposg/test_startup_no_rmbg.py
"""

from __future__ import annotations

import os
import sys
import types

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import test_prepare_photo as tp  # noqa: E402, installs the stubs and imports main

main = tp.main


class _ForbiddenModule(types.ModuleType):
    def __getattr__(self, name):
        raise AssertionError(f"RMBG module touched at startup: briarmbg.{name}")


def _install_triposg_stub(loaded):
    class _Pipe:
        @classmethod
        def from_pretrained(cls, path):
            loaded.append(path)
            return cls()

        def to(self, *_args):
            return self

    pkg = types.ModuleType("triposg")
    pipes = types.ModuleType("triposg.pipelines")
    mod = types.ModuleType("triposg.pipelines.pipeline_triposg")
    mod.TripoSGPipeline = _Pipe
    sys.modules["triposg"] = pkg
    sys.modules["triposg.pipelines"] = pipes
    sys.modules["triposg.pipelines.pipeline_triposg"] = mod


def test_load_models_stages_only_triposg():
    loaded, staged = [], []
    _install_triposg_stub(loaded)
    sys.modules["briarmbg"] = _ForbiddenModule("briarmbg")
    original = main._stage_tree
    main._stage_tree = lambda uri, name, fuse_dir: staged.append(name) or f"/staged/{name}"
    try:
        main._load_models()
    finally:
        main._stage_tree = original
        del sys.modules["briarmbg"]
    assert staged == ["triposg"], f"only the TripoSG tree is staged, got {staged}"
    assert loaded == ["/staged/triposg"]
    assert main._pipe is not None
    for name in ("RMBG_WEIGHTS_DIR", "RMBG_WEIGHTS_GCS_URI", "_rmbg_net"):
        assert not hasattr(main, name), f"main.{name} still exists"


def test_photo_path_uses_the_matte_and_no_in_process_remover():
    calls = {}
    sentinel = main.Image.Image()

    def _prepare_image(path, bg_color=None, rmbg_net="missing"):
        calls["rmbg_net"] = rmbg_net
        return sentinel

    original = main._matte
    main._matte = lambda img: calls.setdefault("matted", img)
    try:
        assert tp._with_stub_prepare_image(_prepare_image) is sentinel
    finally:
        main._matte = original
    assert "matted" in calls, "the photo goes through the rembg-service matte"
    assert calls["rmbg_net"] is None, "upstream prepare_image is given no remover"


if __name__ == "__main__":
    tests = [v for k, v in sorted(globals().items()) if k.startswith("test_")]
    for t in tests:
        t()
        print(f"ok  {t.__name__}")
    print(f"{len(tests)} passed")
    sys.exit(0)
