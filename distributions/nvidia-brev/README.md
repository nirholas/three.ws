# three.ws GPU quickstart (NVIDIA Brev Launchable)

Turn a photo into a 3D mesh on your own NVIDIA GPU in seconds, look at it in an
interactive viewer, see where every millisecond of GPU time goes, and
optionally connect the machine to the three.ws open inference network.

What runs, all in one container on one GPU:

| Piece | Port | What it is |
|---|---|---|
| Studio | 8000 | A web page: pick a sample or upload a photo, rotate the mesh, download the GLB |
| JupyterLab | 8888 | The guided notebook `three-ws-gpu-quickstart.ipynb`, opened by default |
| TripoSR engine | (inside the studio) | Image to triplane to mesh on CUDA, background removal with U2-Net on ONNX Runtime CUDA |
| three.ws inference node | (outbound only) | Proof workload on the GPU; registers and serves jobs only if you turn it on |

Every weight is baked into the image and pinned, and every one is MIT or
Apache-2.0: see [LICENSES.md](LICENSES.md). Nothing is downloaded at runtime.

## One click on NVIDIA Brev

Open the Launchable, pick a GPU (L4 recommended), and deploy. When the
instance is ready, click **Open Notebook** (or the `studio` secure link). The
exact Launchable configuration is in [LAUNCHABLE.md](LAUNCHABLE.md).

## Any clean Ubuntu machine with an NVIDIA GPU

Requirements:

- Ubuntu 22.04 or 24.04, x86_64
- one NVIDIA GPU with 8 GB or more and compute capability 7.5 or newer
  (T4, A10G, L4, L40S, A100, H100, H200, B200, RTX 30/40/50 series, RTX PRO)
- the NVIDIA driver, version 525 or newer (`nvidia-smi` works). GPU cloud
  images ship it; on a bare machine install it with
  `sudo ubuntu-drivers install --gpgpu` and reboot
- about 40 GB of free disk and outbound HTTPS

Run:

```bash
curl -fsSL https://raw.githubusercontent.com/nirholas/three.ws/main/distributions/nvidia-brev/setup.sh | bash
```

or, from a checkout of this repository:

```bash
bash distributions/nvidia-brev/setup.sh
```

The script installs Docker and the NVIDIA Container Toolkit if they are
missing (it never touches the driver), pulls the image, checks that a container
can see the GPU, starts the stack, and waits until the model is on the GPU. It
prints each step's duration and ends with:

```
three.ws GPU quickstart is running on NVIDIA L4, 23034 MiB.

  Notebook   http://localhost:8888   (on Brev: the "jupyter" secure link)
  Studio     http://localhost:8000   (on Brev: the "studio" secure link)
```

Both ports listen on `127.0.0.1` only. From your laptop:

```bash
ssh -L 8888:localhost:8888 -L 8000:localhost:8000 <user>@<gpu-machine>
```

then open http://localhost:8888 for the notebook and http://localhost:8000 for
the studio.

### Settings

All optional, set as environment variables before `setup.sh` (on Brev they are
launch parameters):

| Variable | Default | Meaning |
|---|---|---|
| `JUPYTER_TOKEN` | empty | Token for JupyterLab. Set one if you change `THREE_WS_BIND` |
| `THREE_WS_BIND` | `127.0.0.1` | Host address for ports 8000 and 8888. `0.0.0.0` exposes them on the network |
| `THREE_WS_CONNECT_NODE` | `0` | `1` registers the three.ws inference node and serves jobs on the GPU |
| `NODE_LABEL` | hostname | Label the node registers with |
| `THREE_WS_IMAGE` | the published 0.1.0 image | Run a different tag |
| `THREE_WS_BUILD` | `0` | `1` builds the image from this repository instead of pulling it (20 to 40 minutes) |
| `THREE_WS_HEALTH_TIMEOUT_S` | `900` | How long to wait for the model to load |

Example: `THREE_WS_CONNECT_NODE=1 NODE_LABEL=my-l4 bash setup.sh`.

