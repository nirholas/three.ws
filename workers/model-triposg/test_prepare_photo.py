"""Unit test for _prepare_photo's handling of upstream's unusable-image bug.

Upstream's prepare_image() (VAST-AI-Research/TripoSG's image_process.py) reports
a blank/black/fully-transparent input by having its own load_image() RETURN a
string, then immediately calling `.permute()` on that string -- which raises
AttributeError INSIDE prepare_image, before it ever returns. main.py's
_prepare_photo used to only guard against prepare_image returning a string
(`if not isinstance(prepared, Image.Image)`), which never runs because the
AttributeError escapes the call before that line is reached. Production saw 11
of these surface as opaque "AttributeError: 'str' object has no attribute
'permute'" task failures in three days, and two more on 2026-10-11 (06:06 and
20:14 UTC) after the first attempted fix landed.

No torch, no CUDA, no TripoSG source tree, no GCS: every heavy import main.py
makes at module scope (torch, trimesh, fastapi, google.cloud.storage, PIL,
pydantic) is stubbed in sys.modules before main is imported, so this runs
anywhere:

    python3 workers/model-triposg/test_prepare_photo.py

(also collectable by pytest if it is installed).
"""

from __future__ import annotations

import base64
import io
import os
import sys
import types


def _install_stub_modules() -> None:
    """Install minimal fakes for every heavy module main.py imports at top
    level, just enough for `import main` to succeed without touching any real
    ML/GCP dependency."""

    torch_stub = types.ModuleType("torch")
    torch_stub.float16 = "float16"

    class _Generator:
        def __init__(self, device=None):
            self.device = device

        def manual_seed(self, _seed):
            return self

    torch_stub.Generator = _Generator

    class _NoGrad:
        def __enter__(self):
            return self

        def __exit__(self, *exc):
            return False

    torch_stub.no_grad = _NoGrad

    class _Cuda:
        @staticmethod
        def is_available():
            return False

        @staticmethod
        def get_device_name(_idx):
            return None

    torch_stub.cuda = _Cuda
    sys.modules["torch"] = torch_stub

    trimesh_stub = types.ModuleType("trimesh")

    class _Trimesh:
        pass

    trimesh_stub.Trimesh = _Trimesh
    sys.modules["trimesh"] = trimesh_stub

    fastapi_stub = types.ModuleType("fastapi")

    class _FastAPI:
        def __init__(self, *_args, **_kwargs):
            pass

        def post(self, *_args, **_kwargs):
            return lambda fn: fn

        def get(self, *_args, **_kwargs):
            return lambda fn: fn

    class _HTTPException(Exception):
        def __init__(self, status_code=500, detail=None):
            super().__init__(detail)
            self.status_code = status_code
            self.detail = detail

    def _header(default=None, **_kwargs):
        return default

    class _BackgroundTasks:
        def add_task(self, *_args, **_kwargs):
            pass

    fastapi_stub.FastAPI = _FastAPI
    fastapi_stub.HTTPException = _HTTPException
    fastapi_stub.Header = _header
    fastapi_stub.BackgroundTasks = _BackgroundTasks
    sys.modules["fastapi"] = fastapi_stub

    google_stub = types.ModuleType("google")
    google_api_core_stub = types.ModuleType("google.api_core")
    google_api_core_exceptions_stub = types.ModuleType("google.api_core.exceptions")

    class _NotFound(Exception):
        pass

    google_api_core_exceptions_stub.NotFound = _NotFound
    google_cloud_stub = types.ModuleType("google.cloud")
    google_cloud_storage_stub = types.ModuleType("google.cloud.storage")

    class _Blob:
        def __init__(self, name):
            self.name = name

    class _Bucket:
        def blob(self, name):
            return _Blob(name)

    class _Client:
        def bucket(self, _name):
            return _Bucket()

    google_cloud_storage_stub.Client = _Client
    google_cloud_storage_stub.Bucket = _Bucket
    sys.modules["google"] = google_stub
    sys.modules["google.api_core"] = google_api_core_stub
    sys.modules["google.api_core.exceptions"] = google_api_core_exceptions_stub
    sys.modules["google.cloud"] = google_cloud_stub
    sys.modules["google.cloud.storage"] = google_cloud_storage_stub

    pil_stub = types.ModuleType("PIL")
    pil_image_stub = types.ModuleType("PIL.Image")

    class _Image:
        def __init__(self, size=(1, 1)):
            self.size = size

        def convert(self, _mode):
            return self

        def save(self, fp, format=None):  # noqa: A002, matches PIL's signature
            fp.write(b"stub-png-bytes")

        def alpha_composite(self, _other):
            pass

    def _open(_fp):
        return _Image()

    def _new(_mode, size, _color=None):
        return _Image(size=size)

    pil_image_stub.Image = _Image
    pil_image_stub.open = _open
    pil_image_stub.new = _new
    pil_stub.Image = pil_image_stub
    sys.modules["PIL"] = pil_stub
    sys.modules["PIL.Image"] = pil_image_stub

    pydantic_stub = types.ModuleType("pydantic")

    class _BaseModel:
        pass

    def _field(default=..., **_kwargs):
        return default

    pydantic_stub.BaseModel = _BaseModel
    pydantic_stub.Field = _field
    sys.modules["pydantic"] = pydantic_stub


_install_stub_modules()

os.environ.setdefault("API_KEY", "test-key")
os.environ.setdefault("GCS_BUCKET", "test-bucket")

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import main  # noqa: E402, imported only after the stubs above are in place


def _data_uri() -> str:
    return "data:image/png;base64," + base64.b64encode(b"irrelevant-bytes").decode()


def _with_stub_prepare_image(prepare_image_fn):
    """Install a fake `image_process.prepare_image` for the duration of the
    call, then restore whatever (if anything) was there before."""
    image_process_stub = types.ModuleType("image_process")
    image_process_stub.prepare_image = prepare_image_fn
    previous = sys.modules.get("image_process")
    sys.modules["image_process"] = image_process_stub
    try:
        return main._prepare_photo(_data_uri())
    finally:
        if previous is None:
            del sys.modules["image_process"]
        else:
            sys.modules["image_process"] = previous


def test_blank_image_raises_InputImageError_not_AttributeError():
    """Upstream's prepare_image raises AttributeError (via its own `.permute()`
    call on a string) for a blank/black/transparent input. _prepare_photo must
    translate that into InputImageError, the designed per-input failure the
    rest of main.py already knows how to report (see _run_inference's
    `except InputImageError` branch), not let it escape as an opaque crash."""

    def _prepare_image(_path, bg_color=None, rmbg_net=None):
        raise AttributeError("'str' object has no attribute 'permute'")

    try:
        _with_stub_prepare_image(_prepare_image)
        raise AssertionError("expected InputImageError")
    except main.InputImageError as exc:
        assert "no visible subject" in str(exc), exc
    except AttributeError as exc:  # pragma: no cover, the bug this test guards
        raise AssertionError(
            f"AttributeError escaped _prepare_photo instead of becoming "
            f"InputImageError: {exc}"
        ) from exc


def test_usable_image_passes_through():
    """The success path still returns prepare_image's PIL.Image untouched."""

    sentinel = main.Image.Image()

    def _prepare_image(_path, bg_color=None, rmbg_net=None):
        return sentinel

    result = _with_stub_prepare_image(_prepare_image)
    assert result is sentinel


if __name__ == "__main__":
    tests = [v for k, v in sorted(globals().items()) if k.startswith("test_")]
    for t in tests:
        t()
        print(f"ok  {t.__name__}")
    print(f"{len(tests)} passed")
    sys.exit(0)
