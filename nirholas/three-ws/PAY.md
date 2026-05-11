---
name: three-ws
title: "three.ws"
description: "3D avatar and AI agent identity platform with pay-per-call REST endpoints and MCP tools: glTF/GLB model validation, Solana token-to-mesh rendering, Solana vanity address grinding, Solana agent passport, Solana tx decode, Pump.fun token and creator intelligence, and agentic revenue analysis."
use_case: "Use for validating or inspecting glTF/GLB 3D models, rendering a Solana token as a branded GLB cube, grinding a vanity Solana address, fetching Solana agent reputation and attestations, decoding Solana transactions, querying Pump.fun token or creator trust signals, and getting AI-powered revenue growth analysis."
category: ai_ml
service_url: https://three.ws
openapi:
  url: https://three.ws/openapi.json
---

Agent-first 3D and Solana identity platform. Nine paid REST endpoints (x402 v2, CDP Bazaar) plus a paid MCP endpoint covering 12 tools. All REST endpoints accept USDC on Base (eip155:8453) and Arbitrum One (eip155:42161) via CDP facilitator.

## Paid REST endpoints

### `GET /api/x402/model-check` — $0.001 USDC
Fetch a glTF/GLB model by URL and return structural stats (vertex/triangle counts, materials, textures, animations, extensions) plus a prioritized list of optimization recommendations. Pass `?url=<https-url>`. Max 16 MiB.

### `GET /api/x402/mint-to-mesh` — $0.01 USDC
Pass a Solana SPL mint address (`?mint=<base58>`), get back a binary glTF (GLB) cube themed for that token. Color is a stable hash of the mint; when the off-chain Metaplex JSON has a PNG/JPEG that image is embedded as a baseColor texture on every face.

### `POST /api/x402/solana-vanity-grind` — $0.05 USDC
Server-side `Keypair.generate()` loop that finds a Solana address matching a requested prefix and/or suffix. Returns the full keypair (`publicKey` + `secretKey` in Base58). Body: `{ prefix?, suffix?, caseSensitive? }`. Total pattern length ≤ 4 Base58 chars. Aborts at 45 s / 3 M attempts (408) — retry with fewer chars or `caseSensitive: false`.

### `GET /api/x402/solana-agent-passport` — $0.001 USDC
Full discovery card for a Solana-registered three.ws agent in one call: Metaplex Core identity, owner wallet, reputation summary (feedback counts, score averages, verified vs disputed, validation pass/fail), and 10 most recent on-chain attestations. Pass `?asset=<base58>&network=mainnet|devnet`.

### `GET /api/x402/pumpfun-token-intel` — $0.005 USDC
Full intelligence on a pump.fun token: graduation status, bonding-curve progress, creator profile, top holders, volume, bundle detection, and behavioural trust signals. Pass `?mint=<base58>`.

### `GET /api/x402/pumpfun-creator-intel` — $0.005 USDC
Reputation profile for a pump.fun creator wallet: prior launches, graduation rate, claim activity, and behavioural trust signals. Pass `?wallet=<base58>`. Use before buying into a new token to assess creator history.

### `POST /api/x402/solana-tx-explain` — $0.002 USDC
Decode a Solana transaction signature via Helius: token transfers, native SOL transfers, transaction type, fee payer, description, and an optional plain-English AI summary. Body: `{ signature: "<base58>" }`.

### `GET /api/insights/revenue-vision` — $0.001 USDC
Agentic growth analysis powered by Claude. Pass `?agent_codename=&power_request=revenue-vision&mission_brief=`. Returns `{ power_mode, insight, recommended_move, confidence }`.

### `POST /api/mcp` — $0.001 USDC/call (MCP Streamable HTTP)
JSON-RPC 2.0 MCP endpoint covering 12 tools. Auth via Bearer token (OAuth 2.1 at `/oauth/authorize`) or API key from the three.ws dashboard. Solana and Pump.fun tools are public; avatar and model tools require auth.

**Avatar tools** (auth): `list_my_avatars`, `get_avatar`, `search_public_avatars`, `render_avatar`, `delete_avatar`.  
**Model tools** (auth): `validate_model`, `inspect_model`, `optimize_model`.  
**Solana tools** (public): `solana_agent_passport`, `solana_agent_reputation`, `solana_agent_attestations`.  
**Pump.fun tools** (public): `pumpfun_token_intel`, `pumpfun_creator_intel`, `pumpfun_recent_claims`, `pumpfun_recent_graduations`.

## Free REST endpoints

- `GET /api/avatars/public` — keyword-searchable public avatar browse
- `GET /api/agents/{id}/manifest` — canonical agent discovery card
- `GET /api/pump/curve?mint=` — bonding-curve snapshot
- `GET /api/pump/quote-sdk?mint=&side=&amount=` — deterministic buy/sell quote

## Spend-aware usage

- Use `GET /api/x402/model-check` to validate a model before paying for `optimize_model` via MCP — skip optimization if validation passes.
- Use `GET /api/x402/solana-agent-passport` instead of calling `solana_agent_reputation` + `solana_agent_attestations` via MCP separately — same price, one call.
- Use `GET /api/x402/pumpfun-creator-intel` before `pumpfun-token-intel` when you only need creator trust signals — it is cheaper and faster.
- For vanity grinding, pass `caseSensitive: false` to roughly halve expected attempts. Keep total pattern ≤ 3 chars for reliable sub-10 s completion.
- Use `GET /api/pump/curve` and `GET /api/pump/quote-sdk` for price data — both are free.
- Use `GET /api/avatars/public` for avatar discovery — it is free; pay for MCP avatar tools only when you need auth-scoped results.
