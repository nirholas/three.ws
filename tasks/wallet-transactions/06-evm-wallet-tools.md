# Task 06 — Frontend: EVM Wallet Tools

## Goal
Add two tools — `evm_transfer` and `evm_swap` — to `chat/src/tools.js` that execute EVM transactions from chat. Unlike Solana, EVM wallets (MetaMask) handle transaction building, signing, and broadcasting natively via `window.ethereum`, so no backend endpoint is needed for transfer. Swap uses the 1inch Fusion+ API for calldata.

## Context
- `window.__wallet` holds `{ type: 'evm', address, chainId }` after EVM sign-in (Task 01).
- `window.ethereum` is the MetaMask provider. Use `eth_sendTransaction` RPC call to send.
- `window.requestWalletApproval(details)` pauses for user confirmation (Task 02).
- ERC20 ABI for transfer: `transfer(address to, uint256 amount)` → selector `0xa9059cbb`
- MetaMask will show its own native confirmation after our approval modal — that's expected and fine.
- For swaps, use the 1inch v5 API (no auth key needed for public quotes): `https://api.1inch.dev/swap/v5.2/{chainId}/swap`

## Tool 1: `evm_transfer`

### `clientDefinition`
```js
{
  name: 'evm_transfer',
  description: 'Send ETH or an ERC20 token to a recipient address on any EVM chain. Requires a connected EVM wallet (MetaMask or compatible).',
  arguments: [
    { name: 'recipient', type: 'string', description: '0x recipient address' },
    { name: 'amount',    type: 'string', description: 'Amount in human-readable units (e.g. "0.01" for 0.01 ETH)' },
    { name: 'token',     type: 'string', description: '"ETH" for native token, or an ERC20 contract address (0x...). Default: "ETH"' },
    { name: 'decimals',  type: 'number', description: 'Token decimals (required for ERC20, ignored for ETH). Default: 18' },
  ],
  async body({ recipient, amount, token = 'ETH', decimals = 18 }) {
    const wallet = window.__wallet;
    if (!wallet || wallet.type !== 'evm') throw new Error('No EVM wallet connected. Please connect MetaMask or a compatible wallet.');

    // Chain name lookup
    const chainNames = { 1: 'Ethereum', 8453: 'Base', 10: 'Optimism', 42161: 'Arbitrum', 137: 'Polygon' };
    const networkName = chainNames[wallet.chainId] || `Chain ${wallet.chainId}`;

    // 1. Request approval
    await window.requestWalletApproval({
      network: networkName,
      from: wallet.address,
      to: recipient,
      amount,
      token: token === 'ETH' ? 'ETH' : `${token.slice(0, 8)}…`,
    });

    // 2. Build and send transaction
    let txHash;
    if (token === 'ETH') {
      // Native ETH transfer
      const valueHex = '0x' + BigInt(Math.round(parseFloat(amount) * 1e18)).toString(16);
      txHash = await window.ethereum.request({
        method: 'eth_sendTransaction',
        params: [{ from: wallet.address, to: recipient, value: valueHex }],
      });
    } else {
      // ERC20 transfer
      const amountBigInt = BigInt(Math.round(parseFloat(amount) * 10 ** decimals));
      // Encode transfer(address, uint256) calldata
      const selector = '0xa9059cbb';
      const paddedTo = recipient.slice(2).padStart(64, '0');
      const paddedAmount = amountBigInt.toString(16).padStart(64, '0');
      const data = selector + paddedTo + paddedAmount;
      txHash = await window.ethereum.request({
        method: 'eth_sendTransaction',
        params: [{ from: wallet.address, to: token, data }],
      });
    }

    // 3. Explorer URL
    const explorerBases = { 1: 'https://etherscan.io/tx/', 8453: 'https://basescan.org/tx/', 10: 'https://optimistic.etherscan.io/tx/', 42161: 'https://arbiscan.io/tx/', 137: 'https://polygonscan.com/tx/' };
    const explorerUrl = (explorerBases[wallet.chainId] || 'https://etherscan.io/tx/') + txHash;

    return {
      contentType: 'application/tx-result',
      content: {
        status: 'pending', // EVM tx is pending until mined; wallet confirmation happens outside this tool
        txHash,
        network: networkName,
        chainId: wallet.chainId,
        from: wallet.address,
        to: recipient,
        amount,
        token: token === 'ETH' ? 'ETH' : token.slice(0, 10) + '…',
        explorerUrl,
      },
    };
  }
}
```

### `function` schema
```js
{
  name: 'evm_transfer',
  description: 'Send ETH or ERC20 tokens on any EVM chain (Ethereum, Base, Optimism, Arbitrum, Polygon).',
  parameters: {
    type: 'object',
    properties: {
      recipient: { type: 'string', description: '0x recipient address' },
      amount:    { type: 'string', description: 'Amount in human-readable units' },
      token:     { type: 'string', description: '"ETH" or ERC20 contract address. Default: "ETH"' },
      decimals:  { type: 'number', description: 'ERC20 decimals. Default: 18' },
    },
    required: ['recipient', 'amount'],
  },
}
```

---

## Tool 2: `evm_swap`

