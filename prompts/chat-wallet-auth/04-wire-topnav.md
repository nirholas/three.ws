# Task: Wire WalletConnect into TopNav and initialize session on app mount

## Goal
1. Replace the static "Sign in" / "Sign up" buttons in `chat/src/three-ui/TopNav.svelte`
   with the `WalletConnect` component (which handles both states: signed-in and signed-out).
2. Call `loadCurrentUser()` in `chat/src/App.svelte`'s `onMount` so the auth store is
   populated when the app boots.

---

## Context

### TopNav.svelte — current "Sign in / Sign up" buttons
File: `/workspaces/3D-Agent/chat/src/three-ui/TopNav.svelte`

The right side of the desktop nav (around line 154–165) currently renders:
```svelte
<!-- RIGHT: auth buttons + hamburger -->
<div class="flex items-center gap-2">
  <div class="hidden items-center gap-2 md:flex">
    <button
      class="h-9 rounded-full bg-black px-4 text-sm font-medium text-white transition-colors hover:bg-[#333]"
      on:click={() => route.set('signin')}
    >Sign in</button>
    <button
      class="h-9 rounded-full border border-rule bg-white px-4 text-sm font-medium text-ink transition-colors hover:bg-paper"
      on:click={() => route.set('signup')}
    >Sign up</button>
  </div>
  <!-- hamburger button (mobile) -->
  ...
</div>
```

The mobile sheet (around line 183–195) has separate Sign in / Sign up buttons too.

### WalletConnect component
File: `/workspaces/3D-Agent/chat/src/WalletConnect.svelte`
- Reads from the `currentUser` store (null = signed out)
- Shows "Connect EVM" + "Connect Solana" when signed out
- Shows address chip + Sign out when signed in

### App.svelte — onMount
File: `/workspaces/3D-Agent/chat/src/App.svelte`

`onMount` already exists at line ~1043. `loadCurrentUser` needs to be called there
so the `currentUser` store is populated before any navigation renders.

---

## Changes required

### 1. `TopNav.svelte`

**Desktop nav — replace the two static auth buttons:**
```svelte
<!-- BEFORE -->
<div class="hidden items-center gap-2 md:flex">
  <button ... on:click={() => route.set('signin')}>Sign in</button>
  <button ... on:click={() => route.set('signup')}>Sign up</button>
</div>

<!-- AFTER -->
<div class="hidden items-center gap-2 md:flex">
  <WalletConnect />
</div>
```

**Mobile sheet — replace the two static auth buttons in the `<div class="flex gap-2 px-6 py-4">` block:**
```svelte
<!-- BEFORE -->
<div class="flex gap-2 px-6 py-4">
  <button class="h-9 flex-1 rounded-full bg-black ..." on:click={() => { route.set('signin'); mobileOpen = false; }}>Sign in</button>
  <button class="h-9 flex-1 rounded-full border ..."   on:click={() => { route.set('signup'); mobileOpen = false; }}>Sign up</button>
</div>

<!-- AFTER -->
<div class="flex gap-2 px-6 py-4">
  <WalletConnect />
</div>
```

**Add import at the top of the `<script>` block:**
```js
import WalletConnect from '../WalletConnect.svelte';
```

### 2. `App.svelte`

**Add import** at the top of the `<script>` block alongside existing store imports:
```js
import { loadCurrentUser } from './stores.js';
```

**Call inside `onMount`**, early — before the brand config fetch is a good spot (around line 1047):
```js
onMount(async () => {
  syncRouteFromHash();
  window.addEventListener('hashchange', syncRouteFromHash);

  // Populate auth state from session cookie
  await loadCurrentUser();

  // ... rest of existing onMount ...
```

---

## What NOT to change
- Do not remove the hamburger button from the mobile layout
- Do not touch any other part of TopNav (nav links, dropdowns, logo)
- Do not modify any existing onMount logic in App.svelte beyond adding the import
  and the `await loadCurrentUser()` call

---

## Success criteria
- TopNav desktop nav shows `WalletConnect` instead of the two static auth buttons
- TopNav mobile sheet shows `WalletConnect` instead of the two static auth buttons
- On app load, `loadCurrentUser()` is called in `onMount` so `currentUser` is set
  before the nav renders
- The app compiles without errors (`npm run build` in `chat/`)
