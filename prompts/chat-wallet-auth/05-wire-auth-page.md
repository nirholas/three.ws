# Task: Add wallet sign-in buttons to AuthPage.svelte

## Goal
Update `/workspaces/3D-Agent/chat/src/three-ui/pages/AuthPage.svelte` to include
real EVM and Solana wallet sign-in options. Currently the page is a stub that
`console.log`s and routes to `'chat'` without calling any auth backend.

---

## Context

### Current AuthPage.svelte
File: `/workspaces/3D-Agent/chat/src/three-ui/pages/AuthPage.svelte`

The component currently:
- Accepts `export let kind = 'signin'` prop (`'signin'` | `'signup'`)
- Has a `submit()` function that just `console.log`s and sets `route` to `'chat'`
- Renders Google + GitHub social buttons (non-functional stubs)
- Renders an email/password form

The layout has a card with social buttons at the top, an `or` divider, then the form.

### What needs to be added
Replace the existing non-functional Google + GitHub stub buttons with working
EVM and Solana wallet buttons. Keep the email/password form below them — it can
remain a stub for now (do not need to implement email/password auth here).

### Available utilities
- `chat/src/walletAuth.js` (see task 01) — exports `signInWithEVM`, `signInWithSolana`
- `chat/src/stores.js` — exports `currentUser`, `loadCurrentUser`

### After successful wallet sign-in
1. Call `await loadCurrentUser()` to populate the store
2. Call `route.set('chat')` to navigate to the chat view

---

## Changes required

### Replace the `<script>` block

```svelte
<script>
  import { route } from '../../stores.js';
  import { loadCurrentUser } from '../../stores.js';
  import { signInWithEVM, signInWithSolana } from '../../walletAuth.js';

  export let kind = 'signin'; // 'signin' | 'signup'

  let email = '';
  let password = '';
  let name = '';
  let loading = null; // 'evm' | 'sol' | null
  let error = '';

  async function connectEVM() {
    error = '';
    loading = 'evm';
    try {
      await signInWithEVM();
      await loadCurrentUser();
      route.set('chat');
    } catch (e) {
      error = e.message || 'EVM sign-in failed.';
    } finally {
      loading = null;
    }
  }

  async function connectSolana() {
    error = '';
    loading = 'sol';
    try {
      await signInWithSolana();
      await loadCurrentUser();
      route.set('chat');
    } catch (e) {
      error = e.message || 'Solana sign-in failed.';
    } finally {
      loading = null;
    }
  }

  function submit() {
    // Email/password auth not yet implemented
    route.set('chat');
  }
</script>
```

### Replace the social buttons section

Replace the existing Google + GitHub buttons block:
```svelte
<!-- BEFORE -->
<div class="mt-6 space-y-3">
  <button class="bg-white border border-[#E5E3DC] ...">
    <span ... /> Continue with Google
  </button>
  <button class="bg-white border border-[#E5E3DC] ...">
    <span ... /> Continue with GitHub
  </button>
</div>
```

With EVM + Solana wallet buttons:
```svelte
<!-- AFTER -->
<div class="mt-6 space-y-3">
  <button
    disabled={loading !== null}
    on:click={connectEVM}
    class="bg-black text-white rounded-xl h-11 w-full flex items-center justify-center gap-2 hover:bg-[#333] text-sm font-medium disabled:opacity-50 transition-colors"
  >
    {loading === 'evm' ? 'Connecting…' : 'Connect EVM Wallet'}
  </button>
  <button
    disabled={loading !== null}
    on:click={connectSolana}
    class="bg-white border border-[#E5E3DC] text-[#1A1A1A] rounded-xl h-11 w-full flex items-center justify-center gap-2 hover:bg-[#F5F4EF] text-sm font-medium disabled:opacity-50 transition-colors"
  >
    {loading === 'sol' ? 'Connecting…' : 'Connect Solana Wallet'}
  </button>
  {#if error}
    <p class="text-xs text-red-500 text-center">{error}</p>
  {/if}
</div>
```

---

## What NOT to change
- Keep the email/password form exactly as-is (it can remain a stub)
- Keep the "or" divider between wallet buttons and email form
- Keep the "Don't have an account? Sign up" / "Already have an account? Sign in"
  toggle at the bottom
- Keep the card layout and all existing styles

---

## Success criteria
- AuthPage shows "Connect EVM Wallet" and "Connect Solana Wallet" buttons
- Clicking either calls the appropriate sign-in function
- On success: `loadCurrentUser()` is called, then `route.set('chat')`
- On error: error message appears below the buttons
- Both buttons are disabled while loading
- The email/password form still renders below the divider
- No Svelte compile errors
