# Agent platform build prompts

Each file in this directory is a complete, self-contained build brief for one missing surface of the three.ws agent platform. Hand a file to an agent as its task. Every brief assumes the agent has read `CLAUDE.md` and this page.

## Order

Dependencies flow downward. Rows in the same tier can run in parallel.

| Tier | Prompt | Why this order |
|---|---|---|
| 1 | [01 CLI setup and login](01-cli-setup-login.md) | Everything else gets installed through it. |
| 1 | [02 MCP resources and prompts](02-mcp-resources-prompts.md) | Server-side, no dependencies. |
| 1 | [03 MCP tool policy and the model-facing skill](03-mcp-tool-policy-skill.md) | Server-side, no dependencies. |
| 1 | [05 Agents REST parity](05-agents-rest-parity.md) | The SDK in tier 2 wraps these routes. |
| 2 | [04 Community skills registry](04-community-skills-registry.md) | Installs through the CLI from tier 1. |
| 2 | [06 Agents SDK](06-agents-sdk.md) | Wraps tier 1 routes. |
| 2 | [15 Gasless launch and the launch command](15-gasless-launch.md) | Adds a CLI subcommand from tier 1. |
| 2 | [16 Self-funded inference](16-self-funded-inference.md) | Wallet plus credits, no new dependencies. |
| 3 | [07 Perps](07-perps.md), [08 Lending](08-lending.md), [09 Prediction markets](09-prediction-markets.md) | New execution venues; each registers tools under the tier 1 policy. |
| 3 | [10 Whole-agent marketplace with bids](10-agent-marketplace-bids.md) | Transfers custody; needs the wallet guard surfaces as they are today. |
| 3 | [11 Agent mail](11-agent-mail.md), [12 Agent cards](12-agent-cards.md) | Real-world identity surfaces; each is a provider adapter plus tools. |
| 4 | [13 Chat gateways](13-chat-gateways.md) | Talk to an agent from Telegram and Discord; uses runs from tier 1. |
| 4 | [14 Desktop app release](14-desktop-app-release.md) | Ships the console over everything above. |

## Rules that apply to every brief

- `CLAUDE.md` governs. The four stop-and-ask gates apply, and nothing else stops the work. In particular: any fund-moving action in a test or dry run renders recipient, amount, token and chain and waits for the owner's explicit yes.
- Solana first. Every surface ships and is verified on Solana before any EVM leg is considered.
- No mocks, no placeholders, no TODOs, no sample arrays. Every tool, route, page and state is real and wired.
- Every fund-moving or irreversible tool takes an explicit confirm flag, is disabled by default, and has a quote or preview tool that must be called first. Prompt 03 defines the shared policy; every later prompt registers its tools under it.
- Each brief ends only when the definition of done in `CLAUDE.md` holds: reachable in the UI, exercised in a real browser, no console errors, tests green with `npm test`, docs written, `data/changelog.json` entry appended, `STRUCTURE.md` row added for a new surface, `npm run audit:docs` clean, `npm run check:rules -- --paths <your files>` clean.
- Never name a third-party token in committed code, fixtures or docs. Refer to venues by capability and by the module that integrates them. The promoted coin is `$THREE` only.
- Commit your own finished work promptly with explicit paths and a message that describes the diff.
