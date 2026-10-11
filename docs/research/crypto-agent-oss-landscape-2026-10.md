# Open-source crypto and agent landscape, 2026-10

Survey date 2026-10-09. Question asked by the owner: which open-source crypto and agent repositories beat three.ws, and how do we take their features where the licence allows, and out-build them where it does not. Rival projects are anonymized here by the repository naming rule; the build list is [prompts/finish/_context/beat-00-CONTEXT.md](../../prompts/finish/_context/beat-00-CONTEXT.md).

Every claim about an external repository was gathered from public READMEs, release notes and docs on 2026-10-08 and 2026-10-09. Star counts are approximate and move daily. Re-verify in each order's step 0.

## Verdict

No single repository beats three.ws as a whole. three.ws is the only one that combines custodial Solana agent wallets with layered spend guards, x402 buying and selling, a launchpad, a skill marketplace with royalties, 3D avatars, chat gateways and 73 MCP servers. The repositories below beat it in narrow places, and those places are where users compare us. Twenty-seven gaps are worth closing.

## Reference classes and licences

The legend matches [roadmap-REUSE-MAP.md](../../prompts/finish/_context/roadmap-REUSE-MAP.md): permissive licences allow adoption; copyleft and unlicensed code is reference only.

| Class | What the best of them do that we do not | Typical licence | Posture |
|---|---|---|---|
| General agent runtimes (largest, 250k+ stars) | Write skills from experience, agent-curated memory, full-text session search, many sandbox backends | MIT | Port the idea, reimplement (orders 601, 602) |
| Trading research stacks (35k to 110k stars) | Look-ahead bias audits, point-in-time datasets, data-source canaries, research code walled from live endpoints, single-file HTML reports | Apache-2.0, MIT | Reimplement (620, 621) |
| Market-making and strategy frameworks (20k to 55k stars) | Non-interactive CLI with JSON and stable exit codes, offline reports, gateway with many Solana routers | Apache-2.0 for one, GPL-3.0 for the largest | Behavior only for the GPL one (614, 621) |
| Multi-channel trading bots | 20 plus chat surfaces, prediction markets, risk engine with VaR and Kelly sizing, agent-only forum | MIT | Reimplement (616, 618) |
| Solana Foundation payment tooling | CLI that pays x402 and MPP challenges from the OS keychain, MCP server with payment permissions, metered sessions, subscriptions and allowances program | MIT, Apache-2.0 | Adopt packages (603, 605, 608) |
| Infrastructure vendor agent kits | Domain-routed MCP with summary-first results, agent self-onboarding paid in USDC | MIT | Reimplement (604, 625) |
| Wallet vendor agent servers | Device login, pay tool, perps tools, user-set spending limits | MIT | Reference (606, 615) |
| Trading skill packs | Sub-second orders, one-shot buy with TP and SL, typed confirmation, token due-diligence fields, burner wallet with owner confirmation, ratcheting trailing stops | MIT, MIT-0 | Reimplement (606, 614, 618, 619) |
| Landing and DEX toolkits | A dozen landing providers raced concurrently, many DEX adapters | MIT, ISC | Reimplement (617) |
| Launch SDKs | Holder rewards, shared fee vaults, fee scheduler, rate limiter, referral fees | MIT (SDK), GPL-3.0 (one DEX SDK) | Adopt the MIT SDKs only (627) |
| Agent commerce stacks | Escrow with evaluator and disputes, credit and time plans, prepaid off-chain request paths batch-settled on-chain, one definition served on several rails | MIT, Apache-2.0, ISC | Reimplement (609 to 613) |
| Agent registries and identity | Solana registry with sybil-resistant trust tiers, on-chain agent identity | MIT, custom | Adopt the MIT SDK (622) |
| Skill ecosystems | Open skills format with one-command install, large registries (with a malware incident) | MIT, Apache-2.0 | Publish ours, scan others (623, 624) |

Two licence traps to remember: the largest open strategy framework and several market-making and quant stacks are GPL or AGPL, and several agent-kit repositories carry a custom licence or none. Neither can be ported.

## Gap table

What three.ws already has is not repeated. Each row is a missing or weaker capability, the order that closes it, and the evidence it matters.

