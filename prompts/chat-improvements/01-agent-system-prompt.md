# Task: Wire agent system_prompt and greeting into chat

## Context

This is the `chat/` Svelte app at `/workspaces/3D-Agent/chat/src/`. It's a multi-provider LLM chat UI.

Users can pick an agent from a marketplace picker (`chat/src/AgentPicker.svelte`). When picked, the agent's ID is stored in `localAgentId` (a persisted Svelte store in `chat/src/stores.js`). This drives the 3D avatar widget — but **nothing else**. The agent's `system_prompt`, `greeting`, and `capabilities` fields that live in the database are never fetched or applied to the conversation. The agent has a personality in the DB, but the chat ignores it entirely.

## What the API returns

`GET /api/marketplace/agents/:id` returns:
```json
{
  "data": {
    "agent": {
      "id": "...",
      "name": "...",
      "system_prompt": "You are ...",
      "greeting": "Hi! I'm ...",
      "capabilities": {},
      "thumbnail_url": "..."
    }
  }
}
```

This is confirmed in `api/marketplace/[action].js` — `toDetail()` at the bottom of that file includes `system_prompt`, `greeting`, and `capabilities`.

## What needs to change

### 1. `chat/src/AgentPicker.svelte`

The `pick(agent)` function (line 30) only calls `localAgentId.set(agent.id)`. It has the full agent object from the list endpoint, but the list endpoint returns minimal fields (name, thumbnail). 

Change `pick()` to fetch the full agent detail before dispatching:

```js
async function pick(agent) {
    loading = true;
    try {
        const res = await fetch(`/api/marketplace/agents/${agent.id}`);
        if (res.ok) {
            const json = await res.json();
            const detail = json.data?.agent ?? agent;
            localAgentId.set(detail.id);
            dispatch('pick', detail);
        }
    } catch {
        localAgentId.set(agent.id);
        dispatch('pick', agent);
    }
    loading = false;
}
```

Also export a store for the active agent detail. Add to `chat/src/stores.js`:
```js
export const activeAgent = persisted('activeAgentDetail', null);
```

And in `AgentPicker.svelte`, import and set it:
```js
import { localAgentId, activeAgent } from './stores.js';
// in pick():
activeAgent.set(detail);
// in clear():
activeAgent.set(null);
```

### 2. `chat/src/App.svelte`

Import `activeAgent` from stores. Then add a reactive block that applies the agent to the current conversation when `activeAgent` changes:

```js
$: if ($activeAgent) {
    applyAgentToConvo($activeAgent);
}

function applyAgentToConvo(agent) {
    // Inject system prompt as first message if not already present
    if (agent.system_prompt && convo.messages.length === 0) {
        const sysMsg = { id: uuidv4(), role: 'system', content: agent.system_prompt };
        convo.messages = [sysMsg];
        saveMessage(sysMsg);
        saveConversation(convo);
    }
    // Add greeting as first assistant message if no messages yet (or only system)
    const nonSystem = convo.messages.filter(m => m.role !== 'system');
    if (agent.greeting && nonSystem.length === 0) {
        const greetMsg = {
            id: uuidv4(),
            role: 'assistant',
            content: agent.greeting,
            generated: true,
        };
        convo.messages = [...convo.messages, greetMsg];
        saveMessage(greetMsg);
        saveConversation(convo);
    }
}
```

When `clear()` is called in AgentPicker (removes the agent), remove the system message from the current convo if it was agent-injected. You can detect this by checking `convo.messages[0]?.role === 'system'` and whether it matches the cleared agent's `system_prompt`.

### 3. New conversation

When a new conversation is created (around line 818 in `App.svelte`), if `$activeAgent` is set, apply it to the fresh convo immediately after creating it.

## Success criteria

1. Pick an agent from the picker → the chat immediately shows the agent's greeting as an assistant message
2. The system prompt is in the conversation (visible if you add a system message block, or confirmed via network tab showing it sent)
3. Clearing the agent → system message and greeting are removed from a fresh convo
4. An existing convo with messages is not modified when an agent is picked (don't clobber in-progress convos)

## House rules

- Edit existing files only, do not create new ones (except adding the store export to stores.js)
- Match existing code style (tabs, Svelte reactive syntax)
- Run `node --check chat/src/App.svelte` won't work for Svelte — instead do `cd chat && npx vite build` to verify no build errors
- Report: what shipped, what was skipped, what broke, unrelated bugs noticed
