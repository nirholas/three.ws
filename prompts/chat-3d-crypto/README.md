# /chat — 3D × Crypto tool packs

A set of independent prompts that each add **one** real, working tool pack to the chat at [chat/src/tools.js](../../chat/src/tools.js).

## Hard rules for every prompt in this folder

1. **No mocks. No stubs. No fake data. No placeholder API keys.**
   - If a tool needs a backend route it does not yet have, implement that route end-to-end against a real provider.
   - If a tool needs an API key, use an existing env var already in the repo (search `api/_lib/env.js`) or wire a real public endpoint that needs no key.
   - Do not write code paths like `if (DEMO) return fakeData`. Delete them on sight.
2. **Each prompt is self-contained.** Do not reference siblings. Do not assume another prompt has run.
3. **Finish the task.** That means: code merged into `tools.js` (and any new API route under `api/`), build passes (`cd chat && npm run build`), the tool is selectable from the chat tools menu, and the `Verification` section in the prompt has been executed and the result documented in the PR/turn summary.
4. **When the task is verified complete, delete the prompt file** (or move it under `prompts/chat-3d-crypto/_done/`). Then update [INDEX.md](./INDEX.md).
5. **Surgical changes only.** Do not touch unrelated tool packs, components, or styles.

## How a tool pack is structured

See [chat/src/tools.js](../../chat/src/tools.js) — `curatedToolPacks` is an array. Each entry has:

- `id`, `name`, `description`
- `schema[]` with one entry per function, each containing:
  - `clientDefinition.body` — an **async function body string** that runs in the chat's client sandbox (`args` is in scope). It must `return` either a string, a JSON-serialisable object, or `{ contentType, content }` for HTML widgets.
  - `function` — OpenAI-style tool descriptor used by the LLM.

Tools execute **client-side** in the user's browser. Server work (signing, server-only API keys) goes through new routes under `api/` that you add as part of the same prompt.

## Prompts

See [INDEX.md](./INDEX.md).
