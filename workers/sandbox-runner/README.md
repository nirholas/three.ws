# sandbox-runner

Cloud Run service that runs one untrusted program per request for the agent
sandbox (`execute_code`, `terminal`, `read_file`, `write_file`). The API side is
`api/_lib/sandbox/backends.js` (backend `cloudrun`); this is the other end of
its `POST /exec` call.

## Contract

`POST /exec` with header `x-sandbox-token: $SANDBOX_RUNNER_TOKEN`:

```json
{
  "job": { "kind": "code", "language": "python", "code": "print(1)" },
  "workspace": { "files": [{ "path": "a.csv", "data_base64": "..." }] },
  "limits": { "wallSeconds": 60, "memoryMb": 1024, "cpu": 1, "fileBytes": 10485760, "outputBytes": 65536 },
  "bridge": { "url": "https://three.ws/api/sandbox/bridge", "token": "<per-execution token>" }
}
```

`workspace` may be `{ "gcs": { "bucket", "prefix" } }` instead of inline files
(a Cloud Run request body is capped at 32 MB); the runner then pulls the prefix
with its own service account.

The response is newline-delimited JSON: `started`, then `stdout` and `stderr`
chunks while the program runs, then one `result` (exit code, signal, timings,
capped output, changed files as base64, deleted paths) or an `error`.
`GET /healthz` reports the isolation mode and returns 503 when the host cannot
isolate a program (the runner then refuses every job).

## Isolation

`api/_lib/sandbox/exec-core.js` (shared with the API's local and docker
backends, not a copy): the program gets its own network, PID and IPC namespace
as uid 65534 with no capabilities and no-new-privs, plus kernel rlimits for CPU
time, file size and address space. The only way out is the bridge socket, which
the runner forwards to `/api/sandbox/bridge` with the per-execution token; the
API applies the tool tier, the host allowlist and the refusal of fund-moving
tools. The program's environment is built clean (`programEnv`), so no runner
credentials are visible to it. Concurrency is 1: a second request while one is
running gets 429.

## Run locally

```
SANDBOX_RUNNER_TOKEN=dev PORT=8080 node workers/sandbox-runner/server.mjs
```

On a Linux host without root the runner uses an unprivileged user namespace.
Tests: `npx vitest run tests/sandbox-runner.test.js`.

## Deploy (owner gate)

```
printf '%s' "$(openssl rand -hex 32)" | gcloud secrets create sandbox-runner-token --data-file=- --project aerial-vehicle-466722-p5
gcloud builds submit --config workers/sandbox-runner/cloudbuild.yaml --region us-central1 --project aerial-vehicle-466722-p5 .
gcloud run services update three-ws-api --region us-central1 --project aerial-vehicle-466722-p5 \
  --update-env-vars SANDBOX_RUNNER_URL=<runner service url>,SANDBOX_STORE=gcs
```

`SANDBOX_RUNNER_TOKEN` must also be set on `three-ws-api` (same secret). The
`three-ws-sandbox` runtime service account needs `roles/storage.objectViewer` on
the workspace bucket, and the API's service account needs `roles/run.invoker`
on the runner.

The same image is the docker backend's program image
(`docker build -t three-ws-sandbox -f workers/sandbox-runner/Dockerfile .`).
