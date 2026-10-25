# prompts/

Internal work-order documents for Claude agents: self-contained prompts, each written to be pasted
into a fresh Claude Code chat and executed to 100% without further input. These are operator
documents, not a product surface. Nothing here ships to users.

**Everything still to finish lives in one folder: [finish/](finish/).** Open a work order there,
paste it, run it. That folder is the whole queue; nothing outstanding is filed anywhere else.

**The filenames are the running order.** Since 2026-09-07 every order is numbered by priority,
so sorting the folder by name gives you the sequence to work through: open the first file, run
it, open the next. As of 2026-10-25 the live ranges are `023` to `039` (the `x-grok-` campaign),
`067` to `095` (`best3d-` and `partners-`), `401` to `499` (written by the evolve scout lane,
[../docs/ops/evolve.md](../docs/ops/evolve.md), which also runs this queue unattended), `506`
to `549` (`integrate-`), `605` to `627` (`beat-`), and `902` and up (blocked on an owner action,
so read one before you start it). A retired order is deleted and its number left as a gap, so a
link to a numbered order keeps pointing at the same work.

**Why the order is what it is: [RUN-ORDER.md](RUN-ORDER.md).** It ranks the queue into tiers
against live production measurements. The numbers carry the sequence; that file carries the
reasoning, and it is the one to re-derive when the measurements change.

Campaign indexes, briefs, runbooks and progress logs are not tasks and live in
[finish/_context/](finish/_context/), unnumbered, so they are never opened as the next thing to
run. Read the one your order names.

## Layout

| Path | What it holds |
|---|---|
| [finish/](finish/) | Every open work order, flat, one file each. The filename is `<campaign>-<order>.md`, so `911-okx-ai-08-forge-relisting.md` is the relisting order of the OKX.AI campaign. Sorting the directory groups each campaign together. A campaign's index (`<campaign>-00-INDEX.md`, `-00-CONTEXT.md`, `-README.md`) and its handoff log (`<campaign>-PROGRESS.md`) sit beside its orders under the same prefix. |
| [masters/](masters/) | The nine reusable master prompts. They take a supplied TARGET instead of fixed tasks and never retire, so they are not part of the finish queue. |
| `<campaign>/_generated/`, `okx-ai/assets/`, `okx-ai/e2e-evidence/` | Machine-written evidence (JSON captures, screenshots, transcripts) produced by scripts. These stayed at their original paths because scripts read and write them by hardcoded path; see **Runtime consumption** below. |
| [bnb-chain/](bnb-chain/), [robinhood-chain/](robinhood-chain/) | Two fully shipped campaigns kept as reference: their context and progress files carry adversarially-verified chain facts that other work still cites. No open orders. |

## Conventions

- A campaign's index or shared-facts file carries the facts every one of its orders needs. Each order names its index in its own opening lines; read it first.
- Orders keep their original numbering (`01-`, `02-`) after the campaign prefix when run order matters.
- `<campaign>-PROGRESS.md` is the cross-chat handoff log: the only memory between sessions. Agents append to it when they finish.
- **A finished order is deleted**, in its own closing commit, only after its deliverables are verified shipped in the codebase. `finish/` shrinking is the progress ledger.

## The work-order standard (every open work order follows it)

A work order is a paste-and-run document. Pasting the whole file into a fresh Claude Code chat
in this repo must be enough for an agent to finish the job without asking the owner anything.
Each one carries, in this order:

1. **A how-to-run line**: paste this file, or name its path.
2. **A binding operating clause**: finish 100%, never end with a question or an unexecuted plan,
   plus the CLAUDE.md hard rules that bite most often (no mocks, no TODOs, no em-dash, explicit-path
   commits, deploys and pushes are owner-gated).
3. **Step 0, re-derive the current state**, with the exact commands. This is the load-bearing
   part: a work order's own status claims rot within weeks, so the agent measures first and
   skips whatever already shipped. Never trust a status line, including the ones in these files.
4. **Tasks** with real file paths, real endpoints and real commands.
5. **A definition of done** whose every line is mechanically checkable.
6. **A "never blocked" table** pre-answering the blockers that have historically stalled this
   work, so the answer is in the file instead of in the owner's inbox.
