# Feature: Per-Agent Model & Provider

## Goal
Each agent can specify a preferred model and provider. When a conversation is loaded for that agent, the model is automatically applied. The user can still override the model mid-conversation — the per-agent model is only applied when the thread is first created for that agent.

## Success criteria
1. An agent object can carry `preferred_model: { id, name, provider }`.
2. When creating a new per-agent conversation, `convo.models` is set to `[agent.preferred_model]` instead of the default model.
3. If the agent has no `preferred_model`, fallback to current model (unchanged behavior).
4. The agent settings panel (if it exists) or agent creation flow can set this field. If no agent settings panel exists, at minimum ensure `preferred_model` is persisted on the `activeAgent` store when present.
5. Library agents from `https://agents-ai-library.vercel.app` may include a `config.model` field — if present and non-null, normalise it into `preferred_model`.
6. `npm run build` in `chat/` passes.

## Codebase context

Working directory: `/workspaces/3D-Agent/chat/`

**Key file: `src/App.svelte`**

**Model shape** (from `src/providers.js`):
```js
{ id: 'meta-llama/llama-3.3-70b-instruct:free', name: 'Llama 3.3 70B', provider: 'Built-in' }
```

**Providers available** (from `src/providers.js`):
- `'OpenRouter'` — OpenRouter API, requires `openrouterAPIKey`
- `'Anthropic'` — direct Anthropic API, requires `anthropicAPIKey`
- `'OpenAI'` — direct OpenAI API, requires `openaiAPIKey`
- `'Groq'` — Groq API, requires `groqAPIKey`
- `'Mistral'` — Mistral API, requires `mistralAPIKey`
- `'Built-in'` — free models via OpenRouter proxy (no key required)

**How model is used** (`src/convo.js` line 9):
```js
const model = convo.models[0];
```
So setting `convo.models = [preferredModel]` is sufficient to route to that model.

**`newConversation()`** in App.svelte (line 821) — creates `convoData.models` from `convo.models`. This is where the per-agent model should be applied.

**`switchToAgentConversation(agentId)`** — if you implemented prompt 02, this function creates new conversations; if not, `newConversation()` is used instead. Either way, apply the model at creation time.

**`activeAgent`** store in `src/stores.js` — persisted, holds full agent detail object including any fields set at pick time.

**Agent fields** (current shape):
```js
{ id, name, description, thumbnail_url, system_prompt, greeting }
```
Add: `preferred_model?: { id: string, name: string, provider: string }`

## Implementation

### 1. Normalize `preferred_model` in `AgentPicker.svelte`

In the library agent detail loader (if it exists), map `config.model` to `preferred_model`:
```js
async function loadLibraryAgentDetail(agent) {
  const res = await fetch(`${base}/${agent.identifier}.json`);
  const data = await res.json();
  const cfg = data.config || {};
  // cfg.model may be a string like "gpt-4o" or null
  let preferred_model = null;
  if (cfg.model) {
    preferred_model = { id: cfg.model, name: cfg.model, provider: inferProvider(cfg.model) };
  }
  return { ...agent, system_prompt: cfg.systemRole, greeting: cfg.openingMessage, preferred_model };
}

function inferProvider(modelId) {
  if (!modelId) return 'OpenRouter';
  if (modelId.startsWith('claude')) return 'Anthropic';
  if (modelId.startsWith('gpt') || modelId.startsWith('o1') || modelId.startsWith('o3')) return 'OpenAI';
  if (modelId.startsWith('llama') || modelId.startsWith('mistral') || modelId.startsWith('gemma')) return 'OpenRouter';
  return 'OpenRouter';
}
```

### 2. Apply `preferred_model` when creating a new agent conversation

In `newConversation()` (or `switchToAgentConversation()` if prompt 02 was implemented), apply:
```js
// After building convoData:
const agent = get(activeAgent);
if (agent?.preferred_model) {
  convoData.models = [agent.preferred_model];
}
```

Import `get` from `'svelte/store'` — already imported in App.svelte.

### 3. `ModelSelector.svelte` badge

In the model selector UI, show a small "agent default" indicator if `convo.models[0]?.id === $activeAgent?.preferred_model?.id`. This is optional UX polish — implement it only if `ModelSelector.svelte` has a clear prop or slot for it. Do not over-engineer.

### 4. No migration needed
Existing conversations without `preferred_model` on the agent use existing model selection — no change.

## Constraints
- Only set `preferred_model` at conversation creation time — do not override the model mid-conversation.
- `inferProvider` is a best-effort heuristic for library agents; user-created agents already have a provider set.
- Run `npm run build` (from `chat/`) and confirm it passes.
