# Memory Spec v0.1

Agent memory is a file-based, human-readable system modeled on Claude Code's memory. It is intentionally the same shape — if you know how to read a Claude `MEMORY.md`, you can read an agent's memory.

Memory travels with the agent. Move your agent from one site to another — the memory goes with it, because memory is just files in the manifest bundle.

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

## MEMORY.md — the index

Always loaded into the LLM's system context. **Lines beyond 200 are truncated** — keep it concise.

No frontmatter. One line per memory: `- [Title](file.md) — one-line hook`.

```markdown
# Coach Leo's Memory

## User

- [Role](user_role.md) — Argentina fan, plays weekly 5-a-side on Saturdays
- [Preferences](user_preferences.md) — terse feedback, no emojis

## Feedback

- [Tone](feedback_tone.md) — stay warm but don't coddle; user asked for direct critique
- [Drill pacing](feedback_pacing.md) — 3 drills per session max

## Project

- [Season goal](project_season.md) — user is training for a tournament in June 2026
- [Recovery](project_recovery.md) — knee injury from March; avoid high-impact drills until May

## Reference

- [Highlight reel](reference_reel.md) — shared Drive folder where user stores match clips
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
what's wrong" — their words after session #4.

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
| `updated`     | yes      | ISO date — bump on every edit                            |
| `source`      | no       | What conversation/event produced this memory             |
| `decay`       | no       | `never` \| `30d` \| `90d` — retrieval-layer decay hint   |

### Types

Same taxonomy as Claude Code memory:

- **user** — who the user is, their role, goals, knowledge level. Durable.
- **feedback** — corrections or validations of the agent's own behavior. Include **Why** and **How to apply**.
- **project** — state of ongoing work, deadlines, stakeholders. Decays fast; convert relative dates to absolute (`Thursday` → `2026-03-05`).
- **reference** — pointers to external systems (Drive folders, Slack channels, Linear projects).

## timeline/ — append-only event log

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
- Optionally in the manifest's `id.memoryCID` field (requires a chain write — opt-in).

Slow on write, durable, portable across devices. Use when the agent's memory is valuable and should survive device loss.

### `encrypted-ipfs`

Same as `ipfs` but the content is encrypted to the owner's wallet pubkey (ECIES / libsodium sealed box) before pinning. Only the owner can decrypt. Use when memory contains user PII.

### `none`

Agent is stateless across sessions. Useful for demos, kiosks, one-shot interactions.

### Custom modes

Any `memory.mode` value that is not one of the five built-ins resolves to a backend you registered via `Memory.registerBackend` — see [Custom backends](#custom-backends). If no backend matches, the runtime warns once and falls back to `local`, so a typo can never break the embed.

## Custom backends

You can plug an arbitrary store — a vector database, an episodic event log, your own API — behind a named mode without forking the `Memory` class. Register it once at startup; from then on `memory.mode: "<name>"` (or `<agent-3d memory="<name>">`) routes through it.

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
	// hits. If it throws, Memory falls back to the built-in recall (server embedding rank via `/api/memory/rank`, then substring matching), so
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
- Built-in mode names (`none`, `local`, `remote`, `ipfs`, `encrypted-ipfs`) are reserved — `registerBackend` throws if you try to shadow one.
- `Memory.backends()` lists registered names; `Memory.unregisterBackend(name)` removes one.

The lighter-weight extension point — keeping built-in storage but swapping only the ranker — is `manifest.json → memory.retriever` (see [Retrieval](#retrieval)). Reach for a full backend when you also own where the bytes live.

## Retrieval

The runtime budgets `memory.maxTokens` (default 8192) per turn and fills it with:

1. **Always**: `MEMORY.md` (the index — forces global awareness).
2. **Relevance-ranked**: memories selected by matching the current user message against each memory's `description` via embedding similarity.
3. **Recency-weighted**: the last N timeline entries (N computed from remaining budget).

Retrieval is pluggable — `manifest.json` → `memory.retriever` can point to a skill that implements a custom ranker.

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

Copied verbatim from Claude Code memory guidance — applies here too:

- Information derivable from code/state (skill code, manifest contents).
- Ephemeral conversation context ("we're currently discussing X").
- Anything already in `SKILL.md` or `instructions.md`.
- Secrets, API keys, tokens (ever).

## Sync semantics

- **Single-device**: straightforward — localStorage read-through.
- **Multi-device (ipfs mode)**: last-write-wins, with a 3-way merge on conflict (LLM-mediated). Conflicts are rare because most writes are additive.
- **Multi-runtime**: if the same agent is live in two tabs, writes lock via a BroadcastChannel mutex.

## Forgetting

Explicit user request ("forget that I..."): delete the file, update `MEMORY.md`, append a `forgot` entry to timeline for audit.

Automatic decay (per frontmatter `decay`): retrieval layer down-weights; files are not deleted without user confirmation.

## Snapshot contract

`agent.memory.snapshot()` returns a stable, JSON-safe object — the `memory/0.1` contract — that fully describes an agent's memory at a point in time. It is synchronous, so embedded widgets can serialize/deserialize across page reloads, `postMessage` between frames, or stash state in `sessionStorage`.

```jsonc
{
	"version": "memory/0.1",
	"mode": "local",        // the storage mode this snapshot came from
	"namespace": "agent-uuid",
	"index": "# Memory\n\n## User\n- [Role](user_role.md) — …",
	"files": { "user_role.md": "---\nname: Role\n…", /* … */ },
	"timeline": [ { "ts": "2026-04-14T12:03:12Z", "type": "waved", "style": "casual" } ]
}
```

Rehydrate with `Memory.fromSnapshot`. Overrides win over the snapshot's own values, so you can restore into a fresh agent id:

```js
// Embedded widget — survive a reload:
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

- [AGENT_MANIFEST.md](./AGENT_MANIFEST.md) — `memory` field in manifest
- [SKILL_SPEC.md](./SKILL_SPEC.md) — skill `ctx.memory` API
