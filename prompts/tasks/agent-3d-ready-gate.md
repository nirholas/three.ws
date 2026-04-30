# Task: Gate speakLastMessage on agent-3d element readiness

## Context

`/workspaces/3D-Agent/chat/src/App.svelte` calls `agentEl.speak(text)` on the `<agent-3d>` custom element to trigger lipsync. However, `agentEl` is set via `bind:this` as soon as the DOM element is created — but the `agent-3d` web component loads its 3D scene asynchronously. Calling `.speak()` before the scene is ready is a no-op.

The same problem was already fixed for `TalkingHead` in this codebase (see `talkingHeadReady` flag and `onTalkingHeadReady()` function). The `agent-3d` element needs the same treatment.

## What to fix

### 1. Check what events agent-3d dispatches

The `agent-3d` custom element is loaded from `/agent-3d/latest/agent-3d.js`. Check what events it fires when ready:

```bash
grep -r "dispatchEvent\|CustomEvent\|ready\|loaded" /workspaces/3D-Agent/node_modules 2>/dev/null | grep -i "agent-3d" | head -20
```

Or check the source/docs of the agent-3d element to find the ready event name. Common patterns: `'ready'`, `'load'`, `'agent-ready'`.

If no ready event is documented, use a polling approach as fallback.

### 2. Add an agentReady flag

In `App.svelte`, alongside the existing `talkingHeadReady`:

```js
let agentReady = false;
let agentPendingSpeak = null;
```

### 3. Listen for the ready event on the agent-3d element

After the element is bound (when `agentEl` becomes non-null), attach a one-time event listener:

```js
$: if (agentEl && !agentReady) {
    agentEl.addEventListener('ready', () => {
        agentReady = true;
        if (agentPendingSpeak) {
            agentEl.speak(agentPendingSpeak);
            agentPendingSpeak = null;
        }
    }, { once: true });
}
```

If the event name is different from `'ready'`, adjust accordingly.

**Fallback if no ready event exists:** poll until `agentEl.speak` behaves (check if a `isReady` or `loaded` property exists on the element):

```js
$: if (agentEl && !agentReady) {
    const poll = setInterval(() => {
        if (agentEl?.isReady || typeof agentEl?.speak === 'function') {
            agentReady = true;
            clearInterval(poll);
            if (agentPendingSpeak) {
                agentEl.speak(agentPendingSpeak);
                agentPendingSpeak = null;
            }
        }
    }, 200);
}
```

### 4. Update speakLastMessage to queue if not ready

```js
if (agentEl && effectiveAgentId) {
    if (agentReady) {
        agentEl.speak(last.content);
        const emotion = detectEmotion(last.content);
        if (emotion) setTimeout(() => agentEl?.expressEmotion(emotion), 600);
    } else {
        agentPendingSpeak = last.content;
    }
}
```

### 5. Reset on agent change

When `effectiveAgentId` changes (user picks a different agent), reset the ready flag:

```js
$: if (effectiveAgentId) {
    agentReady = false;
    agentPendingSpeak = null;
}
```

## Files to edit
- `/workspaces/3D-Agent/chat/src/App.svelte`

## Verification
- Open the chat with an agent configured
- Send a message immediately after page load (before the 3D scene finishes loading)
- The speak call should be queued and fire once the avatar is ready — not silently dropped
- If you send another message while a previous speak is pending, only the latest is queued (overwrite `agentPendingSpeak`)
- After the first successful speak, subsequent messages speak immediately
