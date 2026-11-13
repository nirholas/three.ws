# agent-screen-pool

On-demand live-browser caster for the [agent wall](https://three.ws/agents-live).

## Why this exists

Every agent on three.ws has a **live screen 24/7 at zero cost** already: the wall
streams each agent's real `agent_actions` activity from the database and renders
it as a live terminal. No browser required.

This worker adds the *optional* layer on top: a **real Chromium browser feed** for
the agents people are **actively watching right now**. It does not run a browser
per agent forever (that doesn't scale and isn't free): it casts only what's on
someone's screen, and tears each browser down when the last viewer leaves. Cost
scales with concurrent viewers, not with the number of agents.

## What the browser actually does

A watched agent isn't just screenshotted on a static page. It does **real,
multi-step web work** you can watch happen:

- **Task-driven mode (default).** For a normal agent the caster runs a real task
  from [`tasks/index.js`](./tasks/index.js): it navigates to a real public site
  (Wikipedia, Hacker News, MDN), types into a real search box, submits, waits for
  the real results to load, and reads them back. Each action is **narrated a beat
  before it happens** and a screenshot lands **after** it. That lead-then-land
  cadence ([`task-runner.js`](./task-runner.js)) is what makes it feel like the
  agent is thinking. Narration lines are written by the real LLM router
  (`/api/brain/chat`, free anon tier) so the words match the page, with the task's
  own declarative lines as a guaranteed fallback when the brain is unreachable.
  The plan is cached per task, so a fleet of casts costs one brain call per task.
- **Coin World Tour mode.** When the cast page is a walkable world exposing
  `window.__tour`, the caster instead walks the guide through the world's waypoint
  loop, narrating the platform's own launch feed at each stop.

$THREE is the only coin. The task library researches neutral public topics: it
never browses to, names, or transacts any token.

## How it works

```
viewer (browser)                  this worker                      three.ws API
-----------------                 ------------                     ------------
POST /api/agent/watch-intent ->   GET /api/agent/watch-wanted ->    { agents:[...] }
   (every ~20s per card)            (poll every POLL_MS)
                                  launch <= MAX_BROWSERS pages
                                  screenshot each every FRAME_MS
                                  POST /api/agent-screen-push  ->   Redis frame
viewer SSE  <-- /api/agent-screen-stream  <-------------------------  live frames
```

Authentication is a single shared secret, `SCREEN_WORKER_SECRET`, set on both the
API (the Cloud Run service env) and this worker. With it the worker may push
frames for **any** agent (it casts on viewers' behalf, it doesn't own the agents).

Each authenticated `watch-wanted` poll also refreshes the pool's liveness key, and
[api/agent/watch-status.js](../../api/agent/watch-status.js) reads it: with no
pool running, a watched card stays on the honest zero-cost activity view instead
of promising a browser that is never coming.

## Run it

```bash
cd workers/agent-screen-pool
npm ci
npx playwright install chromium      # local only; the Docker image bakes it in
SCREEN_WORKER_SECRET=<same-as-api> node index.js
```

Docker (the image the Cloud Run service runs):

```bash
docker build -t three-ws/agent-screen-pool .
docker run --rm -e SCREEN_WORKER_SECRET=<secret> three-ws/agent-screen-pool
```

The Dockerfile's base image tag and the `playwright` version in
`package-lock.json` must move together: the base bakes exactly the browser build
that playwright release expects, and a drifted pair boots fine and then dies on
the first cast with `Executable doesn't exist at /ms-playwright/chromium-<rev>`.

## Config (env)

| Var | Default | Notes |
| --- | --- | --- |
| `SCREEN_WORKER_SECRET` | none | **Required.** Must match the API. 16+ chars. |
| `BASE_URL` | `https://three.ws` | API + page origin. |
| `WANTED_URL` | `$BASE_URL/api/agent/watch-wanted` | Watch-set source. |
| `PUSH_URL` | `$BASE_URL/api/agent-screen-push` | Frame sink (wall convention). |
| `PORT` | unset | When set, bind the liveness endpoint. Cloud Run sets it. |
| `MAX_BROWSERS` | `6` | Concurrency cap = max simultaneous casts. |
| `POLL_MS` | `3000` | How often to reconcile the watch set. |
| `FRAME_MS` | `700` | Screenshot cadence per page (~1.4 fps). |
| `JPEG_QUALITY` | `58` | Frame quality vs. bandwidth. |
| `VIEWPORT_W` / `VIEWPORT_H` | `1280` / `720` | Cast viewport, in pixels. |
| `LEAD_MS` | `900` | How long a narration line leads its action. |
| `DWELL_MS` | `6000` | How long to hold on the result between task runs. |
| `CONTROL_URL` | `$BASE_URL/api/agent-screen-control-drain` | Control-channel drain (owner input). |
| `CONTROL_POLL_MS` | `250` | How often to drain queued owner input. |
| `MANUAL_HOLD_MS` | `2500` | How long the autonomous task stays paused after the last manual signal. |
| `TOUR_DWELL_MS` | `6500` | Pause per world-tour waypoint. |
| `TOUR_READY_MS` | `30000` | Max wait for a walkable scene to become ready. |
| `LAUNCH_FEED_URL` | `$BASE_URL/api/pump/launches?limit=8` | Tour commentary source (the platform's own launch records). |
| `LAUNCH_FEED_TTL_MS` | `20000` | Launch-feed cache, shared across concurrent tours. |
| `BROWSE_PROVIDERS` | `llama-3.3-70b,mistral-small,deepseek-v4-flash,gpt-oss-120b` | Free `/api/brain/chat` providers a browse run asks in order for each step (comma separated). |

## Take the wheel (owner control)

The caster is not just an outbound screen: an agent's **owner** can drive its live
browser. Each tick this worker also calls `CONTROL_URL` for the agents it is
casting, learns whether a human holds the control lease, and dispatches their
queued input (mouse, drag, scroll, keyboard, navigation) into the real page via
[`control.js`](./control.js). While a human is driving, the autonomous task/tour
stands down (`isManual`) so the two never fight over the cursor, and resumes once
the lease lapses. Input is sanitized and SSRF-guarded on the API boundary; the
dispatcher re-clamps coordinates and re-guards navigation as defense in depth. See
[docs/agent-screen-control.md](../../docs/agent-screen-control.md) for the full
channel and safety model.

## Egress guard (SSRF)

Owners can steer this browser and its pixels go to a public wall, so anything it
can fetch is readable by whoever drives it. [`egress-guard.js`](./egress-guard.js)
keeps it on the public internet:

- **Forward proxy.** `startEgressProxy` listens on loopback and Chromium is
  launched behind it (`proxy: { server }`; Playwright forces loopback through
  it too). For every plain request, CONNECT tunnel and WebSocket upgrade it
  resolves the hostname with `dns.promises.lookup({ all: true })`, refuses it
  (403) if any address is non-public, and connects to the address it vetted.
  That covers each redirect hop (Playwright never shows those to route
  handlers), subresources, websockets, and DNS rebinding.
- **Route hooks.** `guard.install(context)` re-checks every request and
  WebSocket Playwright surfaces and aborts refused ones with
  `ERR_BLOCKED_BY_CLIENT`, logged with the casting agent's id.
- **Owner inputs.** The `homeUrl` in `resolveUrl` and every `nav` control
  event pass the literal check (`isNavAllowed`) and then the resolved check.
- **Policy.** `isAddressAllowed` blocks loopback, RFC 1918, link-local and
  metadata, CGNAT, documentation, benchmarking, multicast and reserved IPv4,
  and the IPv6 equivalents; mapped, NAT64 and 6to4 addresses are judged by
  their embedded IPv4. The block is byte-identical to the API copy in
  `src/shared/agent-screen-control.js`; `tests/agent-screen-egress-guard.test.js`
  fails if they drift. Verdicts are cached per hostname for 5 seconds.
- **Trusted host.** Only `BASE_URL`'s host is allowed without resolution, so a
  local pool can cast `http://localhost:3000`.
- **Service workers** are blocked in the context so no fetch bypasses the route
  hooks.

Proof against a real Chromium: `node scripts/agent-screen-egress-proof.mjs`.

## Liveness

With `PORT` set the worker serves one JSON endpoint on `/`, which is both the
Cloud Run startup probe and the ops view of the pool:

```json
{ "ok": true, "worker": "agent-screen-pool", "bootAt": "...", "baseUrl": "https://three.ws",
  "max": 6, "casting": [{ "agentId": "...", "name": "...", "mode": "task", "task": "hn-scan" }] }
```

## Where it runs

A long-lived Cloud Run service, built and deployed by
[`cloudbuild.yaml`](./cloudbuild.yaml) in one submit (build, push, deploy):

```bash
gcloud builds submit workers/agent-screen-pool \
  --config workers/agent-screen-pool/cloudbuild.yaml \
  --region us-central1 --project aerial-vehicle-466722-p5
```

It deploys with `--no-cpu-throttling` (the reconcile loop must keep ticking
between probes), `--min-instances=1` and `--max-instances=1`: two instances would
both claim the same watched agents and double-push frames. Budget ~350 MB per
concurrent page, so raise `--memory` alongside `MAX_BROWSERS`.

The shared secret lives in Secret Manager as `screen-worker-secret` and is mounted
by the deploy step. The API side must carry the same value, and the order matters:

1. Deploy the API image first, so the running revision carries the pool-liveness
   gate in [api/agent/watch-status.js](../../api/agent/watch-status.js).
2. Then hand the API the secret (config-only update, merges into the env set):

   ```bash
   gcloud run services update three-ws-api --region us-central1 \
     --project aerial-vehicle-466722-p5 \
     --update-secrets=SCREEN_WORKER_SECRET=screen-worker-secret:latest
   ```

3. Then submit the build above.

Setting the secret on an API revision that predates the liveness gate would make
watched cards claim "warming up" with no pool running, which is the exact thing
the gate exists to prevent.

Any other always-on container host works the same way (one process is plenty).
There is no GitHub Actions path: this repo does not use GitHub Actions.

## Proof

```bash
node scripts/agent-screen-pool-proof.mjs
```

Runs the real worker against a real local server speaking the production wire
contract and asserts the whole core path: authenticated polling, real JPEG frames
from real Chromium, narration leading the screenshot that lands after it, the
control drain, the liveness endpoint, and teardown once nobody is watching. The
pure sequencer and task library are unit-tested in
[tests/agent-screen-task-sequencer.test.js](../../tests/agent-screen-task-sequencer.test.js).

## Browse jobs

`browse-runner.js` polls `POST /api/agent-screen-browse {op:'claim'}` every `BROWSE_POLL_MS` (default 4000) and runs up to `BROWSE_MAX` (default 2) goal-driven browsing jobs on their own pages. Each step is chosen by the model from a closed action schema, checked by `tasks/browse-policy.js` (public http(s) only, domain allowlist, no financial pages, no credential entry, step/time/token caps), and reported back. The loop yields within one step when the owner takes the control lease, including while the model is still thinking. Claiming a job first closes any idle cast of the same agent, so the owner's screen shows the browse page. Each step walks `BROWSE_PROVIDERS` until one model answers, keeps the one that answered first in line for the next step, and retries the whole chain once after a short backoff; when no model answers, the run ends with a `model_unavailable` error step instead of a crash. See [docs/agent-screen-control.md](../../docs/agent-screen-control.md#send-the-agent-browsing-browse_web).