7. **A report format**, so the session ends with evidence rather than a recap.

The only interruptions a work order may contain are the CLAUDE.md stop-and-ask gates: spending
real funds, an irreversible on-chain write, a push or production deploy, a commit that
references a crypto project other than `$THREE`, and destroying unrecoverable data. Where one is
unavoidable, the work order batches every human touchpoint into a single message and does
everything else around it.

## The queue

Every campaign with open work, and what its files under [finish/](finish/) cover. Counts are the
state measured on 2026-10-25 (82 open orders across six active campaigns plus the evolve-lane
`auto-` orders and six standalone closeouts); trust the directory, never this table. For the
order to run them in, see [RUN-ORDER.md](RUN-ORDER.md).

| Prefix | What it is |
|---|---|
| `auto-` (`401` to `436`) | Written by the evolve scout lane ([../docs/ops/evolve.md](../docs/ops/evolve.md)) from dated measurements, runnable with no gate. Four open: [restore a green `test:core`](finish/401-auto-restore-green-vitest.md) (52 failing files, 108 failing tests), [drain the docs-freshness backlog](finish/403-auto-drain-docs-freshness.md) (127 docs describing code that moved), [fix the `account_link_codes` table-name collision](finish/433-auto-fix-account-link-codes-schema-collision.md) breaking every phone/desktop/CLI/Telegram account-link call in production, [give `/api/social/sentiment-pulse` a last-known-good fallback](finish/435-auto-sentiment-pulse-lkg-fallback.md), and [decouple the forge-finalize TTL reap from its live poll](finish/436-auto-forge-finalize-ttl-reap-decoupling.md) (780 `forge_creations` rows stuck in `generating`, 96% of the last 24h never finished). |
| `backlog-` | The open backlog, two items: [x402 settle runway](finish/902-backlog-01-x402-settle-runway.md) (code half done; needs the sponsor-wallet funding in `production-100-OWNER-ACTIONS.md` row 2) and [the OKX chat-bot always-on fix](finish/907-backlog-08-okx-chat-bot-always-on.md). |
| `beat-` | Closing the gaps found in the 2026-10-09 survey of open-source crypto and agent repositories. 12 open, runnable, on-chain steps devnet/simulation only: `605`, `606`, `610`, `614`, `615`, `616`, `619`, `621`, `622`, `623`, `626`, `627` (on-chain allowance budgets, a burner wallet with owner confirmation, the hire-escrow evaluator and disputes, the orders engine with ratcheting exits, perps venues, Solana prediction markets in shadow mode, token due diligence and a funding graph, agent CLI automation and HTML reports, Solana agent registry registration, a skill supply-chain scanner, a metered OpenAI-compatible router, and launch-fee/holder-reward features). Context: [finish/_context/beat-00-CONTEXT.md](finish/_context/beat-00-CONTEXT.md). |
| `best3d-` | Closing the gaps found by the 2026-10-09 sweep of open-source and commercial 3D ([docs/research/3d-landscape-2026-10.md](../docs/research/3d-landscape-2026-10.md)). 10 open: `067`, `068`, `069`, `070`, `074`, `081` runnable (TRELLIS.2 default lane, Pixal3D multi-view, non-humanoid rigging, editable parts, the WebGPU TSL path, splat parity) plus `932` to `935` owner-gated (pricing preview and pay-to-keep, SAM 3D Objects, the orphaned-avatar campaign, engine store publishing). Shared facts: [finish/_context/best3d-00-CONTEXT.md](finish/_context/best3d-00-CONTEXT.md). |
| `integrate-` | Bringing the owner's other repositories into three.ws. 13 open, runnable: `506`, `510`, `512`, `525`, `530`, `534`, `536`, `539`, `540`, `544`, `545`, `548`, `549` (the pump.fun claims listener, the per-coin earnings source, the native-lane anti-snipe fee, skill import from Anchor IDL, MCP registry cleanup, news reader lanes, the $THREE-post impact tracker, coin intel signals, a memo/inscription reader, chains turnover, a 3D funder graph, Robinhood Chain launch venues, and the hookforge catalog). Context: [finish/_context/integrate-00-CONTEXT.md](finish/_context/integrate-00-CONTEXT.md). |
| `okx-ai-` | Taking the three.ws 3D Studio listing (agent #2632) to approved status on OKX.AI. Three open orders, owner-gated: [the real-payment gauntlet](finish/913-okx-ai-04-e2e-real-payment-test.md), [forge relisting](finish/911-okx-ai-08-forge-relisting.md), and [the final audit and watch](finish/914-okx-ai-07-final-audit-and-watch.md), plus a runbook. |
| `parity-` | Closing the gaps a teardown of a leading agent launchpad found ("Competitor X", [docs/research/competitor-teardown-2026-09.md](../docs/research/competitor-teardown-2026-09.md)). Seven open, owner-gated: `919` to `925` (shipping and publishing, a community skill registry, directory listings, a "why three.ws" page, a builder competition, pricing levers, and a mention-to-launch flow). Shared facts: [finish/_context/parity-00-CONTEXT.md](finish/_context/parity-00-CONTEXT.md). |
| `partners-` | Working the 2026-10-09 partner prospects list ([docs/partners/prospects.md](../docs/partners/prospects.md)). 13 open: `085`, `087`, `088`, `091` to `095` runnable (the Mixamo-clip animation library license, LiveKit and Pipecat avatar plugins, a Discord Activity, a Shopify product-media app, VRoid Hub import, agent-framework tool packages, site-builder embeds, the HACS package) plus `936` to `940` owner-gated (the Tripo reply and house key, sponsorships, third-party submissions, program applications, a Sketchfab re-tag). Shared facts: [finish/_context/partners-00-CONTEXT.md](finish/_context/partners-00-CONTEXT.md). |
| `roadmap-` | Two open, runnable: [pump.fun trading](finish/917-roadmap-pumpfun-trading.md) and [the pump.fun trading arena](finish/918-roadmap-pumpfun-trading-arena.md); the sniper-arming and capital steps are owner-gated per `production-100-OWNER-ACTIONS.md` row 19. [The reuse map](finish/_context/roadmap-REUSE-MAP.md) still carries license-vetted OSS notes. |
| `simulation-ready-` | The physics-grade asset campaign: turning generated 3D into assets a rigid-body simulator can consume unedited. Retired 2026-09-03: the architect pass ran and all 8 of its build tasks shipped, so both files are gone and the surface is documented in [docs/sim-readiness.md](../docs/sim-readiness.md) and its `STRUCTURE.md` row. |
| standalone closeouts | Six fully-built orders with no shared campaign prefix, each owner-gated on its last step: [the Google OAuth connector](finish/954-oauth-connector-google.md) (create the OAuth client), [the Uniswap lane](finish/957-uniswap-lane-and-launch-status.md) (deploy the launcher contract), [creator-fee payouts](finish/958-creator-fee-payouts.md) (deploy, browser-check, flip `CREATOR_PAYOUTS_LIVE`), [the desktop agent runtime](finish/961-desktop-agent-runtime.md) (code-signing certificates), [the Telegram approvals inbox](finish/962-approvals-inbox-telegram.md) (a throwaway bot token), and [the revenue ledger](finish/965-revenue-ledger-reinvest.md) (browser check, deploy, first live reinvest rule). |
| `x-grok-` | three.ws inside Grok Bot and on X. Nine open: `023`/`024`/`039` runnable (the connector compatibility probe, cloud-agent rate limits, the xAI MCP end-to-end proof) plus `926` to `931` owner-gated (the owner's X API tier, the owner's Grok API key, going live with the mention bot, connector directory listings, the launch announcement, and player-card approval). Shared facts: [finish/_context/x-grok-00-CONTEXT.md](finish/_context/x-grok-00-CONTEXT.md). |

Fully completed campaigns leave the queue once every order is verified shipped (x402-catalog and
x402-overhaul were retired 2026-07-28; agent-briefs, whose world-online program shipped through
Phase 3, and user-value, all seven of whose orders shipped, were retired 2026-07-30); their orders,
progress logs, and evidence remain readable in git history. Open items they still carried were
re-homed into [../ISSUES.md](../ISSUES.md) and then into the `backlog-` orders.

As of 2026-10-25, `event-`, `fix-queue-`, `gcp-credits-`, `home-`, `materialize-`, `openai-pr-`,
`production-100-`, `quality-bar-`, `store-submissions-` and `swarm-100-` carry zero files under
[finish/](finish/) (the old `015` to `022` and `100` to `313` ranges are now entirely empty gaps)
and are removed from this table on that basis alone, per the directory-over-prose rule above; this
is not a claim that every one of them shipped, only that nothing under that prefix is left to run.
Each one's history, including whether it shipped or was abandoned, is in its own
`finish/_context/<prefix>-PROGRESS.md` or `-CONTEXT.md`. `production-100-00-INDEX.md`,
`-OWNER-ACTIONS.md` and `-PROGRESS.md` are still live and cross-referenced by other rows in this
table; they just carry no open order files of their own today.

Individual orders retire the same way. Retirement policy, unchanged: delete only after the
deliverables are verified shipped in the codebase, never merely because a progress log claims done.

On 2026-09-01 a repo-wide sweep re-verified every open order against code and production and
retired fourteen (event 01/03/04/05/07, backlog 02/03/04/06, the OpenAI pack's briefs 01 to 05)
plus the fable-audit index, and rewrote the production-100 map from the measurements; the
per-order evidence is in each campaign's log and in
[production-100/PROGRESS.md](finish/_context/production-100-PROGRESS.md).

On 2026-09-08 the `fable-audit-` pack retired entirely: its last file (the residuals order) was
verified line by line and deleted. The cron guard sweep and its four negative fixtures, the
payment-outcome board and page, and the regenerated skills seed are all in the codebase; the one
step this machine cannot take (attaching the Cloud Scheduler OIDC identity, which needs a live
`gcloud auth login`) is a runbook in [../docs/ops/cron-auth.md](../docs/ops/cron-auth.md), not a
work order.

On 2026-09-02 every open order moved out of its per-campaign directory into [finish/](finish/) so
the queue is one folder instead of fourteen. Nothing was rewritten beyond link paths; the campaign
is now the filename prefix.

## Runtime consumption

The server does not read this directory. Two kinds of code references exist:

1. Comments across `api/` and `scripts/` may cite prompt files as the design source for a feature. Before retiring a prompt file, grep for inbound references and rewrite them to name the campaign + work order instead of the path (the robinhood-chain pack was once wiped by cleanup without this step and had to be restored). Retirement policy (owner directive 2026-07-28): a work order is deleted only after its deliverables are verified shipped in the codebase; partial or blocked work orders stay.
2. A few evidence scripts write output here, by hardcoded path. That is why the evidence directories did NOT move into `finish/` when the work orders did: `scripts/tokenize-3d-devnet-e2e.mjs`, `scripts/embodiment-evidence.mjs`, `scripts/persona-identity-evidence.mjs`, `scripts/agent-hire-settle.mjs` and `scripts/sync-studio-openapi.mjs` write into `store-submissions/_generated/` (the last one keeps `openai-actions.yaml` byte-identical to the served schema, and `tests/api/3d-studio-openapi.test.js` reads it), `scripts/mobile-perf.mjs`, `scripts/mobile-touch-audit.mjs`, `scripts/avatar-likeness-audit.mjs` and `scripts/irl-realism-check.mjs` write into `quality-bar/_generated/`, and `scripts/export-satellites.mjs` reads from `roadmap/_generated/`. Moving one of these means updating its script in the same change.

## Adding a file

- A new work order for an existing campaign goes in [finish/](finish/) as `<campaign>-<nn>-<slug>.md`, following that campaign's numbering and its index file's format.
- A new campaign starts with its own `<campaign>-00-CONTEXT.md` (or `-00-INDEX.md`) in the same folder, plus a `<campaign>-PROGRESS.md` if the work spans multiple chats. No new directory.
- Evidence a script writes goes in `<campaign>/_generated/`, not in `finish/`, and the script names that path.
- One-off machine reports do not belong here; script-written sweep reports go in [../tasks/](../tasks/).