## The notebook

`/workspace/notebooks/three-ws-gpu-quickstart.ipynb` walks through:

1. which GPU you have and how long the model took to load onto it
2. generating a mesh from a bundled sample (or your own image path)
3. an interactive 3D viewer of the result, inside the notebook
4. a per-stage timing table (background removal, TripoSR forward pass, GPU
   marching cubes, GLB export) and a 5-run warm benchmark with median, min and
   max
5. the three.ws inference node's GPU self-test, and connecting the node if you
   want to

Your copy of the notebook and everything you generate live in the Docker volume
`three-ws-workspace`, so they survive restarts and upgrades.

## Health checks

| Check | Healthy when |
|---|---|
| `curl http://127.0.0.1:8000/health` | HTTP 200 with the GPU name and `startup_to_ready_s`. HTTP 503 with `status: loading` while the model loads, `status: failed` and the error if it could not |
| `docker inspect --format '{{.State.Health.Status}}' three-ws-gpu` | `healthy`: both the studio (`/health`) and JupyterLab (`/api`) answer |
| `curl http://127.0.0.1:8000/api/system` | GPU, driver, CUDA, torch versions, memory in use and model load timings |

## Operating it

| Task | Command |
|---|---|
| Logs | `docker logs -f three-ws-gpu` |
| Stop / start | `docker stop three-ws-gpu` / `docker start three-ws-gpu` |
| Upgrade | rerun `setup.sh` (keeps the volume) |
| Remove everything | `docker rm -f three-ws-gpu && docker volume rm three-ws-workspace` |
| Setup timings | `~/three-ws-quickstart/timings.tsv`, full log in `~/three-ws-quickstart/setup.log` |

The container restarts itself after a reboot (`--restart unless-stopped`).

## Troubleshooting

| Symptom | Fix |
|---|---|
| `no working NVIDIA driver` | Install the driver (see Requirements), reboot, rerun |
| `the container cannot see the GPU` | `sudo nvidia-ctk runtime configure --runtime=docker && sudo systemctl restart docker`, rerun |
| The container exits with code 78 | It was started without `--gpus all`; use setup.sh |
| `pull failed; building from source instead` | The registry was unreachable; the source build is the same image, it just takes longer |
| `no foreground subject` from a generate call | The background remover found nothing to keep: use a photo with one clear object |
| Out of GPU memory on an 8 GB card | Lower the mesh resolution to 192 in the studio or `resolution=192` in the notebook |

## Building the image

```bash
distributions/nvidia-brev/build.sh local   # docker build here (needs about 40 GB free)
distributions/nvidia-brev/build.sh cloud   # Cloud Build, pushes to Artifact Registry
```

The build compiles torchmcubes' CUDA kernel for compute capability 7.5 through
12.0, downloads the pinned weights, caches the node's fp32 embedding model, and
runs the unit tests in `image/tests/` (a failure stops the image from
shipping). The repository-level checks are in
[tests/nvidia-brev-distribution.test.js](../../tests/nvidia-brev-distribution.test.js).

## Layout

| Path | Purpose |
|---|---|
| `setup.sh` | Host installer, and the Brev VM Mode setup script |
| `Dockerfile`, `build.sh`, `cloudbuild.yaml` | Image build |
| `image/studio/` | FastAPI server, TripoSR engine, studio page |
| `image/three_ws_brev.py` | Notebook helpers (talk to the studio server, render the viewer) |
| `image/notebooks/` | The quickstart notebook |
| `image/start.sh`, `image/healthcheck.py` | Container entrypoint and health check |
| `image/download_weights.py` | Build-time weight fetch, pinned and size-checked |
| `LAUNCHABLE.md` | Exact Brev Launchable values |
| `LICENSES.md` | Licence review of everything in the image |

More: [docs/nvidia-brev-launchable.md](../../docs/nvidia-brev-launchable.md) and
the [inference node operator guide](../../docs/inference-node-operator.md).

three.ws is a member of the NVIDIA Inception program.
