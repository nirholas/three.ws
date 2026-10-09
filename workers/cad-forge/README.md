# cad-forge

Sandboxed worker that turns a build123d program into a real B-rep part (STEP, STL, GLB, optional SVG thumbnail and drawing).

## API

- `POST /build` with `{ "code": "<build123d program>" }`. Returns `200 { ok, metrics, artifacts, log, elapsed_s }`. A program that fails is still a 200 with `ok: false` and an `error` object so the caller can feed it back to the model for a repair round. Artifacts are base64.
- `GET /health` returns `{ ok, warm, max_concurrent, seccomp_required, build123d }`.

Every request needs the `API_KEY` bearer secret. Each build runs in its own `sandbox_child.py` process: unprivileged uid, scrubbed environment, resource limits and seccomp. The worker holds no cloud credentials; the API uploads the returned artifacts.

## Configuration

| Variable | Default | Meaning |
| --- | --- | --- |
| `API_KEY` | required | shared bearer secret |
| `MAX_CONCURRENT` | 2 | builds allowed at once |
| `WARM_POOL` | `MAX_CONCURRENT` | parked children kept ready |
| `BUILD_TIMEOUT_S` | 60 | wall-clock limit per build |
| `REQUIRE_SECCOMP` | 1 | refuse to build when seccomp cannot load |

## Run

```bash
docker build -t cad-forge workers/cad-forge
docker run --rm -p 8080:8080 -e API_KEY=secret cad-forge
curl -s -X POST localhost:8080/build -H 'authorization: Bearer secret' \
  -H 'content-type: application/json' -d '{"code":"result = Box(10, 10, 10)"}'
```

Tests: `python -m pytest workers/cad-forge`. The caller lives in `api/_lib/cad/`.
