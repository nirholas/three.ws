# three.ws Joins Anthropic's Official MCP Registry: Bringing On-Chain 3D AI Agents to Claude and Beyond

*By CoinMarketCap Editorial • May 2026*

In a significant step that bridges Web3 identity, 3D rendering, and frontier AI tooling, **three.ws** has been officially listed in **Anthropic's MCP Registry** — the canonical directory for Model Context Protocol (MCP) servers.

This listing allows Claude (and other MCP-compatible clients like Cursor, ChatGPT Advanced, and custom agent frameworks) to directly discover, connect to, and interact with three.ws's on-chain 3D AI agents.

---

## What is three.ws?

three.ws is an open-source, browser-native platform for creating, embodying, and owning 3D AI agents. Users can:

- Upload or generate GLB/glTF 3D models
- Attach an LLM brain (powered by Claude)
- Add memory, emotions, skills, and animations
- Mint the agent as an **ERC-8004 on-chain identity**
- Embed it anywhere on the web as a fully interactive `<agent-3d>` component

The platform requires no plugins, no heavy server uploads, and no desktop installs — everything runs in the browser with WebGL. Agents can wave, speak, remember conversations, execute skills, and maintain persistent identity across sessions and sites.

---

## What is the Model Context Protocol (MCP)?

MCP is an open standard (led by Anthropic and adopted across the AI ecosystem) that lets large language models securely discover and call external tools and data sources. Think of it as **"plugins 2.0"** for AI agents — but standardized, secure, and registry-backed.

The official **MCP Registry** acts as a trusted directory where developers publish their MCP servers. Once listed, any compatible AI client can instantly discover and connect to the service without custom integration work.

three.ws is now discoverable at the registry as **`io.github.nirholas/three.ws`**, with its remote MCP endpoint at **`https://three.ws/api/mcp`**.

---

## How to Connect three.ws via MCP

### For Claude Desktop / Claude Code users (easiest)

```json
{
  "mcpServers": {
    "3d-agent": {
      "url": "https://three.ws/api/mcp"
    }
  }
}
```

Add this as a **Custom Connector** and sign in with your three.ws account.

### For developers (programmatic access)

Use your three.ws API key as a Bearer token:

```bash
curl -X POST https://three.ws/api/mcp \
  -H "authorization: Bearer sk_live_..." \
  -H "content-type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

### Available tools include:

- `list_my_avatars`
- `get_avatar`
- `search_public_avatars`
- `render_avatar` (returns embeddable `<model-viewer>` HTML)
- `delete_avatar`

This means Claude can now **natively search, fetch, and render your 3D agents inline as rich artifacts**.

---

## Why This Matters: The AI × Crypto Convergence

This listing is more than a technical integration — it represents a key step in giving AI **persistent, ownable bodies** in the open web and on-chain economy.

### Persistent Identity

Agents minted as ERC-8004 tokens carry verifiable on-chain identity, reputation scores, signed action history, and delegated permissions (EIP-7710). Ownership is real.

### Embed Anywhere

The `<agent-3d>` web component and five widget types (talking agent, passport card, turntable, etc.) let creators drop living 3D agents into websites, Notion pages, or social embeds.

### AI Tooling Meets Web3

By exposing 3D rendering and agent control via MCP, three.ws turns Claude into a 3D design and interaction tool. Developers and users can now instruct Claude to *"find my avatar, render it, and make it wave"* — with results appearing inline.

### Open Source & Decentralization Path

The full stack (viewer, runtime, contracts, MCP server) is **Apache 2.0**. Future phases include selfie-to-avatar generation, voice cloning, on-chain agent economies, and a decentralized inference network.

---

## The Bigger Picture

Most AI today is disembodied chat. three.ws aims to change that by making AI **visible, expressive, and ownable**.

- **Creators** can mint personal 3D versions of themselves
- **Brands** can deploy interactive 3D product agents
- **Developers** can build experiences where agents have real economic agency via on-chain tokens and reputation

The MCP listing dramatically lowers the barrier for mainstream AI users to discover and use these capabilities without leaving their preferred interface (Claude).

As AI agents become more capable and autonomous, infrastructure that gives them **bodies, memory, and on-chain identity** will be foundational. three.ws is shipping that infrastructure today.

---

## Try It Yourself

1. Visit [three.ws](https://three.ws)
2. Create or upload a 3D avatar
3. Connect via the MCP instructions above
4. Mint on-chain and embed anywhere

**Give your AI a body.**

---

*three.ws is open source on GitHub. The project is actively building toward Phase 1 (selfie-to-3D avatar) and welcomes contributors, GPU sponsors, and ecosystem partners.*
