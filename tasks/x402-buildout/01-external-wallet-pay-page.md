# Task: External Wallet x402 Payments on /pay Page

## Context

`public/pay/index.html` is a live x402 demo page at `https://three.ws/pay`. It currently supports one payment mode: agent wallets (Solana SPL transfer, signed server-side via `/api/x402-pay`). Users who don't have an agent wallet cannot make payments.

The x402 protocol (`https://x402.org`) works as follows:
1. Client POSTs to a paid endpoint, receives HTTP 402 with a `Payment-Required` header containing a base64-encoded JSON spec
2. Client constructs a payment payload, signs it, and re-POSTs with an `X-PAYMENT: <base64>` header
3. The facilitator verifies the signature off-chain, the server runs the tool, the facilitator settles on-chain

We need to add two external wallet modes that handle the full x402 flow client-side — no server involvement for payment construction.

## Current Architecture

- `public/pay/index.html` — monolithic vanilla JS + CSS page, no build step, loaded directly by Vite
- Agent wallet flow: `POST /api/x402-pay { tool, args, agentId }` → server constructs + signs Solana payment → calls `three.ws/api/mcp` with `X-PAYMENT` header → streams SSE back
- The 402 spec at `three.ws/api/mcp` advertises two payment methods:
  - `eip155:8453` (Base mainnet): scheme=exact, amount=1000 (0.001 USDC), payTo=`0x00000000b43689a688e51a06fCC0e3F2E058720a`, asset=`0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`
  - `solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp`: scheme=exact, amount=1000, payTo=`wwwPqsM4N7T9J69tB82nLyzxqsH159j4orftLTQfUGV`, feePayer=`2wKupLR9q6wXYppw8Gr2NvWxKBUqm4PPJKkQfoxHDBg4`

## What to Build

### Wallet selector UI

Add a pill selector above the chat input with three modes:
- **Agent** (default, existing behavior)
- **MetaMask** (Base EVM)
- **Phantom** (Solana)

Show wallet address + USDC balance in the pill once connected. Show a "Connect" button if not connected.

### Mode 1: MetaMask (Base, EIP-3009)

x402 on EVM uses `transferWithAuthorization` (EIP-3009), not a regular transfer. The flow:

1. Connect via `window.ethereum`, get signer address
2. Check USDC balance on Base (`0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`)
3. Build the x402 payment payload:
   ```json
   {
     "x402Version": 2,
     "scheme": "exact",
     "network": "eip155:8453",
     "payload": {
       "signature": "<EIP-712 sig>",
       "authorization": {
         "from": "<user address>",
         "to": "0x00000000b43689a688e51a06fCC0e3F2E058720a",
         "value": "1000",
         "validAfter": "0",
         "validBefore": "<now + 60s as unix>",
         "nonce": "<random 32 bytes hex>"
       }
     }
   }
   ```
4. Sign using EIP-712 `eth_signTypedData_v4` with the Base USDC domain:
   ```json
   {
     "name": "USD Coin",
     "version": "2",
     "chainId": 8453,
     "verifyingContract": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"
   }
   ```
   Type: `TransferWithAuthorization { address from; address to; uint256 value; uint256 validAfter; uint256 validBefore; bytes32 nonce }`
5. Base64-encode the payload JSON and POST to `https://three.ws/api/mcp` with `X-PAYMENT: <base64>` and `Content-Type: application/json`
6. On 200: display the tool result. On 402: show payment failed. On any error: show it.

Do NOT go through `/api/x402-pay` — call `three.ws/api/mcp` directly from the browser.

Facilitator for EVM: `https://x402.sperax.io` — the server already knows this, the client doesn't need to call it directly.

### Mode 2: Phantom (Solana, partial tx)

1. Connect via `window.solana` (Phantom), get public key
2. Check USDC balance (`EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`)
3. Fetch the partial tx from the facilitator: `POST https://facilitator.payai.network/sign` with the payment intent
   - Actually: the server returns a partially-signed tx in the 402 response's `payload.transaction` field for Solana
   - Decode it, sign with Phantom (`window.solana.signTransaction`), re-encode
4. Build the x402 payload:
   ```json
   {
     "x402Version": 2,
     "scheme": "exact", 
     "network": "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp",
     "payload": {
       "signature": "<base64 signed tx>"
     }
   }
   ```
5. POST to `https://three.ws/api/mcp` with `X-PAYMENT: <base64 of above>`

To get the partial tx: make the initial POST to `three.ws/api/mcp` without payment first, parse the 402 `Payment-Required` header (base64 decode), find the Solana `accepts` entry, and use `payload.transaction` from it if present — or construct the SPL `transferChecked` instruction directly using `@solana/web3.js` loaded from CDN.

### SSE streaming

Both external wallet modes should display the same SSE timeline as the agent wallet mode. Since we're calling `three.ws/api/mcp` directly (not `/api/x402-pay`), the response won't be SSE — it'll be a regular JSON response. Display it without the timeline, or add a simplified timeline (paid → running → done).

### Error handling

- Wallet not installed → show install link
- Insufficient USDC balance → show amount needed
- User rejected signature → show "cancelled"
- Payment rejected by facilitator → show raw error
- Tool error → show error inline

## Files to modify

- `public/pay/index.html` — add wallet selector, MetaMask + Phantom connection logic, client-side x402 construction

## Do not modify

- `api/x402-pay.js` — agent wallet flow must remain unchanged
- `api/_lib/x402-spec.js` — server-side spec unchanged

## Definition of done

- All three wallet modes selectable in the UI
- MetaMask connects, shows address + USDC balance on Base, makes a real paid call, displays result
- Phantom connects, shows address + USDC balance on Solana, makes a real paid call, displays result
- No console errors in any mode
- Existing agent wallet mode still works
- Test on `localhost:3000/pay` with real wallets before claiming done
