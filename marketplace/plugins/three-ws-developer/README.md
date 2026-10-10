# three.ws Developer Tools

Developer tooling for building on three.ws inside Claude Code. Scaffold a new agent, configure the `@three-ws/mcp-server`, and get runnable code for the paid MCP tools — plus the MCP server itself, wired for x402 payments.

Part of the [three.ws plugin marketplace](https://github.com/nirholas/three.ws).

## Install

```
/plugin marketplace add nirholas/three.ws
/plugin install three-ws-developer@three-ws
```

Run `/reload-plugins` (or restart Claude Code) afterward.

## Commands

| Command | What it does |
| :------ | :----------- |
| `/three-ws-developer:scaffold-agent <Name>` | Scaffold a runnable three.ws agent wired to the SDK, MCP tools, and x402 payments. |
| `/three-ws-developer:setup-mcp` | Configure `@three-ws/mcp-server` in Claude Desktop, Claude Code, or Cursor. Merges into your existing config. |
| `/three-ws-developer:use-tools <tool>` | Print ready-to-run code for any MCP tool (free or paid). |

## Bundled MCP server

Installing this plugin registers the `3d-agent` MCP server (`npx -y @three-ws/mcp-server`), exposing <!-- mcp-count:three-ws-mcp-server.tools -->25<!-- /mcp-count --> tools: <!-- mcp-count:three-ws-mcp-server.free -->5<!-- /mcp-count --> free, and <!-- mcp-count:three-ws-mcp-server.paid -->20<!-- /mcp-count --> paid tools settled per call in USDC via x402:

| Tool | Price | What it does |
| :--- | :---- | :----------- |
| `forge_free` | **Free** | Text → textured 3D GLB on the free NVIDIA NIM (TRELLIS) lane — no payment, no wallet, no API key |
| `mesh_forge` | $0.25 | Text or image → textured 3D GLB (Granite-directed model chain) |
| `rig_mesh` | $0.20 | Auto-rig a static GLB into an animation-ready model |
| `text_to_avatar` | $0.15 | Text or image → textured 3D avatar GLB |
| `get_pose_seed` | $0.001 | Deterministic pose seed + Euler-rotation map for the pose studio |
| `pump_snapshot` | $0.005 | Live pump.fun token snapshot — price, volume, holders |
| `sentiment_pulse` | $0.003 | Sentiment for a Solana token from pump.fun comments |
| `vanity_grinder` | $0.05 | Mine a Solana keypair with a custom address prefix |
| `aixbt_intel` | $0.01 | aixbt narrative-intelligence feed |
| `aixbt_projects` | $0.01 | aixbt momentum scan — ranked projects |
| `agent_reputation` | $0.01 | ERC-8004 reputation lookup on any EVM chain |
| `agent_delegate_action` | $0.01 | Delegate a task to another three.ws-registered agent |
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

Run `/three-ws-developer:use-tools <tool>` for runnable code for any of them.

> **Note:** the MCP server runs via `npx -y @three-ws/mcp-server`, so the `@three-ws/mcp-server` package must be published to npm for the server to start on a user's machine. The skills and commands in this plugin work regardless.

## Configuration

| Variable | Purpose |
| :------- | :------ |
| `MCP_EVM_PAYMENT_ADDRESS` | EVM address where you **receive** x402 micropayments. Public — never a private key. |
| `MCP_SVM_PAYMENT_ADDRESS` | Solana address where you **receive** x402 micropayments. |
| `ANTHROPIC_API_KEY` | Used by scaffolded agents to call Claude. Set in the generated agent's `.env`, not here. |

The payment addresses are public receiving addresses only. The MCP server never needs a private key.

## License

Apache-2.0
