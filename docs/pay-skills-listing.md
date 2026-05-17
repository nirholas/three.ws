# three.ws — Paid API Provider

**Website:** https://three.ws  
**Discovery:** https://three.ws/.well-known/x402.json  
**OpenAPI:** https://three.ws/.well-known/openapi.yaml  
**MCP:** https://three.ws/api/mcp  
**Networks:** Base mainnet (USDC), Solana mainnet (USDC)  
**Protocol:** x402 v2 (HTTP 402 Payment Required)

## Overview

three.ws is an agent-first 3D model platform. Paid REST endpoints cover glTF/GLB model
validation, Solana token visualization, Pump.fun agent analytics, and on-chain identity
verification. All endpoints settle in USDC on Base or Solana mainnet. The MCP server
exposes the same surface as JSON-RPC tools.

## Paid Endpoints

| Endpoint | Method | Price | Description |
|---|---|---|---|
| `/api/mcp` | POST | $0.001 | MCP 2025-06-18 Streamable HTTP — 3D model tools + Solana agent data as JSON-RPC |
| `/api/x402/model-check` | GET | $0.001 | Fetch a glTF/GLB from a URL, return vertex/triangle counts, materials, textures, animations, extensions, and optimization hints |
| `/api/x402/mint-to-mesh` | GET | $0.001 | Pass a Solana SPL mint, get a binary GLB cube themed for that token (color + texture derived from on-chain metadata) |
| `/api/x402/symbol-availability` | GET | $0.001 | Pre-launch ticker collision check against three.ws's pump.fun mint index; returns exact and trigram-similar matches |
| `/api/x402/skill-marketplace` | GET | $0.001 | List active skill listings and prices across all three.ws agents; filter by skill name to find the cheapest provider |
| `/api/x402/onchain-identity-verify` | GET | $0.005 | Verify an agent's ownership of a Solana contract/mint from three.ws's on-chain identity index; returns tx_hash + wallet evidence |
| `/api/x402/agent-reputation` | GET | $0.010 | Reputation snapshot for a three.ws agent: USDC paid in, distinct payers, deployed mints, distribution success rate, attestation count |
| `/api/x402/pump-agent-audit` | GET | $0.020 | Full operational audit of a pump.fun agent-payments token: USDC in, distribute/buyback history, latest error reasons, risk flags |
| `/api/x402/mint-to-mesh-batch` | POST | $0.050 | Resolve 1–10 Solana SPL mints to themed GLB cubes in one call; per-mint failures report individually |

All prices are in USDC with 6 decimals. `$0.001` = 1000 atomics.

## Quick Start

```js
import { withPaymentInterceptor } from "@x402/fetch";
import fetch from "node-fetch";

const fetchWithPayment = withPaymentInterceptor(fetch, wallet);

// Check a 3D model
const res = await fetchWithPayment(
  "https://three.ws/api/x402/model-check?url=https://example.com/model.glb"
);
const { model, suggestions } = await res.json();

// Get a token's 3D representation
const res2 = await fetchWithPayment(
  "https://three.ws/api/x402/mint-to-mesh?mint=DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263"
);
const { glb } = await res2.json(); // base64 GLB bytes
```

## MCP Usage

```json
{
  "mcpServers": {
    "three-ws": {
      "url": "https://three.ws/api/mcp",
      "headers": { "x-payment": "<usdc-payment-token>" }
    }
  }
}
```

## CORS

All paid endpoints include `Access-Control-Allow-Origin: *` — browser-based and
server-side agents can call them directly from any origin.

## Notes

- All endpoints return structured JSON 402 challenges before access; probe with
  `npx x402-surface-check https://three.ws/.well-known/x402.json` to enumerate live prices.
- Server-to-server and browser-agent paths are both supported.
- Solana routes require a `feePayer` field in the accept block (included automatically
  in the 402 challenge) for PayAI's `/verify` to accept the SPL transfer.
