# Feature: Per-Agent Conversation Sessions

## Goal
When the user picks an agent, the app should automatically switch to (or create) a conversation scoped to that agent. Switching agents switches the conversation thread. Going back to "no agent" restores the most recent unscoped conversation. All history is persisted in IndexedDB — nothing is lost.

## Success criteria
1. Pick agent A → a dedicated conversation for A is loaded (or created if none exists).
2. Chat in agent A's thread.
3. Switch to agent B → agent B's own conversation is loaded (or created).
4. Switch back to agent A → A's history is intact.
5. Clear agent (remove) → the most recent non-agent conversation is loaded.
6. All existing conversations without `agentId` continue to work.
7. `npm run build` in `chat/` passes.

## Codebase context

Working directory: `/workspaces/3D-Agent/chat/`

**Key file: `src/App.svelte`** (~2204 lines, Svelte). All conversation state lives here.

**IndexedDB setup** (around line 102):
```js
const request = indexedDB.open('threews-chat', 2);
request.onupgradeneeded = (event) => {
  const db = event.target.result;
  if (!db.objectStoreNames.contains('messages')) {
    db.createObjectStore('messages', { keyPath: 'id' });
  }
  if (!db.objectStoreNames.contains('conversations')) {
    db.createObjectStore('conversations', { keyPath: 'id' });
  }
};
```

**Conversation shape** (around line 91):
```js
const defaultConvo = {
  id: uuidv4(),
  time: Date.now(),
  models: [BUILTIN_MODELS[0]],
  messages: [],
  versions: {},
  tools: [],
  // ADD: agentId: null  (string | null)
};
```

**`convos`** — reactive object `{ [id]: convo }` — populated by `fetchAllConversations()`.

**`$convoId`** — persisted localStorage store holding the current conversation UUID.

**`newConversation()`** (line 821) — creates a new convo or reuses an existing empty one.

**`applyAgentToConvo(agent)`** (line 867) — injects system message + greeting into the current `convo` if empty. Called reactively: `$: if ($activeAgent) applyAgentToConvo($activeAgent)`.

**`clearAgentFromConvo()`** (line 883) — removes system + generated messages.

**`activeAgent`** — persisted Svelte store in `src/stores.js` (`persisted('activeAgentDetail', null)`).

**`localAgentId`** — persisted Svelte store in `src/stores.js` (`persisted('localAgentId', '')`).

## Implementation

### 1. Add `agentId` field to conversation shape
In `newConversation()`, add `agentId: null` to `convoData`. No DB migration needed — missing field just means `undefined`, treated as `null`.

### 2. Add `switchToAgentConversation(agentId)` in App.svelte
```js
function switchToAgentConversation(agentId) {
  if (!db) return;
  if (!agentId) {
    // find most recent non-agent convo
    const noAgent = Object.values(convos)
      .filter(c => !c.agentId)
      .sort((a, b) => b.time - a.time)[0];
    if (noAgent) {
      $convoId = noAgent.id;
      convo = noAgent;
    } else {
      newConversation();
    }
    return;
  }
  // find existing convo for this agent
  const existing = Object.values(convos)
    .filter(c => c.agentId === agentId)
    .sort((a, b) => b.time - a.time)[0];
  if (existing) {
    $convoId = existing.id;
    convo = existing;
    return;
  }
  // create new convo for this agent
  const convoData = {
    id: uuidv4(),
    time: Date.now(),
    models: convo.models.length > 0 ? [...convo.models] : [BUILTIN_MODELS[0]],
    messages: [],
    versions: {},
    tools: [],
    agentId,
  };
  $convoId = convoData.id;
  convos[convoData.id] = convoData;
  convo = convoData;
  saveConversation(convo);
}
```

### 3. Wire up the reactive agent change
Replace the reactive statement:
```js
$: if ($activeAgent) applyAgentToConvo($activeAgent)
```
with:
```js
$: if ($activeAgent !== undefined) {
  const agentId = $activeAgent?.id ?? null;
  switchToAgentConversation(agentId);
  if ($activeAgent) applyAgentToConvo($activeAgent);
}
```
This fires when `activeAgent` changes — including when it's set to `null` (agent cleared).

### 4. Update `clearAgentFromConvo` to also clear the session
The existing `clearAgentFromConvo()` removes system/generated messages. Keep it for cleaning up the messages in the old thread; the reactive statement handles switching away.

### 5. Show agent name in conversation history sidebar
In the conversation history list (around line 1622+), where the convo title is rendered, add a small badge if `historyConvo.agentId`:
```svelte
{#if historyConvo.agentId}
  <span class="text-[10px] text-indigo-400 ml-1">[agent]</span>
{/if}
```

### 6. Guard against race: db not ready
`switchToAgentConversation` must check `if (!db) return;` at the top — the reactive statement can fire before IndexedDB is ready. The existing `applyAgentToConvo` already has this guard.

## Constraints
- Do not change the IndexedDB schema version or object store names — just add a field to records.
- Do not break existing conversations that have no `agentId`.
- Do not change the sync logic — `saveConversation` handles sync automatically.
- Run `npm run build` (from `chat/`) and confirm it passes.
