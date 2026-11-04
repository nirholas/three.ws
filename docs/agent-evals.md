# Agent evals, run replay and trajectory export

Score an agent configuration against a fixed task suite, replay a finished run, and export its trajectory. The same core backs the terminal, the REST API and the Evaluate tab on an agent's page.

## Surfaces

| Surface | Entry |
| --- | --- |
| Evaluate tab | Owner-only tab on `/agent/<id>`, mounted by [src/agent-evals-tab.js](../src/agent-evals-tab.js) |
| REST | `/api/v1/agents/:id/evals`, `/api/v1/agents/:id/runs/:run/replay`, `/api/v1/agents/:id/runs/:run/trajectory` ([api/_lib/evals/routes.js](../api/_lib/evals/routes.js)) |
| CLI | `three-ws evals list|run|show`, `three-ws runs export|replay` ([packages/three-ws-cli/src/commands/evals.js](../packages/three-ws-cli/src/commands/evals.js)) |
| Local runner | `npm run evals -- --list`, `npm run evals:gate` ([scripts/evals.mjs](../scripts/evals.mjs)) |

## Running an eval

`POST /api/v1/agents/:id/evals` with `{ "suite": "smoke", "model": "<optional>" }`. Send `Accept: text/event-stream` to receive `start`, `task`, `done` and `error` events as each task finishes; otherwise the response is one JSON envelope. The run executes inside the request. There is no background work, because Cloud Run throttles CPU after the response.

Guard rails:

- Only credit-safe lanes run through the API (free models and Vertex Gemini). Anything else is rejected before a token is spent.
- A run stops at a cost cap of `$0.25` and reports `truncated: { reason: "cost_cap", skipped: [...] }`.
- Sandbox tools return their declared preview and never execute.

Every run is stored in `agent_evals` (migration `20261105071500_agent_evals.sql`) with the full `three-ws/eval-report@1` report, so the history and score trend survive the session.

## Replay

`GET /runs/:run/replay` returns a deterministic, signed replay of the recorded tool calls, with the receipt chain verified. `POST` with `{ "model": "..." }` re-runs the same goal in preview mode against that model (read-only tools only) and reports whether the tool sequence matches the recording.

## Trajectory export

`GET /runs/:run/trajectory` streams NDJSON: one `run` header, then one `step` line per step. Secrets and wallet material are redacted before export.

## Gate

`npm run evals:gate` runs the smoke suite on a free lane and fails on a regression against the stored baseline. With no usable lane or key it skips cleanly, and an all-errored run is treated as a skip.

Tests: [tests/agent-evals-runner.test.js](../tests/agent-evals-runner.test.js), [packages/three-ws-cli/tests/evals.test.js](../packages/three-ws-cli/tests/evals.test.js).
