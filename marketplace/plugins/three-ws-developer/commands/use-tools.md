---
description: "Show ready-to-run code for calling any @three-ws/mcp-server tool (free or paid). Pass a tool name: /use-tools forge_free"
---

You are producing a working code example for a specific three.ws MCP tool. `$ARGUMENTS` is the tool name the user wants to use. If blank, show a menu of all tools.

## Tool catalog

| Tool | Price | Input | Output |
|------|-------|-------|--------|
| `forge_free` | **Free** | `{ prompt: string, tier?: 'draft'\|'standard'\|'high' }` | Textured GLB `glbUrl` + viewer `preview`, free Microsoft TRELLIS text→3D, no payment |
| `mesh_forge` | $0.25 | `{ prompt?: string, image_url?: string }` | Textured GLB `glbUrl`, viewer `preview`, `directedPrompt`, timing |
| `rig_mesh` | $0.20 | `{ glb_url: string }` | `riggedGlbUrl` + pose-studio link |
| `text_to_avatar` | $0.15 | `{ prompt?: string, image_urls?: string[] }` | Avatar GLB URL, model version, prediction id |
| `get_pose_seed` | $0.001 | `{ prompt: string }` | Pose map with Euler rotations (radians) + previewUrl |
| `pump_snapshot` | $0.005 | `{ mint: string }` | USD price, 24h volume, holders, metadata, bundle signals |
| `sentiment_pulse` | $0.003 | `{ mint: string, snippets?: string[] }` | Overall + per-source sentiment with examples |
| `vanity_grinder` | $0.05 | `{ prefix: string, suffix?: string }` | Solana keypair whose address starts with `prefix` |
| `aixbt_intel` | $0.01 | `{ category?: string, chain?: string }` | aixbt narrative-intelligence items |
| `aixbt_projects` | $0.01 | `{ names?: string[], chain?: string }` | Momentum-ranked projects with market metrics |
| `agent_reputation` | $0.01 | `{ agentId: string, chainId?: number }` | Reputation score, stake, recent ReputationRegistry events |
| `agent_delegate_action` | $0.01 | `{ agentId: string, message: string }` | The delegated agent's response |
| `ens_sns_resolve` | $0.0005 | `{ name: string }` | Resolved ENS (`.eth`) / SNS (`.sol`) address |
| `agenc_list_tasks` | $0.001 | `{ creator: string, cluster?: string }` | A wallet's on-chain AgenC tasks |
| `agenc_get_task` | $0.001 | `{ taskPda?: string, creator?: string, taskId?: string }` | Task state + lifecycle timeline |
| `agenc_get_agent` | $0.001 | `{ agentPda?: string, agentId?: string }` | An AgenC agent's on-chain registration |

## If `$ARGUMENTS` is blank

List all tools in a table and ask: "Which tool do you want to use?"

## If `$ARGUMENTS` names a tool

Produce a complete, runnable Node.js script for that tool. The script must:

1. Spawn the MCP server via `StdioClientTransport` using `npx @three-ws/mcp-server`
2. Set `MCP_EVM_PAYMENT_ADDRESS` and `MCP_SVM_PAYMENT_ADDRESS` from env
3. Use `wrapMCPClientWithPayment` from `@x402/mcp` for automatic 402 retry with a real EVM private key from `process.env.AGENT_EVM_PRIVATE_KEY`
4. Call the tool and `console.log` the parsed result
5. Close the transport

### Template for `get_pose_seed`

```js
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { wrapMCPClientWithPayment } from '@x402/mcp';
import { x402Client } from '@x402/core/client';
import { ExactEvmScheme } from '@x402/evm/exact/client';
import { privateKeyToAccount } from 'viem/accounts';

const transport = new StdioClientTransport({
  command: 'npx',
  args: ['-y', '@three-ws/mcp-server'],
  env: {
    MCP_EVM_PAYMENT_ADDRESS: process.env.MCP_EVM_PAYMENT_ADDRESS,
    MCP_SVM_PAYMENT_ADDRESS: process.env.MCP_SVM_PAYMENT_ADDRESS ?? '',
  },
});

const mcp = new Client({ name: 'demo', version: '1.0.0' });
await mcp.connect(transport);

const account = privateKeyToAccount(process.env.AGENT_EVM_PRIVATE_KEY);
const x402 = new x402Client().register('eip155:8453', new ExactEvmScheme(account));
const paid = wrapMCPClientWithPayment(mcp, x402, { autoPayment: true });

const result = await paid.callTool('get_pose_seed', { prompt: 'warrior stance' });
console.log(JSON.parse(result.content[0].text));

await transport.close();
```

### Special case: `forge_free` (no payment)

`forge_free` is **free** — it never emits a 402, so it needs NO payment wrapper, NO wallet, and NO `AGENT_EVM_PRIVATE_KEY`. Generate the example on the **bare** MCP client instead of `wrapMCPClientWithPayment`:

```js
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const transport = new StdioClientTransport({
  command: 'npx',
  args: ['-y', '@three-ws/mcp-server'],
});

const mcp = new Client({ name: 'demo', version: '1.0.0' });
await mcp.connect(transport);

// Free text → 3D — no payment, no wallet, no API key.
const res = await mcp.callTool('forge_free', { prompt: 'a friendly round robot mascot, glossy white plastic', tier: 'draft' });
const out = res.structuredContent ?? JSON.parse(res.content[0].text);
console.log(out.glbUrl);   // durable GLB you can download
console.log(out.preview);  // three.ws viewer link that renders it in the browser

await transport.close();
```

Note for `forge_free`: it runs the free Microsoft TRELLIS text→3D lane (own GPU workers first, NIM last resort), the same engine `/forge` uses for drafts. Tiers `draft` (default), `standard`, and `high` are all free; higher tiers only take longer. It is text-only; for image/multi-view input or the Granite-directed chain, use `mesh_forge` (paid).

Adapt the tool name, input, and any tool-specific notes (e.g., for `vanity_grinder` note that the returned secret key must be treated as a secret and stored securely; for `agent_reputation` note that `agentId` can be an EVM address and `chainId` defaults to Base).

After the code block, add a one-paragraph note on:
- What env vars are required (`AGENT_EVM_PRIVATE_KEY`, `MCP_EVM_PAYMENT_ADDRESS`, and optionally `MCP_SVM_PAYMENT_ADDRESS`)
- That the x402 payment (~$0.0005–$0.25 USDC, per the tool's price) is deducted automatically from the EVM wallet on each successful call
- Where to get a free Helius RPC if they want better Solana data for `pump_snapshot`
