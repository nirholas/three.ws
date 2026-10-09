# autopilot

An unattended production repair loop for three.ws. Every two hours it syncs
`main`, sweeps production with the GCP triage, and, when the sweep finds
something it is allowed to fix, starts a headless Claude Code session to fix and
commit it. The runner (not Claude) then gates the commits on `npm test`, pushes
to `threews main`, deploys, verifies the deploy, and rolls traffic back if the
verification fails. Every tick leaves a full record in Cloud Storage and, when
something happened, a short Telegram report to the owner.

It is designed to run as the `autopilot` user on a dedicated Compute Engine VM,
`three-ws-autopilot`, in project `aerial-vehicle-466722-p5`.

Not to be confused with evolve (`scripts/evolve.mjs`, [docs/ops/evolve.md](../../docs/ops/evolve.md)),
the development loop that works the `prompts/finish/` queue on a developer
machine and is denied every owner-gated action. This loop is the opposite
shape: it only reacts to production findings, and the owner has approved it to
ship its own fixes.

## Status

**Written, not provisioned.** Checked on 2026-10-09:

- There is no Compute Engine instance with `autopilot` in its name in the project.
- The report bucket `gs://three-ws-autopilot` does not exist.
- The push credential secret `autopilot-github-token` does not exist.
- `three-ws-api` carries no `TELEGRAM_ALERTS_CHAT_ID`, so notifications would
  fall back to `message.txt` unless the VM metadata attribute below is set. The
  `telegram-bot-token` secret does exist.

Three files the scripts refer to are not in the repository and never were (no
commit in any branch has touched them):

