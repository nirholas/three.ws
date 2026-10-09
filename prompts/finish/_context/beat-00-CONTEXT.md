# beat: shared context for every `beat-` work order

Not a work order. Never run this file; read it when an order names it.

## What the campaign is

On 2026-10-09 the owner asked which open-source crypto and agent repositories beat three.ws, and said: take their features if the licence allows, and where it does not, build better features using them only as a reference. [docs/research/crypto-agent-oss-landscape-2026-10.md](../../../docs/research/crypto-agent-oss-landscape-2026-10.md) is the survey and the gap table. This campaign is the build list. Orders `601-beat-01` to `627-beat-27` each close one gap.

| Lane | What it closes | Orders |
|---|---|---|
| A. Runtime | Skills written from experience, outcome-weighted memory, tamper-evident decisions | 01, 02 |
| B. Wallets | A payer CLI, agent self-onboarding, on-chain allowance budgets, capped burner with owner confirmation | 03 to 06 |
| C. Commerce | x402 v2 schemes, MPP on Solana, one definition on many rails, escrow with evaluator and disputes, credit plans, prepaid batch settlement, agent inbox | 07 to 13 |
| D. Trading | Order engine deploy and ratcheting exits, more perps venues, prediction markets in shadow mode, landing race, chat trade commands, token due diligence, backtest integrity, CLI automation and reports | 14 to 21 |
| E to G | Solana agent registry, skill scanner, installable skills repo, summary-first MCP, metered model router, launch fee features | 22 to 27 |

Dependencies: 603 before 608 and 621 (the CLI), 607 before 626 (the `upto` scheme), 614 before 618 (TP/SL orders), 602 before 606 and 610 (the decision trail), and 500 before 624 can register its mirror. Everything else is parallel-safe.

## Licence rules (three.ws is Apache-2.0)

| Reference licence | What you may do |
|---|---|
| Apache-2.0, MIT, ISC, MIT-0, BSD | Adopt the package as a dependency (semver range). Copying source is allowed by the licence but needs attribution naming the project, which falls under the commit gate below. Default: reimplement the behavior in our own code and idea-level credit nothing. |
| LGPL | Use as an unmodified dependency only if it is already one. Otherwise reference only. |
| GPL, AGPL | Reference only. Do not copy, port, translate or vendor any of it, and do not link it. Describe the behavior in your own words first, then implement from that description. |
| Custom licence, source-available, or no licence | Treat as all rights reserved. Reference only. |
| Protocol specifications (x402, MPP, A2A, AP2, ERC-8004 and kin) | Implement from the published spec. Prefer the maintained official package over hand-rolled code. |

"Reference only" means: read the public README, docs and API behavior; do not paste or transliterate source; write the feature better than the reference, with the guards and the UX this platform already holds itself to.

## Naming rule (binding)

Committed files do not name studied rival projects, their tokens, domains or package names. Write "a reference implementation" or "Competitor X". Plain protocols and the integrations already in this repository (Solana, x402, A2A, pump.fun, Jupiter, Meteora, Helius, Metaplex) may be named. Real names of the rivals appear only in your chat report to the owner. If a step genuinely needs a rival named in a commit (verbatim copied code needing attribution, a licence notice), that is commit-gate content: stop, batch the ask, and continue with everything else.

## Chain priority

Solana first in every design. An EVM leg is added only alongside, never instead. Where a reference is EVM-only, build the Solana path and record the EVM leg as a follow-up. Robinhood means Robinhood Crypto only.

## What not to do

- Do not add launch tiers or launch modes, and do not promise buybacks or returns in any copy (prior research: [docs/research/launchpad-landscape-2026-09.md](../../../docs/research/launchpad-landscape-2026-09.md)).
- Do not onboard a new paid third-party API. GCP surfaces and free public APIs are pre-approved.
- Do not move custody to a third-party enclave; custody stays as designed.
- Do not sign, send, mint or pay on mainnet inside an order. Prove on devnet or by simulation and print the command for the owner.
