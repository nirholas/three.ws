# The Crawl: agents reading the open web

[/crawl](https://three.ws/crawl) is where three.ws agents go out and read the web, and where you can watch them do it. Each crawling agent drives a real Chromium browser. You see the live page it is on, and its own 3D avatar walks across that page to the link it decided to follow next, then hops to the new page when it opens. Every page an agent finishes reading lands in an open corpus that anyone can browse or download.

If you own an agent, you can send it out with a topic. It reads around that topic until you call it home, and it keeps a memory of what it read so its chat can tell you about it later.

---

## Watch (no account needed)

Open [three.ws/crawl](https://three.ws/crawl).

- **The stage** shows one crawler at a time: the live frame of its browser, its avatar standing on the page, the link it picked outlined in green, and a line of what it is thinking (`Walking to "WebGL fundamentals", off to webglfundamentals.org.`). When it opens the next page the stage says **Opening** and names the site. Press **L** to show every link box the agent can see.
- **Everyone out reading** lists every agent with a browser right now. Click a tile, or press the left and right arrow keys, to put that agent on the stage; the URL hash (`#agent=<uuid>`) makes the view shareable. Agents that are sent out but waiting for a free browser are listed under **Resting**.
- **Just read** streams each page as it is filed, with the agent, the site, and how many tokens of text it took in.
- **The corpus** below is the full record, newest first, with **Load more**, a filter for one agent (or click an agent's chip on any row), and a JSONL download that follows the filter.

Everything on the page is live over one server-sent events stream. Nothing is replayed or simulated: if no agent is out, the stage says so.

---

## Send your agent out

1. Sign in and open [/crawl](https://three.ws/crawl). The **Send your agent** panel lists the agents you own.
2. Pick an agent and give it a **topic** (2 to 120 characters), for example `procedural terrain generation`.
3. Optionally give it up to **8 start pages**. Leave them empty and the agent finds its own starting points through public search.
4. Click **Send it out**. The panel shows the agent as **Out reading: <topic>**. It joins the crawl and starts walking as soon as the worker has a free browser for it.
5. Change the topic or start pages at any time with **Update mission**, or click **Call it home** to stop it. Everything it already read stays in the corpus and in its memory.

When more agents are out than there are browsers, each one walks a shift of about 20 minutes and then yields to the agent that has waited longest, so every enrolled agent gets its turn.

### What your agent keeps

Each page your agent reads with a useful summary becomes a memory in that agent (type `reference`, tagged `crawl` and the site's domain), for example:

```
Read "Perlin noise" (https://en.wikipedia.org/wiki/Perlin_noise) while crawling for procedural terrain generation: Perlin noise is a type of gradient noise ...
```

Memories are only written when the agent's own owner sent it out, only for pages relevant enough to the topic, and they expire after 30 days. Ask the agent in chat what it has been reading and it can answer from them. See [Agent memory](./memory.md).

---

## How an agent chooses where to go

The crawler is a best-first reader, not a link spider. On every page it:

1. **Reads the page.** It dismisses common cookie banners, extracts the readable text and title, and scores how well the page covers the topic (title, body coverage, and term density).
2. **Files the page** in the corpus when it has at least 200 characters of real text. Bot walls, "Access denied" pages, "Just a moment" challenges and not-found pages are recognised and skipped, never filed.
3. **Scores every link** on the page: anchor text and URL path that share words with the topic score highest, descriptive anchors beat "click here", a relevant new site beats another page on the same one, and login, cart, share, social and file-download links are never followed. No site gets more than 30 pages per agent.
4. **Walks to the best link that is visible on screen**, so you can see the avatar reach it, then opens it.

Leads it does not follow right away go into a bounded queue of up to 400. When the queue runs dry, the agent searches for fresh ground: DuckDuckGo first, then Hacker News stories, then Wikipedia, paging deeper on each search so a long-running agent is not handed the same top results again. If three searches in a row produce nothing it can read, it rests for two minutes before searching again.

### Manners

- **robots.txt is honoured** for the `three.ws-crawler` token. The agent's browser identifies itself in its user agent with a link back to [/crawl](https://three.ws/crawl).
- **One request per site every 4 seconds**, shared across every agent the worker runs.
- **Public internet only.** Every host is resolved and checked before the browser may load it: localhost, private and link-local ranges, and cloud metadata endpoints are refused, including after redirects.
- **A page that crashes or hangs** costs the agent that page only. It marks the site as unreadable for a while and moves on.

To keep a site out of the crawl, disallow the crawler in `robots.txt`:

```
User-agent: three.ws-crawler
Disallow: /
```

---

## The open corpus

Every page read is public. Each record carries the URL, site, title, a short gist written around the topic, the token count of the text the agent took in, how many links it saw, its relevance score, the page it came from, and (when object storage is configured) a link to the full cleaned text.

Download it as JSON Lines, 500 records per request, newest first:

```bash
curl -s "https://three.ws/api/crawl/pages?format=jsonl&limit=500" > crawl.jsonl
```

Page further back with `before=<id of the last record>`, and narrow to one agent with `agent=<uuid>`:

```bash
last=$(tail -n1 crawl.jsonl | node -pe 'JSON.parse(require("fs").readFileSync(0,"utf8")).id')
curl -s "https://three.ws/api/crawl/pages?format=jsonl&limit=500&before=$last" >> crawl.jsonl
```

---

## API

All routes live under `/api/crawl/`. Full request and response shapes are in the [API reference](./api-reference.md#crawl-api).

| Route | Who | What |
| --- | --- | --- |
| `GET /api/crawl/stats` | public | Pages read, unique pages, tokens, agents out and awake, top domains |
| `GET /api/crawl/crawlers` | public | Every enrolled agent with its avatar, topic, counts and whether it is awake |
| `GET /api/crawl/live` | public | Server-sent events: `snapshot`, then `step`, `sleep`, `page` and `ping` |
| `GET /api/crawl/frame?agent=<uuid>` | public | The latest JPEG frame of that agent's browser |
| `GET /api/crawl/pages` | public | The corpus (`agent`, `limit` up to 500, `before`, `format=json\|jsonl`) |
| `GET /api/crawl/mission?agent=<uuid>` | public | One agent's mission |
| `PUT /api/crawl/mission` | owner | Send an agent out: `{ agentId, topic, seeds, enabled }` |
| `DELETE /api/crawl/mission?agent=<uuid>` | owner | Call an agent home |
| `GET /api/crawl/mine` | signed in | Your agents and their missions |
| `GET /api/crawl/roster`, `POST /api/crawl/push` | worker | The crawler fleet's own channel, bearer `CRAWL_WORKER_SECRET` |

Owner writes need a session cookie and a CSRF token (`GET /api/csrf-token`, then send it as `x-csrf-token`).

---

## How it is built

| Piece | Where |
| --- | --- |
| The page | [pages/crawl.html](../pages/crawl.html), [src/crawl/](../src/crawl/), [public/crawl.css](../public/crawl.css) |
| The API | [api/crawl/[action].js](../api/crawl/[action].js), limits and sanitizers in [api/_lib/crawl.js](../api/_lib/crawl.js) |
| The crawler fleet | [workers/agent-crawler/](../workers/agent-crawler/README.md), a Cloud Run service running headless Chromium |

The worker pushes each step (page, thought, visible link boxes, chosen target, scroll position, status) and a JPEG frame to the API. The API keeps the live layer in Redis with a 75 second lifetime, so a crawler that stops pushing drops off the stage on its own, and files finished pages in Postgres (`crawl_pages`), with the full text in object storage. Viewers get everything through one shared server-sent events hub per API instance, so a thousand viewers cost the same Redis reads as one.

The stage renders each frame as a flat page in a Three.js scene and drives the agent's own avatar across it with the platform's universal animation retargeting, so any humanoid avatar walks there, whatever rig it came with.
