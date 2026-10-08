# elevate: shared context for every `elevate-` work order

Not a work order. Never run this file; read it when an order names it.

## What the campaign is

Fifty work orders, written 2026-10-08, that improve, build and innovate across the whole platform: the 3D core, agents, the create-to-coin funnel, the Solana economy, trading surfaces, the developer platform, reliability, and retention. Each order was grounded in a measurement of this repo and of production taken the day it was written, and each closes one gap a user would notice.

The orders are numbered `067` to `116` by priority: a live defect outranks an unshipped fix, an unshipped fix outranks a new feature, and anything that unblocks several other orders outranks anything that unblocks one. Run them in numeric order unless an order names a dependency.

## Not this campaign (do not duplicate)

These queues already own their areas. If an `elevate-` order drifts into one of them, stop at the boundary and link the owning order instead of building a second copy.

| Queue | Owns |
|---|---|
| `parity-` (015 to 022, 919 to 925) | Creator-earnings API, `/analytics`, the earnings leaderboard, sell-an-agent-as-x402, `/experiments`, `/stories`, the $THREE "per $100" flow, MCP use cases and paid-call `retry_safe`, npm publish of `three-ws`, community skill sync, directory listings, comparison page, builder competition, key tiers, launch-by-mention |
| `x-grok-` (023 to 066, 926 to 931) | Grok Bot connector work, the `/grok` page, xAI as a provider, the whole X @-mention bot stack |
| `home-` | three.ws Home (smart home) |
| `materialize-` | 3D printing and physical fulfillment |

## Production state (measured 2026-10-08; re-derive before relying on any line)

