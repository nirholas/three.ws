# Agent sandbox

Agents can run code, run terminal commands and edit files in a per-run workspace. The work happens in an isolated sandbox, never in the API process.

## What an agent can do

Four tools, available on `/api/mcp-agent` and to in-app agents: `execute_code` (python, javascript, bash), `terminal`, `read_file` and `write_file`. A workspace is persistent for the life of a run: files one program writes are there for the next one.

## Isolation

- The program runs in fresh user, mount, PID and network namespaces as an unprivileged user, with CPU, memory, process, file-size and wall-clock limits from the account plan (`api/_lib/sandbox/limits.js`).
- It has no network. Its only way out is the bridge, a unix socket that lets it call platform tools its agent already owns and reach hosts on the owner's allowlist.
- The bridge token is minted per execution, expires with the wall-clock limit and is refused once the execution finishes or the run is stopped.

## Backends

| Backend | Where it runs | Notes |
| --- | --- | --- |
| `cloudrun` | [workers/sandbox-runner](../workers/sandbox-runner) | Production. The API POSTs the job to the runner's `/exec` and reads NDJSON events back. The runner forwards bridge calls to `POST /api/sandbox/bridge`. |
| `docker` | A local container from the same image | Self-hosters. Enabled with `SANDBOX_DOCKER=1`. |
| `local` | A subprocess of the API | Development only (`SANDBOX_LOCAL=1`). Refused in production. |

Configuration variables are listed at the top of `api/_lib/sandbox/config.js`.

## Owner controls

`/settings/sandbox` lists every workspace with each program's source, output, exit code, duration and cost, offers file downloads, stops a workspace, shows plan limits and edits the host allowlist (`example.com` or `*.example.com`).

## Run replay

On an agent's Runs tab, each sandbox step shows inline what ran: the program (or terminal command), stdout and stderr, exit status, duration, cost and download links for the files it wrote. Output is escaped as untrusted text and file links are accepted only when they point at `/api/sandbox/file`. Source: [src/shared/sandbox-step-view.js](../src/shared/sandbox-step-view.js).

## API (session auth, CSRF on mutations)

| Route | Purpose |
| --- | --- |
| `GET /api/sandbox/overview` | Plan, limits, backend status, settings, recent runs |
| `GET /api/sandbox/run?run=ID` | One run: programs (newest first) and workspace files |
| `POST /api/sandbox/run?run=ID` | `{ "action": "kill", "reason": "..." }` |
| `GET /api/sandbox/file?run=ID&path=P` | Download a file. Always an attachment, `nosniff`, sandboxed CSP |
| `PATCH /api/sandbox/settings` | `{ "allow_hosts": [...], "default_backend": "cloudrun" }` |
| `POST /api/sandbox/bridge` | Runner only. Bearer is the per-execution token |

A run that belongs to another account answers 404.

Tests: `tests/sandbox-*.test.js` (including `sandbox-step-view`), `tests/api/sandbox-owner-routes.test.js`.
