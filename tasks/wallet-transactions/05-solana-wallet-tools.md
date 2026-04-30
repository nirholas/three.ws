# Task 05 — Frontend: Solana Wallet Tools

## Goal
Add two new tools to `chat/src/tools.js` — `solana_transfer` and `solana_swap` — that the LLM can invoke to execute Solana transactions from within chat. Each tool:
1. Calls the backend API (built in Task 04) to get a serialized transaction.
2. Calls `window.requestWalletApproval(details)` (set up in Task 02) to pause for user confirmation.
3. Signs the transaction with `window.solana`.
4. Broadcasts via the Solana RPC.
5. Returns a `tx_result` content object (rendered by Task 03).

## Context
- Tool bodies are JavaScript strings stored in `clientDefinition.body`. They are eval'd in the browser context. They can use `fetch`, `window.*`, and `async/await`.
- `window.__wallet` holds `{ type, address }` (set up in Task 01).
- `window.requestWalletApproval(details)` returns a Promise that resolves on user approval, rejects on cancel (Task 02).
- `window.solana` is the Phantom/Solana wallet adapter.
- Tool body receives its arguments as local variables matching the `arguments` array names.
- Add these tools to the existing `pumpToolSchema` array at the bottom of that array (or create a new `walletToolSchema` — see Task 07).

## Common Explorer URL helper (inline in each body)

```js
const solscanBase = network === 'devnet'
  ? 'https://solscan.io/tx/'
  : 'https://solscan.io/tx/';
```
Both mainnet and devnet use solscan; devnet links append `?cluster=devnet`.

---

## Tool 1: `solana_transfer`

