---
description: Configure the @three-ws/mcp-server in Claude Desktop, Claude Code, or Cursor — outputs the exact JSON snippet and optionally writes it to your config file.
---

You are helping the user add the `@three-ws/mcp-server` to their MCP client config. Follow these steps precisely:

## Step 1 — Detect OS and find the config file

Check the user's platform:

- **macOS Claude Desktop:** `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows Claude Desktop:** `%APPDATA%\Claude\claude_desktop_config.json`
- **Claude Code (project):** `.mcp.json` in the current working directory
- **Claude Code (global):** `~/.claude/claude_desktop_config.json`
- **Cursor:** `~/.cursor/mcp.json`

Use `uname -s` or `$OS` to detect the platform. Check which of these files already exists with the shell.

## Step 2 — Collect wallet addresses

Ask the user (in a single message) for:

1. **EVM wallet address** (Base USDC payouts) — `0x...` format
2. **Solana wallet address** (Solana USDC payouts) — base58 format
3. **Helius API key** (optional, improves pump_snapshot data — get free at helius.dev)
4. **CDP API key ID + secret** (optional, enables Coinbase Bazaar discovery — get at portal.cdp.coinbase.com)

If the user skips any optional field, omit that env var from the config.

## Step 3 — Generate the config snippet

Produce the exact JSON block to add to their config file under `"mcpServers"`:

```json
{
  "mcpServers": {
    "3d-agent": {
      "command": "npx",
      "args": ["-y", "@three-ws/mcp-server"],
      "env": {
        "MCP_EVM_PAYMENT_ADDRESS": "<their EVM address>",
        "MCP_SVM_PAYMENT_ADDRESS": "<their Solana address>"
      }
    }
  }
}
```

Add optional env vars only if the user supplied them:
- `"HELIUS_API_KEY": "<key>"` — better pump.fun token data
- `"CDP_API_KEY_ID": "<id>"` and `"CDP_API_KEY_SECRET": "<secret>"` — Coinbase Bazaar discovery
- `"SOLANA_RPC_URL": "https://mainnet.helius-rpc.com/?api-key=<key>"` — if Helius key provided

If the config file already exists, read it first and **merge** the `"3d-agent"` entry into the existing `"mcpServers"` object rather than replacing the whole file.

## Step 4 — Write or show

Ask the user: "Should I write this to `<config path>` now, or do you want to paste it yourself?"

- If they say write: use the Write or Edit tool to update the file.
- If they say paste: display the final JSON block in a code fence with clear copy instructions.

## Step 5 — Verify

After writing, confirm the file is valid JSON with:
```bash
node -e "JSON.parse(require('fs').readFileSync('<path>', 'utf8')); console.log('valid')"
```

Then tell the user to restart Claude Desktop / Claude Code / Cursor for the tools to appear.

## Tools available

Once configured, these <!-- mcp-count:three-ws-mcp-server.tools -->25<!-- /mcp-count --> tools will be available: <!-- mcp-count:three-ws-mcp-server.free -->5<!-- /mcp-count --> free, and <!-- mcp-count:three-ws-mcp-server.paid -->20<!-- /mcp-count --> paid (settled per call in USDC via x402):

| Tool | Price | What it does |
|------|-------|--------------|
| `forge_free` | **Free** | Text → textured 3D GLB on the free NVIDIA NIM (TRELLIS) lane — no payment, no wallet, no key |
| `mesh_forge` | $0.25 | Text or image → textured 3D GLB |
| `rig_mesh` | $0.20 | Auto-rig a static GLB into an animation-ready model |
| `text_to_avatar` | $0.15 | Text or image → textured 3D avatar GLB |
| `get_pose_seed` | $0.001 | Deterministic pose map for a three.ws avatar |
| `pump_snapshot` | $0.005 | Live pump.fun token snapshot — price, volume, holders |
| `sentiment_pulse` | $0.003 | Sentiment for a Solana token from pump.fun comments |
| `vanity_grinder` | $0.05 | Mine a Solana keypair with a custom address prefix |
| `aixbt_intel` | $0.01 | aixbt narrative-intelligence feed |
| `aixbt_projects` | $0.01 | aixbt momentum scan — ranked projects |
| `agent_reputation` | $0.01 | ERC-8004 reputation lookup on any EVM chain |
| `agent_delegate_action` | $0.01 | Delegate a task to another three.ws agent |
| `ens_sns_resolve` | $0.0005 | Resolve ENS (`.eth`) + SNS (`.sol`) names |
| `agenc_list_tasks` | $0.001 | List a wallet's on-chain AgenC tasks |
| `agenc_get_task` | $0.001 | On-chain state + lifecycle of an AgenC task |
| `agenc_get_agent` | $0.001 | An AgenC agent's on-chain registration |
| `forge_avatar` | $0.45 | Text or image to a rigged, animation-ready avatar in one call |
| `refine_model` | $0.25 | Re-generate a model from a plain-language change, keeping a version lineage |
| `restyle_material` | $0.05 | Re-skin a GLB's materials without touching its mesh |
| `agent_hire_discover` | $0.01 | Shortlist three.ws agents to hire for a task, ranked by fit and reputation |
| `agent_hire` | $0.05 | Hire an agent end to end and get its result with a payment receipt |
| `vanity_premium` | **Free** | Browse the premium pre-ground vanity address inventory |
| `crypto_news` | **Free** | Live crypto headlines from publisher feeds |
| `crypto_news_digest` | **Free** | Recent coverage clustered into narratives |
| `crypto_news_archive` | **Free** (daily quota) | Search the archived crypto news corpus |
