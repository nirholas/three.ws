# Licences in the three.ws GPU quickstart image

Reviewed 2026-11-16 for the NVIDIA Brev Launchable. The question for every
component was: may three.ws redistribute it inside a public container image,
and may anyone who launches that image use it for a commercial demo? Every
answer below is yes. This file ships inside the image at
`/licenses/THREE_WS_QUICKSTART_LICENSES.md`, next to the upstream licence texts.

## Why TripoSR, and not TRELLIS

three.ws runs several image-to-3D models in production. The one with the best
quality per GPU second, TRELLIS, cannot go in a public, commercially usable
image: its texture bake needs nvdiffrast (NVIDIA Source Code License,
non-commercial) and diff-gaussian-rasterization (Inria/MPII, research and
evaluation only). The full review is in
[docs/nvidia-ngc-listing.md](../../docs/nvidia-ngc-listing.md), gate 5.

TripoSR is MIT for both the code and the weights, has no restricted CUDA
extension, runs in about 6 GB of GPU memory, and is already a production lane
on three.ws ([workers/model-triposr](../../workers/model-triposr/README.md)).
That makes it the model a stranger can run, keep, modify and show to customers
without asking anyone.

## Model weights (baked into the image, pinned)

| Weights | Revision | Licence | Commercial use | Redistribution |
|---|---|---|---|---|
| [stabilityai/TripoSR](https://huggingface.co/stabilityai/TripoSR) `config.yaml`, `model.ckpt` | `5b521936b01fbe1890f6f9baed0254ab6351c04a` | MIT | Yes | Yes, with the licence notice |
| [facebook/dino-vitb16](https://huggingface.co/facebook/dino-vitb16) `config.json` only | `f205d5d8e640a89a2b8ef0369670dfc37cc07fc2` | Apache-2.0 | Yes | Yes, with the licence and NOTICE |
| U2-Net `u2net.onnx` (fetched by rembg) | rembg 2.0.86 release asset | Apache-2.0 ([U-2-Net](https://github.com/xuebinqin/U-2-Net)) | Yes | Yes |
| [Xenova/all-MiniLM-L6-v2](https://huggingface.co/Xenova/all-MiniLM-L6-v2) fp32 ONNX (inference node) | resolved at build | Apache-2.0 | Yes | Yes |

The DINO ViT-B/16 checkpoint itself is not in the image: TripoSR builds the
ViT from its config and loads every weight from `model.ckpt`.

## Code

| Component | Licence | Note |
|---|---|---|
| [TripoSR](https://github.com/VAST-AI-Research/TripoSR) at `107cefdc244c39106fa830359024f6a2f1c78871` | MIT | Licence text at `/opt/triposr/LICENSE` |
| [torchmcubes](https://github.com/tatsy/torchmcubes) at `a9ac95aa329957ba646e7bb057f825f5dfa77f38` | MPL-2.0 | File-level copyleft. Unmodified; its Source Code Form is the pinned commit linked here, which satisfies MPL-2.0 section 3.2 for the compiled extension in the image |
| PyTorch 2.7.1 (cu128 wheel) | BSD-3-Clause | Bundles NVIDIA CUDA, cuDNN, cuBLAS and NCCL runtime libraries as pip wheels, redistributed under NVIDIA's redistributable-components terms |
| ONNX Runtime GPU (via rembg[gpu]) | MIT | |
| rembg 2.0.86 | MIT | |
| transformers 4.35.0, huggingface-hub | Apache-2.0 | |
| trimesh, einops, omegaconf, imageio, FastAPI, uvicorn, python-multipart | MIT / BSD | |
| Pillow 13 | MIT-CMU (HPND) | |
| JupyterLab 4.4 | BSD-3-Clause | |
| [@google/model-viewer](https://github.com/google/model-viewer) 4.3.1 | Apache-2.0 | Licence text at `/licenses/model-viewer-LICENSE` |
| three.ws node operator client ([packages/node-operator](../../packages/node-operator)) | MIT | `@huggingface/transformers` (Apache-2.0), `onnxruntime-node` (MIT), `tweetnacl` (Unlicense) |
| Node.js 22 (NodeSource) | MIT | |

Every Python package's own licence file is inside its `*.dist-info` directory
under `/opt/venv/lib/python3.11/site-packages/`, and every npm package's under
`/opt/node-operator/node_modules/`.

## Base image

`nvidia/cuda:12.8.1-cudnn-runtime-ubuntu22.04`. The CUDA runtime and cuDNN
libraries in it are covered by the
[NVIDIA Deep Learning Container License](https://developer.download.nvidia.com/licenses/NVIDIA_Deep_Learning_Container_License.pdf)
and the CUDA EULA's redistributable components; building an application image
on it and distributing that image is the documented use. Ubuntu packages carry
their licences in `/usr/share/doc/*/copyright`.

## Sample images

The eight sample inputs in `/opt/samples` are copied from TripoSR's `examples/`
directory at the pinned commit and are covered by its MIT licence.

## What is deliberately absent

- nvdiffrast, diff-gaussian-rasterization, diffoctreerast (non-commercial).
- TRELLIS / TRELLIS.2, Hunyuan3D (Tencent community licence excludes some
  territories), Stable Fast 3D (Stability AI Community Licence revenue cap).
- gradio, moderngl and imageio-ffmpeg from TripoSR's demo requirements: not
  needed for inference, and leaving them out keeps the image smaller.

The repository test [tests/nvidia-brev-distribution.test.js](../../tests/nvidia-brev-distribution.test.js)
fails if any of the restricted packages above appears in the Dockerfile or the
requirements.