| Gap | Order | Evidence |
|---|---|---|
| No path from a good run to a reusable skill | 601 | The strongest runtimes of 2026 do this by default |
| Memory ignores outcomes; decision ledger is not tamper-evident | 602 | Trading agents need to learn from P&L; chained trails are cheap |
| No CLI that pays an arbitrary 402 with permissions | 603 | The Solana payer CLI and its MCP mode are the reference |
| An agent cannot become a customer on its own | 604 | Infrastructure vendors now do agent self-signup paid in USDC |
| Budgets are enforced only in our database | 605 | The Solana Subscriptions and Allowances program shipped 2026-06-02, audited and live |
| Single custodial policy, no owner confirmation tier | 606 | Mobile agent apps ship capped burner plus main-wallet confirmation |
| Only the exact x402 scheme | 607 | x402 v2 defines upto, batch settlement and extensions; Solana carries most x402 volume |
| MPP only on BNB | 608 | MPP now extends to Solana via pay-kit |
| Skills priced on one rail | 609 | Frameworks serve one handler on x402, MPP and A2A |
| Escrow has no evaluator, dispute or auto-release | 610 | Escrowed-job standards define all three |
| No credit or time plans for paid MCP tools | 611 | Payment platforms gate MCP tools behind plans |
| Tiny settlements starve the settle floor | 612 | Prepaid balance with batched settlement removes the failure class |
| Agents cannot receive verification mail | 613 | Agent toolkits ship an inbox with OTP extraction |
| Order engine built but not deployed; no ratcheting exits | 614 | `workers/agent-orders` has never shipped |
| One perps venue, off on MCP | 615 | Wallet vendors ship Hyperliquid perps tools; Jupiter perps is the Solana peer |
| No native Solana prediction venue, no shadow mode | 616 | Best references default to shadow mode and scan for fee-aware no-arbitrage |
| One landing route | 617 | Landing toolkits race many providers |
| No trade commands in chat | 618 | Trading bots live in Telegram; typed confirmation is the safe pattern |
| Thin token due diligence | 619 | Skill packs score smart money, bundlers, snipers, insiders, fresh wallets |
| Backtests unaudited, research not walled from live | 620 | Research stacks audit look-ahead and pin datasets |
| CLI is interactive-first, no portable reports | 621 | Strategy frameworks ship JSON, exit codes and HTML reports |
| Not in the Solana agent registry | 622 | Registry with trust tiers is what hiring agents consult |
| Weak publish-time scanning of skills | 623 | Hundreds of malicious skills hit a large public registry in early 2026 |
| Skills not installable by other runtimes | 624 | Solana tooling moved from SDK kits to installable skills |
| Full-payload MCP results, no docs-search tool | 625 | Best MCP servers summarize first and expand on demand |
| `/v1` endpoint not payable per request | 626 | Wallet-holding agents buy model access per call |
| New launch SDK fee features unexposed | 627 | Fee scheduler, shared vaults, referral fees shipped in 2026 |

Also found, not given an order because the work is documentation: `docs/perps.md`, `docs/predictions.md` and `docs/chat-gateways.md` do not exist (orders 615, 616 and 618 create them).

## Deliberately skipped

- **Launch tiers and modes.** Prior research ([launchpad-landscape-2026-09.md](launchpad-landscape-2026-09.md)) says not to add them or promise buybacks.
- **Enclave custody.** A later decision; the current custody model is unchanged.
- **On-device models.** One framework ships them; our brain router already reaches every hosted model and the GPU lanes.
- **Equities.** Robinhood means crypto only.
- **EVM-first features.** Several references are Base-first. Every order builds the Solana path; EVM legs are follow-ups.

## How the licence rule is applied

Permissive references are adopted as maintained npm packages where one exists (semver range) and otherwise reimplemented from documented behavior. Copyleft, custom-licence and unlicensed references are read for public behavior only and the feature is written from a prose description, never from their source. The orders carry this rule, plus the naming rule, in [beat-00-CONTEXT.md](../../prompts/finish/_context/beat-00-CONTEXT.md).

## Sources

Public repositories and docs for each class above; the Solana Foundation announcement of Subscriptions and Allowances (2026-06-02); the x402 specification and package changelogs; the Machine Payments Protocol and pay-kit documentation; the Agent Skills specification; reporting on the early-2026 malicious skills incident. Exact URLs are recorded per order in its step 0 and final report, not here.
