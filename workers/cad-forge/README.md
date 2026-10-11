# cad-forge

Builds a [build123d](https://github.com/gumyr/build123d) program into a real B-rep part on the OpenCascade kernel and returns the exported files: STEP, STL, GLB (metres, true scale, Y-up), an isometric hidden-line thumbnail and a four-view drawing sheet as SVG, plus the kernel's measurements.

It is the builder behind [CAD Forge](../../docs/cad-forge.md) (`/cad`, `POST /api/cad`, and the `cad_generate` / `cad_rebuild` MCP tools). The programs it runs are written by a language model from a stranger's prompt, so everything here is built around running hostile Python safely.

CPU only. FastAPI on Cloud Run (gen2).

## Isolation

Every build runs in its own `sandbox_child.py` process, which is used once and then discarded. Four independent layers:

| Layer | Where | What it stops |
| --- | --- | --- |
| Static policy | `cad_policy.py` | Imports outside `build123d`, `bd_warehouse`, `math`, `itertools`, `functools`; whole-module imports of the CAD libraries; any underscore attribute or name (`__class__`, `__globals__`); `eval`, `exec`, `open`, `getattr`, `type`, `str.format` and the other escape hatches. The program runs under a trimmed `__builtins__` with an import guard that enforces the same allowlist at runtime and refuses any name that resolves to a module object. |
| seccomp | `sandbox_child.install_seccomp` | After build123d is imported and before the program runs: `socket`, `connect`, `execve`, `fork`, `ptrace`, `unshare`, `mount` and friends return `EPERM`. Threads stay allowed (OpenCascade meshes in parallel). |
| Unprivileged uid | `main._spawn` | The child runs as `nobody` with a scrubbed environment, so it cannot read the parent's environment or root-owned files. |
| Resource limits | `main._limits` | Address space 3 GB, CPU time, file size, open files; a wall-clock kill at `BUILD_TIMEOUT_S`. |

On Cloud Run the service also runs as `cad-forge-sandbox@`, a service account with no IAM roles, and authenticates callers with its own `cad-forge-key` secret, which no other worker shares.

The image's build runs `test_cad_policy.py` and `test_sandbox.py` (real builds, plus real socket, exec, fork and parent-environment escape attempts) as a Docker step, so a sandbox regression fails the image instead of reaching production.

## Kernel help

* **Edge treatments.** `fillet` and `chamfer` are wrapped: a size the kernel rejects is retried at half and quarter size, then skipped, and every change is reported in `adjustments`. A cosmetic round is never worth failing a part over.
* **Standard parts.** [bd_warehouse](https://github.com/gumyr/bd_warehouse) (Apache-2.0) is installed, so programs can use involute `SpurGear`, `IsoThread`, ISO fasteners and bearings instead of modeling them by hand.
* **Crashes.** A segfault inside OpenCascade is reported as `kind: "crash"` with the program line that was running (read from `faulthandler`), so the caller's repair round knows what to rewrite.
* **Drawings last.** The part's files and measurements are written before the hidden-line drawings. A build that times out while projecting views still returns the part, flagged `drawings_skipped`.

## API

Every request except `/health` needs `Authorization: Bearer $API_KEY`.

### `POST /build`

```json
{ "code": "from build123d import *\nresult = Box(40, 20, 5)\n" }
```

Success:

```json
{
  "ok": true,
  "metrics": { "size_mm": [40, 20, 5], "min_mm": [-20, -10, -2.5], "volume_mm3": 4000, "area_mm2": 2200,
               "center_mm": [0, 0, 0], "solids": 1, "faces": 6, "edges": 12, "valid": true },
  "adjustments": [],
  "artifacts": { "step": "<base64>", "stl": "<base64>", "glb": "<base64>", "thumb_svg": "<base64>", "drawing_svg": "<base64>" },
  "timings_s": { "step": 0.012, "mesh": 0.005, "drawing": 0.012 },
  "seccomp": true,
  "log": "",
  "elapsed_s": 0.044
}
```

A program that fails is still a `200`, because the failure is the program's and the caller feeds it back to the model:

```json
{ "ok": false, "error": { "kind": "runtime", "message": "ValueError: ...", "line": 12 }, "log": "", "elapsed_s": 0.3 }
```

`kind` is one of `syntax`, `policy`, `runtime`, `result` (no solid, 2D sketch, missing `result`, too large), `timeout`, `memory`, `crash`, `export`, `sandbox`. A non-200 means the worker itself could not run the build.

The program must assign the finished solid to `result` (a lone `BuildPart` in scope is accepted). Units are millimetres.

### `GET /health`

`{ "ok": true, "warm": 2, "max_concurrent": 2, "seccomp_required": true, "build123d": "0.13.0" }`

## Configuration

| Variable | Default | Meaning |
| --- | --- | --- |
| `API_KEY` | required | Bearer secret (`cad-forge-key` in Secret Manager) |
| `MAX_CONCURRENT` | `2` | Builds allowed at once |
| `WARM_POOL` | `MAX_CONCURRENT` | Sandbox children kept parked with build123d already imported |
| `BUILD_TIMEOUT_S` | `60` | Wall-clock limit per build |
| `SANDBOX_MEMORY_MB` | `3072` | Address-space limit per build |
| `REQUIRE_SECCOMP` | `1` | Refuse to build when the seccomp filter cannot load |

## Run locally

```bash
docker build -t cad-forge workers/cad-forge     # also runs the full test gate
docker run --rm -p 8091:8080 -e API_KEY=localdev cad-forge
curl -s -X POST localhost:8091/build \
  -H 'authorization: Bearer localdev' -H 'content-type: application/json' \
  -d '{"code":"from build123d import *\nresult = Box(40, 20, 5)\n"}' | head -c 300
```

Point the API at it with `GCP_CAD_FORGE_URL=http://localhost:8091` and `CAD_FORGE_KEY=localdev`.

Tests run inside the image (`python test_cad_policy.py && python test_sandbox.py`); `test_cad_policy.py` also runs on any Python 3.11+ without build123d.

## Deploy

```bash
gcloud builds submit --config workers/cad-forge/cloudbuild.yaml \
  --region us-central1 --project aerial-vehicle-466722-p5 \
  --substitutions=SHORT_SHA=manual$(date +%s)

URL=$(gcloud run services describe cad-forge --region us-central1 --project aerial-vehicle-466722-p5 --format='value(status.url)')
gcloud run services update three-ws-api --region us-central1 --project aerial-vehicle-466722-p5 \
  --update-env-vars GCP_CAD_FORGE_URL=$URL --update-secrets CAD_FORGE_KEY=cad-forge-key:latest
```

The service account, secret and image repository already exist.
