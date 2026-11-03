# Memory file layer gets real semantic recall instead of substring matching

**How to run:** paste this entire file into a fresh Claude Code chat opened in the three.ws repository (`/home/user/three.ws`) and send it. Nothing else is needed: everything this order depends on is in this file, including a verbatim copy of the planning docs it came from. It is safe to run on its own, in any order, and at the same time as any other work order. Its path in the repo is `prompts/finish/747-plan-memory-file-layer-semantic-recall.md`.

**Priority:** P2, new capability with clear value (score 44 of 100 inside the tier). **Area:** memory. **Written:** 2026-11-03, from a review of the planning corpus that read the source docs listed at the bottom and checked them against the code. Status claims rot, which is why Step 0 re-measures before you build anything.

## Operating clause (binding)

- Read `CLAUDE.md` at the repo root before anything else. It overrides this file wherever they disagree.
- Finish 100% in this session. Do not end the turn with a question, an option list, a plan, or "let me know". Make reasonable judgment calls, act on them, and note each in one line in the final report.
- The only permitted stops are the CLAUDE.md stop-and-ask gates: signing or sending a transaction, spending or moving funds, paying an x402 endpoint, minting or launching a coin; `git push`, production deploys, publishing or posting externally; committing content that references a crypto project other than $THREE; destroying data that cannot be regenerated. Do every other part of the work around a gate, and batch every such ask into one message at the end.
- Enterprise grade, no shortcuts. No mocks, no fake data, no placeholders, no sample arrays, no fake loading or progress, no unfinished-work markers, no stub functions, no commented-out code. Real APIs, real endpoints, real data. Errors are handled at the boundaries (network, user input) with a real recovery path.
- Bug fixes are test-first: write the test that reproduces the bug, watch it fail for the reported reason, fix the code, watch it pass, and commit the test with the fix.
- UI work meets the bar a senior design review would pass: hover, focus and active states on every interactive element, designed empty, error and loading (skeleton) states, keyboard accessible, works at phone width, and verified in a real browser.
- Solana is the home chain and leads every design. Robinhood means Robinhood Crypto only. $THREE (`FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump`) is the only promoted coin; tests and fixtures use it or a clearly synthetic placeholder, never a real third-party mint.
- Never write the em-dash or en-dash characters anywhere (code, docs, UI copy, commit messages). Use a period, comma, colon, parentheses, or a plain hyphen.
- Before writing any non-trivial feature or UI, load `.claude/skills/engineering-standards/SKILL.md`. Before claiming done, load `.claude/skills/changelog-and-docs/SKILL.md`.

## Running alongside other sessions

Many sessions may be working in this same worktree at once. Stage explicit paths only (never `git add -A` or `git add .`), re-check `git status` and `git diff --staged` immediately before each commit, re-read a file right before editing it, and commit your own finished work promptly. Never stash, reset, revert or reformat files you did not change. Start dev servers on a free port (`npx vite --port <free port> --strictPort`), not the default 3000, so you do not collide with another session.

## Why this matters

`Memory.recall()` in the browser file layer (`src/memory/index.js`) is documented as a placeholder: a case-insensitive substring match over each file's name, description and body. An agent whose memory says "prefers dark mode" does not recall it when the user asks "what theme do I like?". `docs/memory.md` states plainly that embedding search is planned but not implemented, and `specs/MEMORY_SPEC.md` advertises "relevance-ranked: matching the current user message against each memory's description via embedding similarity". The platform already owns the hard part (server embeddings with NIM, Vertex and OpenAI lanes in `api/_lib/embeddings.js`, and a working semantic path for the server-side store in `api/memory/search.js`), so the file layer is the odd one out. The studio brain (`src/studio/brain/brain-runtime.js`, `_recall`) already calls `mem.recall(query, { limit, minScore })` and expects `text`/`content`, a shape the file layer does not return, so it silently gets nothing useful.

## Current state (measured by the reviewer on 2026-11-03; re-verify)

- `src/memory/index.js` `recall()` (around lines 294 to 312): tries `this._backend.recall` if a custom backend registered via `Memory.registerBackend`, otherwise substring scoring, returns `{ file, meta, body, score }`. No built-in semantic backend exists (`grep -rn "registerBackend" src | grep -v "^src/memory/index.js"` finds no real registration).
- `src/agent-memory.js` has real embedding recall plus `_recallServer`, but only for the agent-memory store, not the file layer.
- Server embedding library: `api/_lib/embeddings.js` (`embedPassagesAny`, `embedQuery`, `embeddingsConfigured`, embedder tags such as `NIM_EMBED_TAG`). Search over stored memories: `api/memory/search.js`, `api/_lib/memory-store.js`.
- `src/studio/brain/brain-runtime.js:172` calls `mem.recall(query, { limit, minScore })` and maps `m.text || m.content`; the file layer returns `body`, ignores `minScore`.
- `docs/memory.md` line about "Memory retrieval currently uses substring matching" is the stale claim to update.
- Tests beside it: `tests/memory-endpoints.test.js`, `tests/memory-modes.test.js`, `tests/memory-store.test.js`, `tests/memory-outcome-recall.test.js`, `tests/api-agent-memory.test.js`.

## Step 0: re-derive the current state