### `clientDefinition`
```js
{
  name: 'solana_transfer',
  description: 'Send SOL or a Solana SPL token (e.g. USDC) to a recipient address. Requires a connected Solana wallet.',
  arguments: [
    { name: 'recipient', type: 'string', description: 'Base58 recipient wallet address' },
    { name: 'amount',    type: 'number', description: 'Amount to send in human-readable units (e.g. 1.5 for 1.5 SOL)' },
    { name: 'token',     type: 'string', description: 'Token to send: "SOL" or an SPL mint address (e.g. USDC mint). Default: "SOL"' },
    { name: 'memo',      type: 'string', description: 'Optional memo string to attach' },
    { name: 'network',   type: 'string', description: '"mainnet" or "devnet". Default: "mainnet"' },
  ],
  async body({ recipient, amount, token = 'SOL', memo, network = 'mainnet' }) {
    const wallet = window.__wallet;
    if (!wallet || wallet.type !== 'solana') throw new Error('No Solana wallet connected. Please connect a Solana wallet first.');

    // 1. Build transaction on backend
    const buildRes = await fetch('/api/tx/solana/build-transfer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ sender: wallet.address, recipient, amount, token, memo, network }),
    });
    if (!buildRes.ok) {
      const err = await buildRes.json().catch(() => ({}));
      throw new Error(err.message || 'Failed to build transaction');
    }
    const { transaction: txBase64 } = await buildRes.json();

    // 2. Request user approval
    await window.requestWalletApproval({
      network: network === 'devnet' ? 'Solana Devnet' : 'Solana',
      from: wallet.address,
      to: recipient,
      amount: String(amount),
      token,
      memo,
    });

    // 3. Deserialize, sign, and send
    const txBytes = Uint8Array.from(atob(txBase64), c => c.charCodeAt(0));
    // Use wallet.signAndSendTransaction if available (Phantom), else signTransaction + manual broadcast
    let signature;
    if (window.solana.signAndSendTransaction) {
      const { Transaction } = await import('https://esm.sh/@solana/web3.js@1');
      const tx = Transaction.from(txBytes);
      const result = await window.solana.signAndSendTransaction(tx);
      signature = result.signature;
    } else {
      throw new Error('Wallet does not support signAndSendTransaction');
    }

    const explorerUrl = `https://solscan.io/tx/${signature}${network === 'devnet' ? '?cluster=devnet' : ''}`;

    return {
      contentType: 'application/tx-result',
      content: {
        status: 'success',
        txHash: signature,
        network: network === 'devnet' ? 'Solana Devnet' : 'Solana',
        from: wallet.address,
        to: recipient,
        amount: String(amount),
        token,
        explorerUrl,
      },
    };
  }
}
```

### `function` schema (OpenAI-compatible)
```js
{
  name: 'solana_transfer',
  description: 'Send SOL or SPL tokens on Solana. Requires a connected Solana wallet.',
  parameters: {
    type: 'object',
    properties: {
      recipient: { type: 'string', description: 'Base58 recipient wallet address' },
      amount:    { type: 'number', description: 'Amount in human-readable units' },
      token:     { type: 'string', description: '"SOL" or SPL mint address. Default: "SOL"' },
      memo:      { type: 'string', description: 'Optional memo' },
      network:   { type: 'string', enum: ['mainnet', 'devnet'], description: 'Default: mainnet' },
    },
    required: ['recipient', 'amount'],
  },
}
```

---

## Tool 2: `solana_swap`

### `clientDefinition`
```js
{
  name: 'solana_swap',
  description: 'Swap tokens on Solana via Jupiter aggregator. Finds the best route automatically. Requires a connected Solana wallet.',
  arguments: [
    { name: 'inputMint',   type: 'string', description: 'Mint address of the token to sell (e.g. USDC: EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v)' },
    { name: 'outputMint',  type: 'string', description: 'Mint address of the token to buy (e.g. SOL: So11111111111111111111111111111111111111112)' },
    { name: 'amount',      type: 'number', description: 'Amount of input token to sell in human-readable units' },
    { name: 'slippageBps', type: 'number', description: 'Max slippage in basis points (100 = 1%). Default: 50' },
  ],
  async body({ inputMint, outputMint, amount, slippageBps = 50 }) {
    const wallet = window.__wallet;
    if (!wallet || wallet.type !== 'solana') throw new Error('No Solana wallet connected.');

    // 1. Build swap transaction
    const buildRes = await fetch('/api/tx/solana/build-swap', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ sender: wallet.address, inputMint, outputMint, amount, slippageBps }),
    });
    if (!buildRes.ok) {
      const err = await buildRes.json().catch(() => ({}));
      throw new Error(err.message || 'Failed to get swap route');
    }
    const { transaction: txBase64, outputAmount, priceImpactPct } = await buildRes.json();

    // 2. Request approval
    await window.requestWalletApproval({
      network: 'Solana',
      from: wallet.address,
      to: 'Jupiter (DEX aggregator)',
      amount: String(amount),
      token: `${inputMint.slice(0,6)}… → ${outputMint.slice(0,6)}…`,
      memo: `~${outputAmount} out, ${priceImpactPct}% price impact`,
    });

    // 3. Sign and send
    const txBytes = Uint8Array.from(atob(txBase64), c => c.charCodeAt(0));
    const { Transaction } = await import('https://esm.sh/@solana/web3.js@1');
    const tx = Transaction.from(txBytes);
    const result = await window.solana.signAndSendTransaction(tx);
    const signature = result.signature;

    return {
      contentType: 'application/tx-result',
      content: {
        status: 'success',
        txHash: signature,
        network: 'Solana',
        from: wallet.address,
        to: outputMint,
        amount: String(outputAmount),
        token: outputMint.slice(0, 8) + '…',
        explorerUrl: `https://solscan.io/tx/${signature}`,
      },
    };
  }
}
```

### `function` schema
```js
{
  name: 'solana_swap',
  description: 'Swap tokens on Solana via Jupiter. Best-route aggregation.',
  parameters: {
    type: 'object',
    properties: {
      inputMint:   { type: 'string', description: 'Mint address of token to sell' },
      outputMint:  { type: 'string', description: 'Mint address of token to buy' },
      amount:      { type: 'number', description: 'Amount of input token in human-readable units' },
      slippageBps: { type: 'number', description: 'Max slippage in bps. Default: 50' },
    },
    required: ['inputMint', 'outputMint', 'amount'],
  },
}
```

---

## Where to Add in `tools.js`
Add both tools to the `pumpToolSchema` array. Each entry needs both `clientDefinition` and `function` keys, matching the pattern of existing tools in that array.

## Verification
- The LLM can see both tools when `pumpToolSchema` tools are active.
- Calling `solana_transfer` from chat (with a connected Phantom wallet on devnet) shows the approval modal, then on approve attempts to sign and submit the transaction.
- If no wallet is connected, the tool throws a clear error message that the LLM relays to the user.