| Probe | Result |
|---|---|
| `curl -s https://three.ws/api/version` | `76081013b`, revision `three-ws-api-00476-225`, built 2026-10-01 |
| commits on local `main` not in production | 18 |
| `curl -s https://three.ws/api/healthz` subsystems | `down`: `x402_settle` (0 of 36 paid settles in 3h; 36 `sweep_broadcast_failed`, 53 refused at the fee-wallet floor), `agent_index` (32m median Solana lag, 128 of 1,663 agents erroring; EVM cursor 639h stale), `three_token_rail` (`THREE_TREASURY_WALLET` and `THREE_REWARDS_WALLET` unset). `degraded`: `helius`, `rpc_lanes` (all 3 paid lanes exhausted), `sniper` (out of capital) |
| `GET /api/platform/analytics` (30d) | 785 new agents, 176 new agents with a wallet, 2 coin launches, 20,900 models generated, 233.7M LLM tokens, 63,212 x402 settlements ($10,145, includes the platform's self-cycled ring), 0 marketplace sales, $0 hire volume, 0.000269 SOL creator fees |

The headline: people make agents and 3D models in volume, and almost nothing turns into a coin, a sale, a hire or a return visit. Most orders in this campaign attack that conversion, or the reliability under it.

## Facts every order relies on

- **$THREE** mint `FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump` on Solana. It is the only coin the platform promotes. The platform never burns $THREE (`SPLIT_POLICIES` in [api/_lib/token/config.js](../../../api/_lib/token/config.js)).
- **Solana first.** Build and verify on Solana before any EVM leg.
- **Numbers on pages come from live APIs**, fetched at render time or generated at build time, each with a "how it's calculated" line. Never type a figure into copy.
- **Spend gate.** Anything that pays, launches, transfers or settles shows amount, asset, chain and recipient and waits for an explicit yes. Launching signs with the agent's custodial wallet only from a same-site browser session.
- **Commit gate.** Anything naming a crypto project other than $THREE needs the owner's yes before commit. Never name a competitor platform in committed files.
- **Orientation:** [STRUCTURE.md](../../../STRUCTURE.md) maps every surface to its directory.

## The work-order template (every `elevate-` order follows it)

    # elevate NN: <title in plain words>

    How to run: paste this file's repo path into a fresh Claude Code chat in this repository and say "run this work order". <Runnable now, no gate | Runnable after order NNN | Gated: ...>

    ## Operating clause (binding)
    (the eight bullets below, verbatim)

    ## Why this matters
    Who benefits and how, with the measured evidence (file paths, line refs, production numbers, the command that produced them).

    ## Step 0: re-derive the current state
    The exact commands, indented four spaces. If step 0 shows the work already shipped, say so, delete the file in a closing commit, log it, and stop.

    ## Tasks
    Numbered, concrete: real file paths, real endpoints, real tables, real commands.

    ## Definition of done
    Checkbox lines, each mechanically checkable.

    ## Never blocked
    | Blocker | Resolution (act, do not ask) |

    ## Close out (required)
    (the four steps below, verbatim, with this order's filename)

The operating clause, verbatim:

    - Read CLAUDE.md first, then [_context/elevate-00-CONTEXT.md](_context/elevate-00-CONTEXT.md). CLAUDE.md overrides everything, including this file.
    - Finish 100% in this session. Never end the turn with a question, an option list, or an unexecuted plan. A judgment call goes in one line of the final report; it never becomes a question that halts work.
    - The only permitted stops are the CLAUDE.md stop-and-ask gates: spending real funds or any irreversible on-chain write, git push or a production deploy, committing content that names a crypto project other than $THREE, and destroying unrecoverable data. Where this order hits one, it says so, and you batch every such ask into ONE message after everything else is done.
    - Never name a competitor platform in anything you commit.
    - No mocks, no fake data, no placeholder stubs, no unfinished-work markers, no commented-out code. Real APIs and real integrations only.
    - The em-dash and en-dash characters are banned in everything you write.
    - Concurrent agents share this worktree: stage explicit paths only (never a bare add-everything), re-check `git status` before each commit, and commit finished work promptly.
    - Before committing, run `npm run check:rules -- --paths <files you touched>`. It must exit 0.

The close out, verbatim:

    1. Verify every Definition of done line with the actual command output in front of you. Never claim a line you did not verify.
    2. Commit with explicit paths and a subject that describes the diff (house style: `type(scope): what changed and why a reader cares`).
    3. If every Definition of done line passes, delete this file in that same commit (`git rm prompts/finish/<this file>`) and append a dated entry to [_context/elevate-PROGRESS.md](_context/elevate-PROGRESS.md) with the commit SHAs. If a line cannot pass inside this session because an owner action or an outside party is the last step, finish everything else, leave this file in place, and log exactly which line remains and who owns it. Never delete this file on a partial.
    4. Final report, in this order: what step 0 measured; what changed (file list with commit SHAs); evidence for each Definition of done line; the single batched owner message, if the order has a gate; one-line judgment calls. No trailing questions.

## How a new page is wired (all five, every time)

1. The page: `pages/<name>.html` (copy the head block, theme boot script, `nav.js` header and `/i18n.js` tail from [pages/connect.html](../../../pages/connect.html)). Colors and spacing come from the tokens in `public/tokens.css` / `public/style.css`.
2. The route: a `{ "src": "/<name>/?", "dest": "/<name>.html" }` row in `vercel.json`, near a sibling page.
3. The build input: a `<name>: resolve(__dirname, 'pages/<name>.html')` line in `vite.config.js`.
4. The index: an entry in `data/pages.json` (`path`, `title`, `description`, `priority`, `changefreq`, `added`), then `npm run build:pages`.
5. The map: a row in `STRUCTURE.md`. Nav entries go in `public/nav-data.js`; the lite menu is capped at 30 items by `tests/onboarding-tier.test.js`, so new items default to `tier: 'advanced'`.

Verify in a real browser: `npm run dev` (port 3000; reuse it if another agent is serving), then drive the page with Playwright at 375, 768 and 1440 px in dark and light themes, with zero console errors and every loading, empty and error state exercised. Throwaway Playwright scripts go in `scripts/` with a `.tmp-` prefix and are deleted after.

## Order index

See [elevate-PROGRESS.md](elevate-PROGRESS.md) for the index table and the per-session log.
