# 25. Sandboxed code execution and scripted tool pipelines for agents

Read `docs/prompts/README.md` first.

## The problem

Runs are tool loops over a read-only registry (`api/agent/run.js`). An agent cannot write and execute a script, transform data, run a backtest, or collapse a twenty-step tool pipeline into one program call. The best agents give the model a sandboxed terminal and an RPC bridge so a script can call tools without spending context on every step.

## Build

- **Execution backends** behind one interface in `api/_lib/sandbox/`: `local` (the local runtime from prompt 20, subprocess with resource limits), `cloudrun` (a Cloud Run job per execution with gVisor, a per-run workspace in GCS mounted read-write, no network except the platform API and an allowlist), `docker` for self-hosters, and `ssh` for a user's own machine. GCP is pre-approved; do not add a third-party sandbox vendor.
- **Tools:** `execute_code` (language, code, timeout, files in and out), `terminal` (persistent session per run), `read_file`, `write_file`. Files persist per run in GCS and are downloadable from the run page.
- **RPC bridge:** inside the sandbox, `three_ws.tool("swap_quote", {...})` calls any tool the run is allowed to use, through a local socket to the runtime, honoring the prompt 03 tiers and confirm rules (financial tools from a script still require a preview and the user's confirm outside the script). A Python and a JavaScript client are pre-installed.
- **Limits:** CPU, memory, wall time and output size per plan; every execution metered in credits; the anomaly guard can kill a run.
- **UI:** the run page shows executions with stdout, stderr, files and cost; `/settings/sandbox` picks the default backend. Every state designed.
- Docs: `docs/agent-sandbox.md` linked from `docs/agent-runtime.md`; changelog entry tagged `feature`.

## Acceptance

- A run asked to "fetch the last 30 days of SOL prices and compute the 7 and 30 day moving averages" writes and executes a script through the Cloud Run backend and returns a chart file.
- A script that calls a financial tool without a preview is refused by the bridge.
- `npm test` green with backend interface and limit tests.
