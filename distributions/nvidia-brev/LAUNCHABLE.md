# NVIDIA Brev Launchable: exact configuration

These are the values to enter in the Brev console
(brev.nvidia.com, Launchables, Create Launchable) so that one link gives any
developer a GPU machine running the three.ws GPU quickstart: TripoSR
image-to-3D on the GPU, a guided JupyterLab notebook, a studio web page, and
an optional three.ws inference node.

The Launchable runs [setup.sh](setup.sh), the same script the
[README](README.md) uses on any clean Ubuntu GPU machine, so what was verified
on a clean GCE VM is what Brev runs.

## Prerequisite: publish the image

Brev machines pull anonymously, so the Artifact Registry repository must be
public before the Launchable works (otherwise setup.sh falls back to a 20 to
40 minute source build, which still works but is not one-click):

```bash
gcloud artifacts repositories add-iam-policy-binding three-ws-public \
  --location=us --project=aerial-vehicle-466722-p5 \
  --member=allUsers --role=roles/artifactregistry.reader
```

Image: `us-docker.pkg.dev/aerial-vehicle-466722-p5/three-ws-public/gpu-quickstart:0.1.0`
(also tagged `latest`). Rebuild with `distributions/nvidia-brev/build.sh cloud`;
bump `_VERSION` in [cloudbuild.yaml](cloudbuild.yaml) and the default in
setup.sh together (a test enforces that they match).

## Builder values

### 1. Details

| Field | Value |
|---|---|
| Name (immutable) | `three.ws GPU quickstart: image to 3D on your GPU` |
| Description | Turn any photo into a vertex-colored GLB mesh in seconds with TripoSR on an NVIDIA GPU, view it in an interactive 3D viewer inside JupyterLab, read the per-stage GPU timings, and optionally connect the machine to the three.ws open inference network. All weights are MIT or Apache-2.0 and baked into the image. |

### 2. Hardware

| Field | Value |
|---|---|
| GPU | **1x NVIDIA L4 (24 GB)**. Recommended: verified end to end, cheapest Brev GPU with headroom. |
| Also works | Any single GPU with 8 GB or more and compute capability 7.5 or newer: T4, A10G, L40S, A100, H100, H200, B200, RTX PRO 6000. Kernels for all of them are compiled into the image. |
| GPU count | 1 (the stack uses one GPU) |
| Disk Storage | **100 GiB** (the image is about 15 GB compressed; the rest is room for outputs and Docker) |
| Location | Any; nearest to the user |

### 3. Software

| Field | Value |
|---|---|
| Mode | **VM Mode** |
| Setup script | paste the full contents of [setup.sh](setup.sh) |
| Jupyter on the host | **Off** (the container serves its own JupyterLab with the notebook preloaded) |

### 4. Source

| Field | Value |
|---|---|
| Code files | "I don't have any code files" (the notebook ships inside the image) |
| Notebook path in the running container | `/workspace/notebooks/three-ws-gpu-quickstart.ipynb` (JupyterLab opens it by default) |

### 5. Network: Secure Links

| Name | Port | Purpose |
|---|---|---|
| jupyter | 8888 | JupyterLab with the quickstart notebook. Naming it `jupyter` gives the Launchable its Open Notebook button. |
| studio | 8000 | The studio page: pick a sample or upload a photo, rotate the mesh, download the GLB. |

No TCP/UDP ports. Both services bind to `127.0.0.1` on the VM and are only
reachable through Brev's authenticated secure links or an SSH tunnel.

### 6. Launch parameters (optional, passed to setup.sh as environment variables)

| Name | Type | Default | Meaning |
|---|---|---|---|
| `JUPYTER_TOKEN` | Text | empty | Extra token on JupyterLab. Brev's secure link already requires the user's Brev login, so empty is safe. |
| `THREE_WS_CONNECT_NODE` | Choice: `0`, `1` | `0` | `1` registers the three.ws inference node at boot and serves embedding jobs on the GPU. |
| `NODE_LABEL` | Text | the hostname | Label the node registers with. |

### 7. View access

Public (anyone with the link).

## Single Container alternative

If a container-mode Launchable is preferred over VM Mode, use:

| Field | Value |
|---|---|
| Mode | Single Container |
| Image | `us-docker.pkg.dev/aerial-vehicle-466722-p5/three-ws-public/gpu-quickstart:0.1.0` |
| Entrypoint | image default (`tini -- /opt/three-ws/start.sh`) |
| Secure Links | the same two rows as above |
| Disk, GPU | the same as above |

VM Mode is the primary choice because setup.sh verifies the driver and the
container toolkit, writes `~/three-ws-quickstart/timings.tsv`, and the same
script is what was verified on a clean VM.

## After the Launchable exists

Brev returns a link of the form
`https://brev.nvidia.com/launchable/deploy?launchableID=<id>` and a Markdown
badge. Put the link in [README.md](README.md) (the "One click" section) and in
[docs/nvidia-brev-launchable.md](../../docs/nvidia-brev-launchable.md), then add
the changelog entry.
