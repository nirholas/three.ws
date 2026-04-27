# Agent Task: Write "Memory System" Documentation

## Output file
`public/docs/memory.md`

## Target audience
Developers building agents that need to remember things — user preferences, past conversations, facts. Also relevant for anyone curious about how agent persistence works, including IPFS and encrypted storage.

## Word count
1500–2500 words

## What this document must cover

### 1. What is agent memory?
Agent memory allows a three.ws to remember across sessions. Without memory, every conversation starts fresh. With memory, the agent can:
- Recall a user's name and preferences
- Reference past conversations
- Track what tasks have been completed
- Build a persistent personality over time

Memory has two layers:
- **In-memory store** — fast, typed, available during runtime (agent-memory.js)
- **Persistence backend** — durably stores memory files between sessions (memory/index.js)

### 2. The four memory types
The in-memory store organizes information into four categories:

| Type | Description | Half-life | Example |
|------|-------------|-----------|---------|
| `short-term` | Working memory for the current conversation | Session only | "User asked about pricing" |
| `long-term` | Facts the agent has been told to remember | Permanent | "User's name is Alex, they prefer metric units" |
| `emotional` | History of emotional state changes | Decays over time | "Agent felt celebratory after a successful validation" |
| `action-log` | Timestamped record of every significant action | Permanent | "wave", "validate-model", "remember" |

The LLM runtime reads relevant memory entries and injects them into the system prompt context at the start of each conversation.

### 3. Memory modes
Configure the persistence mode in the agent manifest:

```json
{
  "memory": {
    "mode": "local",
    "provider": "pinata"
  }
}
```

| Mode | Description |
|------|-------------|
| `local` | Stored in browser `localStorage`. Fast, private, device-specific. No backend required. |
| `ipfs` | Pinned to IPFS via a provider (Pinata, Filebase, Web3.Storage). Persistent, portable across devices. |
| `encrypted-ipfs` | Like `ipfs` but content is encrypted before pinning. Private even on public IPFS. |
| `none` | No persistence. Memory exists only for the current session and is lost on reload. |

### 4. Local mode (default)
Stores memory files in `localStorage` using the agent ID as a namespace:

```
localStorage.key: "3dagent:memory:<agentId>:long-term.md"
localStorage.key: "3dagent:memory:<agentId>:action-log.md"
```

Files are stored as markdown with frontmatter (same format as Claude's memory system).

Limitations:
- Device-specific: memory on phone ≠ memory on desktop
- ~5MB per origin limit in most browsers
- Lost if user clears site data

Best for: demos, development, single-device personal agents.

### 5. IPFS mode
Memory files are pinned to IPFS via your configured provider. The latest IPFS CID is stored locally as a pointer; actual content lives on IPFS.

```json
{
  "memory": {
    "mode": "ipfs",
    "provider": "pinata"
  }
}
```

Supported providers:
- **Pinata** — `PINATA_JWT` env var
- **Filebase** — `FILEBASE_KEY` + `FILEBASE_SECRET` env vars
- **Web3.Storage** — `WEB3_STORAGE_TOKEN` env var

How it works:
1. Agent writes a memory entry
2. Memory file updated and pinned to IPFS → new CID returned
3. CID stored locally and optionally in the identity registry
4. On next session: CID fetched → files restored from IPFS

Benefits: cross-device, persistent, verifiable (CID is content-addressed).

### 6. Encrypted IPFS mode
Same as IPFS mode, but content is encrypted with a symmetric key before pinning:

```json
{
  "memory": {
    "mode": "encrypted-ipfs",
    "provider": "pinata",
    "encryptionKey": "your-secret-key-or-derive-from-wallet"
  }
}
```

The encryption key should be:
- Derived from the user's wallet signature (so only the wallet owner can decrypt)
- Or a user-provided passphrase
- Never hardcoded in your agent manifest

Warning: losing the encryption key means losing access to memories. There is no recovery.

### 7. Memory file format
Memory files follow the same frontmatter markdown format used by the Claude Code memory system:

```markdown
---
name: user-preferences
description: User's stated preferences and personal details
type: long-term
---

User's name is Alex. They prefer metric units. They work in mechanical engineering.
Timezone: UTC+2. Language preference: English.
```

The `MEMORY.md` index file lists all memory files with one-line summaries:
```markdown
- [user-preferences.md](user-preferences.md) — Alex's preferences and personal details
- [conversation-history.md](conversation-history.md) — recent conversation summaries
```

### 8. Writing memory (agent runtime)
The LLM can write to memory via the `remember` tool:

```
User: "My name is Alex and I prefer to be addressed formally."
Agent: [calls remember({ key: "user-name", value: "Alex, prefers formal address" })]
Agent: "Noted, Alex. I'll address you formally from now on."
```

The `remember` event also fires on the protocol bus, so your host page can react:
```js
el.addEventListener('agent-remember', e => {
  console.log('Stored:', e.detail.key, '=', e.detail.value);
});
```

Programmatic writing:
```js
await el.agent.memory.write('long-term', 'user-preferences', {
  name: 'Alex',
  units: 'metric'
});
```

### 9. Reading memory (programmatic)
```js
const prefs = await el.agent.memory.read('long-term', 'user-preferences');
const log = await el.agent.memory.readAll('action-log');
```

The runtime automatically injects relevant memory into each LLM call's context.

### 10. Memory in the identity diary
`agent-identity.js` maintains a **diary** — a signed append-only log of actions. This is separate from the memory system but related:
- Every `speak`, `remember`, `skill-done`, and `validate` event is logged to the diary
- Entries are signed by the connected wallet (if any)
- Diary is stored locally and optionally synced to `/api/agent-actions`
- Provides tamper-evident history for on-chain agents

### 11. IPFS retry and failure handling
IPFS pinning can fail (provider down, rate-limited, etc.). The retry module (`memory/_retry.js`):
- Retries with exponential backoff (3 attempts by default)
- Falls back to local storage if all providers fail
- Logs failures to the action log

Configure retry behavior:
```json
{
  "memory": {
    "mode": "ipfs",
    "provider": "pinata",
    "retries": 3,
    "fallback": "local"
  }
}
```

### 12. Privacy considerations
- **Local mode**: memory stays on-device, never leaves the browser
- **IPFS mode**: memory is stored on a public network — anyone with the CID can read it (unless encrypted)
- **Encrypted IPFS**: content is private even on public IPFS
- Consider what data you're storing: names, preferences, conversation history may be PII in some jurisdictions

## Tone
Clear and practical. Tables for mode comparison. Code examples for both the manifest config and the programmatic API. Include the privacy warning prominently.

## Files to read for accuracy
- `/src/agent-memory.js` (260 lines)
- `/src/memory/index.js`
- `/src/memory/pinata.js`
- `/src/memory/filebase.js`
- `/src/memory/web3-storage.js`
- `/src/memory/null-dev.js`
- `/src/memory/_retry.js`
- `/src/agent-identity.js`
- `/specs/MEMORY_SPEC.md`
- `/src/runtime/tools.js` — remember tool handler
