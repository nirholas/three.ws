# Task: Add conversation export (Markdown and JSON)

## Context

`/workspaces/3D-Agent/chat/src/App.svelte` stores conversations in IndexedDB. Users have no way to export or back up their conversations. This task adds an Export button to the conversation options menu that downloads the current conversation as Markdown or JSON.

## What to build

### 1. Add export functions

In `App.svelte` script, add:

```js
function exportConvoAsMarkdown() {
    const lines = [];
    for (const msg of convo.messages) {
        if (msg.role === 'system') continue;
        const role = msg.role === 'user' ? '**You**' : '**Assistant**';
        lines.push(`${role}\n\n${msg.content || ''}\n\n---\n`);
    }
    downloadFile(lines.join('\n'), `conversation-${convo.id.slice(0, 8)}.md`, 'text/markdown');
}

function exportConvoAsJSON() {
    const data = {
        id: convo.id,
        time: convo.time,
        models: convo.models,
        messages: convo.messages.filter(m => m.role !== 'system' || !m.customInstructions).map(m => ({
            role: m.role,
            content: m.content,
            model: m.model,
            time: m.time,
        })),
    };
    downloadFile(JSON.stringify(data, null, 2), `conversation-${convo.id.slice(0, 8)}.json`, 'application/json');
}

function downloadFile(content, filename, type) {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
}
```

### 2. Find the conversation options menu

Search `App.svelte` for `MoreDropdown` or an existing dropdown/menu on conversations. If there's already a "..." menu per conversation, add Export options there.

If no such menu exists, add a simple dropdown near the top of the current conversation view. Look for where the model name or conversation header is rendered.

Add two buttons to the menu:
```svelte
<button on:click={exportConvoAsMarkdown} class="...">
    Export as Markdown
</button>
<button on:click={exportConvoAsJSON} class="...">
    Export as JSON
</button>
```

Match the existing button styling in whatever dropdown you find.

### 3. Handle edge cases

- If `convo.messages` is empty, show a disabled state or skip (no point exporting empty chat)
- Skip messages where `content` is null/empty (tool call-only messages)
- For Markdown export, if a message has `toolcalls`, append a note: `*[used tool: toolname]*`

## Files to edit
- `/workspaces/3D-Agent/chat/src/App.svelte`
- Possibly `/workspaces/3D-Agent/chat/src/three-ui/MoreDropdown.svelte` if that's where the menu lives

## Verification
- Open a conversation with several messages
- Click the export button/menu item for Markdown
- A `.md` file should download with all messages formatted cleanly
- Open the file — it should be readable and correctly formatted
- Export as JSON — the `.json` file should parse cleanly with `JSON.parse()`
- Exporting an empty conversation should either be disabled or produce a file with just metadata
