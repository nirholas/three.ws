# Task: Auto-generate conversation titles using the LLM

## Context

`/workspaces/3D-Agent/chat/src/App.svelte` stores conversations in `convos`. Conversations have a `time` field and a `messages` array but no `title` field — the history sidebar shows them by date only, making it impossible to distinguish between conversations at a glance.

The chat already has a working LLM call pipeline via `complete()` in `convo.js` and a `fetch`-based API setup.

## What to build

### 1. Add a `generateTitle()` function in App.svelte

After an assistant message is received (when `generating` goes from `true` to `false`), if the conversation has no title yet and has at least 2 messages (one user, one assistant), call the active model to generate a short title.

```js
async function generateTitle() {
    if (convo.title) return; // already titled
    const msgs = convo.messages.filter(m => m.role === 'user' || m.role === 'assistant');
    if (msgs.length < 2) return;

    // Use the first user message + first assistant response as context
    const context = msgs.slice(0, 4).map(m => `${m.role}: ${m.content?.slice(0, 300)}`).join('\n');
    const model = convo.models[0];
    if (!model?.id) return;

    try {
        const provider = providers.find(p => p.name === model.provider);
        if (!provider) return;

        const response = await fetch(`${provider.url}${provider.completionUrl}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...(model.provider === 'Anthropic'
                    ? { 'x-api-key': provider.apiKeyFn(), 'anthropic-version': '2023-06-01' }
                    : { Authorization: `Bearer ${provider.apiKeyFn()}` }),
            },
            body: JSON.stringify({
                model: model.id,
                stream: false,
                max_tokens: 20,
                messages: [
                    { role: 'user', content: `Summarize this conversation in 4-6 words as a title. No quotes, no punctuation.\n\n${context}` }
                ],
            }),
        });
        if (!response.ok) return;
        const data = await response.json();
        const title = data?.choices?.[0]?.message?.content?.trim()
            || data?.content?.[0]?.text?.trim(); // Anthropic shape
        if (title) {
            convo.title = title;
            saveConversation(convo);
            convos = { ...convos, [convo.id]: convo };
        }
    } catch {
        // Non-critical, fail silently
    }
}
```

### 2. Trigger it when generation completes

Find where `generating = false` is set after a successful completion. After that line, call:
```js
generateTitle();
```

There may be multiple places where `generating = false` is set — only call it after a successful response (not on abort/error).

### 3. Show the title in the history sidebar

In the history sidebar conversation list, show `convo.title` if it exists, otherwise fall back to the current display (date or first message excerpt):

```svelte
<span class="truncate text-sm font-medium text-slate-700">
    {convo.title || convo.messages.find(m => m.role === 'user')?.content?.slice(0, 50) || 'New conversation'}
</span>
```

Find the exact location in the sidebar rendering loop and update it.

### 4. Allow renaming

Add a double-click handler on the conversation title in the sidebar to make it editable inline:

```svelte
{#if editingTitleId === c.id}
    <input
        class="w-full text-sm font-medium text-slate-700 outline-none"
        bind:value={c.title}
        on:blur={() => { saveConversation(c); convos = {...convos}; editingTitleId = null; }}
        on:keydown={(e) => e.key === 'Enter' && e.target.blur()}
        autofocus
    />
{:else}
    <span class="truncate text-sm font-medium" on:dblclick={() => editingTitleId = c.id}>
        {c.title || 'New conversation'}
    </span>
{/if}
```

Add `let editingTitleId = null` to the script.

## Files to edit
- `/workspaces/3D-Agent/chat/src/App.svelte`

## Verification
- Start a new conversation and send a message, wait for the response
- The conversation in the sidebar should get a short title within a second or two after the response completes
- The title should be 4-6 words describing what was discussed
- Double-clicking a title in the sidebar should let you edit it inline
- Edited titles persist after page reload
- Old conversations with no title still show a fallback (first message text or "New conversation")
