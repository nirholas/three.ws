"""The build-time contract check must tell "no GPU on the CPU builder" apart from
a genuinely broken import, or the image either never builds or ships broken.

flex_gemm imports Triton, and Triton's driver discovery raises
`RuntimeError: 0 active drivers ([]). There should only be one.` on a host with
no GPU. That is expected on Cloud Build and must be classified as driver absence.
"""

from test_app_contract import _is_gpu_driver_absence


def test_triton_zero_active_drivers_is_driver_absence():
    exc = RuntimeError("0 active drivers ([]). There should only be one.")
    assert _is_gpu_driver_absence(exc)


def test_missing_libcuda_is_driver_absence():
    exc = OSError("libcuda.so.1: cannot open shared object file: No such file or directory")
    assert _is_gpu_driver_absence(exc)


def test_missing_compiled_extension_is_not_driver_absence():
    exc = OSError("_C.cpython-310-x86_64-linux-gnu.so: cannot open shared object file")
    assert not _is_gpu_driver_absence(exc)


def test_unrelated_runtime_error_is_not_driver_absence():
    exc = RuntimeError("shape mismatch in sparse conv")
    assert not _is_gpu_driver_absence(exc)


def test_triton_multiple_drivers_is_not_driver_absence():
    exc = RuntimeError("2 active drivers ([cuda, hip]). There should only be one.")
    assert not _is_gpu_driver_absence(exc)
