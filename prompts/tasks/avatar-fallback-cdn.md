# Task: Add fallback and retry for avatar CDN loading failures

## Context

`/workspaces/3D-Agent/chat/src/TalkingHead.svelte` loads the TalkingHead library from a single CDN:

```js
const mod = await import(
    'https://cdn.jsdelivr.net/gh/met4citizen/TalkingHead@1.4/modules/talkinghead.mjs'
);
```

If jsDelivr is slow or down, the avatar silently fails to load. The `loadError` state is set, but the only feedback is a small red text inside the avatar container which is easy to miss.

Similarly, the default avatar GLB URL is fetched from `models.readyplayer.me`. If that CDN is slow, `head.showAvatar()` hangs indefinitely with no timeout.

## What to fix

### 1. Add a timeout to the CDN import

Wrap the dynamic import in a race against a timeout:

```js
const importWithTimeout = (url, ms) => Promise.race([
    import(/* @vite-ignore */ url),
    new Promise((_, reject) =>
        setTimeout(() => reject(new Error('CDN load timed out')), ms)
    )
]);

const mod = await importWithTimeout(
    'https://cdn.jsdelivr.net/gh/met4citizen/TalkingHead@1.4/modules/talkinghead.mjs',
    15000
);
```

### 2. Retry once on failure

```js
let mod;
try {
    mod = await importWithTimeout('https://cdn.jsdelivr.net/gh/met4citizen/TalkingHead@1.4/modules/talkinghead.mjs', 15000);
} catch {
    // Wait 2s and retry once
    await new Promise(r => setTimeout(r, 2000));
    mod = await importWithTimeout('https://cdn.jsdelivr.net/gh/met4citizen/TalkingHead@1.4/modules/talkinghead.mjs', 15000);
}
```

### 3. Improve the error state UI

Currently the error is a small red text. Make it more visible and actionable:

```svelte
{#if loadError}
    <div class="error">
        <p>Avatar failed to load</p>
        <p class="detail">{loadError}</p>
        <button on:click={retry}>Retry</button>
    </div>
{/if}
```

Add a `retry()` function that resets `loadError = null` and re-runs `onMount` logic. The simplest implementation: set a reactive `retryCount` variable that `onMount` watches to re-trigger:

```js
let retryCount = 0;
let loadError = null;

async function retry() {
    loadError = null;
    retryCount++;
}

onMount(async () => {
    // existing load logic, but triggered reactively
});
```

Actually, since `onMount` only runs once, extract the load logic into a separate `loadAvatar()` async function and call it from `onMount` and from `retry()`.

### 4. Add a timeout to showAvatar

After creating the `TalkingHead` instance, wrap `showAvatar()` in a timeout:

```js
await Promise.race([
    head.showAvatar({ url: avatarUrl, body: avatarBody, avatarMood: 'neutral', lipsyncLang: 'en' }),
    new Promise((_, reject) => setTimeout(() => reject(new Error('Avatar model load timed out')), 20000))
]);
```

### 5. Update the error styles

```css
.error {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    padding: 16px;
}
.error p { color: #f88; font-size: 12px; text-align: center; }
.error .detail { color: #aaa; font-size: 11px; }
.error button {
    background: #333;
    color: #fff;
    border: none;
    border-radius: 6px;
    padding: 4px 12px;
    font-size: 12px;
    cursor: pointer;
}
```

## Files to edit
- `/workspaces/3D-Agent/chat/src/TalkingHead.svelte`

## Verification
- Temporarily change the CDN URL to a bad URL and open the chat
- After ~15 seconds, the error state should show with a Retry button
- Clicking Retry should attempt to reload
- With a valid URL, the avatar loads normally (the timeout doesn't interfere)
- Restoring the correct URL and clicking Retry should successfully load the avatar
