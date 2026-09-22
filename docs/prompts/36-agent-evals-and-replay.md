# 36. Agent evals and run replay: measure agents before and after every change

Read `docs/prompts/README.md` first.

## The problem

We ship prompt, model and tool changes with no way to know whether agents got better or worse. Runs are logged, but there is no harness that replays a fixed set of tasks against an agent configuration, scores the outcome, and compares versions. The strongest agent projects treat evals and trajectory data as core infrastructure.

## Build

- **Task suites:** `evals/` at the repo root with suites as JSON: task prompt, allowed tools, expected outcome checks (tool called with arguments, final answer contains, cost below, steps below), and a sandbox fixture for tools with side effects (previews only, never executions).
- **Runner:** `npm run evals -- --suite <name> --agent <id or preset> --model <id>` executes each task as a prompt 05 run against production or a local runtime, scores, and writes a report to `evals/reports/` with per-task traces; a comparison mode diffs two reports.
- **Replay:** `POST /runs/:id/replay` re-executes a recorded run's prompts against a different model or skill set with tools in preview-only mode, so a change can be tested on real history.
- **Trajectory export:** `three-ws runs export --format jsonl` for training and analysis, with secrets and memories redacted.
- **Product:** an "Evaluate" tab on the agent page that runs a suite and shows the score history per configuration version. Every state designed.
- Wire a smoke suite into `npm run gate` so a regression in the default preset fails the gate.
- Docs: `docs/agent-evals.md` linked from `docs/agent-runtime.md`; changelog entry tagged `improvement`.

## Acceptance

- The smoke suite scores the default preset on two models and the report shows the difference.
- Replaying a real run in preview-only mode produces no transaction.
- `npm test` green.
