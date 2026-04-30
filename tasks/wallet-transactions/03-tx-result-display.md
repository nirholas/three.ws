# Task 03 — Transaction Result Display in Toolcall

## Goal
Add a `tx_result` display type to `Toolcall.svelte` so wallet transaction tool results render as a clean status card (hash, explorer link, amount, status badge) instead of raw JSON.

## Context
- `chat/src/Toolcall.svelte` already handles `image`, `webpage`, `markdown`, and `choice` display types by checking `toolresponse.content.contentType`.
- Tool bodies return `{ contentType: 'application/tx-result', content: { ... } }` to trigger this display type.
- Explorer base URLs by network:
  - `solana` mainnet: `https://solscan.io/tx/`
  - `solana` devnet: `https://solscan.io/tx/?cluster=devnet`
  - EVM chain 1 (Ethereum): `https://etherscan.io/tx/`
  - EVM chain 8453 (Base): `https://basescan.org/tx/`
  - EVM chain 10 (Optimism): `https://optimistic.etherscan.io/tx/`
  - EVM chain 42161 (Arbitrum): `https://arbiscan.io/tx/`
  - EVM chain 137 (Polygon): `https://polygonscan.com/tx/`

## Expected `content` Shape
```js
{
  status: 'success' | 'failed' | 'pending',
  txHash: string,          // Solana signature or EVM 0x... hash
  network: string,         // 'solana' | 'ethereum' | 'base' | etc.
  chainId?: number,        // EVM only
  from: string,
  to: string,
  amount: string,          // human-readable, e.g. "1.5"
  token: string,           // e.g. "SOL", "USDC", "ETH"
  explorerUrl: string,     // full URL to block explorer
}
```

## Changes to `chat/src/Toolcall.svelte`

### 1. Detection logic
In the reactive block that sets `displayType`, add:
```js
} else if (contentType === 'application/tx-result') {
  displayType = 'tx_result';
}
```

### 2. Template block
In the `{#if !collapsable || toolcall.expanded}` section, add a new branch after the `'choice'` block:

```svelte
{:else if toolresponse && displayType === 'tx_result'}
  <div class="flex flex-col rounded-b-lg border border-t-0 border-slate-200 px-5 py-4 gap-3">
    <!-- Status badge -->
    <div class="flex items-center gap-2">
      {#if displayedContent.status === 'success'}
        <span class="rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-medium text-emerald-700">Confirmed</span>
      {:else if displayedContent.status === 'pending'}
        <span class="rounded-full bg-yellow-100 px-2.5 py-0.5 text-xs font-medium text-yellow-700">Pending</span>
      {:else}
        <span class="rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-medium text-red-700">Failed</span>
      {/if}
      <span class="text-sm font-medium text-slate-700">{displayedContent.amount} {displayedContent.token}</span>
      <span class="text-xs text-slate-400">on {displayedContent.network}</span>
    </div>

    <!-- Addresses -->
    <div class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs text-slate-600 font-mono">
      <span class="text-slate-400 font-sans">From</span>
      <span>{displayedContent.from?.slice(0,6)}…{displayedContent.from?.slice(-4)}</span>
      <span class="text-slate-400 font-sans">To</span>
      <span>{displayedContent.to?.slice(0,6)}…{displayedContent.to?.slice(-4)}</span>
    </div>

    <!-- Tx hash + explorer link -->
    <div class="flex items-center gap-2 text-xs font-mono text-slate-500">
      <span>{displayedContent.txHash?.slice(0,12)}…{displayedContent.txHash?.slice(-6)}</span>
      <a
        href={displayedContent.explorerUrl}
        target="_blank"
        rel="noopener noreferrer"
        class="ml-auto whitespace-nowrap rounded border border-slate-200 px-2 py-0.5 text-[10px] font-sans text-slate-600 hover:bg-slate-50 transition-colors"
      >
        View on Explorer ↗
      </a>
    </div>
  </div>
{/if}
```

### 3. `displayedContent` assignment
The existing reactive block already sets `displayedContent = toolresponse.content.content`. For `tx_result`, the full object IS the content — make sure the assignment in the block uses `displayedContent = toolresponse.content.content` which should already be the parsed object if the tool returns it correctly.

If `toolresponse.content` is the raw object (i.e., `{ contentType: 'application/tx-result', content: { status, txHash, ... } }`), then `displayedContent = toolresponse.content.content` is already correct.

## Verification
- No existing display types (image, webpage, markdown, choice) should be affected.
- A tool response with `contentType: 'application/tx-result'` renders the card, not raw JSON.
- The "View code / View component" toggle button still works for this display type.
