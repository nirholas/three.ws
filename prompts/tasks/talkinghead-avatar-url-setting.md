# Task: Make the TalkingHead avatar URL configurable via Settings

## Context

`/workspaces/3D-Agent/chat/src/TalkingHead.svelte` has a hardcoded default Ready Player Me avatar URL:

```js
export let avatarUrl =
    'https://models.readyplayer.me/64bfa15f0e72c63d7c3934a6.glb?morphTargets=ARKit,Oculus+Visemes,...';
```

This is someone else's avatar model. Users should be able to paste their own Ready Player Me GLB URL.

`TalkingHead` is mounted in `/workspaces/3D-Agent/chat/src/App.svelte`:
```svelte
<TalkingHead bind:this={talkingHead} on:ready={onTalkingHeadReady} />
```

## What to build

### 1. Add a persisted store for the avatar URL

In `/workspaces/3D-Agent/chat/src/stores.js`, add:
```js
export const talkingHeadAvatarUrl = persisted('talkingHeadAvatarUrl', '');
```

### 2. Pass the URL to TalkingHead in App.svelte

In `App.svelte`, import the new store:
```js
import { ..., talkingHeadAvatarUrl } from './stores.js';
```

Pass it to TalkingHead (use the default when empty):
```svelte
<TalkingHead
    bind:this={talkingHead}
    on:ready={onTalkingHeadReady}
    avatarUrl={$talkingHeadAvatarUrl || undefined}
/>
```

(`undefined` causes TalkingHead to use its own default prop value)

### 3. Add an input field in SettingsModal

In `/workspaces/3D-Agent/chat/src/SettingsModal.svelte`, find the section for voice/avatar settings (search for `ttsEnabled` or `speaker`).

Add a text input for the avatar URL:
```svelte
<script>
    import { talkingHeadAvatarUrl } from './stores.js';
</script>

<div class="flex flex-col gap-1">
    <label class="text-sm font-medium text-slate-700">3D Avatar URL (Ready Player Me .glb)</label>
    <input
        type="url"
        placeholder="https://models.readyplayer.me/your-avatar.glb?morphTargets=ARKit,Oculus+Visemes,..."
        bind:value={$talkingHeadAvatarUrl}
        class="rounded-md border border-slate-200 px-3 py-1.5 text-sm outline-none focus:border-indigo-400"
    />
    <p class="text-xs text-slate-400">
        Get your URL from <a href="https://readyplayer.me" target="_blank" class="underline">readyplayer.me</a>.
        Must include <code>morphTargets=ARKit,Oculus+Visemes</code> query param for lipsync.
    </p>
</div>
```

### 4. Reload TalkingHead when URL changes

In `App.svelte`, when `talkingHeadAvatarUrl` changes, reset the ready flag so `speakLastMessage` doesn't try to speak before the new avatar loads:

```js
$: if ($talkingHeadAvatarUrl) {
    talkingHeadReady = false;
    pendingSpeak = null;
}
```

## Files to edit
- `/workspaces/3D-Agent/chat/src/stores.js`
- `/workspaces/3D-Agent/chat/src/App.svelte`
- `/workspaces/3D-Agent/chat/src/SettingsModal.svelte`

## Verification
- Open Settings, paste a Ready Player Me GLB URL with the required morphTargets params
- Close Settings — the floating avatar should reload with the new model
- The URL should persist after page reload
- Leaving the field empty should use the default avatar
