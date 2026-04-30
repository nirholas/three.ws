# Task: Replace substring search in AgentMemory with semantic embeddings

## Context

The project is three.ws — a platform for 3D AI agents.

The repo is at `/workspaces/3D-Agent`.

`src/agent-memory.js` is the in-browser memory store for agent state. Its `query()` method currently does a plain substring match:

```js
// src/agent-memory.js — current query logic (around line 80-100)
query({ type, tags, limit = 50, since = 0 } = {}) {
  const now = Date.now();
  let results = this._entries.filter((m) => {
    if (m.expiresAt && m.expiresAt < now) return false;
    if (since && m.createdAt < since) return false;
    if (type && m.type !== type) return false;
    if (tags?.length) return tags.some((t) => m.tags.includes(t));
    return true;
  });
  return results
    .sort((a, b) => b.salience - a.salience || b.createdAt - a.createdAt)
    .slice(0, limit);
}
```

The CLAUDE.md for this module notes: *"`memory.recall()` is substring search. No embeddings yet."*

There is no `recall()` method yet — it's a placeholder concept. The LLM runtime at `src/runtime/index.js` calls `memory.query(opts)` when it needs to inject context before the LLM call.

**The problem:** An agent that remembers "the user prefers dark mode" won't surface that memory when the user asks about "theme" or "appearance" — because there's no "dark mode" substring match. Semantic search would catch the intent.

**The goal:** Add a `recall(queryText, opts)` method to `AgentMemory` that does semantic similarity search using Anthropic's embeddings API, falling back to the existing `query()` if embeddings are unavailable or not yet stored.

---

## Architecture

### Embedding storage

Each `MemoryEntry` gets an optional `embedding` field — a `Float32Array` or plain `number[]` of 1024 floats (Anthropic `voyage-3-lite` model produces 1024-dim vectors). Embeddings are generated lazily: when a memory is added and an embed function is available, embed it immediately. For existing memories without embeddings, fall back to substring search.

### Embedding function

The agent runtime already proxies API calls through the backend. Add a thin endpoint `GET /api/agents/:id/embed?text=...` (or `POST` with body) that calls Anthropic's embedding endpoint and returns the vector. The `AgentMemory` constructor accepts an optional `embedFn: async (text) => number[]` — this keeps the memory module decoupled from the specific API client.

### Cosine similarity

```js
function cosineSim(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i]*b[i]; na += a[i]*a[i]; nb += b[i]*b[i]; }
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}
```

### recall() method

```js
async recall(queryText, { type, limit = 10, minScore = 0.75 } = {}) {
  // 1. If no embedFn, fall back to query() substring match
  // 2. Embed queryText
  // 3. Filter to entries that have embeddings (skip ones without)
  // 4. Score each entry's embedding against queryText embedding via cosineSim
  // 5. Also include entries without embeddings that pass the old substring filter
  // 6. Sort by score descending, return top `limit`
}
```

---

## Files to create/edit

**Create:**
- `api/agents/[id]/embed.js` — thin Vercel endpoint. `GET ?text=...` or `POST { text }`. Calls Anthropic embeddings API. Returns `{ embedding: number[] }`. Use the `wrap`, `error`, `json` helpers from `api/_lib/http.js`. Auth: session or bearer. Rate limit: use `limits.authIp`.

  Anthropic embedding call:
  ```js
  import Anthropic from '@anthropic-ai/sdk';
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const response = await client.embeddings.create({
    model: 'voyage-3-lite',
    input: [text],
    input_type: 'query',
  });
  return response.embeddings[0].embedding;
  ```

**Edit:**
- `src/agent-memory.js`:
  - `constructor`: accept `{ embedFn }` in opts
  - `add()`: after storing, if `embedFn` available, call it async and store result in `mem.embedding` (fire-and-forget, don't block `add()`)
  - Add `async recall(queryText, opts)` method
  - Export the `cosineSim` helper (for testing)

- `src/runtime/index.js`: pass `embedFn` to `AgentMemory` constructor. The embed function should call `fetch('/api/agents/${agentId}/embed', { method:'POST', body: JSON.stringify({text}), headers: {'content-type':'application/json'}, credentials:'include' })` and return the embedding array.

**Do not touch:**
- Existing `query()` method behavior — `recall()` is additive
- `src/memory/index.js` (the file-based memory variant — separate concern)
- Any viewer or avatar files

---

## Endpoint shape

`POST /api/agents/:id/embed`

Request body: `{ text: string }`

Response `200`: `{ embedding: number[] }` (1024 floats)

Error cases:
- 400 if `text` is empty or > 8192 chars
- 401 if not authenticated
- 429 if rate limited

---

## Acceptance criteria

1. Call `memory.add({ type: 'user', content: 'prefers dark mode', tags: [] })` — the entry gets an embedding attached.
2. Call `await memory.recall('what theme does the user like?')` — the "dark mode" entry comes back in the top results even though no substring matches.
3. Call `memory.query({ type: 'user' })` — still works unchanged (no regression).
4. If `embedFn` is not provided (default), `recall()` falls back to the existing substring-based `query()` and returns a resolved promise.
5. `POST /api/agents/:id/embed` returns a 1024-element array for a sample text.
6. `npx vite build` passes. `node --check src/agent-memory.js` passes.

## Constraints

- ESM only. Tabs, 4-wide. Match existing style in `src/`.
- The Anthropic SDK is already a project dependency — don't add it again.
- Embedding generation is fire-and-forget on `add()` — never block the caller.
- `recall()` must work even if some entries have no embeddings (skip scoring them, include via substring fallback instead).
- API endpoint follows the pattern in `api/CLAUDE.md` exactly — use `wrap`, `cors`, `method`, `error`, `json` helpers.
