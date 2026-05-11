# three-ws-mcp

MCP sidecar for [three.ws](https://three.ws) — gives any MCP client (Claude Desktop, Cursor, Windsurf) Solana agent identity, Pump.fun intelligence, and 3D avatar tools in one `npx` command.

- **16 tools** — Solana passport, Pump.fun token/creator intel, glTF/GLB validation, avatar management
- **3 MCP Resources** — live pump.fun feed, bonding-curve snapshots, buy/sell quotes (all free)
- **4 pre-built Prompts** — analyze a token, evaluate an agent, validate a model, render a mint as 3D
- **Response cache** — repeat lookups hit local cache, cost $0
- **Spend guard** — hard session cap so you never overspend
- **$0.001 USDC per tool call** via [three.ws](https://three.ws)

---

## Setup

```bash
npx three-ws-mcp init
```

This walks you through API key setup and prints a ready-to-paste config block for your client. Get an API key at [three.ws/dashboard](https://three.ws/dashboard).

### Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "three-ws": {
      "command": "npx",
      "args": ["-y", "three-ws-mcp"],
      "env": { "THREE_WS_API_KEY": "your-key-here" }
    }
  }
}
```

### Cursor / Windsurf

Add to `.cursor/mcp.json`:

```json
{
  "three-ws": {
    "command": "npx",
    "args": ["-y", "three-ws-mcp"],
    "env": { "THREE_WS_API_KEY": "your-key-here" }
  }
}
```

---

## Tools

### Solana — public, no auth required

| Tool | What it returns | Cost |
|------|----------------|------|
| `solana_agent_passport` | Identity + reputation + 10 recent attestations in one call | $0.001 |
| `solana_agent_reputation` | Verified score, feedback counts, dispute rate, validation pass/fail | $0.001 |
| `solana_agent_attestations` | Full on-chain attestation history with verified/disputed flags | $0.001 |

### Pump.fun — public, no auth required

| Tool | What it returns | Cost |
|------|----------------|------|
| `pumpfun_token_intel` | Graduation status, bonding curve, top holders, bundle detection, trust signals | $0.001 |
| `pumpfun_creator_intel` | Creator wallet history, prior launches, graduation rate, trust signals | $0.001 |
| `pumpfun_recent_claims` | Latest social-fee claim events with influencer tier and fake-claim detection | $0.001 |
| `pumpfun_recent_graduations` | Tokens that recently graduated to PumpAMM with holder analysis | $0.001 |

### Avatars — requires API key

| Tool | What it does | Cost |
|------|-------------|------|
| `list_my_avatars` | List your three.ws avatars with pagination | $0.001 |
| `get_avatar` | Fetch a single avatar by ID or slug | $0.001 |
| `search_public_avatars` | Keyword search across the public avatar directory | $0.001 |
| `render_avatar` | Get embeddable `<model-viewer>` HTML for any avatar | $0.001 |
| `delete_avatar` | Delete an avatar | $0.001 |

### Models — requires API key

| Tool | What it does | Cost |
|------|-------------|------|
| `validate_model` | Run glTF-Validator on a URL — errors, warnings, hints | $0.001 |
| `inspect_model` | Vertex/triangle counts, materials, textures, animation stats | $0.001 |
| `optimize_model` | Optimize geometry and textures, return a download URL | $0.001 |

### Local — always free

| Tool | What it does |
|------|-------------|
| `spend_status` | Session spend, call count, cache hit rate, remaining budget |

---

## Resources

Free — no payment required.

| URI | Description |
|-----|-------------|
| `three-ws://pump/channel-feed` | Live pump.fun events: new mints, whale buys, social-fee claims |
| `three-ws://pump/curve/{mint}` | Bonding-curve snapshot: spot price, market cap, graduation % |
| `three-ws://pump/quote/{mint}/{side}/{amount}` | Deterministic buy/sell quote with price impact |

---

## Prompts

Pre-built multi-step workflows. Invoke from your MCP client's prompt picker.

| Prompt | What it does |
|--------|-------------|
| `analyze-token` | Calls creator intel → token intel → curve resource, gives BUY/SKIP/WATCH |
| `agent-trust` | Calls passport, interprets verified vs raw score, returns TRUSTED/CAUTION/UNVERIFIED |
| `validate-model` | Calls validate → inspect if issues found, lists fixes in priority order |
| `mint-to-avatar` | Fetches curve context, renders the mint as a GLB cube with embeddable viewer |

---

## Spend management

Every tool result includes spend metadata:

```json
{
  "_meta": {
    "cost_usdc": 0.001,
    "session_spend_usdc": 0.004,
    "remaining_budget_usdc": 0.996
  }
}
```

Set a hard cap with `THREE_WS_SPEND_LIMIT`. Once the cap is reached, the sidecar blocks further calls and returns a clear error — call `spend_status` to check or restart the server to reset.

The response cache skips the network entirely for repeated lookups: agent passports cache for 60s, token intel for 30s, model validation for 5min.

---

## Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `THREE_WS_API_KEY` | — | API key from [three.ws/dashboard](https://three.ws/dashboard) |
| `THREE_WS_NETWORK` | `mainnet` | `mainnet` or `devnet` |
| `THREE_WS_REMOTE` | `https://three.ws` | Override the remote base URL |
| `THREE_WS_SPEND_LIMIT` | `1.0` | Session USDC spend cap (0 = unlimited) |

---

## CLI

```bash
npx three-ws-mcp            # start MCP stdio server
npx three-ws-mcp init       # interactive setup + prints client config snippet
npx three-ws-mcp status     # remote health, session spend, cache stats
npx three-ws-mcp --help     # usage
```
