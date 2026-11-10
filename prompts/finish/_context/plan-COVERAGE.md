# Planning corpus coverage ledger

Every tracked markdown file in the repository on 2026-11-03 (2969 files), and what became of it in the sweep that produced the `plan-` work orders. Use it to answer "was this doc turned into a task?" for any file. The queue itself is [plan-00-INDEX.md](plan-00-INDEX.md).

| Disposition | Files | Meaning |
|---|---:|---|
| order | 196 | Outstanding work was found; it is now the linked work order(s), with this file copied verbatim inside, or referenced by path where inlining would have pushed the order past the 50,000-character paste limit. |
| shipped | 211 | The work it describes exists in the code today (the note names the evidence). |
| covered-by-existing | 90 | An order that was already in the queue covers it. |
| no-open-work | 803 | Reviewed: reference or descriptive doc with nothing outstanding. |
| not-a-plan | 269 | Content, rules, or configuration rather than work to do. |
| owner-only | 97 | Open, but only the owner can do it (no agent-doable part). |
| retired-by-owner | 16 | The owner retired this work on 2026-09-09 (finish/_context/00-RETIRED-BY-OWNER.md). |
| excluded | 1284 | Not reviewed for tasks by category (vendored code, skill bundles, published content, existing orders). |

## Where each row lives

The per-file table is split across the parts below, sorted by path, so every file stays under the 50,000-character paste limit. Find one file's row with `grep -h '<path>' prompts/finish/_context/plan-COVERAGE*.md`.

| Part | Paths | Rows |
|---|---|---:|
| [plan-COVERAGE-1.md](plan-COVERAGE-1.md) | `.agents/README.md` to `ARCHITECTURE.md` | 365 |
| [plan-COVERAGE-2.md](plan-COVERAGE-2.md) | `assistant-sdk/README.md` to `docs/agent-symphony.md` | 379 |
| [plan-COVERAGE-3.md](plan-COVERAGE-3.md) | `docs/agent-system.md` to `docs/ops/ibm-hosted-page-audit.md` | 452 |
| [plan-COVERAGE-4.md](plan-COVERAGE-4.md) | `docs/ops/image-selfie-3d-review-2026-10-09.md` to `docs/x-partner-series.md` | 430 |
| [plan-COVERAGE-5.md](plan-COVERAGE-5.md) | `docs/x-posts/3d-ar-studio-launch.md` to `packages/clash-mcp/README.md` | 368 |
| [plan-COVERAGE-6.md](plan-COVERAGE-6.md) | `packages/companion-sdk/README.md` to `robinhood/robinhood-chain-examples/examples/02-stock-price-sdk/README.md` | 408 |
| [plan-COVERAGE-7.md](plan-COVERAGE-7.md) | `robinhood/robinhood-chain-examples/examples/03-portfolio-valuation/README.md` to `third_party/designcode-agent-skills/agent-skills/web-design/funky-purple-container-tech/demo/PROMPT.md` | 346 |
| [plan-COVERAGE-8.md](plan-COVERAGE-8.md) | `third_party/designcode-agent-skills/agent-skills/web-design/funky-purple-container-tech/SKILL.md` to `x402-payment-modal/TUTORIAL.md` | 218 |