### `clientDefinition`
```js
{
  name: 'evm_swap',
  description: 'Swap tokens on EVM chains using 1inch aggregator. Finds best DEX route. Requires a connected EVM wallet.',
  arguments: [
    { name: 'fromToken', type: 'string', description: 'Token contract address to sell (use "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE" for native ETH)' },
    { name: 'toToken',   type: 'string', description: 'Token contract address to buy' },
    { name: 'amount',    type: 'string', description: 'Amount of fromToken in human-readable units' },
    { name: 'decimals',  type: 'number', description: 'Decimals of fromToken. Default: 18' },
    { name: 'slippage',  type: 'number', description: 'Max slippage percentage (e.g. 1 for 1%). Default: 1' },
  ],
  async body({ fromToken, toToken, amount, decimals = 18, slippage = 1 }) {
    const wallet = window.__wallet;
    if (!wallet || wallet.type !== 'evm') throw new Error('No EVM wallet connected.');

    const chainNames = { 1: 'Ethereum', 8453: 'Base', 10: 'Optimism', 42161: 'Arbitrum', 137: 'Polygon' };
    const networkName = chainNames[wallet.chainId] || `Chain ${wallet.chainId}`;
    const amountWei = BigInt(Math.round(parseFloat(amount) * 10 ** decimals)).toString();

    // 1. Get swap calldata from 1inch
    const quoteUrl = `https://api.1inch.dev/swap/v5.2/${wallet.chainId}/swap?src=${fromToken}&dst=${toToken}&amount=${amountWei}&from=${wallet.address}&slippage=${slippage}&disableEstimate=true`;
    const quoteRes = await fetch(quoteUrl, {
      headers: { 'Accept': 'application/json' },
    });
    if (!quoteRes.ok) {
      const err = await quoteRes.json().catch(() => ({}));
      throw new Error(err.description || 'Failed to get swap quote from 1inch');
    }
    const quote = await quoteRes.json();

    const toAmountHuman = (Number(quote.toAmount) / 10 ** 18).toFixed(6); // approximate; real decimals of toToken unknown here

    // 2. Request approval
    await window.requestWalletApproval({
      network: networkName,
      from: wallet.address,
      to: `1inch Router`,
      amount,
      token: `${fromToken.slice(0,8)}… → ${toToken.slice(0,8)}…`,
      memo: `~${toAmountHuman} out`,
    });

    // 3. Check allowance and approve if needed (ERC20 only)
    const ETH_ADDRESS = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE';
    if (fromToken.toLowerCase() !== ETH_ADDRESS.toLowerCase()) {
      // Check current allowance
      const allowanceSelector = '0xdd62ed3e';
      const paddedOwner = wallet.address.slice(2).padStart(64, '0');
      const paddedSpender = quote.tx.to.slice(2).padStart(64, '0');
      const allowanceData = allowanceSelector + paddedOwner + paddedSpender;
      const allowanceHex = await window.ethereum.request({
        method: 'eth_call',
        params: [{ to: fromToken, data: allowanceData }, 'latest'],
      });
      const allowance = BigInt(allowanceHex || '0x0');
      const needed = BigInt(amountWei);
      if (allowance < needed) {
        // Approve max
        const approveSelector = '0x095ea7b3';
        const maxUint256 = 'f'.repeat(64);
        const approveData = approveSelector + paddedSpender + maxUint256;
        await window.ethereum.request({
          method: 'eth_sendTransaction',
          params: [{ from: wallet.address, to: fromToken, data: approveData }],
        });
      }
    }

    // 4. Send swap transaction
    const txHash = await window.ethereum.request({
      method: 'eth_sendTransaction',
      params: [{ from: wallet.address, to: quote.tx.to, data: quote.tx.data, value: quote.tx.value || '0x0' }],
    });

    const explorerBases = { 1: 'https://etherscan.io/tx/', 8453: 'https://basescan.org/tx/', 10: 'https://optimistic.etherscan.io/tx/', 42161: 'https://arbiscan.io/tx/', 137: 'https://polygonscan.com/tx/' };
    const explorerUrl = (explorerBases[wallet.chainId] || 'https://etherscan.io/tx/') + txHash;

    return {
      contentType: 'application/tx-result',
      content: {
        status: 'pending',
        txHash,
        network: networkName,
        chainId: wallet.chainId,
        from: wallet.address,
        to: toToken,
        amount: `~${toAmountHuman}`,
        token: toToken.slice(0, 10) + '…',
        explorerUrl,
      },
    };
  }
}
```

### `function` schema
```js
{
  name: 'evm_swap',
  description: 'Swap ERC20 tokens or ETH on EVM chains via 1inch DEX aggregator.',
  parameters: {
    type: 'object',
    properties: {
      fromToken: { type: 'string', description: 'Token to sell (address or 0xEeee... for ETH)' },
      toToken:   { type: 'string', description: 'Token to buy (address)' },
      amount:    { type: 'string', description: 'Amount of fromToken in human-readable units' },
      decimals:  { type: 'number', description: 'fromToken decimals. Default: 18' },
      slippage:  { type: 'number', description: 'Max slippage %. Default: 1' },
    },
    required: ['fromToken', 'toToken', 'amount'],
  },
}
```

---

## Where to Add
Add both tools to `pumpToolSchema` in `tools.js` (or to a new `walletToolSchema` if Task 07 creates one).

## Verification
- With MetaMask connected on a testnet, calling `evm_transfer` from chat opens the approval modal, then MetaMask's own confirmation dialog.
- The tool returns a `tx_result` content object with `status: 'pending'` and a correct explorer link.
- If no EVM wallet is connected, the tool returns a clear error.
