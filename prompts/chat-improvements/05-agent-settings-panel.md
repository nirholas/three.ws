# Feature: Agent Settings Panel

## Goal
Create a new `AgentSettingsModal.svelte` component that lets users view and edit the settings of the currently active agent — system prompt, greeting, preferred model, temperature, max tokens, and enabled tools. Changes persist to the `activeAgent` Svelte store (and IndexedDB via the conversation's system message). For user-owned agents, also persist to `/api/agents/{id}` if available.

## Success criteria
1. A settings/gear icon button appears in the chat header when an agent is active.
2. Clicking it opens `AgentSettingsModal.svelte`.
3. The modal shows: agent name, system prompt textarea, greeting textarea, model picker, temperature slider, max tokens input, tools checklist.
4. Saving updates `activeAgent` store. If the agent has an `id` that doesn't start with `lib:`, attempt a `PATCH /api/agents/{id}` — if it 404s or fails, silently continue (library agents are local-only).
5. The system message in the current conversation is updated to reflect the new system prompt.
6. `npm run build` in `chat/` passes.

## Codebase context

Working directory: `/workspaces/3D-Agent/chat/`

**Stores** (`src/stores.js`):
```js
export const activeAgent = persisted('activeAgentDetail', null);
export const params = persisted('params', {
  temperature: 0.3, maxTokens: 0, messagesContextLimit: 0,
  reasoningEffort: { 'low-medium-high': 'high', range: 64000 }
});
export const toolSchema = persisted('toolSchemaGroups', []);
```

**Agent shape** (current + additions):
```js
{
  id: string,
  name: string,
  description: string,
  thumbnail_url: string | null,
  system_prompt: string,       // applied as first system message
  greeting: string,            // applied as first assistant message on new convo
  preferred_model: {           // optional
    id: string, name: string, provider: string
  } | null,
}
```

**`applyAgentToConvo(agent)`** in `App.svelte` (line 867):
```js
function applyAgentToConvo(agent) {
  if (!db) return;
  if (agent.system_prompt && convo.messages.length === 0) {
    const sysMsg = { id: uuidv4(), role: 'system', content: agent.system_prompt };
    convo.messages = [sysMsg];
    saveMessage(sysMsg);
  }
  ...
  saveConversation(convo);
}
```
To update the system message live: find the first message with `role === 'system'` in `convo.messages` and update its `content`, then call `saveMessage` and `saveConversation`.

**`App.svelte`** imports and renders modals at the bottom of the template. Existing pattern:
```svelte
import SettingsModal from './SettingsModal.svelte';
let showSettings = false;
...
<SettingsModal bind:open={showSettings} />
```

**`ModelSelector.svelte`** — a `<select>` or dropdown component. Check its actual props by reading the file. It is already used in `SettingsModal.svelte` — replicate that usage.

**Existing `Modal.svelte`** — a simple modal wrapper. Props: `bind:open`, default slot for content. Used by all other modals — use it.

**`KnobsSidebar.svelte`** — already has temperature/maxTokens sliders. Copy those inputs' markup verbatim.

**Tool list** — `$toolSchema` is an array of groups `{ id, name, schema: [...] }`. Each function name in `schema[*].function.name` is a tool. A tool is enabled for an agent when its name is in `agent.tools` (array of strings). If `agent.tools` is undefined, treat as empty array.

## Implementation

### 1. Create `src/AgentSettingsModal.svelte`

```svelte
<script>
  import { activeAgent, params, toolSchema, notify } from './stores.js';
  import Modal from './Modal.svelte';
  import ModelSelector from './ModelSelector.svelte';

  export let open = false;
  export let onSave = null; // callback: (updatedAgent) => void — called so App.svelte can patch the live convo

  let draft = {};
  $: if (open && $activeAgent) {
    draft = {
      system_prompt: $activeAgent.system_prompt || '',
      greeting: $activeAgent.greeting || '',
      preferred_model: $activeAgent.preferred_model || null,
      temperature: $activeAgent.temperature ?? $params.temperature,
      maxTokens: $activeAgent.maxTokens ?? $params.maxTokens,
      tools: [...($activeAgent.tools || [])],
    };
  }

  $: allTools = ($toolSchema || []).flatMap(g =>
    (g.schema || []).map(t => ({ name: t.function.name, groupName: g.name }))
  );

  function toggleTool(name) {
    if (draft.tools.includes(name)) {
      draft.tools = draft.tools.filter(t => t !== name);
    } else {
      draft.tools = [...draft.tools, name];
    }
  }

  async function save() {
    const updated = { ...$activeAgent, ...draft };
    activeAgent.set(updated);
    onSave?.(updated);
    // attempt server persist for user-owned agents
    if (updated.id && !updated.id.startsWith('lib:')) {
      try {
        await fetch(`/api/agents/${updated.id}`, {
          method: 'PATCH',
          credentials: 'include',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            system_prompt: updated.system_prompt,
            greeting: updated.greeting,
          }),
        });
      } catch {}
    }
    open = false;
  }
</script>

<Modal bind:open>
  <div class="flex flex-col gap-4 p-4 w-[480px] max-w-full">
    <h2 class="text-[15px] font-semibold text-slate-800">Agent Settings — {$activeAgent?.name}</h2>

    <label class="flex flex-col gap-1.5 text-[12px] font-medium text-slate-600">
      System Prompt
      <textarea
        bind:value={draft.system_prompt}
        rows="5"
        class="rounded-lg border border-slate-200 px-3 py-2 text-[13px] text-slate-800 resize-y outline-none focus:border-indigo-400"
        placeholder="You are a helpful assistant..."
      />
    </label>

    <label class="flex flex-col gap-1.5 text-[12px] font-medium text-slate-600">
      Opening Message
      <textarea
        bind:value={draft.greeting}
        rows="2"
        class="rounded-lg border border-slate-200 px-3 py-2 text-[13px] text-slate-800 resize-y outline-none focus:border-indigo-400"
        placeholder="Hello! How can I help you today?"
      />
    </label>

    <label class="flex flex-col gap-1.5 text-[12px] font-medium text-slate-600">
      Temperature
      <div class="flex items-center gap-2">
        <input type="range" min="0" max="2" step="0.1" bind:value={draft.temperature}
          class="flex-1 accent-indigo-500" />
        <span class="text-[12px] text-slate-500 w-8 text-right">{draft.temperature}</span>
      </div>
    </label>

    <label class="flex flex-col gap-1.5 text-[12px] font-medium text-slate-600">
      Max Tokens (0 = unlimited)
      <input type="number" min="0" bind:value={draft.maxTokens}
        class="rounded-lg border border-slate-200 px-3 py-2 text-[13px] text-slate-800 outline-none focus:border-indigo-400 w-32" />
    </label>

    {#if allTools.length > 0}
      <div class="flex flex-col gap-1.5">
        <p class="text-[12px] font-medium text-slate-600">Enabled Tools</p>
        <div class="flex flex-wrap gap-2">
          {#each allTools as tool}
            <label class="flex items-center gap-1.5 text-[12px] text-slate-700 cursor-pointer select-none">
              <input type="checkbox"
                checked={draft.tools.includes(tool.name)}
                on:change={() => toggleTool(tool.name)}
                class="accent-indigo-500"
              />
              {tool.name}
            </label>
          {/each}
        </div>
      </div>
    {/if}

    <div class="flex justify-end gap-2 pt-2">
      <button on:click={() => (open = false)}
        class="rounded-lg border border-slate-200 px-4 py-1.5 text-[13px] text-slate-600 hover:bg-slate-50">
        Cancel
      </button>
      <button on:click={save}
        class="rounded-lg bg-indigo-500 px-4 py-1.5 text-[13px] font-medium text-white hover:bg-indigo-600">
        Save
      </button>
    </div>
  </div>
</Modal>
```

### 2. Wire into `App.svelte`

Import and add to template:
```svelte
import AgentSettingsModal from './AgentSettingsModal.svelte';
let showAgentSettings = false;

function onAgentSettingsSave(updatedAgent) {
  // update live system message in current convo
  if (!convo) return;
  const sysIdx = convo.messages.findIndex(m => m.role === 'system');
  if (sysIdx !== -1 && updatedAgent.system_prompt) {
    convo.messages[sysIdx].content = updatedAgent.system_prompt;
    saveMessage(convo.messages[sysIdx]);
    saveConversation(convo);
  } else if (sysIdx === -1 && updatedAgent.system_prompt) {
    const sysMsg = { id: uuidv4(), role: 'system', content: updatedAgent.system_prompt };
    convo.messages = [sysMsg, ...convo.messages];
    saveMessage(sysMsg);
    saveConversation(convo);
  }
}
```

Add gear button in the header area near the agent name (wherever the active agent name is rendered). Show only when `$activeAgent`:
```svelte
{#if $activeAgent}
  <button on:click={() => (showAgentSettings = true)}
    class="rounded-md p-1 text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition"
    title="Agent settings">
    <!-- use the feather settings/gear icon from feather.js -->
    {@html $feSettings}
  </button>
{/if}
...
<AgentSettingsModal bind:open={showAgentSettings} onSave={onAgentSettingsSave} />
```

Check `src/feather.js` for the correct exported icon name (look for `feSettings` or `feSliders` — use whichever exists). If neither exists, render a simple `⚙` character instead.

## Constraints
- Do not modify `SettingsModal.svelte` (the global app settings modal).
- The PATCH to `/api/agents/{id}` is fire-and-forget — failure must not block the UI update.
- Library agents (id starts with `lib:`) are local-only and never PATCHed to the server.
- Run `npm run build` (from `chat/`) and confirm it passes.