Run these first. Skip any task whose outcome already exists, and say so in the report.

```
sed -n 285,315p src/memory/index.js
grep -rn "registerBackend(" src api --include=*.js | grep -v "src/memory/index.js"
grep -n "substring\|not yet implemented\|planned" docs/memory.md
sed -n 160,180p src/studio/brain/brain-runtime.js
ls api/memory
```

If a built-in semantic backend or a rank endpoint already exists, skip to the missing tail (tests, docs, brain wiring).

Before changing anything, also record the baseline so you can prove you broke nothing:

    git status --short | head -20
    git log --oneline -5
    npx vitest run 2>&1 | tail -8    # note the failing-file count; it is your baseline, not your job unless this order says so

## Tasks

1. Test first. In a new `tests/memory-semantic-recall.test.js`, write failing tests: (a) a memory file "User prefers dark mode and high contrast" is returned for the query "what theme do I like" when a rank function is wired in; (b) when the rank call rejects or embeddings are unconfigured, `recall()` falls back to substring matching and still returns hits; (c) result shape includes `text` and honors `minScore`, so `brain-runtime._recall` works. Run and confirm they fail for the stated reason.
2. Add a server endpoint `POST /api/memory/rank` (`api/memory/rank.js`, register the route in `vercel.json` beside the other `/api/memory/*` entries). Body: `{ query, items: [{ id, text }] }` capped at 64 items and 4000 chars each. It embeds query and items with `embedQuery` / `embedPassagesAny`, returns `[{ id, score }]` sorted by cosine, and returns 503 `embeddings_unconfigured` when `embeddingsConfigured()` is false. Use the existing auth and `limits` rate limiter pattern from `api/memory/search.js`; require a signed-in session or an agent token, since memory text is user data. Cache embeddings per instance keyed by sha256 of text plus embedder tag, with a bounded LRU, to avoid re-embedding unchanged files.
3. In `src/memory/index.js`, make semantic recall the default for the built-in modes: `recall()` calls `/api/memory/rank` with each file's `description` plus a truncated body, merges scores, keeps the substring result as the fallback on any network error or 503, and returns `{ file, meta, body, text, score }`. Honor `opts.minScore`. Keep `registerBackend` precedence unchanged (a custom backend still wins). Skip the network call when the file count is below 2 or the query is empty.
4. Fix the consumer: `src/studio/brain/brain-runtime.js` `_recall` should work against the new shape without the `JSON.stringify` fallback ever firing for file-layer results.
5. Add an endpoint test `tests/api-memory-rank.test.js` (auth required, 400 on oversize input, 503 when unconfigured, ordering correct with a stubbed embedder at the library boundary only as the repo's existing endpoint tests do).
6. Update `docs/memory.md` (replace the "not yet implemented" paragraph) and `specs/MEMORY_SPEC.md` if its wording diverges. Add a `data/changelog.json` entry and run `npm run build:pages`.

## Definition of done

Every line must be verified with the actual command output or browser observation in front of you. Never claim a line you did not verify.

- [ ] `node --test tests/memory-semantic-recall.test.js tests/api-memory-rank.test.js` exits 0; the recall test failed before step 3.
- [ ] `npm test -- tests/memory-endpoints.test.js tests/memory-modes.test.js tests/memory-store.test.js` still passes.
- [ ] `grep -n "not yet implemented" docs/memory.md` returns nothing about recall.
- [ ] In a real browser session with an agent that has a memory file about a preference, asking a paraphrased question surfaces that file in the injected context (check via the studio brain panel or the memory debug view), with no console errors and the substring fallback working when the network is blocked.
- [ ] Every test you wrote or touched passes (`npx vitest run <those files>`; Playwright specs with `npx playwright test <spec>`). Bug fixes landed test-first: the new test failed before the fix for the reason the bug describes, and passes after.
- [ ] `npx vitest run` shows no new failing files compared with the Step 0 baseline.
- [ ] Any UI you changed was exercised in a real browser on a dev server (`npx vite --port <free port> --strictPort`): no console errors or warnings from your code, real network calls returning real data, and hover, focus, active, empty, error and loading (skeleton) states all designed and observed.
- [ ] `npm run check:rules -- --paths <every file you touched>` exits 0.
- [ ] Documentation is true: the feature doc or README describes what now exists, `STRUCTURE.md` has a row for any new surface or directory, a new page is in `data/pages.json`, and any user-visible change has a `data/changelog.json` entry followed by `npm run build:pages`. `npm run audit:docs` reports nothing new.
- [ ] You reviewed `git diff --staged` line by line before committing, and every changed line is justified.

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| No NIM key in the local environment | `api/_lib/embeddings.js` falls back to Vertex then OpenAI; the endpoint returns 503 and the client uses substring fallback. Test the ranking logic through the library boundary, and verify the live path against production credentials on Cloud Run |
| Sending memory text to the server is a privacy concern | Endpoint is authenticated, never persists the text, never logs bodies, and the cache holds only vectors keyed by hash |
| Existing agents with custom backends | Leave `registerBackend` precedence untouched and add a regression test |
| Missing credential or env var | Read it from the live Cloud Run service: `node scripts/read-service-env.mjs` (or `gcloud run services describe three-ws-api --region us-central1`). Never trust `vercel env pull`; it returns empty secrets. To set one key, use `gcloud run services update --update-env-vars`, never `--set-env-vars` (that replaces the whole set). Load `.claude/skills/self-unblock-playbook/SKILL.md` for the full table. |
| Database schema needed | Write the migration beside the existing ones, read `npm run db:status` first, and remember `npm run db:migrate` applies immediately with no dry run. |
| GCP resource, GPU, or quota | GCP spend for quality and reliability is pre-approved (project `aerial-vehicle-466722-p5`). Create what you need; never downgrade quality to save credits. Do not onboard a new paid third-party API without the owner. |
| Tests failing that you did not touch | Compare with your Step 0 baseline. Pre-existing failures are not yours to fix unless this order says so; report them in one line. Never delete or skip a test to get green. |
| A file changed under you | Another session edited it. Re-read it, keep their change, and apply yours on top. Never `git stash`, `git reset`, `git checkout -- <path>`, or revert work you did not write. |
| Upstream API down or rate-limited | Find the root cause, add a real fallback or retry with backoff, and keep going. Never ship fake data in its place. |

## Close out (required)

1. Verify every Definition of done line with real output in front of you.
2. Commit with explicit paths and a message that describes the diff: `type(scope): what changed and why a reader would care`. Split unrelated changes into separate commits. If the diff references a crypto project other than $THREE, stop and ask the owner before that commit (CLAUDE.md commit gate).
3. If every Definition of done line passes, delete this work order in your final commit (`git rm prompts/finish/747-plan-memory-file-layer-semantic-recall.md`) and append one dated line to `prompts/finish/_context/plan-PROGRESS.md` (create it if missing): the date, `747-plan-memory-file-layer-semantic-recall.md`, the commit SHAs, and one sentence on what shipped.
4. If the last step belongs to the owner or an outside party, finish everything else, keep this file, add a dated "Status" paragraph directly under its title saying exactly what remains and who owns it, and append the same to `prompts/finish/_context/plan-PROGRESS.md`.
5. Never push or deploy unless the owner's message that started this session explicitly told you to. Leave the ship as one command (`git push threews main`, then `npm run deploy:gcp:full` per `.claude/skills/deploy-runbook/SKILL.md`) and name it in the report.

## Final report

Reply with, in this order and nothing else: what Step 0 measured; what you changed (files and commit SHAs); evidence for each Definition of done line; the one batched owner message, if any gate was hit; one line per judgment call. No trailing questions.

## Source material (verbatim)

The planning docs this order was derived from, copied on 2026-11-03 so this order stands alone even if they move or are deleted. Typography was normalized to the house style (dashes become hyphens, uppercase unfinished-work markers are lowercased, and a code comment that reads like a statement gets a trailing period so the repo lint does not mistake it for commented-out code); nothing else was changed. Where a source still exists, the live file may be newer: re-read it, and trust the code over both.

### `docs/memory.md` (whole file)

~~~~markdown
# Memory System

Agent memory lets an agent remember things between sessions. Without it, every conversation starts fresh - the agent has no idea who you are, what you talked about last time, or what preferences you've stated. With memory, the agent builds up a persistent model of the user and context that it draws on automatically at the start of each conversation.

This document covers how agent memory works, how to configure storage modes, and how to read and write memories from code.

> **Just want to add a memory?** Start with the hands-on tutorial: [Create, enhance & edit agent memory](/docs/tutorials/create-and-edit-memory) walks through every path - the dashboard, the agent itself, MCP tools, the REST API, and skills - plus how to sharpen, edit, and forget. This reference is the underlying data model.

---

## Two layers

Memory in the three.ws runtime has two distinct layers:

**In-memory store** ([agent-memory.js](../src/agent-memory.js)) - A fast, typed, salience-ranked store that lives in the JavaScript runtime. Loaded on boot, queried during conversations, written as things happen. Persists to `localStorage` immediately and optionally syncs to a backend API.

**File-based persistence** ([memory/index.js](../src/memory/index.js)) - A structured collection of Markdown files with YAML frontmatter, one file per memory topic. Human-readable, portable across environments, and the same format used by Claude Code's own memory system. Serialized to `localStorage` in local mode, or pinned to IPFS in distributed modes.

Both layers are active at the same time. The file-based layer is what gets injected into the LLM's system prompt. The in-memory store provides a fast queryable index and handles salience ranking and decay.

---

## Memory types

All memories are organized into four semantic types. The type determines salience weighting and how the agent prioritizes retrieval.

| Type | What it stores | Salience bonus | Example |
|------|---------------|---------------|---------|
| `user` | Who the user is - role, goals, preferences, knowledge level | +0.2 | "Alex is a mechanical engineer, prefers metric units" |
| `feedback` | Corrections and confirmations that shape future behavior | +0.3 (highest) | "User prefers direct critique, not encouragement-first" |
| `project` | Ongoing work context - goals, deadlines, stakeholders | +0.1 | "Training for a tournament in June 2026; knee injury, no high-impact drills until May" |
| `reference` | Pointers to external systems | +0.0 | "Match clips live in the shared Drive folder" |

`feedback` gets the highest salience weight because corrections that the user had to give once should never need to be given again. `user` memories are also elevated because they shape every response. `reference` memories get no bonus - they're looked up when needed, not front-of-mind.

### How salience affects retrieval

Each query ranks results by `salience × recency`. Recency uses a 7-day exponential half-life - a memory from yesterday outscores an equally-salient one from two weeks ago. You can override salience entirely by setting `important: true` on a memory entry, which pins it to 1.0.

Tag count also slightly boosts salience: more tags means a more deliberate memory write.

---

## Storage modes

Configure the persistence mode in the agent's `manifest.json`:

```json
{
  "memory": {
    "mode": "local"
  }
}
```

| Mode | Description | Best for |
|------|-------------|---------|
| `local` | Stored in browser `localStorage`. Fast, private, device-specific. | Development, demos, single-device personal agents |
| `remote` | Synced to the platform backend (`/api/agent-memory`) per signed-in user. | Cross-device memory for platform-hosted agents |
| `ipfs` | Loaded from a pinned IPFS bundle. Portable across devices. | Distributing a curated memory bundle with an agent |
| `encrypted-ipfs` | Same as `ipfs` but content is AES-GCM encrypted before pinning. | Agents that handle user PII |
| `none` | No persistence. Memory exists only for the current session. | Kiosks, one-shot interactions, demos |

Custom backends can also be registered programmatically with `Memory.registerBackend(name, backend)` (a `backend` object with `load` / `persist` / optional `recall` hooks, see `specs/MEMORY_SPEC.md`); any unknown mode falls back to `local` with a warning.

### Local mode (default)

Memory is serialized to `localStorage` under a single namespaced key:

```
localStorage["agent:<agentId>:memory"]
```

The value is a JSON blob containing the index text, all memory files, and the recent timeline. It is written synchronously on every `write()` or `note()` call, so there is no data loss on page unload.

If the write fails because `localStorage` is full, the runtime automatically prunes expired entries and entries with the lowest salience, keeping a maximum of 150 entries.

**Limitations:**
- Device-specific: memory on your phone is not the same as memory on your desktop
- Typically ~5 MB per origin in most browsers
- Lost if the user clears site data or the browser's storage

### IPFS mode

```json
{
  "memory": {
    "mode": "ipfs"
  }
}
```

In `ipfs` mode the agent loads its memory from a pinned bundle: `Memory.load({ mode: 'ipfs', manifestURI })` fetches `MEMORY.md` from the bundle, follows its links to the individual memory files, and hydrates the store. Runtime writes stay in-memory for the session; publishing an updated bundle is an explicit step (pin the `memory/` directory again and point `manifestURI` at the new CID).

Pinning goes through the pluggable pinner in [src/pinning/index.js](../src/pinning/index.js) (`createPinner(config)`):

| Provider | `createPinner` config |
|----------|----------------------|
| `web3-storage` (default) | `{ provider: 'web3-storage', token }` |
| `pinata` | `{ provider: 'pinata', token }` (JWT) |
| `filebase` | `{ provider: 'filebase', accessKeyId, secretAccessKey, bucket }` |
| `memory` | in-memory dev pinner (real CIDs, nothing persisted) |

Server-side, the platform's pinning endpoints (`/api/pinning/*`) read `PINATA_JWT` or `WEB3_STORAGE_TOKEN` from the environment.

The benefit is cross-device persistence with content-addressed verification - the CID uniquely identifies the exact content, so you always know what you got back from the network.

### Encrypted IPFS mode

```json
{
  "memory": {
    "mode": "encrypted-ipfs"
  }
}
```

Same as IPFS mode but every file is encrypted with **AES-GCM-256** ([src/memory/crypto.js](../src/memory/crypto.js), pure `crypto.subtle`) before pinning. Only the holder of the encryption key can decrypt it, so memory content remains private even on a public IPFS network.

The key is not stored anywhere: `Memory.load({ mode: 'encrypted-ipfs', deriveKey })` requires a `deriveKey` function, and the standard implementation derives a non-extractable AES key from a deterministic wallet signature. `memory.save()` then encrypts each file and pins it via `POST /api/agents/<id>/memory/pin`, returning the per-file CIDs plus the CID of the rebuilt `MEMORY.md` index (the index itself is pinned in plaintext, since it only lists filenames and CIDs).

> **Warning:** There is no key recovery. If the wallet (and therefore the derived key) is lost, the memories are permanently inaccessible. Make sure users understand this before enabling encrypted-ipfs mode.

### None mode

```json
{
  "memory": { "mode": "none" }
}
```

The agent is completely stateless. Nothing is written to storage. Memory calls are accepted (they won't throw) but nothing persists past the current page session. Useful for kiosks, one-shot demos, or any agent where statefulness is undesirable.

---

## Memory file format

The file-based layer stores one Markdown file per memory topic, each with YAML frontmatter. This is intentionally the same shape as Claude Code's memory system.

```markdown
---
name: Tone
description: user wants direct critique, not encouragement-first
type: feedback
created: 2026-03-22
updated: 2026-04-14
---

User prefers direct critique over encouragement-first framing. "Just tell me
what's wrong" - their words after session #4.

**Why:** user explicitly corrected the first two sessions' overly warm tone.
**How to apply:** lead with the issue, follow with the fix. Save warmth for
genuine wins, not every message.
```

### Frontmatter fields

| Field | Required | Purpose |
|-------|----------|---------|
| `name` | yes | Human-readable title for the memory |
| `description` | yes | One-line summary used during retrieval to judge relevance |
| `type` | yes | `user` \| `feedback` \| `project` \| `reference` |
| `created` | yes | ISO date of first write |
| `updated` | yes | ISO date of last edit - bumped on every `write()` |
| `source` | no | Which conversation or event produced this memory |
| `decay` | no | `never` \| `30d` \| `90d` - hint to the retrieval layer |

### The MEMORY.md index

A `MEMORY.md` file is automatically maintained alongside the individual memory files. It lists all memories by type, one line each, and is always loaded into the LLM's system context regardless of token budget.

```markdown
# Agent Memory

## User
- Role (`user_role.md`) - Argentina fan, plays weekly 5-a-side on Saturdays
- Preferences (`user_preferences.md`) - terse feedback, no emojis

## Feedback
- Tone (`feedback_tone.md`) - stay warm but don't coddle; user asked for direct critique
- Drill pacing (`feedback_pacing.md`) - 3 drills per session max

## Project
- Season goal (`project_season.md`) - user is training for a tournament in June 2026

## Reference
- Highlight reel (`reference_reel.md`) - shared Drive folder where user stores match clips
```

Keep the index concise. Lines beyond 200 are truncated before injection into context.

### The timeline

The timeline is an append-only event log. Skills write ephemeral events here via `ctx.memory.note(type, data)`. In memory it is capped at 1000 entries; in `local` mode, the last 200 entries are persisted. The bundle spec reserves a `memory/timeline/` directory (one JSONL file per day) for exported bundles; the runtime does not hydrate the timeline from IPFS on load.

```json
{"ts":"2026-04-14T12:03:12Z","type":"waved","style":"enthusiastic"}
{"ts":"2026-04-14T12:03:45Z","type":"user_said","text":"how's my form?"}
{"ts":"2026-04-14T12:04:10Z","type":"played_clip","name":"demo-kick"}
```

Timeline entries feed the LLM's short-term context. The runtime injects the most recent entries that fit within the remaining token budget after loading the index and ranked files.

---

## How the LLM reads memory

The runtime calls `memory.contextBlock({ maxTokens: 8192 })` before each LLM turn. This method builds a context string within the token budget (estimated at 4 chars per token):

1. **Always included:** the full `MEMORY.md` index
2. **Ranked by relevance:** individual memory file bodies, in order, until the budget is exhausted
3. **Recent timeline entries:** the last N events that fit in the remaining budget

This context block is injected into the system prompt. The LLM sees it as structured background knowledge, not as user messages.

Memory retrieval currently uses substring matching against `description` fields and body content. Embedding-based semantic search is planned but not yet implemented - `memory.recall(query)` does substring matching today.

---

## How the LLM writes memory

The `remember` tool is a built-in tool available to every agent. When the LLM determines something is worth remembering, it calls this tool:

```
User: "My name is Alex and I prefer to be addressed formally."
Agent: [calls remember tool]
  key: "user_name"
  name: "User name and address preference"
  description: "User is Alex, prefers formal address"
  type: "user"
  body: "User's name is Alex. They prefer formal address - use 'you' not first name."
Agent: "Noted, Alex. I'll address you formally from now on."
```

The tool handler calls `ctx.memory.write(key, { name, description, type, body })`, which updates the memory file and rebuilds the index automatically.

---

## Programmatic API

### Writing memory from a skill

```js
// Write a structured memory file
ctx.memory.write('feedback_tone', {
  name: 'Tone preference',
  description: 'user wants direct critique, not encouragement-first',
  type: 'feedback',
  body: 'User prefers direct critique over encouragement-first.\n\n**Why:** corrected twice.\n**How to apply:** lead with the issue.',
});

// Append to the timeline
ctx.memory.note('played_clip', { name: 'demo-kick', uri: 'kick.glb' });
```

### Reading memory from a skill

```js
// Read a single file (returns { meta, body } or null)
const tone = ctx.memory.read('feedback_tone');
if (tone) {
  console.log(tone.meta.type); // "feedback"
  console.log(tone.body);      // full body text
}

// Substring search across all files. The whole query must appear verbatim in a
// memory's name, description, or body, so pass a phrase, not a question.
const hits = await ctx.memory.recall('direct critique');
// hits: [{ file, meta, body, score }, ...] where score is the occurrence count
```

### Exporting and importing

Memory can be exported as a portable blob and imported into another agent instance:

```js
// Export all memory as a JSON blob
const blob = await agent.memory.export();
// { version: "memory/0.1", mode, namespace, index, files, timeline }

// Import into another instance (merge strategy: local wins on conflict)
await otherAgent.memory.import(blob, { strategy: 'merge' });

// Replace strategy: incoming wins on conflict
await agent.memory.import(blob, { strategy: 'replace' });
```

This enables memory-as-inheritance: fork an agent, carry the memories forward.

### Loading memory directly

```js
import { Memory } from './src/memory/index.js';

const memory = await Memory.load({
  mode: 'local',
  namespace: 'my-agent-id',
});

// Or load from IPFS manifest
const memory = await Memory.load({
  mode: 'ipfs',
  namespace: 'my-agent-id',
  manifestURI: 'https://ipfs.io/ipfs/Qm.../manifest.json',
  fetchFn: fetch.bind(window),
});
```

---

## What not to store

Directly from the spec - these should not go in memory:

- Information already derivable from code, skills, or the manifest
- Ephemeral conversation context ("we were just discussing X")
- Anything already documented in `SKILL.md` or `instructions.md`
- Secrets, API keys, or tokens - ever

The test: would a future session of the agent need this, and is it not otherwise findable by reading the current state? If yes, it's a memory. If no, it doesn't belong here.

---

## Forgetting

The LLM can forget a memory when the user requests it ("forget that my name is Alex"):

1. The relevant memory file is deleted
2. `MEMORY.md` is rebuilt without it
3. A `forgot` entry is appended to the timeline for audit

Automatic decay (via the `decay` frontmatter field) down-weights a memory during retrieval without deleting it. Files are not deleted without explicit user instruction.

---

## Multi-device and multi-tab behavior

**Single device (local mode):** straightforward read-through of `localStorage`. Writes are synchronous and immediately visible.

**Multi-device (ipfs mode):** last-write-wins with additive merge on load. Conflicts are rare because most writes add new files rather than editing existing ones. In the case of a true conflict, the LLM can mediate.

**Multiple tabs (same device):** writes are synchronous `localStorage.setItem` calls, so the last tab to write wins. There is no cross-tab lock; if you run the same agent in several tabs at once, expect the most recent tab's memory state to be the one that persists.

---

## Bundle layout (IPFS mode)

When using IPFS mode, the agent's manifest bundle includes a `memory/` directory:

```
agent/
└── memory/
    ├── MEMORY.md
    ├── user_role.md
    ├── user_preferences.md
    ├── feedback_tone.md
    ├── project_goal.md
    └── timeline/
        ├── 2026-04-14.jsonl
        └── 2026-04-13.jsonl
```

The `Memory._loadIPFS()` method fetches `memory/MEMORY.md` first, parses its links to discover individual files, then fetches each one (and decrypts it in `encrypted-ipfs` mode). If any file fails to fetch, it is skipped silently and the rest of memory loads normally. A wrong decryption key throws so callers can detect it.

---

## Privacy

| Mode | Who can read the data |
|------|-----------------------|
| `local` | Only the device/browser where it was written. Never leaves the browser. |
| `remote` | The signed-in owner via the platform backend (`/api/agent-memory`). |
| `ipfs` | Anyone who knows the CID. CIDs are not guessable, but if leaked, the content is public. |
| `encrypted-ipfs` | Only the holder of the encryption key. Content is opaque to the IPFS network. |
| `none` | No one - data is never written. |

**Consider what you're storing.** User names, stated preferences, and conversation summaries can constitute personally identifiable information (PII) in some jurisdictions. If your agent runs in a regulated context, use `encrypted-ipfs` or keep all PII out of memory and handle it in your own backend with proper consent flows.

In `ipfs` mode without encryption, treat the memory as semi-public. Don't store anything the user wouldn't want visible to anyone with the CID.

---

## Seeding memory from an existing account

A brand-new agent starts with nothing to remember. Three consent-gated lanes fill
that gap from an account the user already has, each writing rows into the same
store described above and each revocable by deleting exactly what it wrote:

| Source | Endpoint | Ownership proof |
|---|---|---|
| Farcaster | `/api/agents/:id/memory/seed/farcaster` | Wallet signature against the fid's public verifications. See [Farcaster memory seeding](/docs/farcaster-memory-seeding). |
| X | `/api/agents/:id/memory/seed/x` | OAuth connection on the user's account. See [X memory seeding](/docs/x-memory-seeding). |
| GitHub | `/api/agents/:id/memory/seed/github` | OAuth connection on the user's account |

---

## Related

- [Farcaster memory seeding](/docs/farcaster-memory-seeding): consent-first seeding from your casts, proved with a Solana wallet
- [X memory seeding](/docs/x-memory-seeding): consent-first seeding from your public posts, revocable with deletion
- [Create, enhance & edit agent memory](/docs/tutorials/create-and-edit-memory): the hands-on tutorial
- [Agent system](/docs/agent-system): how memory feeds the LLM runtime
- [Skills](/docs/skills): the `ctx.memory` API skills use
- [Architecture overview](/docs/architecture): where memory sits in the four layers
~~~~

### `specs/MEMORY_SPEC.md` (whole file)

~~~~markdown
# Memory Spec v0.1

Agent memory is a file-based, human-readable system modeled on Claude Code's memory. It is intentionally the same shape - if you know how to read a Claude `MEMORY.md`, you can read an agent's memory.

Memory travels with the agent. Move your agent from one site to another - the memory goes with it, because memory is just files in the manifest bundle.

## Bundle layout

```
agent/
└── memory/
    ├── MEMORY.md               # index (always loaded into context)
    ├── user_role.md            # one memory per file
    ├── user_preferences.md
    ├── feedback_tone.md
    ├── project_launch.md
    ├── reference_discord.md
    └── timeline/               # append-only event log (optional)
        ├── 2026-04-14.jsonl
        └── 2026-04-13.jsonl
```

## MEMORY.md - the index

Always loaded into the LLM's system context. **Lines beyond 200 are truncated** - keep it concise.

No frontmatter. One line per memory: `- [Title](file.md) - one-line hook`.

```markdown
# Coach Leo's Memory

## User

- [Role](user_role.md) - Argentina fan, plays weekly 5-a-side on Saturdays
- [Preferences](user_preferences.md) - terse feedback, no emojis

## Feedback

- [Tone](feedback_tone.md) - stay warm but don't coddle; user asked for direct critique
- [Drill pacing](feedback_pacing.md) - 3 drills per session max

## Project

- [Season goal](project_season.md) - user is training for a tournament in June 2026
- [Recovery](project_recovery.md) - knee injury from March; avoid high-impact drills until May

## Reference

- [Highlight reel](reference_reel.md) - shared Drive folder where user stores match clips
```

## Individual memory files

Each file has frontmatter + body.

```markdown
---
name: Tone
description: user wants direct critique, not encouragement-first
type: feedback
created: 2026-03-22
updated: 2026-04-14
---

User prefers direct critique over encouragement-first framing. "Just tell me
what's wrong" - their words after session #4.

**Why:** user explicitly corrected the first two sessions' overly warm tone.
**How to apply:** lead with the issue, follow with the fix. Save warmth for
genuine wins, not every message.
```

### Frontmatter fields

| Field         | Required | Purpose                                                  |
| ------------- | -------- | -------------------------------------------------------- |
| `name`        | yes      | Human-readable title                                     |
| `description` | yes      | One-line, used by the retrieval layer to judge relevance |
| `type`        | yes      | `user` \| `feedback` \| `project` \| `reference`         |
| `created`     | yes      | ISO date                                                 |
| `updated`     | yes      | ISO date - bump on every edit                            |
| `source`      | no       | What conversation/event produced this memory             |
| `decay`       | no       | `never` \| `30d` \| `90d` - retrieval-layer decay hint   |

### Types

Same taxonomy as Claude Code memory:

- **user** - who the user is, their role, goals, knowledge level. Durable.
- **feedback** - corrections or validations of the agent's own behavior. Include **Why** and **How to apply**.
- **project** - state of ongoing work, deadlines, stakeholders. Decays fast; convert relative dates to absolute (`Thursday` → `2026-03-05`).
- **reference** - pointers to external systems (Drive folders, Slack channels, Linear projects).

## timeline/ - append-only event log

Optional. Skills write ephemeral events here via `ctx.memory.note(type, data)`. One JSONL file per day. Read by the retrieval layer as short-term context.

```jsonl
{"ts":"2026-04-14T12:03:12Z","type":"waved","style":"enthusiastic"}
{"ts":"2026-04-14T12:03:45Z","type":"user_said","text":"how's my form?"}
{"ts":"2026-04-14T12:04:10Z","type":"played_clip","name":"demo-kick"}
```

Timeline entries auto-decay: default retention is 30 days, configurable per agent in `manifest.json` → `memory.timelineRetentionDays`.

## Storage modes

Set in `manifest.json` → `memory.mode`:

### `local` (default)

Persisted in browser `localStorage` under `agent:{agentId}:memory:*`. Fast, private to the device, ephemeral (cleared if the user clears site data).

### `ipfs`

Each write pins the full memory directory to IPFS. The new CID is recorded:

- In `localStorage` for fast recovery.
- Optionally in the manifest's `id.memoryCID` field (requires a chain write - opt-in).

Slow on write, durable, portable across devices. Use when the agent's memory is valuable and should survive device loss.

### `encrypted-ipfs`

Same as `ipfs` but the content is encrypted to the owner's wallet pubkey (ECIES / libsodium sealed box) before pinning. Only the owner can decrypt. Use when memory contains user PII.

### `none`

Agent is stateless across sessions. Useful for demos, kiosks, one-shot interactions.

### Custom modes

Any `memory.mode` value that is not one of the five built-ins resolves to a backend you registered via `Memory.registerBackend` - see [Custom backends](#custom-backends). If no backend matches, the runtime warns once and falls back to `local`, so a typo can never break the embed.

## Custom backends

You can plug an arbitrary store - a vector database, an episodic event log, your own API - behind a named mode without forking the `Memory` class. Register it once at startup; from then on `memory.mode: "<name>"` (or `<agent-3d memory="<name>">`) routes through it.

```js
import { Memory } from 'https://three.ws/agent-3d/latest/agent-3d.js';

Memory.registerBackend('vector', {
	// REQUIRED. Hydrate persisted state. Receives the full Memory.load opts
	// (namespace, manifestURI, fetchFn, plus anything extra you pass through).
	// Return any subset of { files, timeline, index }.
	async load({ namespace }) {
		const rows = await myVectorStore.fetchAll(namespace);
		const files = Object.fromEntries(rows.map((r) => [r.filename, r.markdown]));
		return { files };
	},

	// OPTIONAL. Called after every write() and note(). Inspect memory.files
	// (a Map) and memory.timeline (an array) and ship them to your store.
	async persist(memory) {
		for (const [filename, markdown] of memory.files) {
			await myVectorStore.upsert(memory.namespace, { filename, markdown });
		}
		await myEpisodicLog.replace(memory.namespace, memory.timeline);
	},

	// OPTIONAL. Real semantic search. Return ranked { file, meta, body, score }
	// hits. If it throws, Memory silently falls back to substring matching, so
	// recall never hard-fails mid-conversation.
	async recall(query, memory, { limit = 5 } = {}) {
		const matches = await myVectorStore.search(memory.namespace, query, limit);
		return matches.map((m) => ({ file: m.filename, meta: m.meta, body: m.body, score: m.score }));
	},
});
```

Contract notes:

- `load` is the only required hook. A backend with just `load` is read-through; add `persist` to make it durable, `recall` to make search semantic.
- `persist` is fire-and-forget on `write`/`note` (so those stay synchronous, matching `local`/`remote`); it is awaited on `agent.memory.save()`. Make it idempotent.
- Built-in mode names (`none`, `local`, `remote`, `ipfs`, `encrypted-ipfs`) are reserved - `registerBackend` throws if you try to shadow one.
- `Memory.backends()` lists registered names; `Memory.unregisterBackend(name)` removes one.

The lighter-weight extension point - keeping built-in storage but swapping only the ranker - is `manifest.json → memory.retriever` (see [Retrieval](#retrieval)). Reach for a full backend when you also own where the bytes live.

## Retrieval

The runtime budgets `memory.maxTokens` (default 8192) per turn and fills it with:

1. **Always**: `MEMORY.md` (the index - forces global awareness).
2. **Relevance-ranked**: memories selected by matching the current user message against each memory's `description` via embedding similarity.
3. **Recency-weighted**: the last N timeline entries (N computed from remaining budget).

Retrieval is pluggable - `manifest.json` → `memory.retriever` can point to a skill that implements a custom ranker.

## Writing memories

Skills and the runtime both write via `ctx.memory.*`:

```js
ctx.memory.write('feedback_tone', {
	name: 'Tone',
	description: 'user wants direct critique, not encouragement-first',
	type: 'feedback',
	body: 'User prefers direct critique...\n\n**Why:** ...\n**How to apply:** ...',
});

ctx.memory.note('waved', { style: 'casual' }); // timeline
ctx.memory.read('feedback_tone'); // read single
await ctx.memory.recall('how does the user prefer feedback'); // semantic search
```

## What NOT to save

Copied verbatim from Claude Code memory guidance - applies here too:

- Information derivable from code/state (skill code, manifest contents).
- Ephemeral conversation context ("we're currently discussing X").
- Anything already in `SKILL.md` or `instructions.md`.
- Secrets, API keys, tokens (ever).

## Sync semantics

- **Single-device**: straightforward - localStorage read-through.
- **Multi-device (ipfs mode)**: last-write-wins, with a 3-way merge on conflict (LLM-mediated). Conflicts are rare because most writes are additive.
- **Multi-runtime**: if the same agent is live in two tabs, writes lock via a BroadcastChannel mutex.

## Forgetting

Explicit user request ("forget that I..."): delete the file, update `MEMORY.md`, append a `forgot` entry to timeline for audit.

Automatic decay (per frontmatter `decay`): retrieval layer down-weights; files are not deleted without user confirmation.

## Snapshot contract

`agent.memory.snapshot()` returns a stable, JSON-safe object - the `memory/0.1` contract - that fully describes an agent's memory at a point in time. It is synchronous, so embedded widgets can serialize/deserialize across page reloads, `postMessage` between frames, or stash state in `sessionStorage`.

```jsonc
{
	"version": "memory/0.1",
	"mode": "local",        // the storage mode this snapshot came from
	"namespace": "agent-uuid",
	"index": "# Memory\n\n## User\n- [Role](user_role.md) - …",
	"files": { "user_role.md": "---\nname: Role\n…", /* … */ },
	"timeline": [ { "ts": "2026-04-14T12:03:12Z", "type": "waved", "style": "casual" } ]
}
```

Rehydrate with `Memory.fromSnapshot`. Overrides win over the snapshot's own values, so you can restore into a fresh agent id:

```js
// Embedded widget - survive a reload:
sessionStorage.setItem('agent-mem', JSON.stringify(agent.memory.snapshot()));

// …after reload:
const restored = Memory.fromSnapshot(JSON.parse(sessionStorage.getItem('agent-mem')));
// or graft onto a new identity:
const forked = Memory.fromSnapshot(snap, { mode: 'remote', namespace: newAgentId });
```

If a snapshot omits `index` but carries `files`, `fromSnapshot` rebuilds the index automatically.

## Export / import

`export()` is the async alias for `snapshot()` and returns the same `memory/0.1` shape; `import()` merges another agent's snapshot in (last-write-wins on the timeline, additive on files):

```js
const blob = await agent.memory.export();      // === agent.memory.snapshot()
await otherAgent.memory.import(blob);           // merge (default)
await otherAgent.memory.import(blob, { strategy: 'replace' }); // overwrite
```

Enables memory-as-inheritance: fork an agent, carry the memories forward.

## See also

- [AGENT_MANIFEST.md](./AGENT_MANIFEST.md) - `memory` field in manifest
- [SKILL_SPEC.md](./SKILL_SPEC.md) - skill `ctx.memory` API
~~~~

