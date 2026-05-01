# Feature: Agent Public Library (JSON Index)

## Goal
Add a "Public Library" section to `chat/src/AgentPicker.svelte` that fetches agents from the live LobeHub-compatible JSON index at `https://agents-ai-library.vercel.app`. On pick, fetch the full agent detail and populate `system_prompt` and `greeting`. This is fully client-side — no backend changes.

## Success criteria
1. The picker shows a "Public Library" section with agents from the live index.
2. Searching filters the library (by title, description, tags, category).
3. Picking a library agent loads its `config.systemRole` as `system_prompt` and `config.openingMessage` as `greeting` on the `activeAgent` store.
4. The library URL is configurable via a persisted store (`agentLibraryUrl`, default `https://agents-ai-library.vercel.app`).
5. `npm run build` in `chat/` succeeds with no new errors.

## Codebase context

Working directory: `/workspaces/3D-Agent/chat/`

**Entry point:** `src/main.js` mounts `src/App.svelte` into `#app`.

**AgentPicker.svelte** (`src/AgentPicker.svelte`) — rendered inside a dropdown in App.svelte. Currently has two sections: "My Agents" (from `/api/agents`) and "Marketplace" (from `/api/marketplace/agents`). Dispatches a `pick` event with the agent detail object. Uses Tailwind CSS, raw Svelte (no component library).

**Stores** (`src/stores.js`) — uses a `persisted(key, default)` helper that reads/writes localStorage. Currently exports:
```js
export const localAgentId = persisted('localAgentId', '');
export const activeAgent = persisted('activeAgentDetail', null);
```
Add:
```js
export const agentLibraryUrl = persisted('agentLibraryUrl', 'https://agents-ai-library.vercel.app');
```

**Agent shape used by the app** (fields consumed by `applyAgentToConvo` in App.svelte):
```js
{
  id,           // string — must be unique; prefix library agents with "lib:"
  name,
  description,
  thumbnail_url,
  system_prompt,  // injected as first system message on new convo
  greeting,       // injected as first assistant message on new convo
}
```

## Live API

**Index** — `GET https://agents-ai-library.vercel.app/index.en-US.json`
```json
{
  "schemaVersion": 1,
  "agents": [
    {
      "identifier": "academic-writing-assistant",
      "meta": {
        "avatar": "📘",
        "title": "Academic Writing Assistant",
        "description": "Expert in academic research paper writing",
        "tags": ["academic-writing","research"],
        "category": "academic"
      }
    }
  ]
}
```

**Detail** — `GET https://agents-ai-library.vercel.app/{identifier}.json`
```json
{
  "config": {
    "systemRole": "You are an expert academic writing assistant...",
    "openingMessage": "Hello! I'm here to help..."
  },
  "meta": { "avatar": "📘", "title": "...", "description": "..." }
}
```

## Implementation plan

1. **`src/stores.js`** — add `export const agentLibraryUrl = persisted('agentLibraryUrl', 'https://agents-ai-library.vercel.app');`

2. **`src/AgentPicker.svelte`** — in `<script>`:
   - Import `agentLibraryUrl` from stores.
   - Add state: `libraryAgents = []`, `loadingLibrary = false`.
   - Add `normalizeLibraryAgent(item)` — maps index entry to app agent shape (`id: 'lib:' + identifier`, `name: meta.title`, `description: meta.description`, `thumbnail_url`: only if meta.avatar is a URL, else store it as `avatar_emoji`).
   - Add `loadLibrary()` — fetches `$agentLibraryUrl + '/index.en-US.json'`, maps with `normalizeLibraryAgent`, stores in `libraryAgents`.
   - Add reactive `filteredLibrary` — filter by query across name/description/tags/category, `slice(0, 60)` when no query.
   - Add `loadLibraryAgentDetail(agent)` — fetches `$agentLibraryUrl + '/' + agent.identifier + '.json'`, returns `{ ...agent, system_prompt: cfg.systemRole, greeting: cfg.openingMessage }`.
   - Modify `pick(agent)` — if `agent.source === 'library'`, call `loadLibraryAgentDetail` then set stores; else existing logic unchanged.
   - Call `loadLibrary()` at init.

3. **Template** — add a "Public Library" section below "Marketplace" with the same grid layout. Show emoji avatars for agents where `avatar_emoji` is set (just render the emoji in a `div`, no image). Show "Showing 60 of N — search to filter" when unfiltered and list is truncated.

## Constraints
- No backend changes.
- Do not touch "My Agents" or "Marketplace" sections.
- Match the existing Tailwind/grid style exactly.
- Run `npm run build` (from `chat/`) and confirm it passes.
