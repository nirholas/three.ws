# Agent platform build prompts

Each file in this directory is a complete, self-contained build brief for one missing surface of the three.ws agent platform. Hand a file to an agent as its task. Every brief assumes the agent has read `CLAUDE.md` and this page.

## Order

Dependencies flow downward. Rows in the same tier can run in parallel.

| Tier | Prompt | Why this order |
|---|---|---|
| 1 | [01 CLI setup and login](01-cli-setup-login.md) | Everything else gets installed through it. |
| 1 | [02 MCP resources and prompts](02-mcp-resources-prompts.md) | Server-side, no dependencies. |
| 1 | [03 MCP tool policy and the model-facing skill](03-mcp-tool-policy-skill.md) | Every later tool registers under it. |
| 1 | [05 Agents REST parity](05-agents-rest-parity.md) | The SDK, gateways and loop all wrap these routes. |
| 1 | [17 One MCP endpoint, one OAuth](17-unified-mcp-endpoint.md) | Every later tool mounts here. |
| 1 | [18 Open-model roster and free-tier models](18-open-model-roster.md) | Needed by the free tier and the local runtime. |
| 1 | [29 Free tier, pricing and rate limits](29-free-tier-and-hosting-plan.md) | Every metered brief prices against `data/plans.json`. |
| 2 | [04 Community skills registry](04-community-skills-registry.md) | Installs through the CLI. |
| 2 | [06 Agents SDK](06-agents-sdk.md) | Wraps tier 1 routes. |
| 2 | [15 Gasless launch and the launch command](15-gasless-launch.md) | Adds a CLI subcommand. |
| 2 | [16 Self-funded inference](16-self-funded-inference.md) | Wallet plus credits. |
| 2 | [19 Self-custody, signers, key export, balance history](19-self-custody-and-signers.md) | Changes the signing contract every financial brief uses. |
| 2 | [30 Trading tool parity](30-trading-tool-parity.md) | Exposes existing trading as tools; venue interface for later legs. |
| 2 | [33 Account, X posting policy, Google linking](33-account-social-and-sso.md) | Account objects the gateways and status tools read. |
| 3 | [07 Perps](07-perps.md), [08 Lending](08-lending.md), [09 Prediction markets](09-prediction-markets.md) | New execution venues under the policy. |
| 3 | [10 Whole-agent marketplace with bids](10-agent-marketplace-bids.md) | Transfers custody; depends on 19. |
| 3 | [11 Agent mail](11-agent-mail.md), [12 Agent cards](12-agent-cards.md), [31 Human tasks](31-human-task-fulfillment.md) | Real-world surfaces; provider adapters plus tools. |
| 3 | [21 Memory and self-improvement](21-agent-memory-and-self-improvement.md) | Needs runs (05) and prompt-only skills (04). |
| 3 | [22 External MCP integrations for agents](22-external-mcp-integrations-for-agents.md) | Needs the policy (03) and the unified endpoint (17). |
| 3 | [25 Sandboxed code execution](25-sandboxed-code-execution.md), [26 Tool gateway](26-tool-gateway-bundle.md) | New default tools under the policy, metered by 29. |
| 3 | [28 Public economics](28-public-economics-dashboard.md) | Reads the fee settings the launch brief unifies. |
| 4 | [13 Telegram and Discord](13-chat-gateways.md), [24 Slack, WhatsApp, Signal, SMS, email, voice](24-more-gateways-and-voice.md) | Uses runs, link codes and mail. |
| 4 | [20 Local agent runtime and TUI](20-local-agent-runtime-tui.md) | Uses 17, 25, 26, 21 and the gateway. |
| 4 | [35 Always-on strategy loop](35-always-on-strategy-loop.md) | Uses runs, memory, budgets and guards. |
| 4 | [27 Bounties and hackathons](27-bounties-and-hackathons.md) | Creates runs from bounties; feeds 28. |
| 4 | [32 EVM secondary leg](32-evm-secondary-leg.md) | Extends the venue interfaces after Solana is complete. |
| 5 | [14 Desktop app release](14-desktop-app-release.md) | Ships the console over everything above. |
| 5 | [23 Distribution into every agent framework](23-distribution-into-agent-frameworks.md) | Packages 01, 03 and 17 for other agents. |
| 5 | [34 Localization](34-localization.md) | Translates what exists. |
| 5 | [36 Agent evals and replay](36-agent-evals-and-replay.md) | Measures everything above; smoke suite into the gate. |

## Rules that apply to every brief

- `CLAUDE.md` governs. The four stop-and-ask gates apply, and nothing else stops the work. In particular: any fund-moving action in a test or dry run renders recipient, amount, token and chain and waits for the owner's explicit yes.
- Solana first. Every surface ships and is verified on Solana before any EVM leg is considered.
- No mocks, no placeholders, no TODOs, no sample arrays. Every tool, route, page and state is real and wired.
- Every fund-moving or irreversible tool takes an explicit confirm flag, is disabled by default, and has a quote or preview tool that must be called first. Prompt 03 defines the shared policy; every later prompt registers its tools under it.
- Each brief ends only when the definition of done in `CLAUDE.md` holds: reachable in the UI, exercised in a real browser, no console errors, tests green with `npm test`, docs written, `data/changelog.json` entry appended, `STRUCTURE.md` row added for a new surface, `npm run audit:docs` clean, `npm run check:rules -- --paths <your files>` clean.
- Never name a third-party token in committed code, fixtures or docs. Refer to venues by capability and by the module that integrates them. The promoted coin is `$THREE` only.
- Commit your own finished work promptly with explicit paths and a message that describes the diff.
