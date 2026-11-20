# Third-party notices: three.ws TRELLIS Mesh Server

Generated at image build time by `third_party_notices.py` from the packages actually
installed in the image. Inside the container this file is
`/licenses/THIRD_PARTY_NOTICES.md` and every license text it references is under
`/licenses/`. The three.ws serving code is Apache-2.0; the NGC Container EULA is at
https://three.ws/legal/nvidia-ngc-eula. Where a component's own license conflicts
with the EULA, that component's license governs it.

## Use restrictions: read first

These components are redistributed under their own licenses, which limit use to
research, evaluation or other non-commercial purposes. The image cannot run inference
without them, so the image as a whole inherits their limits: commercial use of the
image requires the rights holders' permission.

| Component | License | Operative clause | License text |
|---|---|---|---|
| [nvdiffrast](https://github.com/NVlabs/nvdiffrast) at `253ac4fcea7d` | NVIDIA Source Code License (1-Way Commercial) | Section 3.3: "The Work and any derivative works thereof only may be used or intended for use non-commercially. [...] As used herein, "non-commercially" means for research or evaluation purposes only and not for any direct or indirect monetary gain." Commercial use is reserved to NVIDIA and its affiliates. | `source/nvdiffrast/LICENSE.txt` |
| [diff-gaussian-rasterization (mip-splatting fork)](https://github.com/autonomousvision/mip-splatting) at `dda02ab5ecf4` | Gaussian-Splatting License (Inria / MPII) | Section 3: "The Software may be used "non-commercially", i.e., for research and/or evaluation purposes only." Section 5: "THE USER CANNOT USE, EXPLOIT OR DISTRIBUTE THE SOFTWARE FOR COMMERCIAL PURPOSES WITHOUT PRIOR AND EXPLICIT CONSENT OF LICENSORS." | `source/diff-gaussian-rasterization/LICENSE.md` |

### Python packages flagged for review

Their license metadata or files contain a phrase that usually signals a use limit.

| Package | Version | Declared license | Matched phrase |
|---|---|---|---|
| diff_gaussian_rasterization | 0.0.0 | not declared in package metadata | research and/or evaluation purposes only |
| kaolin | 0.18.0 | Apache License 2.0 | intended for use non-commercially |
| nvdiffrast | 0.4.0 | not declared in package metadata | intended for use non-commercially |

## Components built or checked out from source

| Component | Commit | License | Role | License text |
|---|---|---|---|---|
| [nvdiffrast](https://github.com/NVlabs/nvdiffrast) | `253ac4fcea7d` | NVIDIA Source Code License (1-Way Commercial) | CUDA rasteriser used by the TRELLIS GLB texture bake and mesh renderer. | `source/nvdiffrast/LICENSE.txt` |
| [diff-gaussian-rasterization (mip-splatting fork)](https://github.com/autonomousvision/mip-splatting) | `dda02ab5ecf4` | Gaussian-Splatting License (Inria / MPII) | CUDA Gaussian splat rasteriser used to render the views the texture bake projects. | `source/diff-gaussian-rasterization/LICENSE.md` |
| [Microsoft TRELLIS](https://github.com/microsoft/TRELLIS) | `442aa1e1afb9` | MIT | Image-to-3D pipeline source, imported from /app/TRELLIS. | `source/TRELLIS/LICENSE` |
| [FlexiCubes (TRELLIS submodule)](https://github.com/MaxtirError/FlexiCubes) | `815e075a2a40` | Apache-2.0 | Mesh extractor vendored by TRELLIS at trellis/representations/mesh/flexicubes. | `source/flexicubes/LICENSE.txt` |
| [utils3d](https://github.com/EasternJournalist/utils3d) | `9a4eb15e4021` | MIT | 3D math and rasterisation helpers used by the TRELLIS postprocess. | `source/utils3d/LICENSE` |
| [DINOv2 (code and the dinov2_vitl14_reg4 checkpoint)](https://github.com/facebookresearch/dinov2) | `7764ea0f912e` | Apache-2.0 | Image conditioner. Code at /opt/dinov2; weights at /opt/torch/hub/checkpoints. | `source/dinov2/LICENSE` |

## Model weights included in the image

The TRELLIS weights are not included; you mount them. Only this conditioner checkpoint
is baked in, so the model load never depends on a network call.

| File | Model | License |
|---|---|---|
| `/opt/torch/hub/checkpoints/dinov2_vitl14_reg4_pretrain.pth` | DINOv2 ViT-L/14 with registers, Meta AI | Apache-2.0 (facebookresearch/dinov2 LICENSE covers code and model weights) |

## Python packages (199)

| Package | Version | Declared license | License files |
|---|---|---|---|
| annotated-doc | 0.0.7 | MIT | `python/annotated-doc/licenses/LICENSE` |
| annotated-types | 0.8.0 | MIT | `python/annotated-types/licenses/LICENSE` |
| anyio | 4.16.0 | MIT | `python/anyio/licenses/LICENSE` |
| asttokens | 3.0.2 | Apache 2.0 | `python/asttokens/licenses/LICENSE` |
| attrs | 26.1.0 | MIT | `python/attrs/licenses/LICENSE` |
| blinker | 1.9.0 | MIT License | `python/blinker/LICENSE.txt` |
| ccimport | 0.4.4 | MIT | `python/ccimport/LICENSE` |
| certifi | 2026.10.23 | MPL-2.0 | `python/certifi/licenses/LICENSE` |
| cffi | 2.1.1 | MIT-0 | `python/cffi/licenses/LICENSE` |
| charset-normalizer | 3.5.2 | MIT | `python/charset-normalizer/licenses/LICENSE` |
| click | 8.5.1 | BSD-3-Clause | `python/click/licenses/LICENSE.txt` |
| comm | 0.2.3 | BSD 3-Clause License | `python/comm/licenses/LICENSE` |
| ConfigArgParse | 1.10.1 | MIT | `python/configargparse/licenses/LICENSE` |
| contourpy | 1.4.0 | BSD-3-Clause | `python/contourpy/licenses/LICENSE` |
| cryptography | 50.0.2 | Apache-2.0 OR BSD-3-Clause | `python/cryptography/licenses/LICENSE`, `python/cryptography/licenses/LICENSE.APACHE`, `python/cryptography/licenses/LICENSE.BSD` |
| cumm-cu126 | 0.7.11 | MIT | `python/cumm-cu126/LICENSE` |
| cycler | 0.12.1 | Copyright (c) 2015, matplotlib project | `python/cycler/LICENSE` |
| cyclopts | 5.5.2 | Apache-2.0 | `python/cyclopts/licenses/LICENSE` |
| dash | 4.5.1 | MIT | `python/dash/licenses/LICENSE` |
| dataclasses-json | 0.6.7 | MIT | `python/dataclasses-json/LICENSE` |
| Deprecated | 3.0.1 | MIT | `python/deprecated/licenses/LICENSE.md` |
| diff_gaussian_rasterization | 0.0.0 | not declared in package metadata | `python/diff-gaussian-rasterization/licenses/LICENSE.md` |
| docstring_parser | 0.18.0 | MIT | `python/docstring-parser/licenses/LICENSE.md` |
| easydict | 1.14 | LGPL-3.0-only | `python/easydict/licenses/LICENSE` |
| entrypoints | 0.4.2 | MIT | `python/entrypoints/licenses/LICENSE` |
| executing | 2.3.0 | MIT | `python/executing/licenses/LICENSE.txt` |
| fastapi | 0.162.0 | MIT | `python/fastapi/licenses/LICENSE` |
| fastjsonschema | 2.22.3 | BSD-3-Clause | `python/fastjsonschema/licenses/LICENSE` |
| filelock | 4.2.4 | MIT | `python/filelock/licenses/LICENSE` |
| fire | 0.7.1 | Apache-2.0 | `python/fire/licenses/LICENSE` |
| Flask | 3.1.3 | BSD-3-Clause | `python/flask/licenses/LICENSE.txt` |
| flatbuffers | 25.12.19 | Apache 2.0 | none shipped in the distribution |
| fonttools | 4.68.0 | MIT | `python/fonttools/licenses/LICENSE`, `python/fonttools/licenses/LICENSE.external` |
| fsspec | 2026.9.0 | BSD-3-Clause | `python/fsspec/licenses/LICENSE` |
| glcontext | 3.1.0 | MIT | `python/glcontext/licenses/LICENSE` |
| google-api-core | 2.44.0 | Apache 2.0 | `python/google-api-core/licenses/LICENSE` |
| google-auth | 2.62.2 | Apache 2.0 | `python/google-auth/licenses/LICENSE` |
| google-cloud-core | 2.8.0 | Apache 2.0 | `python/google-cloud-core/licenses/LICENSE` |
| google-cloud-storage | 2.18.0 | Apache 2.0 | `python/google-cloud-storage/LICENSE` |
| google-crc32c | 1.9.0 | Apache-2.0 | `python/google-crc32c/licenses/LICENSE` |
| google-resumable-media | 2.11.0 | Apache 2.0 | `python/google-resumable-media/licenses/LICENSE` |
| googleapis-common-protos | 1.76.0 | Apache-2.0 | `python/googleapis-common-protos/licenses/LICENSE` |
| h11 | 0.16.0 | MIT | `python/h11/licenses/LICENSE.txt` |
| hf-xet | 1.8.0 | Apache-2.0 | `python/hf-xet/licenses/LICENSE` |
| httpcore | 1.0.9 | BSD-3-Clause | `python/httpcore/licenses/LICENSE.md` |
| httpcore2 | 2.16.2 | BSD-3-Clause | `python/httpcore2/licenses/LICENSE.md` |
| httptools | 0.9.0 | MIT | `python/httptools/licenses/LICENSE`, `python/httptools/licenses/vendor/http-parser/LICENSE-MIT`, `python/httptools/licenses/vendor/llhttp/LICENSE` |
| httpx | 0.28.1 | BSD-3-Clause | `python/httpx/licenses/LICENSE.md` |
| httpx2 | 2.16.2 | BSD-3-Clause | `python/httpx2/licenses/LICENSE.md` |
| huggingface_hub | 2.4.0 | Apache-2.0 | `python/huggingface-hub/licenses/LICENSE` |
| idna | 3.20 | BSD-3-Clause | `python/idna/licenses/LICENSE.md` |
| igraph | 1.0.0 | GNU General Public License (GPL) | `python/igraph/licenses/LICENSE` |
| ImageIO | 2.38.2 | BSD-2-Clause | `python/imageio/licenses/LICENSE` |
| imageio-ffmpeg | 0.8.1 | BSD-2-Clause | `python/imageio-ffmpeg/licenses/LICENSE` |
| importlib_metadata | 10.2.0 | Apache-2.0 | `python/importlib-metadata/licenses/LICENSE` |
| iniconfig | 2.3.1 | MIT | `python/iniconfig/licenses/LICENSE` |
| ipycanvas | 0.14.3 | Copyright (c) 2019 Martin Renou | `python/ipycanvas/licenses/LICENSE.txt` |
| ipyevents | 2.0.4 | BSD 3-clause | `python/ipyevents/licenses/LICENSE.md` |
| ipython | 9.18.1 | BSD-3-Clause | `python/ipython/licenses/COPYING.rst`, `python/ipython/licenses/LICENSE` |
| ipython_pygments_lexers | 1.1.1 | BSD License | `python/ipython-pygments-lexers/LICENSE` |
| ipywidgets | 8.1.9 | BSD 3-Clause License | `python/ipywidgets/licenses/LICENSE` |
| itsdangerous | 2.2.0 | BSD License | `python/itsdangerous/LICENSE.txt` |
| janus | 2.1.1 | Apache-2.0 | `python/janus/licenses/LICENSE` |
| jedi | 0.20.1 | MIT | `python/jedi/LICENSE.txt`, `python/jedi/jedi/third_party/django-stubs/LICENSE.txt`, `python/jedi/jedi/third_party/typeshed/LICENSE` |
| Jinja2 | 3.1.6 | BSD License | `python/jinja2/licenses/LICENSE.txt` |
| jsonschema | 4.26.0 | MIT | `python/jsonschema/licenses/COPYING` |
| jsonschema-specifications | 2025.9.1 | MIT | `python/jsonschema-specifications/licenses/COPYING` |
| jupyter_client | 7.4.9 | # Licensing terms | `python/jupyter-client/licenses/COPYING.md` |
| jupyter_core | 5.9.1 | BSD-3-Clause | `python/jupyter-core/licenses/LICENSE` |
| jupyterlab_widgets | 3.0.17 | Copyright (c) 2015 Project Jupyter Contributors | `python/jupyterlab-widgets/licenses/LICENSE` |
| kaolin | 0.18.0 | Apache License 2.0 | `python/kaolin/LICENSE`, `python/kaolin/LICENSE.NSCL` |
| kiwisolver | 1.5.1 | ========================= | `python/kiwisolver/licenses/LICENSE` |
| lark | 1.3.1 | MIT | `python/lark/licenses/LICENSE` |
| lazy-importer | 0.1.0 | Apache-2.0 | `python/lazy-importer/licenses/LICENSE` |
| lazy-loader | 0.6 | BSD-3-Clause | `python/lazy-loader/licenses/LICENSE.md` |
| llvmlite | 0.50.0 | BSD-2-Clause AND Apache-2.0 WITH LLVM-exception | `python/llvmlite/licenses/LICENSE`, `python/llvmlite/licenses/LICENSE.thirdparty` |
| markdown-it-py | 4.3.0 | MIT License | `python/markdown-it-py/licenses/LICENSE`, `python/markdown-it-py/licenses/LICENSE.markdown-it` |
| MarkupSafe | 3.0.3 | BSD-3-Clause | `python/markupsafe/licenses/LICENSE.txt` |
| marshmallow | 3.26.2 | MIT License | `python/marshmallow/licenses/LICENSE` |
| matplotlib | 3.11.2 | License agreement for matplotlib versions 1.3.0 and later | `python/matplotlib/LICENSE`, `python/matplotlib/matplotlib/mpl-data/fonts/ttf/LICENSE_DEJAVU`, `python/matplotlib/matplotlib/mpl-data/fonts/ttf/LICENSE_STIX` |
| matplotlib-inline | 0.2.2 | BSD-3-Clause | `python/matplotlib-inline/licenses/LICENSE` |
| mdurl | 0.1.2 | MIT License | `python/mdurl/LICENSE` |
| moderngl | 5.13.0 | MIT | `python/moderngl/licenses/LICENSE` |
| mpmath | 1.3.0 | BSD | `python/mpmath/LICENSE` |
| mypy_extensions | 1.2.0 | MIT | `python/mypy-extensions/licenses/LICENSE` |
| narwhals | 2.29.0 | MIT | `python/narwhals/licenses/LICENSE.md` |
| nbformat | 5.11.1 | BSD 3-Clause License | `python/nbformat/licenses/LICENSE` |
| nest-asyncio | 1.6.0 | BSD | `python/nest-asyncio/LICENSE` |
| networkx | 3.7 | BSD-3-Clause | `python/networkx/licenses/LICENSE.txt` |
| ninja | 1.13.2 | Apache-2.0 | `python/ninja/licenses/LICENSE_Apache_20` |
| numba | 0.68.1 | BSD | `python/numba/licenses/LICENSE`, `python/numba/licenses/LICENSES.third-party` |
| numpy | 2.5.4 | BSD-3-Clause AND 0BSD AND MIT AND Zlib AND CC0-1.0 | `python/numpy/licenses/LICENSE.txt`, `python/numpy/licenses/numpy/_core/include/numpy/libdivide/LICENSE.txt`, `python/numpy/licenses/numpy/_core/src/common/pythoncapi-compat/COPYING`, `python/numpy/licenses/numpy/_core/src/highway/LICENSE`, `python/numpy/licenses/numpy/_core/src/npysort/x86-simd-sort/LICENSE.md`, `python/numpy/licenses/numpy/_core/src/umath/svml/LICENSE`, `python/numpy/licenses/numpy/fft/pocketfft/LICENSE.md`, `python/numpy/licenses/numpy/linalg/lapack_lite/LICENSE.txt`, `python/numpy/licenses/numpy/ma/LICENSE`, `python/numpy/licenses/numpy/random/LICENSE.md`, `python/numpy/licenses/numpy/random/src/distributions/LICENSE.md`, `python/numpy/licenses/numpy/random/src/mt19937/LICENSE.md`, `python/numpy/licenses/numpy/random/src/pcg64/LICENSE.md`, `python/numpy/licenses/numpy/random/src/philox/LICENSE.md`, `python/numpy/licenses/numpy/random/src/sfc64/LICENSE.md`, `python/numpy/licenses/numpy/random/src/splitmix64/LICENSE.md`, `python/numpy/numpy/_core/include/numpy/random/LICENSE.txt`, `python/numpy/numpy/ma/LICENSE`, `python/numpy/numpy/random/LICENSE.md` |
| nvdiffrast | 0.4.0 | not declared in package metadata | `python/nvdiffrast/licenses/LICENSE.txt` |
| nvidia-cublas-cu12 | 12.6.4.1 | NVIDIA Proprietary Software | `python/nvidia-cublas-cu12/License.txt` |
| nvidia-cuda-cupti-cu12 | 12.6.80 | NVIDIA Proprietary Software | `python/nvidia-cuda-cupti-cu12/License.txt` |
| nvidia-cuda-nvrtc-cu12 | 12.6.77 | NVIDIA Proprietary Software | `python/nvidia-cuda-nvrtc-cu12/License.txt` |
| nvidia-cuda-runtime-cu12 | 12.6.77 | NVIDIA Proprietary Software | `python/nvidia-cuda-runtime-cu12/License.txt` |
| nvidia-cudnn-cu12 | 9.5.1.17 | NVIDIA Proprietary Software | `python/nvidia-cudnn-cu12/License.txt` |
| nvidia-cufft-cu12 | 11.3.0.4 | NVIDIA Proprietary Software | `python/nvidia-cufft-cu12/License.txt` |
| nvidia-curand-cu12 | 10.3.7.77 | NVIDIA Proprietary Software | `python/nvidia-curand-cu12/License.txt` |
| nvidia-cusolver-cu12 | 11.7.1.2 | NVIDIA Proprietary Software | `python/nvidia-cusolver-cu12/License.txt` |
| nvidia-cusparse-cu12 | 12.5.4.2 | NVIDIA Proprietary Software | `python/nvidia-cusparse-cu12/License.txt` |
| nvidia-cusparselt-cu12 | 0.6.3 | NVIDIA Proprietary Software | `python/nvidia-cusparselt-cu12/cusparselt/LICENSE.txt` |
| nvidia-nccl-cu12 | 2.21.5 | NVIDIA Proprietary Software | `python/nvidia-nccl-cu12/License.txt` |
| nvidia-nvjitlink-cu12 | 12.6.85 | NVIDIA Proprietary Software | `python/nvidia-nvjitlink-cu12/License.txt` |
| nvidia-nvtx-cu12 | 12.6.77 | Apache 2.0 | `python/nvidia-nvtx-cu12/License.txt` |
| onnxruntime | 1.32.0 | MIT License | `python/onnxruntime/onnxruntime/LICENSE` |
| open3d | 0.20.0 | MIT | `python/open3d/licenses/LICENSE.txt` |
| opencv-python-headless | 5.1.0.95 | Apache 2.0 | `python/opencv-python-headless/LICENSE-3RD-PARTY.txt`, `python/opencv-python-headless/LICENSE.txt`, `python/opencv-python-headless/cv2/LICENSE-3RD-PARTY.txt`, `python/opencv-python-headless/cv2/LICENSE.txt` |
| opentelemetry-api | 1.45.2 | Apache-2.0 | `python/opentelemetry-api/licenses/LICENSE` |
| packaging | 26.3 | Apache-2.0 OR BSD-2-Clause | `python/packaging/licenses/LICENSE`, `python/packaging/licenses/LICENSE.APACHE`, `python/packaging/licenses/LICENSE.BSD` |
| parso | 0.8.7 | MIT | `python/parso/LICENSE.txt` |
| pccm | 0.4.16 | MIT | `python/pccm/LICENSE` |
| pexpect | 4.9.0 | ISC license | `python/pexpect/LICENSE` |
| pillow | 13.0.0 | MIT-CMU | `python/pillow/licenses/LICENSE` |
| pip | 26.3 | MIT | `python/pip/licenses/LICENSE.txt`, `python/pip/licenses/src/pip/_vendor/cachecontrol/LICENSE.txt`, `python/pip/licenses/src/pip/_vendor/certifi/LICENSE`, `python/pip/licenses/src/pip/_vendor/distlib/LICENSE.txt`, `python/pip/licenses/src/pip/_vendor/distro/LICENSE`, `python/pip/licenses/src/pip/_vendor/idna/LICENSE.md`, `python/pip/licenses/src/pip/_vendor/msgpack/COPYING`, `python/pip/licenses/src/pip/_vendor/packaging/LICENSE`, `python/pip/licenses/src/pip/_vendor/packaging/LICENSE.APACHE`, `python/pip/licenses/src/pip/_vendor/packaging/LICENSE.BSD`, `python/pip/licenses/src/pip/_vendor/pkg_resources/LICENSE`, `python/pip/licenses/src/pip/_vendor/platformdirs/LICENSE`, `python/pip/licenses/src/pip/_vendor/pygments/LICENSE`, `python/pip/licenses/src/pip/_vendor/pyproject_hooks/LICENSE`, `python/pip/licenses/src/pip/_vendor/requests/LICENSE`, `python/pip/licenses/src/pip/_vendor/resolvelib/LICENSE`, `python/pip/licenses/src/pip/_vendor/rich/LICENSE`, `python/pip/licenses/src/pip/_vendor/tomli/LICENSE`, `python/pip/licenses/src/pip/_vendor/tomli_w/LICENSE`, `python/pip/licenses/src/pip/_vendor/truststore/LICENSE`, `python/pip/licenses/src/pip/_vendor/urllib3/LICENSE.txt`, `python/pip/pip/_vendor/cachecontrol/LICENSE.txt`, `python/pip/pip/_vendor/certifi/LICENSE`, `python/pip/pip/_vendor/distlib/LICENSE.txt`, `python/pip/pip/_vendor/distro/LICENSE`, `python/pip/pip/_vendor/idna/LICENSE.md`, `python/pip/pip/_vendor/msgpack/COPYING`, `python/pip/pip/_vendor/packaging/LICENSE`, `python/pip/pip/_vendor/packaging/LICENSE.APACHE`, `python/pip/pip/_vendor/packaging/LICENSE.BSD`, `python/pip/pip/_vendor/pkg_resources/LICENSE`, `python/pip/pip/_vendor/platformdirs/LICENSE`, `python/pip/pip/_vendor/pygments/LICENSE`, `python/pip/pip/_vendor/pyproject_hooks/LICENSE`, `python/pip/pip/_vendor/requests/LICENSE`, `python/pip/pip/_vendor/resolvelib/LICENSE`, `python/pip/pip/_vendor/rich/LICENSE`, `python/pip/pip/_vendor/tomli/LICENSE`, `python/pip/pip/_vendor/tomli_w/LICENSE`, `python/pip/pip/_vendor/truststore/LICENSE`, `python/pip/pip/_vendor/urllib3/LICENSE.txt` |
| platformdirs | 4.14.7 | MIT | `python/platformdirs/licenses/LICENSE` |
| plotly | 7.1.0 | MIT | `python/plotly/licenses/LICENSE.txt` |
| pluggy | 1.7.0 | MIT | `python/pluggy/licenses/LICENSE` |
| plyfile | 1.1.5 | GNU GENERAL PUBLIC LICENSE | `python/plyfile/licenses/COPYING` |
| pooch | 1.9.0 | BSD-3-Clause | `python/pooch/licenses/LICENSE.txt` |
| portalocker | 4.4.2 | BSD-3-Clause | `python/portalocker/licenses/LICENSE` |
| prompt_toolkit | 3.0.53 | BSD License | `python/prompt-toolkit/licenses/LICENSE` |
| proto-plus | 1.29.0 | Apache 2.0 | `python/proto-plus/licenses/LICENSE` |
| protobuf | 7.36.2 | 3-Clause BSD License | `python/protobuf/LICENSE` |
| psutil | 7.2.2 | BSD-3-Clause | `python/psutil/LICENSE` |
| ptyprocess | 0.7.0 | ISC License (ISCL) | `python/ptyprocess/LICENSE` |
| pure_eval | 0.2.4 | MIT | `python/pure-eval/licenses/LICENSE.txt` |
| pyasn1 | 0.6.5 | BSD-2-Clause | `python/pyasn1/licenses/LICENSE.rst` |
| pyasn1_modules | 0.4.2 | BSD | `python/pyasn1-modules/licenses/LICENSE.txt` |
| pybind11 | 3.1.0 | BSD-3-Clause | `python/pybind11/licenses/LICENSE` |
| pycparser | 3.12 | BSD-3-Clause | `python/pycparser/licenses/LICENSE` |
| pydantic | 2.14.4 | MIT | `python/pydantic/licenses/LICENSE` |
| pydantic_core | 2.50.5 | MIT | `python/pydantic-core/licenses/LICENSE` |
| pygltflib | 1.16.5 | MIT License | `python/pygltflib/licenses/LICENSE` |
| Pygments | 2.21.0 | BSD-2-Clause | `python/pygments/licenses/LICENSE` |
| PyMatting | 1.1.16 | MIT | `python/pymatting/licenses/LICENSE.md` |
| pymeshfix | 0.18.1 | GNU Affero General Public License v3 | `python/pymeshfix/licenses/LICENSE` |
| pyparsing | 3.3.3 | MIT | `python/pyparsing/licenses/LICENSE` |
| pytest | 9.2.0 | MIT | `python/pytest/licenses/LICENSE` |
| python-dateutil | 4.0.0 | BSD-3-Clause | `python/python-dateutil/licenses/LICENSE` |
| python-dotenv | 1.2.4 | BSD-3-Clause | `python/python-dotenv/licenses/LICENSE` |
| pyvista | 0.49.2 | MIT | `python/pyvista/licenses/LICENSE` |
| pyvista-validation | 0.2.2 | MIT | `python/pyvista-validation/licenses/LICENSE` |
| PyYAML | 6.0.3 | MIT | `python/pyyaml/licenses/LICENSE` |
| pyzmq | 27.3.0 | BSD-3-Clause | `python/pyzmq/licenses/LICENSE.md`, `python/pyzmq/licenses/licenses/LICENSE.libsodium.txt`, `python/pyzmq/licenses/licenses/LICENSE.tornado.txt`, `python/pyzmq/licenses/licenses/LICENSE.zeromq.txt` |
| referencing | 0.37.0 | MIT | `python/referencing/licenses/COPYING` |
| regex | 2026.11.19 | Apache-2.0 AND CNRI-Python | `python/regex/licenses/LICENSE.txt` |
| rembg | 2.0.86 | MIT | `python/rembg/licenses/LICENSE.txt` |
| requests | 2.34.2 | Apache-2.0 | `python/requests/licenses/LICENSE`, `python/requests/licenses/NOTICE` |
| retrying | 1.4.2 | Apache-2.0 | `python/retrying/licenses/LICENSE.txt`, `python/retrying/licenses/NOTICE.txt` |
| rich | 15.0.0 | MIT | `python/rich/licenses/LICENSE` |
| rich-rst | 2.2.0 | MIT | `python/rich-rst/licenses/LICENSE`, `python/rich-rst/licenses/rich_rst/_vendor/LICENSES.txt`, `python/rich-rst/rich_rst/_vendor/LICENSES.txt` |
| rpds-py | 2026.9.1 | MIT | `python/rpds-py/licenses/LICENSE` |
| safetensors | 0.8.0 | Apache Software License | `python/safetensors/licenses/LICENSE` |
| scikit-image | 0.26.0 | Files: * | `python/scikit-image/LICENSE.txt` |
| scipy | 1.18.1 | Copyright (c) 2001-2002 Enthought, Inc. 2003, SciPy Developers. | `python/scipy/LICENSE.txt`, `python/scipy/scipy/_lib/_uarray/LICENSE`, `python/scipy/scipy/fft/_duccfft/LICENSE.md`, `python/scipy/scipy/integrate/LICENSE_DOP`, `python/scipy/scipy/spatial/qhull_src/COPYING_QHULL.txt` |
| scooby | 0.12.1 | MIT | `python/scooby/licenses/LICENSE` |
| setuptools | 84.2.1 | MIT | `python/setuptools/licenses/LICENSE`, `python/setuptools/setuptools/_vendor/LICENSE`, `python/setuptools/setuptools/_vendor/LICENSE`, `python/setuptools/setuptools/_vendor/LICENSE`, `python/setuptools/setuptools/_vendor/licenses/LICENSE`, `python/setuptools/setuptools/_vendor/licenses/LICENSE`, `python/setuptools/setuptools/_vendor/licenses/LICENSE`, `python/setuptools/setuptools/_vendor/licenses/LICENSE`, `python/setuptools/setuptools/_vendor/licenses/LICENSE`, `python/setuptools/setuptools/_vendor/licenses/LICENSE`, `python/setuptools/setuptools/_vendor/licenses/LICENSE`, `python/setuptools/setuptools/_vendor/licenses/LICENSE`, `python/setuptools/setuptools/_vendor/licenses/LICENSE.APACHE`, `python/setuptools/setuptools/_vendor/licenses/LICENSE.BSD`, `python/setuptools/setuptools/_vendor/licenses/LICENSE.txt`, `python/setuptools/setuptools/config/NOTICE`, `python/setuptools/setuptools/config/_validate_pyproject/NOTICE` |
| shellingham | 1.5.4 | ISC License | `python/shellingham/LICENSE` |
| spconv-cu126 | 2.3.8 | Apache License 2.0 | `python/spconv-cu126/LICENSE` |
| stack-data | 0.6.3 | MIT | `python/stack-data/LICENSE.txt` |
| starlette | 1.10.0 | BSD-3-Clause | `python/starlette/licenses/LICENSE.md` |
| sympy | 1.13.1 | BSD | `python/sympy/LICENSE`, `python/sympy/sympy/parsing/latex/LICENSE.txt` |
| termcolor | 3.3.0 | MIT | `python/termcolor/licenses/COPYING.txt` |
| texttable | 1.7.3 | MIT | `python/texttable/licenses/LICENSE` |
| tifffile | 2026.11.16 | BSD-3-Clause | `python/tifffile/licenses/LICENSE` |
| tokenizers | 0.23.3 | Apache Software License | none shipped in the distribution |
| torch | 2.6.0+cu126 | BSD-3-Clause | `python/torch/LICENSE`, `python/torch/NOTICE` |
| torchvision | 0.21.0+cu126 | BSD | `python/torchvision/LICENSE` |
| tornado | 6.6.1 | Apache-2.0 | `python/tornado/licenses/LICENSE` |
| tqdm | 4.70.1 | MPL-2.0 AND MIT | `python/tqdm/licenses/LICENCE` |
| traitlets | 5.16.1 | BSD 3-Clause License | `python/traitlets/licenses/LICENSE` |
| transformers | 5.21.0 | Apache 2.0 License | `python/transformers/licenses/LICENSE` |
| trimesh | 5.2.1 | The MIT License (MIT) | `python/trimesh/licenses/LICENSE.md` |
| triton | 3.2.0 | MIT License | none shipped in the distribution |
| truststore | 0.10.5 | MIT | `python/truststore/licenses/LICENSE` |
| typer | 0.29.2 | MIT | `python/typer/licenses/LICENSE`, `python/typer/typer/_click/LICENSE.txt` |
| typing_extensions | 4.16.0 | PSF-2.0 | `python/typing-extensions/licenses/LICENSE` |
| typing-inspect | 0.9.0 | MIT | `python/typing-inspect/LICENSE` |
| typing-inspection | 0.4.5 | MIT | `python/typing-inspection/licenses/LICENSE` |
| tzdata | 2026.6 | Apache-2.0 | `python/tzdata/licenses/LICENSE`, `python/tzdata/licenses/licenses/LICENSE_APACHE` |
| urllib3 | 2.8.0 | MIT | `python/urllib3/licenses/LICENSE.txt` |
| usd-core | 26.11 | LicenseRef-TOST-1.0 | `python/usd-core/licenses/LICENSE.txt` |
| utils3d | 0.0.2 | MIT | `python/utils3d/licenses/LICENSE` |
| uvicorn | 0.32.0 | BSD-3-Clause | `python/uvicorn/licenses/LICENSE.md` |
| uvloop | 0.23.0 | MIT License | `python/uvloop/licenses/LICENSE-APACHE`, `python/uvloop/licenses/LICENSE-MIT` |
| vtk | 9.7.2 | BSD | `python/vtk/licenses/LICENSE` |
| warp-lang | 1.19.0 | Apache-2.0 | `python/warp-lang/licenses/LICENSE.md` |
| watchfiles | 1.3.0 | MIT | `python/watchfiles/licenses/LICENSE` |
| wcwidth | 0.9.4 | MIT License | `python/wcwidth/licenses/LICENSE` |
| websockets | 17.4 | BSD-3-Clause | `python/websockets/licenses/LICENSE` |
| Werkzeug | 3.1.9 | BSD-3-Clause | `python/werkzeug/licenses/LICENSE.txt` |
| wheel | 0.48.0 | MIT | `python/wheel/licenses/LICENSE.txt` |
| widgetsnbextension | 4.0.16 | BSD 3-Clause License | `python/widgetsnbextension/licenses/LICENSE` |
| wrapt | 2.5.2 | BSD-2-Clause | `python/wrapt/licenses/LICENSE` |
| xatlas | 0.0.11 | MIT License | `python/xatlas/licenses/LICENSE` |
| xformers | 0.0.29.post3 | BSD License | `python/xformers/LICENSE` |
| zipp | 4.1.2 | MIT | `python/zipp/licenses/LICENSE` |

## NVIDIA CUDA base image

The image is built on `nvidia/cuda` (runtime flavour). NVIDIA's CUDA and container
license terms ship in the image at:

- `/NGC-DL-CONTAINER-LICENSE`

## Ubuntu packages (182)

Each package's copyright and license terms are at `/usr/share/doc/<package>/copyright`.

| Package | Version |
|---|---|
| adduser | 3.137ubuntu1 |
| apt | 2.8.4ubuntu0.1 |
| base-files | 13ubuntu10.5 |
| base-passwd | 3.6.3build1 |
| bash | 5.2.21-2ubuntu4 |
| bsdutils | 1:2.39.3-9ubuntu6.6 |
| ca-certificates | 20260816ubuntu0.24.04.2 |
| coreutils | 9.4-3ubuntu6.3 |
| cuda-compat-12-6 | 560.35.05-0ubuntu1 |
| cuda-cudart-12-6 | 12.6.77-1 |
| cuda-libraries-12-6 | 12.6.3-1 |
| cuda-nvrtc-12-6 | 12.6.85-1 |
| cuda-nvtx-12-6 | 12.6.77-1 |
| cuda-opencl-12-6 | 12.6.77-1 |
| cuda-toolkit-12-6-config-common | 12.6.77-1 |
| cuda-toolkit-12-config-common | 12.9.79-1 |
| cuda-toolkit-config-common | 13.5.37-1 |
| dash | 0.5.12-6ubuntu5 |
| debconf | 1.5.86ubuntu1 |
| debianutils | 5.17build1 |
| diffutils | 1:3.10-1ubuntu0.1 |
| dirmngr | 2.4.4-2ubuntu17.6 |
| dpkg | 1.22.6ubuntu6.6 |
| e2fsprogs | 1.47.0-2.4~exp1ubuntu4.1 |
| findutils | 4.9.0-5build1 |
| gcc-14-base | 14.2.0-4ubuntu2~24.04.1 |
| gnupg | 2.4.4-2ubuntu17.6 |
| gnupg-utils | 2.4.4-2ubuntu17.6 |
| gnupg2 | 2.4.4-2ubuntu17.6 |
| gpg | 2.4.4-2ubuntu17.6 |
| gpg-agent | 2.4.4-2ubuntu17.6 |
| gpgconf | 2.4.4-2ubuntu17.6 |
| gpgsm | 2.4.4-2ubuntu17.6 |
| gpgv | 2.4.4-2ubuntu17.6 |
| grep | 3.11-4build1 |
| gzip | 1.12-1ubuntu3.2 |
| hostname | 3.23+nmu2ubuntu2 |
| init-system-helpers | 1.66ubuntu1 |
| keyboxd | 2.4.4-2ubuntu17.6 |
| libacl1 | 2.3.2-1build1.1 |
| libapt-pkg6.0t64 | 2.8.4ubuntu0.1 |
| libassuan0 | 2.5.6-1build1 |
| libattr1 | 1:2.5.2-1ubuntu0.1 |
| libaudit-common | 1:3.1.2-2.1ubuntu0.1 |
| libaudit1 | 1:3.1.2-2.1ubuntu0.1 |
| libblkid1 | 2.39.3-9ubuntu6.6 |
| libbsd0 | 0.12.1-1build1.1 |
| libbz2-1.0 | 1.0.8-5.1ubuntu0.1 |
| libc-bin | 2.39-0ubuntu8.12 |
| libc6 | 2.39-0ubuntu8.12 |
| libcap-ng0 | 0.8.4-2build2 |
| libcap2 | 1:2.66-5ubuntu2.4 |
| libcom-err2 | 1.47.0-2.4~exp1ubuntu4.1 |
| libcrypt1 | 1:4.4.36-4build1 |
| libcublas-12-6 | 12.6.4.1-1 |
| libcufft-12-6 | 11.3.0.4-1 |
| libcufile-12-6 | 1.11.1.6-1 |
| libcurand-12-6 | 10.3.7.77-1 |
| libcusolver-12-6 | 11.7.1.2-1 |
| libcusparse-12-6 | 12.5.4.2-1 |
| libdb5.3t64 | 5.3.28+dfsg2-7 |
| libdebconfclient0 | 0.271ubuntu3 |
| libdrm-amdgpu1 | 2.4.125-1ubuntu0.1~24.04.2 |
| libdrm-common | 2.4.125-1ubuntu0.1~24.04.2 |
| libdrm-intel1 | 2.4.125-1ubuntu0.1~24.04.2 |
| libdrm2 | 2.4.125-1ubuntu0.1~24.04.2 |
| libedit2 | 3.1-20230828-1build1 |
| libegl-mesa0 | 25.2.8-0ubuntu0.24.04.5 |
| libegl1 | 1.7.0-1build1 |
| libelf1t64 | 0.190-1.1ubuntu0.1 |
| libexpat1 | 2.6.1-2ubuntu0.6 |
| libext2fs2t64 | 1.47.0-2.4~exp1ubuntu4.1 |
| libffi8 | 3.4.6-1build1 |
| libgbm1 | 25.2.8-0ubuntu0.24.04.5 |
| libgcc-s1 | 14.2.0-4ubuntu2~24.04.1 |
| libgcrypt20 | 1.10.3-2ubuntu0.2 |
| libgl1 | 1.7.0-1build1 |
| libgl1-mesa-dri | 25.2.8-0ubuntu0.24.04.5 |
| libglib2.0-0t64 | 2.80.0-6ubuntu3.10 |
| libglvnd0 | 1.7.0-1build1 |
| libglx-mesa0 | 25.2.8-0ubuntu0.24.04.5 |
| libglx0 | 1.7.0-1build1 |
| libgmp10 | 2:6.3.0+dfsg-2ubuntu6.1 |
| libgnutls30t64 | 3.8.3-1.1ubuntu3.6 |
| libgomp1 | 14.2.0-4ubuntu2~24.04.1 |
| libgpg-error0 | 1.47-3build2.1 |
| libhogweed6t64 | 3.9.1-2.2build1.1 |
| libicu74 | 74.2-1ubuntu3.1 |
| libidn2-0 | 2.3.7-2build1.1 |
| libksba8 | 1.6.6-1build1 |
| libldap2 | 2.6.10+dfsg-0ubuntu0.24.04.1 |
| libllvm20 | 1:20.1.2-0ubuntu1~24.04.3 |
| liblz4-1 | 1.9.4-1build1.1 |
| liblzma5 | 5.6.1+really5.4.5-1ubuntu0.4 |
| libmd0 | 1.1.0-2build1.1 |
| libmount1 | 2.39.3-9ubuntu6.6 |
| libnccl2 | 2.23.4-1+cuda12.6 |
| libncursesw6 | 6.4+20240113-1ubuntu2.2 |
| libnettle8t64 | 3.9.1-2.2build1.1 |
| libnpp-12-6 | 12.3.1.54-1 |
| libnpth0t64 | 1.6-3.1build1 |
| libnvfatbin-12-6 | 12.6.77-1 |
| libnvjitlink-12-6 | 12.6.85-1 |
| libnvjpeg-12-6 | 12.3.3.54-1 |
| libp11-kit0 | 0.25.3-4ubuntu2.2 |
| libpam-modules | 1.5.3-5ubuntu5.7 |
| libpam-modules-bin | 1.5.3-5ubuntu5.7 |
| libpam-runtime | 1.5.3-5ubuntu5.7 |
| libpam0g | 1.5.3-5ubuntu5.7 |
| libpciaccess0 | 0.17-3ubuntu0.24.04.3 |
| libpcre2-8-0 | 10.42-4ubuntu2.2 |
| libproc2-0 | 2:4.0.4-4ubuntu3.3 |
| libpython3.12-minimal | 3.12.3-1ubuntu0.17 |
| libpython3.12-stdlib | 3.12.3-1ubuntu0.17 |
| libreadline8t64 | 8.2-4build1 |
| libsasl2-2 | 2.1.28+dfsg1-5ubuntu3.1 |
| libsasl2-modules-db | 2.1.28+dfsg1-5ubuntu3.1 |
| libseccomp2 | 2.5.5-1ubuntu3.1 |
| libselinux1 | 3.5-2ubuntu2.1 |
| libsemanage-common | 3.5-1build5 |
| libsemanage2 | 3.5-1build5 |
| libsensors-config | 1:3.6.0-9build1 |
| libsensors5 | 1:3.6.0-9build1 |
| libsepol2 | 3.5-2build1 |
| libsmartcols1 | 2.39.3-9ubuntu6.6 |
| libsqlite3-0 | 3.45.1-1ubuntu2.9 |
| libss2 | 1.47.0-2.4~exp1ubuntu4.1 |
| libssl3t64 | 3.0.13-0ubuntu3.16 |
| libstdc++6 | 14.2.0-4ubuntu2~24.04.1 |
| libsystemd0 | 255.4-1ubuntu8.19 |
| libtasn1-6 | 4.19.0-3ubuntu0.24.04.2 |
| libtinfo6 | 6.4+20240113-1ubuntu2.2 |
| libudev1 | 255.4-1ubuntu8.19 |
| libunistring5 | 1.1-2build1.1 |
| libusb-1.0-0 | 2:1.0.27-1 |
| libuuid1 | 2.39.3-9ubuntu6.6 |
| libvulkan1 | 1.3.275.0-1build1 |
| libwayland-client0 | 1.22.0-2.1build1 |
| libx11-6 | 2:1.8.7-1ubuntu0.1 |
| libx11-data | 2:1.8.7-1ubuntu0.1 |
| libx11-xcb1 | 2:1.8.7-1ubuntu0.1 |
| libxau6 | 1:1.0.9-1build6 |
| libxcb-dri3-0 | 1.15-1ubuntu2 |
| libxcb-glx0 | 1.15-1ubuntu2 |
| libxcb-present0 | 1.15-1ubuntu2 |
| libxcb-randr0 | 1.15-1ubuntu2 |
| libxcb-shm0 | 1.15-1ubuntu2 |
| libxcb-sync1 | 1.15-1ubuntu2 |
| libxcb-xfixes0 | 1.15-1ubuntu2 |
| libxcb1 | 1.15-1ubuntu2 |
| libxdmcp6 | 1:1.1.3-0ubuntu6 |
| libxext6 | 2:1.3.4-1build2 |
| libxml2 | 2.9.14+dfsg-1.3ubuntu3.10 |
| libxshmfence1 | 1.3-1build5 |
| libxxf86vm1 | 1:1.1.4-1build4 |
| libxxhash0 | 0.8.2-2build1 |
| libzstd1 | 1.5.5+dfsg2-2build1.1 |
| login | 1:4.13+dfsg1-4ubuntu3.2 |
| logsave | 1.47.0-2.4~exp1ubuntu4.1 |
| mawk | 1.3.4.20240123-1build1 |
| media-types | 10.1.0 |
| mesa-libgallium | 25.2.8-0ubuntu0.24.04.5 |
| mount | 2.39.3-9ubuntu6.6 |
| ncurses-base | 6.4+20240113-1ubuntu2.2 |
| ncurses-bin | 6.4+20240113-1ubuntu2.2 |
| netbase | 6.4 |
| openssl | 3.0.13-0ubuntu3.16 |
| passwd | 1:4.13+dfsg1-4ubuntu3.2 |
| perl-base | 5.38.2-3.2ubuntu0.7 |
| pinentry-curses | 1.2.1-3ubuntu5 |
| procps | 2:4.0.4-4ubuntu3.3 |
| python3.12 | 3.12.3-1ubuntu0.17 |
| python3.12-minimal | 3.12.3-1ubuntu0.17 |
| readline-common | 8.2-4build1 |
| sed | 4.9-2ubuntu0.24.04.1 |
| sensible-utils | 0.0.22 |
| sysvinit-utils | 3.08-6ubuntu3 |
| tar | 1.35+dfsg-3ubuntu0.4 |
| tzdata | 2026e-0ubuntu0.24.04.1 |
| ubuntu-keyring | 2023.11.28.1 |
| util-linux | 2.39.3-9ubuntu6.6 |
| zlib1g | 1:1.3.dfsg-3.1ubuntu2.3 |
