# 35. Always-on hosted agents: the 24/7 strategy loop with heartbeat, budgets and recovery

Read `docs/prompts/README.md` first.

## The problem

Prompt 05 gives agents `start` and `stop`, and automations fire on triggers. A "running" agent should also run its strategy continuously: observe the market, reason on a cadence, act within limits, and keep going through deploys and crashes. Competitors sell exactly this, "agents that run 24/7", and it is what the strategy presets promise.

## Build

- **Loop:** a `strategy-loop` worker (Cloud Run, its own `cloudbuild.yaml`, README) that leases running agents from `agent_leases` (heartbeat, lease expiry, worker id), executes one strategy tick per agent per interval (from the preset; default a few minutes), each tick a bounded run from prompt 05 with the preset's goal, the memory from prompt 21 and the tool tiers the user enabled. Ticks are idempotent and resume after a worker restart; a stuck lease is reclaimed.
- **Budgets:** per-agent daily credit and USDC caps for the loop, separate from manual chat; the loop pauses the agent with a notification when a cap is hit and never fails silently.
- **Observability:** `three://agents/{id}/loop` resource and `GET /agents/:id/loop` with last tick, next tick, ticks today, spend, errors; the agent page shows a live status pill and the tick timeline; alerts on repeated errors through the notification channels.
- **Safety:** every financial action inside a tick goes through previews and the guards; the anomaly freeze stops the loop; `stop` takes effect before the next tick.
- Docs: `docs/agent-runtime.md` gains "The strategy loop"; changelog entry tagged `feature`.

## Acceptance

- Start a QA agent on the conservative preset; ticks appear on schedule with their steps and cost; kill the worker mid-tick and see the lease reclaimed and the tick resumed.
- Hitting the daily cap pauses the agent with a notification.
- `npm test` green.
