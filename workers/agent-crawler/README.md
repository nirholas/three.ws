# agent-crawler: the crawler fleet behind /crawl

A long-lived Node process that sends three.ws agents out to read the open web in real browsers. It runs one shared headless Chromium, gives every crawling agent its own isolated browser context, and streams each step (the page, what the agent is thinking, the link boxes it can see, the link it chose, a JPEG frame) to the three.ws API, which fans it out live to [three.ws/crawl](https://three.ws/crawl) and files every finished page in the open corpus.

The package is `"private": true`: an internal worker, not published to npm. Consume it by running the process. The product side (watching, sending your own agent out, the corpus export) is documented in [docs/crawl.md](../../docs/crawl.md).

## What it does

1. **Roster.** Every `ROSTER_MS` it asks `GET /api/crawl/roster` which agents their owners have sent out, oldest reader first, and keeps up to `CRAWLERS` of them walking at once. When more are enrolled than there are slots, each walks a shift of `SHIFT_MS` and then yields to the agent that has waited longest.
2. **Read.** Each crawler opens its next page, dismisses common consent banners, extracts title, readable text and every link with its on-screen box (`extract.js`), and scores how well the page covers the topic (`frontier.js`). Bot walls and error pages are recognised and skipped.
3. **Choose.** Every link is scored against the topic (anchor text, URL path, new site versus same site, link depth, visibility). Login, cart, share, social and file links are never followed, and no site gets more than 30 pages per agent. The best visible link is walked to on screen; the rest go into a bounded best-first queue of 400.
4. **Search when stuck.** With no start pages, or an empty queue, it asks DuckDuckGo, then Hacker News, then Wikipedia for leads it has not read, paging deeper on every round (`seeds.js`).
5. **Push.** Every step goes to `POST /api/crawl/push` with the latest frame, and every finished page goes with it. A page that crashes the tab or hangs costs that page only; the crawler recycles its tab and moves on.

### Manners and safety

- robots.txt is honoured for the `three.ws-crawler` token, which is also in the browser's user agent with a link to /crawl (`robots.js`, `guard.js`).
- One request per site every `DOMAIN_GAP_MS`, shared across every crawler in the process.
- Every request the browser makes, including redirects and subresources, is resolved and refused if it points at localhost, a private or link-local range, or a cloud metadata host (`guard.js`).
- The browser holds no wallet, no keys and no three.ws session. Its only credential is the worker secret, which it sends to the three.ws API and nowhere else.

## Configuration

| Variable | Default | Meaning |
| --- | --- | --- |
| `CRAWL_WORKER_SECRET` | required | Shared secret, at least 16 characters. Must equal the API's `CRAWL_WORKER_SECRET` or every roster poll answers 401. |
| `BASE_URL` | `https://three.ws` | The API the worker reads the roster from and pushes to. |
| `CRAWLERS` | `8` | Agents walking at once. Each context peaks around 300 MB on a heavy page. |
| `SHIFT_MS` | `1200000` | How long an agent walks before yielding its slot to a waiting one. |
| `ROSTER_MS` | `30000` | Roster poll interval. |
| `READ_MS` | `3500` | Time spent reading a page before choosing. |
| `WALK_MS` | `3200` | Time the avatar spends walking to the chosen link. |
| `LEAP_MS` | `900` | Pause before opening a lead from the queue rather than an on-screen link. |
| `DOMAIN_GAP_MS` | `4000` | Minimum gap between two requests to the same site. |
| `NAV_TIMEOUT_MS` | `20000` | Navigation timeout per page. |
| `JPEG_QUALITY` | `55` | Frame quality pushed to viewers. |
| `PORT` | unset | When set, binds a liveness endpoint. Cloud Run sets it. |

## Run it locally

```bash
cd workers/agent-crawler
npm install
npx playwright install chromium
CRAWL_WORKER_SECRET="$(node ../../scripts/read-service-env.mjs '^CRAWL_WORKER_SECRET$' --raw)" \
  CRAWLERS=1 PORT=3028 npm start
```

That drives the production API. Only do this while the deployed `agent-crawler` service is not running: two workers would both claim the same roster and push interleaved steps for the same agent. For development, point it at a local API instead: run the server on a spare port from the repo root (`PORT=3027 node --env-file=.env.local server/index.mjs`, with `CRAWL_WORKER_SECRET` in its environment set to the same value) and add `BASE_URL=http://localhost:3027` to the worker. The local API still needs Redis (the `UPSTASH_REDIS_REST_*` pair) for the live layer.

Check it is alive:

```bash
curl -s localhost:3028
# {"ok":true,"crawlers":[{"agentId":"...","name":"...","topic":"...","status":"reading","url":"...","frontier":37,"visited":12,"pagesRead":9,"upMs":184000}],
#  "slots":1,"browser":true,"lastRosterAt":1760000000000,"lastRosterError":null}
```

Logs go to stdout, one line per page, lead, block and search.

## Deploy

A Cloud Run service with one always-on instance (two instances would both claim the same roster), no CPU throttling, 2 vCPU and 4 GiB. The secret lives in Secret Manager as `crawl-worker-secret`, and the runtime service account holds `secretAccessor` on it.

```bash
gcloud builds submit workers/agent-crawler \
  --config workers/agent-crawler/cloudbuild.yaml \
  --region us-central1 --project aerial-vehicle-466722-p5 \
  --substitutions=SHORT_SHA=manual$(date +%s)
```

The Docker base image tag must match the exact `playwright` version in `package.json`; bump both together.

## Tests

```bash
npx vitest run tests/agent-crawler-frontier.test.js tests/agent-crawler-seeds.test.js tests/agent-crawler-guard.test.js
```

Run from the repo root. They cover link scoring, canonical URLs, wall detection, topic relevance, the agent's thoughts, the search fallback, and the private-address guard.
