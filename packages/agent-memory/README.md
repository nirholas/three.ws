<p align="center">
  <a href="https://three.ws"><img src="https://three.ws/three-ws-mcp-icon.svg" width="72" height="72" alt="three.ws" /></a>
</p>

<h1 align="center">@three-ws/agent-memory</h1>

<p align="center"><strong>Persistent, embeddings-backed memory for agents — store facts and entities, recall them semantically, in one import.</strong></p>

<p align="center">
  <a href="https://www.npmjs.com/package/@three-ws/agent-memory"><img alt="npm" src="https://img.shields.io/npm/v/@three-ws/agent-memory?logo=npm&color=cb3837"></a>
  <a href="https://www.npmjs.com/package/@three-ws/agent-memory"><img alt="downloads" src="https://img.shields.io/npm/dm/@three-ws/agent-memory?color=cb3837"></a>
  <img alt="license" src="https://img.shields.io/npm/l/@three-ws/agent-memory?color=3b82f6">
  <img alt="node" src="https://img.shields.io/node/v/@three-ws/agent-memory?color=339933&logo=node.js">
</p>

<p align="center">
  <a href="#install">Install</a> ·
  <a href="#quick-start">Quick start</a> ·
  <a href="#api">API</a> ·
  <a href="#how-it-works">How it works</a> ·
  <a href="https://three.ws">three.ws</a>
</p>

---

> `@three-ws/agent-memory` is the official client for the three.ws **Memory**
> engine — the durable, embeddings-backed memory that gives an agent continuity
> across sessions. Your agent `remember()`s a fact, then `recall()`s it later by
> meaning, not keyword: a real semantic search over stored vectors. It wraps the
> live `/api/agent-memory` and `/api/memory/*` endpoints — a tiered store
> (working / recall / archival), free-first embeddings, and an auto-mined entity
> graph of the mints, tickers, wallets, people, and strategies your agent has
> seen. It pairs with the talking-agent runtime: the same memories that feed the
> Brain Memory node power your agent's replies.

## Why

Every "agent memory" you reach for is either an in-process array that dies with
the process, or a raw vector DB that leaves embedding, tiering, entity
extraction, ownership, and the cross-model "different vectors, different space"
trap to you. Memory is the whole pipeline, done once:

- **One import, durable recall.** `remember('User prefers SOL over EVM')` writes
  a memory that's still there next session — and `recall('which chain?')`
  finds it by meaning.
- **Free first.** Embeddings default to NVIDIA NIM's `nv-embedqa-e5-v5` (1024-dim,
  free with one key); OpenAI `text-embedding-3-small` is the paid backstop. No
  vector DB to stand up.
- **No fabricated similarity.** Each stored vector is tagged with the model that
  made it; queries are scored strictly within their own space. When no provider
  is configured, recall degrades to substring + salience — never a fake cosine
  score.
- **It builds a graph for free.** Every memory is mined (deterministically, no
  LLM call) for the entities it mentions, so you can ask *"what does my agent
  remember about this mint?"* and walk a co-occurrence graph.

This is the SDK twin of the three.ws **Memory Studio** — the same engine, exposed
as plain functions instead of a UI.

## Install

```bash
npm install @three-ws/agent-memory
```

