# Task: Create WalletConnect.svelte component

## Goal
Create `/workspaces/3D-Agent/chat/src/WalletConnect.svelte` — a self-contained Svelte
component that lets users sign in with an EVM wallet (MetaMask / injected) or a
Solana wallet (Phantom), and shows their address + a sign-out button when authenticated.

---

## Context

### Existing files this component uses
- `chat/src/walletAuth.js` — exports `getCurrentUser`, `signOut`, `signInWithEVM`,
  `signInWithSolana` (created in task 01)
- `chat/src/stores.js` — exports `currentUser` (writable store, null when signed out)
  and `loadCurrentUser` (async function that refreshes the store from `/api/auth/me`)

### Tailwind
The chat app uses Tailwind CSS v3. Match the existing button styles already in
`TopNav.svelte`:
- Primary button: `h-9 rounded-full bg-black px-4 text-sm font-medium text-white hover:bg-[#333]`
- Secondary button: `h-9 rounded-full border border-rule bg-white px-4 text-sm font-medium text-ink hover:bg-paper`
- Rule/border color variable: `border-rule`
- Text color: `text-ink`, muted: `text-ink-soft`

---

## Component behavior

### When `$currentUser` is null (signed out)
Show two buttons side by side:
1. **Connect EVM** — clicking it calls `signInWithEVM()`, shows loading state, then
   calls `loadCurrentUser()` on success. On error shows a small inline error message.
2. **Connect Solana** — same but calls `signInWithSolana()`.

While loading, disable both buttons and show "Connecting…" text on the active one.

### When `$currentUser` is set (signed in)
Show a chip:
- Left: shortened wallet address or `display_name` if no wallet address.
  Short address format: first 6 chars + `…` + last 4 chars.
  Use `currentUser.wallet_address` if present, else `currentUser.display_name`.
- Right: "Sign out" button. Clicking it calls `signOut()` then sets `currentUser` to
  null via `currentUser.set(null)`.

### Error display
Show errors inline below the buttons (not an alert/modal). Clear the error when the
user clicks either button again.

---

## Implementation

```svelte
<script>
  import { currentUser, loadCurrentUser } from './stores.js';
  import { signInWithEVM, signInWithSolana, signOut } from './walletAuth.js';

  let loading = null; // 'evm' | 'sol' | null
  let error = '';

  async function connectEVM() {
    error = '';
    loading = 'evm';
    try {
      await signInWithEVM();
      await loadCurrentUser();
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
    } catch (e) {
      error = e.message || 'Solana sign-in failed.';
    } finally {
      loading = null;
    }
  }

  async function handleSignOut() {
    await signOut();
    currentUser.set(null);
  }

  function shortAddr(addr) {
    if (!addr) return '';
    return addr.slice(0, 6) + '…' + addr.slice(-4);
  }
</script>

{#if $currentUser}
  <!-- signed-in chip -->
  <span class="flex items-center gap-2 text-sm text-ink">
    <span class="font-medium" title={$currentUser.wallet_address}>
      {$currentUser.wallet_address ? shortAddr($currentUser.wallet_address) : ($currentUser.display_name || 'Account')}
    </span>
    <span class="opacity-30">·</span>
    <button
      class="text-sm text-ink-soft underline hover:text-ink"
      on:click={handleSignOut}
    >Sign out</button>
  </span>
{:else}
  <div class="flex flex-col items-end gap-1">
    <div class="flex items-center gap-2">
      <!-- EVM button -->
      <button
        disabled={loading !== null}
        on:click={connectEVM}
        class="h-9 rounded-full bg-black px-4 text-sm font-medium text-white transition-colors hover:bg-[#333] disabled:opacity-50"
      >
        {loading === 'evm' ? 'Connecting…' : 'Connect EVM'}
      </button>
      <!-- Solana button -->
      <button
        disabled={loading !== null}
        on:click={connectSolana}
        class="h-9 rounded-full border border-rule bg-white px-4 text-sm font-medium text-ink transition-colors hover:bg-paper disabled:opacity-50"
      >
        {loading === 'sol' ? 'Connecting…' : 'Connect Solana'}
      </button>
    </div>
    {#if error}
      <p class="text-xs text-red-500">{error}</p>
    {/if}
  </div>
{/if}
```

---

## Success criteria
- File exists at `chat/src/WalletConnect.svelte`
- Signed-out state shows EVM + Solana connect buttons
- Signed-in state shows shortened address (or display_name) + Sign out
- Loading state disables both buttons and relabels the active one
- Errors display inline without crashing the app
- No external npm packages (only imports from `./stores.js` and `./walletAuth.js`)
