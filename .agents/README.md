# three.ws Core

The three.ws skill pack for Claude Code. Generate and rig 3D models and avatars, create an
agent with a body, wallet and persona, publish and price its skills, hire other agents, run
a wallet, and pay or get paid over x402, all from natural language.

Part of the [three.ws plugin marketplace](https://github.com/nirholas/three.ws).

## Install

```
/plugin marketplace add nirholas/three.ws
/plugin install three-ws-core@three-ws
```

Then run `/reload-plugins` (or restart Claude Code) and start a request like *"send $5 USDC to vitalik.eth"*.

## Skills

The full, always-current index with every trigger is
[`skills/SKILLS.md`](skills/SKILLS.md), generated from the skill files themselves
(`npm run build:skills-pack`). The machine-readable form is
[`skills/skills-pack.json`](skills/skills-pack.json).

| Group | Skills |
| :---- | :----- |
| Wallet and x402 economy | `authenticate-wallet`, `fund`, `send-usdc`, `trade`, `search-for-service`, `pay-for-service`, `monetize-service`, `query-onchain-data`, `x402` |
| Build on three.ws | `create-a-three-ws-agent`, `build-an-agent-skill`, `sell-an-agent-skill`, `hire-an-agent`, `connect-three-ws-mcp` |
| 3D creation | `generate-3d-model`, `create-3d-avatar`, `rig-a-model`, `find-3d-assets`, `embed-three-ws-avatar` |
| Production ops (maintainers) | `gcp-triage` |
| Vendored partner packs | wallet, identity, and market-data skills kept byte-identical to their publishers' drops |

Skills are model-invoked: Claude selects the right one from the task. You can also call
any of them explicitly, e.g. `/three-ws-core:send-usdc`.

Prefer a smaller install? The same folders ship as standalone repos, one plugin each:
`nirholas/three-ws-3d-skills` (no crypto content) and
`nirholas/three-ws-agent-economy-skills`. See
[docs/agent-skills.md](../docs/agent-skills.md).

## Configuration

Nothing is required to start: the 3D skills run against the free hosted lane
(`https://three.ws/api/mcp-studio`), which needs no account, no key, and no payment.

| What you are doing | What it needs |
| :----------------- | :------------ |
| Generating or rigging 3D models, browsing the asset catalog | Nothing |
| Anything tied to an account (agents, avatar library, pricing, earnings) | A three.ws API key from [/dashboard/api](https://three.ws/dashboard/api), exported as `THREE_WS_KEY` and sent as `Authorization: Bearer` |
| Wallet operations (fund, send, trade) | The `awal` CLI's own email sign-in, handled by the `authenticate-wallet` skill |
| Paid MCP tools or x402 endpoints | A funded wallet; the `pay-for-service` and `x402` skills drive the 402 handshake |

API-key secrets are shown exactly once at creation, and their scopes are fixed then, so
mint a key with only the scopes the task needs. No skill writes a secret to disk, and
every money-moving skill renders a confirmation card and stops for an explicit yes before
it spends: transfers are irreversible.

## License

Apache-2.0
