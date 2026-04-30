# Task 02 — Transaction Approval Modal

## Goal
Create a `TxApprovalModal.svelte` component that shows transaction details and Ask/Reject buttons before any wallet transaction executes. Wire it into `App.svelte` via a global `window.requestWalletApproval(details)` function that returns a Promise — tool bodies call this function to pause execution until the user approves or rejects.

## Context
- Tool bodies in `tools.js` are eval'd JavaScript strings that run in the browser. They can call `window.*` globals freely.
- `chat/src/Choice.svelte` shows a similar "pause and wait for user input" pattern — study its props and how `Toolcall.svelte` renders it for reference style.
- `chat/src/Modal.svelte` is an existing modal shell — use it as the outer wrapper.
- `chat/src/Button.svelte` is the standard button component.
- `chat/src/App.svelte` is where global UI overlays are mounted (search for where `<Notifications />` is rendered — add the modal nearby).

## `TxApprovalModal.svelte` — New File at `chat/src/TxApprovalModal.svelte`

Props:
```js
export let details;   // { network, from, to, amount, token, memo?, estimatedFee? }
export let onApprove; // () => void
export let onReject;  // () => void
```

UI layout (use existing Tailwind classes that match the app's dark slate aesthetic):
- Title: "Approve Transaction"
- Network badge: e.g. "Solana" or "Ethereum / Base / etc."
- Table of rows: From, To, Amount, Token, Memo (if present), Estimated Fee (if present)
- Long addresses: truncate to first 6 + `…` + last 4 chars
- Two full-width buttons at bottom: "Reject" (secondary/outline) and "Approve" (primary/accent)
- Disabled state on both buttons while a `pending` flag is true (set true on Approve click, to prevent double-submit)

## `App.svelte` Changes

1. Import `TxApprovalModal`.
2. Add reactive vars:
   ```js
   let txApprovalDetails = null;
   let txApprovalResolve = null;
   let txApprovalReject  = null;
   ```
3. In `onMount` (or a top-level `if (typeof window !== 'undefined')` block), assign:
   ```js
   window.requestWalletApproval = (details) => new Promise((resolve, reject) => {
     txApprovalDetails = details;
     txApprovalResolve = resolve;
     txApprovalReject  = reject;
   });
   ```
4. Mount the modal conditionally in the template:
   ```svelte
   {#if txApprovalDetails}
     <TxApprovalModal
       details={txApprovalDetails}
       onApprove={() => { txApprovalResolve(); txApprovalDetails = null; }}
       onReject={() => { txApprovalReject(new Error('User rejected transaction')); txApprovalDetails = null; }}
     />
   {/if}
   ```
   Render this at the very end of the `<body>` content so it overlays everything.

## Verification
- Open the browser console and run:
  ```js
  window.requestWalletApproval({ network: 'Solana', from: 'ABC123', to: 'XYZ789', amount: 1.5, token: 'SOL' })
    .then(() => console.log('approved'))
    .catch(e => console.log('rejected:', e.message));
  ```
  The modal should appear. Clicking Approve logs "approved". Clicking Reject logs "rejected: User rejected transaction".
- The modal must be centered/overlaid on the full viewport with a dark backdrop.
- No existing functionality in App.svelte should change.
