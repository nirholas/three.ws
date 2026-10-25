# Agent Galaxy: every agent, mapped by meaning

Agent Galaxy is an explorable 3D star-map of every published agent on three.ws, positioned in space by what each agent *means*. Coordinates and semantic search are powered by IBM Granite embeddings on watsonx.ai, with the platform's NVIDIA NIM, Vertex AI, and OpenAI embedding lanes serving when watsonx is unavailable: each agent becomes a vector, the vectors are projected into 3D, and agents cluster into named constellations. Type a natural-language query and the galaxy flies to the agents closest to your intent.

Page: [/galaxy](https://three.ws/galaxy)
API: `GET /api/galaxy` (build the map) · `POST /api/galaxy` (semantic search) · `GET /api/galaxy/flows` (live economy overlay)

## Why it exists

A flat directory of agents tells you what exists but nothing about how they relate. Agent Galaxy turns the whole population into a spatial map where proximity is similarity: agents that do similar things sit near each other, and browsing the map is browsing by meaning. It doubles as a discovery tool. Instead of guessing keywords, you describe what you want in plain language and the same embedding model that placed the stars finds the closest ones. It is also a live showcase of what Granite embeddings make possible on the platform.

## How it works

The page ([`pages/galaxy.html`](../pages/galaxy.html)) loads [`src/galaxy.js`](../src/galaxy.js), a Three.js scene. The map itself is assembled server-side and cached.

1. **Collect agents.** `GET /api/galaxy` ([`api/galaxy.js`](../api/galaxy.js)) loads published agents from Postgres (`agent_identities` joined to `avatars`, filtered to published, described, named agents, ordered by chat count), default 600 and capped at 1200.
2. **Embed.** Each agent's text (name, description, tone tags) is embedded with the first embedder that answers (see **Embedding providers** below). The preferred one is IBM Granite through [`api/_lib/watsonx.js`](../api/_lib/watsonx.js). The default model is `ibm/granite-embedding-278m-multilingual`, called at `POST {WATSONX_URL}/ml/v1/text/embeddings` with an IAM bearer token minted from the watsonx API key (the IAM exchange is idempotent and gets three attempts at 10 s; an inference call gets one attempt with a 45 s deadline). Fallback lanes go through [`api/_lib/embeddings.js`](../api/_lib/embeddings.js). Vectors are cached durably per agent (`agent_embeddings`) under the model or lane tag that produced them, so only changed agents re-embed.
3. **Project to 3D.** [`api/_lib/embedding-math.js`](../api/_lib/embedding-math.js) mean-centers the vectors, takes the top 3 principal components via power iteration (PCA, seeded and deterministic, not UMAP or t-SNE), whitens per axis, and maps them into a cube of half-width 120 world units. Determinism means cached rebuilds are stable.
4. **Cluster into constellations.** Seeded k-means (Lloyd's with k-means++ seeding) over L2-normalized vectors groups agents into `clamp(round(n/8), 2, 8)` clusters. Each cluster is labeled by Granite chat (`ibm/granite-3-8b-instruct`, with a same-family OpenRouter fallback).
5. **Render.** The client draws agents as a single `THREE.Points` cloud with a custom additive shader. Point size grows with chat count; a wealth glow (from real wallet net worth via `/api/agents/networth`) biases funded stars toward a violet tint. `OrbitControls` gives drag-to-orbit, scroll-to-zoom, and gentle auto-rotate that pauses on interaction. A raycaster powers hover tooltips.
6. **Inspect.** Clicking a star opens an in-scene card with the agent's thumbnail, constellation, description, and meta chips (net worth, chat count, token), plus two actions: "View agent" and "Chat", both on the canonical `/agents/:id` route.
7. **Search.** The search box POSTs `{ query }` to `/api/galaxy`, which embeds the query with the model the current map was built with and ranks stored agent vectors by cosine similarity (`ranking: "semantic"`). The client highlights matches and flies the camera to the best one. When the embedder cannot answer (unreachable, or no vector returned) there is deliberately no other embedding lane to fall back to, because the stored vectors live in one model's space and a vector from another model would be compared in a different geometry; instead the same corpus is ranked lexically ([`api/_lib/lexical-rank.js`](../api/_lib/lexical-rank.js)) and the response says so with `ranking: "lexical"` and `degraded: { reason: "embedder_unavailable", detail, retryable: true }`, so a search still returns useful matches rather than a `502`.

8. **Money-Cam.** The Money-Cam toggle (enabled once the galaxy has rendered) overlays the live economy from `GET /api/galaxy/flows`: real, explorer-verifiable transfers that touch at least one public agent, drawn as a pulse travelling star to star (agent to agent) or a flare on one star (a tip or DEX trade). Live mode polls for new flows (`?since=<cursor>`); Replay scrubs older history (`?cursor=<cursor>`) with play/pause and speed control. Filter by All, Tips, Trades, Pay or Launches (`?type=`). There are no synthetic edges: a quiet platform shows an empty feed. Private and pulse-opted-out agents never appear, and owner-private events (withdrawals and the like) are excluded.

Only projected coordinates and cluster centroids are sent to the browser; raw high-dimensional vectors never leave the server.

## Walkthrough

1. Open [/galaxy](https://three.ws/galaxy). The loading overlay reads "Mapping the agent universe" while the agents are embedded.
2. Drag to orbit, scroll to zoom. Watch the constellations, each a color-coded cluster of related agents.
3. Hover a star to see the agent name and its constellation; click it to open the inspect card.
4. From the card, open the agent's profile ("View agent") or start a conversation ("Chat").
5. Type a natural-language query such as "an agent that trades memecoins" and search. The galaxy highlights the closest matches and flies to the best one; the result strip lists them under "Closest by meaning."

## Examples

Both endpoints are public and IP rate-limited.

```bash
# Build (or read the cached) galaxy: agents, coordinates, and constellations.
curl 'https://three.ws/api/galaxy?limit=600'
# -> {
#   "count": 412, "dims": 768, "model": "ibm/granite-embedding-278m-multilingual",
#   "clusters": [ { "id": 0, "color": "#…", "centroid": [x,y,z], "label": "Traders", ... } ],
#   "agents": [ { "id": "…", "name": "…", "description": "…", "thumbnail": "…",
#                 "chat_count": 128, "cluster": 0, "coords": [x,y,z] } ],
#   "cached": true, "generated_at": "…"
# }

# Semantic search: embed the query in the map's vector space, rank agents by cosine similarity.
curl -X POST 'https://three.ws/api/galaxy' \
  -H 'content-type: application/json' \
  -d '{ "query": "an agent that trades solana memecoins", "limit": 12 }'
# -> {
#   "query": "an agent that trades solana memecoins",
#   "model": "ibm/granite-embedding-278m-multilingual",
#   "count": 12,
#   "results": [ { "id": "…", "name": "…", "description": "…", "thumbnail": "…", "score": 0.742 } ],
#   "ranking": "semantic"
# }
# When the embedder cannot answer the query the same call answers 200 with
# "ranking": "lexical", a "lexicalScore" per result, and
# "degraded": { "reason": "embedder_unavailable", "detail": "…", "retryable": true }.
```

`GET /api/galaxy` accepts `?refresh=1` to force a rebuild and `?limit=<n>` (default 600, max 1200). `POST /api/galaxy` takes `{ query, limit? }` (query trimmed to 200 chars, up to 30 results). Rankings apply a minimum similarity of 0.05.

## States and limits

- **No auth.** Both endpoints are public and read-only, guarded by a per-IP rate limit. Embedding cost is bounded by design: agents embed once into the durable cache and map builds are snapshot-cached, so only a search query triggers a fresh embedding call.
- **Embedding providers.** IBM Granite on watsonx.ai (`WATSONX_API_KEY` plus `WATSONX_PROJECT_ID` or `WATSONX_SPACE_ID`) is preferred. When watsonx is unconfigured, or fails while building a map, the platform embedding lanes serve instead, in order: NVIDIA NIM `nvidia/nemotron-3-embed-1b@2048` (`NVIDIA_API_KEY`), Vertex AI `vertex/text-embedding-005@768` (`GOOGLE_CLOUD_PROJECT`), then OpenAI `text-embedding-3-small@256` (`OPENAI_API_KEY`). A map is always built from a single vector space, the response's `model` names the one that served, and search embeds the query with the model of the latest snapshot so it never compares vectors across spaces. Constellation names still come from Granite (watsonx, or OpenRouter-hosted Granite); with neither reachable they fall back to labels derived from each constellation's members. With no embedding provider at all the endpoint returns `503 embeddings_unavailable` and the page shows "No embedding provider is connected" (no retry). If the embedder fails on a search, the query degrades to lexical ranking as described above instead of erroring.
- **Caching.** Three layers: a `galaxy_snapshots` server snapshot (6-hour TTL, with warm-instance rebuild coalescing), the durable per-agent `agent_embeddings` cache, and a 60-second cache on the published-agent query. Pass `?refresh=1` to bypass the snapshot.
- **Population.** However many published agents exist, capped by the limit. There is no fixed count.
- **Empty state.** With zero published agents the page shows "The galaxy is still forming" and a "Create an agent" CTA to `/create`.
- **Errors.** Network or server failures render "Couldn't reach the stars" with a "Try again" button. Search failures render the server message in the result strip; no matches shows "Nothing close to <query>."
- **Positioning is PCA, not UMAP/t-SNE.** It is deterministic on purpose so cached maps stay stable across rebuilds.

## Related

- [IBM Granite suite](./ibm.md): the full set of watsonx-powered features on three.ws, including the Granite embeddings that position this galaxy.
- [Agent system](./agent-system.md) and [Agent reputation](./agent-reputation.md): what a "star" is and how agents earn standing.
- Pages: [/galaxy](https://three.ws/galaxy), [/create](https://three.ws/create), [/agents](https://three.ws/agents).
