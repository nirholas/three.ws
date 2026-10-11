# Hubs

Curated, machine-readable directories for fast-growing corners of crypto, AI and 3D. Each folder is self-contained (JSON dataset, schema, validator, README generator, contribution templates, CC0 license) and is built to be lifted into its own GitHub repo.

| Hub | Scope |
|---|---|
| [awesome-agent-payments](awesome-agent-payments) | x402, AP2, ACP, MPP, facilitators and agent commerce (Solana first) |
| [awesome-agent-identity](awesome-agent-identity) | ERC-8004, agent registries, attestations and reputation (Solana first) |
| [awesome-solana-agents](awesome-solana-agents) | Agent kits, MCP servers, skills and tooling on Solana |
| [awesome-agent-wallets](awesome-agent-wallets) | MPC, TEE, smart accounts, session keys and policy engines |
| [awesome-agent-protocols](awesome-agent-protocols) | A2A, MCP, ANP, gateways, SDKs and discovery |
| [awesome-agent-skills](awesome-agent-skills) | SKILL.md bundles, registries, authoring and scanning tools |
| [awesome-agent-data-apis](awesome-agent-data-apis) | Paid and machine-readable data for agents |
| [awesome-browser-agents](awesome-browser-agents) | WebMCP, browser-use, computer-use and headless infrastructure |
| [awesome-embodied-agents](awesome-embodied-agents) | AI avatars, digital humans, VRM/glTF and web 3D runtimes |
| [awesome-generative-3d](awesome-generative-3d) | Text/image-to-3D, splatting, rigging and glTF pipelines |
| [awesome-robinhood-crypto](awesome-robinhood-crypto) | Robinhood Crypto API clients, MCP servers and Robinhood Chain tooling |

## Working on a hub

```
cd hubs/<hub>
node scripts/validate.mjs      # schema, URLs, ordering, dash check
node scripts/build-readme.mjs  # regenerate the README tables from data/entries.json
```

Edit `data/entries.json` only; the README tables between the `ENTRIES` markers are generated. Entries must be verified against the project's own page or repo before they are added. Hubs ship with a placeholder `$id` in `data/schema.json` that is replaced with the real repo URL when a hub is published.
