# Evolve: three.ws keeps improving while nobody is prompting

`scripts/evolve.mjs` is a long-running loop on the workspace machine that drives headless Claude Code (`claude -p`) through the work queue, refills that queue, and sweeps production, around the clock. It bills to whichever Claude subscription the machine is signed in to (`claude auth status`), so a Max plan that would otherwise sit idle does the work. Nothing it produces leaves the machine on its own: pushing and deploying stay one owner command.

Not to be confused with Autopilot, the product feature that trades for an agent (`api/autopilot/`, `packages/autopilot-mcp`). Evolve is internal tooling for developing the repository and ships nothing to users.

```bash
npm run evolve:start     # start the loop in the background
npm run evolve           # status: what ran, what landed, what is next, deploy gap
npm run evolve:pause     # let the current session finish, start no new one
npm run evolve:resume
npm run evolve:stop      # stop now, including the running session
npm run evolve:once -- --lane scout --dry-run   # print what one cycle would do
npm run evolve:land      # fast-forward finished work into main by hand
```

## What a cycle does

Each cycle picks one lane, runs one Claude Code session to completion, then rests `EVOLVE_COOLDOWN_MIN` minutes.

| Lane | When it runs | What the session is told to do |
|---|---|---|
| `triage` | Production has not been swept for `EVOLVE_TRIAGE_EVERY_HOURS` (default 8) | Run the `gcp-triage` deep sweep, fix every code-side defect at the root with a test, record owner-only remainders. |
| `scout` | The queue is empty, or thin (under `EVOLVE_QUEUE_FLOOR`, default 3) and the last scout is 6h old, or the last scout is `EVOLVE_SCOUT_EVERY_HOURS` (default 24) old | Measure the live platform (healthz, logs, tests, docs audit, live-page sweep), view it through one master from [prompts/masters/](../../prompts/masters/README.md) (rotating frontier, adversary, designer, operator, integrator), and write the top one to three findings as work orders numbered `400` to `499`. It does not build them. |
| `queue` | Otherwise | Run the lowest-numbered runnable order in [prompts/finish/](../../prompts/finish/) to 100% and retire it, exactly as [prompts/README.md](../../prompts/README.md) describes. |

An order is runnable when it is numbered below `900` (that band is owner-blocked by convention), has not used its `EVOLVE_MAX_ATTEMPTS` (default 2) tries, and has not been committed or edited in the owner's tree within the last 6 hours, which is how evolve avoids racing a session someone is running by hand. An order that runs out of attempts is listed as parked in `npm run evolve`.

## Where the work happens and how it lands

Sessions run in a dedicated worktree, `../.evolve-wt`, on the branch `evolve`, staged once by `npm run prep:worktree` (hardlinked `node_modules`, copied `.env` and `.env.local`) and restaged automatically when `package-lock.json` changes on main. Before every cycle the branch is reset or rebased onto local `main`.

When a session commits, the runner fast-forwards local `main` to the branch from the owner's tree, but only if none of the incoming files has uncommitted changes there; otherwise the commits wait and `npm run evolve` says why. Set `EVOLVE_AUTOLAND=0` to land only by hand.

Anything a session leaves uncommitted is kept as a named stash (`evolve held: ...`), never discarded. That is also how the coin commit gate works unattended: a diff that references a crypto project other than $THREE is left uncommitted on purpose, so it waits in `git stash list` for the owner's yes.

## The guard rails

An unattended session cannot get an owner's yes, so every CLAUDE.md stop-and-ask gate becomes "skip it and record it":

1. **The session is told.** An appended system prompt says no human is watching, forbids every gated action, and routes each one into a dated row in `prompts/finish/_context/production-100-OWNER-ACTIONS.md`.
2. **The tools refuse.** `DENY_RULES` in the script holds even in bypass-permissions mode: `git push`, Cloud Build submits, `gcloud run deploy`, `--set-env-vars`, every `deploy:*` script, `release:lib`, `db:migrate`, `db:restamp`, `changelog:push*`, Solana and SPL transfers, and every money-moving skill.
3. **git refuses.** The session's environment rewrites every push URL to a scheme with no remote helper, so a push fails at the git layer even if a command slipped past the rule.

New migrations are written and tested but not applied; the deploy runbook's `db:check` gate applies them when the owner ships. Config-only `gcloud run services update --update-env-vars` changes stay pre-approved, as CLAUDE.md says.

## Shipping what it built

```bash
npm run evolve           # read what landed and what is held
git push threews main       # owner gate 2
npm run deploy:gcp:full     # the CLAUDE.md deploy runbook
```

To let evolve push `main` itself after each landing, start it with `EVOLVE_PUSH=1`. That is a standing owner approval for gate 2's push half; deploys remain gated either way.

## Surviving restarts

The container has no cron or systemd, so the loop is restarted by a guarded line in `~/.bashrc` that runs `node scripts/evolve.mjs ensure` in the background. `ensure` starts the loop unless it is already running or paused, so opening any terminal or editor session after a restart brings it back. `pause` survives restarts; `stop` does not, so use `pause` to keep it off.

## Files

All runtime state lives under the git common dir, never in the tree: `.git/evolve/state.json` (lane clock, attempts, current session), `runs.jsonl` (one record per session: lane, target, outcome line, minutes, commits, landed, held stash, session id), `logs/<time>-<lane>.jsonl` (the full stream-json transcript), and `daemon.log`. Each session is also a normal Claude Code session named `evolve <lane> <target>`, so `claude --resume <session>` opens it.

## Usage limits

When the subscription hits its usage window the session ends with a limit error; the runner records `limited`, does not count it as an attempt, and backs off `EVOLVE_LIMIT_BACKOFF_MIN` (default 20) minutes before trying again. Interactive use shares the same plan, so `npm run evolve:pause` before a long hands-on session keeps the window for you.

## Configuration

| Variable | Default | Meaning |
|---|---|---|
| `EVOLVE_MODEL` | `sonnet` | Model alias passed to `claude --model` |
| `EVOLVE_EFFORT` | unset | Passed to `--effort` when set |
| `EVOLVE_COOLDOWN_MIN` | `5` | Rest between sessions |
| `EVOLVE_RUN_TIMEOUT_MIN` | `240` | A session running longer is stopped |
| `EVOLVE_TRIAGE_EVERY_HOURS` | `8` | Production sweep cadence |
| `EVOLVE_SCOUT_EVERY_HOURS` | `24` | Queue-refill cadence |
| `EVOLVE_QUEUE_FLOOR` | `3` | Below this many runnable orders, scout sooner |
| `EVOLVE_MAX_ATTEMPTS` | `2` | Tries per order before it is parked |
| `EVOLVE_AUTOLAND` | `1` | `0` to land only with `npm run evolve:land` |
| `EVOLVE_PUSH` | `0` | `1` to push `main` after each landing |
| `EVOLVE_WORKTREE` | `../.evolve-wt` | Session worktree |

Set them in the environment that runs `npm run evolve:start`.
