# 21. Agent memory, cross-session recall, and skills learned from experience

Read `docs/prompts/README.md` first.

## The problem

An agent has a persona and a chat history, and nothing else persists: no memory it curates, no model of the person it works for, no search over its own past sessions, and no way to turn a task it completed into a reusable skill. The best agents run a closed learning loop: they save memories, are nudged to persist what matters, search prior conversations, build a deepening user model, and author skills after complex tasks, then improve those skills while using them.

## Build

- **Memory store:** `agent_memories` migration (agent, kind: fact, preference, procedure, user-model; text, source run or message, confidence, created, last used). Tools `memory_save`, `memory_search`, `memory_list`, `memory_forget` (the last one irreversible, `confirm_delete`). Injected into the system prompt as a bounded, ranked section; ranking by recency and use.
- **Nudges:** the runtime (server loop in `api/agent/run.js` and the local runtime from prompt 20) prompts the agent at the end of a run or every N turns to persist anything worth keeping, with the nudge text in the prompt 03 skill.
- **Session search:** full-text index over messages and run steps (Postgres `tsvector` on Neon; SQLite FTS locally), tool `search_sessions` returning summaries generated on demand and cached.
- **User model:** a structured, editable "about the user" document per account that the agent updates through `memory_save` with kind `user-model`; the user sees and edits it on `/settings/memory` (in `data/pages.json`), with per-memory delete and a global off switch. Every state designed.
- **Skills from experience:** after a run with more than N tool calls succeeds, the runtime drafts a prompt-only custom skill (prompt 04) capturing the procedure, saves it disabled, and notifies the user to review and enable. While a skill is in use, the agent may propose edits; edits are versioned and the user can roll back.
- **Privacy:** memories are per account, never shared across accounts or into the community registry, and excluded from any marketplace transfer (prompt 10) unless the seller opts in.
- **Docs:** `docs/agent-memory.md` linked from `docs/start-here.md` and `docs/agent-runtime.md`; changelog entry tagged `feature`.

## Acceptance

- Tell an agent a preference in one session; a new session honors it without being told.
- A completed multi-step run produces a draft skill visible on the agent's skills page.
- Deleting a memory removes it from the next prompt; the off switch stops all writes.
- `npm test` green.