Zero runtime dependencies. Works in Node 18+ and the browser (uses `fetch`).
Writes require a signed-in three.ws account or a bearer token (see
[Auth](#auth--errors)); reads are owner-only.

## Quick start

Bind a client to one agent, then remember and recall:

```js
import { AgentMemory } from '@three-ws/agent-memory';

const memory = new AgentMemory({ agentId: AGENT_ID, token: process.env.THREE_WS_TOKEN });

await memory.remember('User prefers Solana over EVM chains', { tags: ['preference'] });

const hits = await memory.recall('which blockchain does the user like?');
console.log(hits[0].content); // → "User prefers Solana over EVM chains"
console.log(hits[0].score);   // → 0.83  (real cosine; null on a lexical fallback)
```

Pin something to the always-in-context working core, then read what the agent
carries into every reply:

```js
await memory.remember('Never risk more than 2% per trade', {
  tags: ['strategy'],
  pinned: true, // → working tier, always in context
});

const ctx = await memory.context();
console.log(ctx.tokens, '/', ctx.budget, 'tokens in core'); // → 41 / 2000
```

Walk the entity graph the store mined for you:

```js
const { nodes, edges } = await memory.graph();
// nodes: [{ kind: 'strategy', label: 'Never risk more than 2%…', mentions: 1 }, …]
```

## API

### `new AgentMemory(options)`

| Option | Type | Default | Notes |
|---|---|---|---|
| `agentId` | `string` | — | **Required.** The agent these memories belong to. |
| `token` | `string` | — | Bearer token for writes (or use cookie session in-browser). |
| `baseUrl` | `string` | `https://three.ws` | Override for self-host / preview. |
| `fetch` | `typeof fetch` | global `fetch` | Inject a custom fetch (e.g. an x402 payer). |

### `remember(content, options?) → Promise<Memory>`

Store (or upsert) a memory. Wraps `POST /api/agent-memory { agentId, entry }`.

| Option | Type | Default | Notes |
|---|---|---|---|
| `type` | `'user' \| 'feedback' \| 'project' \| 'reference'` | `'project'` | Memory category. Invalid values fall back to `project`. |
| `tags` | `string[]` | `[]` | Topic tags — also mined into entity/topic nodes. |
| `context` | `object` | `{}` | Structured fields (`{ mint, symbol, wallet }`) extracted as entities. |
| `salience` | `number` | `0.5` | Importance, `0..1`. Drives ranking and tier. |
| `pinned` | `boolean` | `false` | Pin to the working core (forces `tier: 'working'`). |
| `tier` | `'working' \| 'recall' \| 'archival'` | auto | Defaults: pinned → `working`, low-salience reference → `archival`, else `recall`. |
| `id` | `string` | — | Pass to upsert an existing memory idempotently. |
| `expiresAt` | `number \| string` | — | Auto-expiry timestamp. |

Returns the stored `Memory` (see [shape](#memory-shape)). Content is capped at
10,000 chars. Changing an existing memory's content resets its vector and mined
entities, so it re-indexes on the next read.

### `recall(query, options?) → Promise<Memory[]>`

Semantic search over the agent's memories. Wraps `POST /api/memory/search`.

| Option | Type | Default | Notes |
|---|---|---|---|
| `topK` | `number` | `8` | Max results, clamped `1..50`. |
| `minScore` | `number` | `0.25` | Min cosine similarity, `0..1`. |
| `tiers` | `string[]` | all | Restrict to e.g. `['working', 'recall']`. |
| `type` | `string` | all | Restrict to one memory type. |

Each result carries a `score` (cosine, 4-dp) and `match` of `'semantic'` or
`'lexical'`. Results are semantic-first, then back-filled with salience-ranked
substring hits so a query is never empty just because a provider is down.
Hits are ordered by `rankScore`, the score times an outcome weight. When a memory was recalled into a decision (a snipe, for example) and that position later closed, the realized P&L is written back onto it; `outcome` reports `{ weight, samples, wins, losses, netPnlUsd, lastClosedAt }`. The weight is bounded to 0.65..1.35, halves every 45 days, and is never zero, so a memory tied to a loss ranks lower but is still returned as a warning.
Recalling a memory bumps its `accessCount` and salience slightly — the
recency/reinforcement loop the tiers rely on.

### `entities(options?) → Promise<Entity[]>`

The knowledge-graph nodes the agent's memories mention. Convenience over
`graph()` — returns `nodes` ranked by mention count.

### `graph() → Promise<{ nodes, edges, stats }>`

The full temporal knowledge graph. Wraps `GET /api/memory/graph`. `nodes` are
entities (`kind` ∈ `mint | ticker | wallet | person | strategy | topic`);
`edges` are co-occurrence links weighted by how often two entities share a
memory. Lazily mines any not-yet-processed memories on read.

### `memoriesFor(entityId, options?) → Promise<Memory[]>`

Memories that mention a given entity node. Wraps
`GET /api/memory/graph?entityId=`. Powers node drilldown ("what does my agent
remember about this mint?").

### `context() → Promise<Context>`

The "in-context now" working set: pinned + working-tier memories with a live
token budget. Wraps `GET /api/memory/context`.

```ts
type Context = {
  entries: Memory[];
  tokens: number;       // estimated tokens in the working core
  budget: number;       // 2000 — the working-core token budget
  overBudget: boolean;  // tokens > budget
  counts: { total, working, recall, archival, embedded };
};
```

### `list(options?) → Promise<Memory[]>`

Every memory for the agent (newest, salience-first). Wraps
`GET /api/agent-memory?agentId=`. Options: `type`, `since` (ms), `limit`
(≤ 500, default 200).

### Curation

Owner-only edits over `POST /api/memory/curate`:

| Method | Op | Effect |
|---|---|---|
| `pin(id)` / `unpin(id)` | `pin` / `unpin` | Move in/out of the working core. |
| `retier(id, tier)` | `tier` | Set `working \| recall \| archival`. |
| `setSalience(id, n)` | `salience` | Set importance, `0..1`. |
| `edit(id, { content?, tags? })` | `edit` | Re-embeds + re-mines on content change. |
| `merge([target, ...dupes])` | `merge` | Fold duplicates into one; re-indexes. |
| `forget(id)` | `forget` | Delete a memory. |

### Memory shape

```ts
type Memory = {
  id: string;
  type: 'user' | 'feedback' | 'project' | 'reference';
  content: string;
  tags: string[];
  context: object;
  salience: number;            // 0..1
  tier: 'working' | 'recall' | 'archival';
  pinned: boolean;
  embedder: string | null;     // e.g. "nvidia/nv-embedqa-e5-v5@1024"
  hasEmbedding: boolean;
  accessCount: number;
  tokens: number;              // ~chars/4
  createdAt: number; updatedAt: number;
  lastAccessedAt: number | null; expiresAt: number | null;
  // recall() only:
  score?: number | null;       // cosine, or null for a lexical hit
  match?: 'semantic' | 'lexical';
  rankScore?: number;          // order key: score (or salience) x outcome.weight
  outcome?: { weight: number; samples: number; wins: number; losses: number; netPnlUsd: number; lastClosedAt: string | null };
};
```

## How it works

Three layers turn a string into durable, recall-able memory — a write path, a
read-triggered indexing pass, and a query path:

```
 remember(text) ──▶ POST /api/agent-memory ──▶ agent_memories (Postgres)
                                                     │
        read of recall()/graph() triggers lazy indexing (best-effort, bounded)
                                                     ▼
        ┌──────────────── embed ────────────────┐   ┌──────── mine ────────┐
        │ NIM nv-embedqa-e5-v5 @1024 (free)      │   │ deterministic entity │
        │  → OpenAI text-embedding-3-small @256  │   │ extraction (no LLM)  │
        │ vector tagged with its embedder        │   │ → entity nodes+links │
        └────────────────────┬───────────────────┘   └──────────┬──────────┘
                             ▼                                   ▼
 recall(query) ──▶ cosine within the SAME vector space ──▶ ranked Memory[]
                   (lexical + salience fallback)        graph(): nodes + edges
```

- **Tiers (Letta/MemGPT model).** `working` is the small, always-in-context core
  (pinned + active rules), token-budgeted at **2000** tokens. `recall` is recent,
  searchable interactions. `archival` is the long-term store. A new memory's tier
  is chosen for you unless you set it.
- **Free-first embeddings.** New writes embed with NVIDIA NIM `nv-embedqa-e5-v5`
  (1024-dim, free with one `NVIDIA_API_KEY`); OpenAI `text-embedding-3-small` at
  256 dims is the paid backstop. Embedding happens lazily on read, in bounded
  batches, so no write blocks on a provider.
- **One space, never crossed.** Every vector is stored tagged with the exact
  model that produced it. A query is embedded once per stored space and cosine
  runs strictly within each — vectors of different dimensionality score `0`, never
  a plausible-looking garbage similarity.
- **Auto-mined graph.** Each memory is pattern-matched (deterministic, dependency-
  free) for mints, `$TICKER` cashtags, wallet addresses, `@handles`, and trading
  strategies. Entities become graph nodes; co-occurrence within a memory becomes
  a weighted edge.

## Auth & errors

Reads are **owner-only**: anonymous or non-owner requests get an empty result
(an empty array / zeroed context), never a leak and never a 401 that spams a
public embed console. Writes require auth and surface as a thrown
`MemoryError` with a `code`:

| `code` | HTTP | Meaning | Recovery |
|---|---|---|---|
| `unauthorized` | 401 | Write with no session / token. | Pass a `token`, or sign in. |
| `forbidden` | 403 | Agent isn't yours. | Use an `agentId` you own. |
| `not_found` | 404 | Agent or memory doesn't exist. | Check the id. |
| `id_conflict` | 409 | Upsert id already used by another agent. | Omit `id` to mint a new one. |
| `validation_error` | 400 | Missing `agentId` / `content` / bad field. | Fix the input. |

Browser writes also need a CSRF token (handled automatically by the three.ws
session cookie flow); server-to-server calls authenticate with a bearer
`token`.

## Examples

**Agent loop — remember every turn, recall before replying:**

```js
const memory = new AgentMemory({ agentId, token });

async function onUserMessage(text) {
  const recalled = await memory.recall(text, { topK: 5 });
  const reply = await llm(text, { memories: recalled.map((m) => m.content) });
  await memory.remember(`User said: ${text}\nAgent: ${reply}`, { type: 'user' });
  return reply;
}
```

**Record a trade with structured context — it extracts the entities for you:**

```js
await memory.remember('Sniped a fresh launch, took profit at 3x', {
  tags: ['trade', 'lesson'],
  salience: 0.8,
  context: { mint: 'THREEsynthetic1111111111111111111111111111', symbol: '$THREE' },
});

const { nodes } = await memory.graph(); // mint + ticker nodes now linked
```

**Curate the working core so it stays under budget:**

```js
const ctx = await memory.context();
if (ctx.overBudget) {
  // demote the least-salient working memory to recall
  const weakest = ctx.entries.sort((a, b) => a.salience - b.salience)[0];
  await memory.retier(weakest.id, 'recall');
}
```

## Related

- [`@three-ws/forge`](https://www.npmjs.com/package/@three-ws/forge) — give your remembering agent a body: text/image → rig-ready 3D GLB.
- [`@three-ws/avatar`](https://www.npmjs.com/package/@three-ws/avatar) — render and animate that agent in the browser.
- [`@three-ws/x402-fetch`](https://www.npmjs.com/package/@three-ws/x402-fetch) — inject a paying `fetch` for paid three.ws lanes.

---

<p align="center">Built by <a href="https://three.ws">three.ws</a> · The only coin is <a href="https://three.ws">$THREE</a></p>