- `provision.sh`, which `bootstrap.sh` says installs it as the VM's
  `startup-script` metadata. The VM, the bucket, the secret and the service
  account bindings are therefore created by hand today; [Provisioning](#provisioning)
  lists what that takes.
- `autopilot.service` and `autopilot.timer`, which `bootstrap.sh` installs from
  this directory into `/etc/systemd/system/`. As committed, `bootstrap.sh` stops
  at that `install` step (`set -e`). The units have to exist before the loop can
  run on its timer; [The systemd units](#the-systemd-units) states what they
  must do.

## Files

| File | Role |
|---|---|
| [run.sh](run.sh) | One tick, end to end. The whole body lives in `main()` so bash parses it before running it, because the tick resets this very file to the newest `main`. |
| [bootstrap.sh](bootstrap.sh) | VM startup script, run as root on every boot. Idempotent. |
| [prompt.md](prompt.md) | The instructions the Claude session runs under: inputs, method, hard limits, and the required `result.json`. |
| [claude-settings.json](claude-settings.json) | Copied to `~/.claude/settings.json` for the `autopilot` user before each session: a deny list for every ship, spend and destroy command, and the auto-updater and telemetry switched off. |
| [notify.mjs](notify.mjs) | Composes and sends the Telegram report for one tick. |

## What a tick does

`run.sh`, in order. Every step writes its outcome into the tick's `status.json`.

1. **Lock.** `flock` on `$AUTOPILOT_HOME/.autopilot.lock`. If the previous tick
   is still running, this one logs `previous tick still running, skipping` and
   exits 0.
2. **Sync.** In `$AUTOPILOT_HOME/three.ws`: `git fetch threews main`, then a
   forced checkout of `main` at `threews/main` and `git clean -fdq`. The clone is
   the runner's own; nobody edits it.
3. **Install.** `npm ci` (plus the Playwright Chromium) only when
   `package-lock.json` changed since the last tick, otherwise just `postinstall`.
   Always `deps:chat`. Rebuilds the avatar studio when `character-studio/`
   changed or its build is missing.
4. **Env.** Writes `.env.local` holding only `DATABASE_URL`, read fresh from the
   live `three-ws-api` service with `scripts/read-service-env.mjs` so a rotated
   credential never goes stale, and truncates `.env`.
5. **Triage.** `npm run triage:gcp -- --json --deep --since 3h` into
   `triage.json`. Each finding carries a class (see
   [docs/ops/production-log-triage.md](../../docs/ops/production-log-triage.md)).
6. **Decide.** Only `env-action` and `investigate` findings wake Claude. `owner`
   and `self-healing` findings never do. A signature Claude deferred in an
   earlier tick is skipped for `AUTOPILOT_DEFER_HOURS`. With nothing actionable
   the tick ends here.
7. **Claude.** `claude -p` with [prompt.md](prompt.md) (with `AUTOPILOT_RUN_DIR`
   and `AUTOPILOT_HISTORY` substituted), the configured model on Vertex AI
   (`CLAUDE_CODE_USE_VERTEX=1`, billed to the project), `--permission-mode
   bypassPermissions`, the deny list from `claude-settings.json`, and a hard
   timeout. The session reads the last eight tick summaries first, fixes and
   commits, and must write `result.json`. Anything it leaves uncommitted is saved
   as `uncommitted.patch` and discarded, never shipped.
8. **Gate.** No new commits and `result.json` not asking for a deploy: done.
   With commits, `npm test` must pass. On a red, the commits are pushed to a
   review branch `autopilot/<timestamp>` instead of `main`, and nothing deploys.
9. **Push.** To `threews main`. If `main` moved meanwhile, it rebases once and
   retries; a rebase conflict pushes `autopilot/<timestamp>` for review instead.
   The repository's pre-push hook (`check:rules` and the secrets scan) still
   runs on this push.
10. **Deploy.** The steps of `npm run deploy:gcp:full`, split so traffic can be
    moved explicitly: `clean:worktrees -- --apply`, `build:gcp`, `check:dist`,
    `check:pages`, `deploy:gcp:submit` (which includes the pending-migration
    gate), `update-traffic --to-latest` (a previous rollback pins traffic, and a
    plain deploy would then not receive any), `deploy:gcp:sync-crons`,
    `deploy:gcp:purge-cdn`.
11. **Verify, or roll back.** The deploy counts as live only when `smoke:prod`
    passes, `/api/version` reports the commit just pushed, and `/api/healthz` did
    not go from `200` to anything else. Otherwise traffic goes back to the
    revision that was serving before, the CDN is purged again, and the tick
    records `rollback`. The next tick's history shows the rollback, and the
    prompt tells Claude to fix or revert the offending commit before anything
    else.
12. **Report.** `notify.mjs`, then the whole run directory is copied to
    `gs://three-ws-autopilot/runs/<timestamp>/`. Local run directories older than
    14 days are deleted.

### What Claude may and may not do

The prompt's hard limits override everything else in it: no money movement of
any kind (wallet and treasury findings are owner items), no destroying data, no
`db:migrate` (pending migrations are reported with the `db:status` output), no
secret values anywhere, no commit referencing a crypto project other than
$THREE, config changes only through `gcloud run services update
--update-env-vars`, and one small commit per problem in the house commit style.

`claude-settings.json` enforces the ship and destroy half mechanically: `git
push`, every `npm run deploy*`, `db:migrate`, `db:restamp`, `changelog:push`,
`gcloud builds submit`, any `gcloud ... delete`, `run services replace`,
`--set-env-vars` and `--clear-env-vars`, creating or changing secrets, and
`gcloud projects` / `gcloud iam` are all denied. Pushing and deploying happen in
`run.sh` only, after Claude has exited.

The push credential never reaches Claude or the disk: `run.sh` reads
`autopilot-github-token` from Secret Manager at push time and passes it to git
as an HTTP header on the command line of that one process.

## Configuration

Environment variables read by `run.sh` (and `AUTOPILOT_PROJECT` /
`AUTOPILOT_HOME` by `notify.mjs`):

| Variable | Default | Meaning |
|---|---|---|
| `AUTOPILOT_PROJECT` | `aerial-vehicle-466722-p5` | GCP project for Cloud Run, Secret Manager and Vertex AI. |
| `AUTOPILOT_REGION` | `us-central1` | Cloud Run region of `three-ws-api`. |
| `AUTOPILOT_HOME` | `$HOME` | Base directory. The clone is `$AUTOPILOT_HOME/three.ws`; tick records live in `$AUTOPILOT_HOME/runs/`. |
| `AUTOPILOT_BUCKET` | `gs://three-ws-autopilot` | Where every run directory is uploaded. |
| `AUTOPILOT_MODEL` | `claude-opus-5` | Model id passed to `claude --model`. |
| `AUTOPILOT_CLAUDE_TIMEOUT` | `100m` | Hard limit on the Claude session (`timeout`, killed 2 minutes after). |
| `AUTOPILOT_DEFER_HOURS` | `24` | How long a signature Claude deferred stays quiet. |
| `AUTOPILOT_GH_SECRET` | `autopilot-github-token` | Secret Manager secret holding the GitHub token used to push. |
| `AUTOPILOT_NO_SHIP` | unset | Any value: run Claude, but never test-gate, push or deploy. |
| `AUTOPILOT_DRY_RUN` | unset | Any value: sync, install, triage and the gating decision only. Claude never starts. |

State kept in `$AUTOPILOT_HOME` between ticks:

| Path | Contents |
|---|---|
| `runs/<timestamp>/` | One tick: `status.json`, `run.log`, `triage.json`, and when they apply `claude.jsonl`, `result.json`, `history.jsonl`, `test.log`, `uncommitted.patch`, `message.txt`. |
| `history.jsonl` | One line per tick (dry runs and ticks that failed before triage excepted): its `status.json` plus Claude's `result.json`. The last eight, newest first, are handed to the next session. |
| `deferred.json` | Signature to the time Claude first deferred it. |
| `.owner-signatures` | The owner-class signatures last reported, so an unchanged list is not re-sent. |

## Notifications

`notify.mjs <run-dir>` keeps quiet ticks quiet. It sends a message only when the
tick did something (Claude ran, a push, deploy or rollback happened, a step
failed) or when the set of owner-class findings changed since the last message.
The message carries the verdict, Claude's summary, what was fixed, config changes
applied, the ship line (tests, push, deploy), owner items with their exact
commands, deferrals, the Claude cost, and the GCS path of the full report. It is
cut to 4000 characters for Telegram.

- **Bot token:** the `telegram-bot-token` Secret Manager secret.
- **Destination:** the VM metadata attribute `autopilot-telegram-chat-id`, else
  `TELEGRAM_ALERTS_CHAT_ID` on `three-ws-api`. This is the private ops chat,
  never the public channel.
- **Not configured:** when either is missing it says which, and the message is
  still written to `message.txt` in the run directory (and so to the bucket).

## Dry runs

`run.sh` force-resets `$AUTOPILOT_HOME/three.ws` to `threews/main` and deletes
untracked files there, so never point it at a working checkout. Give it a
directory of its own:

```bash
export AUTOPILOT_HOME="$HOME/autopilot-dry"
mkdir -p "$AUTOPILOT_HOME"
git clone --origin threews https://github.com/nirholas/three.ws.git "$AUTOPILOT_HOME/three.ws"
AUTOPILOT_DRY_RUN=1 bash "$AUTOPILOT_HOME/three.ws/services/autopilot/run.sh"
cat "$AUTOPILOT_HOME"/runs/*/status.json
```

The first run does a full `npm ci` and the Playwright install, so it takes a
while. It needs `jq`, `flock` and `envsubst` on the path, and `gcloud` authenticated with read access to `three-ws-api` (for
`DATABASE_URL` and the triage). The `status.json` it leaves shows the triage
verdict, how many findings were actionable, and `"claude": "skipped: dry run"`
(or `"skipped: nothing Claude may act on"`). The report upload fails harmlessly
while the bucket does not exist (`report upload to gs://three-ws-autopilot
failed` in `run.log`).

`AUTOPILOT_NO_SHIP=1` goes one step further: Claude runs and commits in the
dedicated clone, but nothing is tested, pushed or deployed. The commits stay in
`$AUTOPILOT_HOME/three.ws` for review (and are discarded by the next tick's
sync).

To check a report without running a tick, point `notify.mjs` at any run
directory. Off the VM there is no metadata server, so without
`TELEGRAM_ALERTS_CHAT_ID` on the service it writes `message.txt` and sends
nothing:

```bash
node services/autopilot/notify.mjs "$AUTOPILOT_HOME/runs/<timestamp>"
```

## Provisioning

What `bootstrap.sh` does, on every boot, as root:

1. Installs `git`, `jq`, `curl`, `gettext-base` (for `envsubst`), the build
   toolchain, the Google Cloud CLI if missing, and Node.js 24 from NodeSource if
   the installed major is not 24.
2. Installs the latest `@anthropic-ai/claude-code` globally (refreshed every
   boot; the CLI's own auto-updater is off for the unattended user).
3. Adds a 16 GB swap file, because the avatar-studio and frontend builds peak
   above RAM on a cold build.
4. Creates the `autopilot` user, sets its gcloud project and `run/region`,
   clones the repository with the remote named `threews`, runs `npm ci`, and
   installs Playwright Chromium with its system dependencies.
5. Installs `autopilot.service` and `autopilot.timer` into systemd and enables
   the timer.

What has to exist around it, and is not scripted in this repository:

- The VM `three-ws-autopilot` with `bootstrap.sh` as its `startup-script`
  metadata, a disk large enough for the clone, `node_modules` and a full
  `build:gcp`, and optionally the `autopilot-telegram-chat-id` metadata
  attribute.
- A runtime service account for the VM that can read `three-ws-api`'s
  configuration and logs, access the `telegram-bot-token` and
  `autopilot-github-token` secrets, submit Cloud Build builds as the pinned
  `three-ws-build@` account, update Cloud Run traffic and env vars, invalidate the
  `three-ws-lb` CDN cache, create Cloud Scheduler jobs, call Vertex AI, and
  write to the report bucket.
- The bucket `gs://three-ws-autopilot`.
- The secret `autopilot-github-token`: a GitHub token that can push to
  `nirholas/three.ws`.

### The systemd units

`run.sh` and `bootstrap.sh` together define what the two missing units must
do: `autopilot.service` runs `services/autopilot/run.sh` from the clone as the
`autopilot` user (a oneshot; the script holds its own lock), and
`autopilot.timer` starts it every two hours. The tick can take well over an hour
(a 100-minute Claude session, then tests and a full build and deploy), so the
service must not carry a shorter timeout.

## Related

- [.agents/skills/gcp-triage/SKILL.md](../../.agents/skills/gcp-triage/SKILL.md): the method the session follows for each finding.
- [scripts/gcp-triage.mjs](../../scripts/gcp-triage.mjs): the sweep and its known signatures.
- [docs/ops/production-log-triage.md](../../docs/ops/production-log-triage.md): finding classes and the exact owner commands.
- [docs/ops/gcp-production.md](../../docs/ops/gcp-production.md): the production runbook the deploy step follows.
