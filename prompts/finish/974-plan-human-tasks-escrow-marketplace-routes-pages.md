# Ship the human-task marketplace: routes, pages, agent tools, devnet escrow settlement up to the mainnet gate

**How to run:** paste this entire file into a fresh Claude Code chat opened in the three.ws repository (`/home/user/three.ws`) and send it. Nothing else is needed: everything this order depends on is in this file, including a verbatim copy of the planning docs it came from. It is safe to run on its own, in any order, and at the same time as any other work order. Its path in the repo is `prompts/finish/974-plan-human-tasks-escrow-marketplace-routes-pages.md`.

**Priority:** Gated, the last step needs an owner action or outside party (score 54 of 100 inside the tier). **Area:** tasks. **Written:** 2026-11-03, from a review of the planning corpus that read the source docs listed at the bottom and checked them against the code. Status claims rot, which is why Step 0 re-measures before you build anything.

## Operating clause (binding)

- Read `CLAUDE.md` at the repo root before anything else. It overrides this file wherever they disagree.
- Finish 100% in this session. Do not end the turn with a question, an option list, a plan, or "let me know". Make reasonable judgment calls, act on them, and note each in one line in the final report.
- The only permitted stops are the CLAUDE.md stop-and-ask gates: signing or sending a transaction, spending or moving funds, paying an x402 endpoint, minting or launching a coin; `git push`, production deploys, publishing or posting externally; committing content that references a crypto project other than $THREE; destroying data that cannot be regenerated. Do every other part of the work around a gate, and batch every such ask into one message at the end.
- Enterprise grade, no shortcuts. No mocks, no fake data, no placeholders, no sample arrays, no fake loading or progress, no unfinished-work markers, no stub functions, no commented-out code. Real APIs, real endpoints, real data. Errors are handled at the boundaries (network, user input) with a real recovery path.
- Bug fixes are test-first: write the test that reproduces the bug, watch it fail for the reported reason, fix the code, watch it pass, and commit the test with the fix.
- UI work meets the bar a senior design review would pass: hover, focus and active states on every interactive element, designed empty, error and loading (skeleton) states, keyboard accessible, works at phone width, and verified in a real browser.
- Solana is the home chain and leads every design. Robinhood means Robinhood Crypto only. $THREE (`FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump`) is the only promoted coin; tests and fixtures use it or a clearly synthetic placeholder, never a real third-party mint.
- Never write the em-dash or en-dash characters anywhere (code, docs, UI copy, commit messages). Use a period, comma, colon, parentheses, or a plain hyphen.
- Before writing any non-trivial feature or UI, load `.claude/skills/engineering-standards/SKILL.md`. Before claiming done, load `.claude/skills/changelog-and-docs/SKILL.md`.

## Running alongside other sessions

Many sessions may be working in this same worktree at once. Stage explicit paths only (never `git add -A` or `git add .`), re-check `git status` and `git diff --staged` immediately before each commit, re-read a file right before editing it, and commit your own finished work promptly. Never stash, reset, revert or reformat files you did not change. Start dev servers on a free port (`npx vite --port <free port> --strictPort`), not the default 3000, so you do not collide with another session.

## Why this matters

Agents hit tasks only humans can do (verify a place, make a call, label an image). A marketplace where an agent posts a task, humans quote, claim and submit proof, and escrowed funds release on verification closes that loop and creates a new revenue line. The schema and money/state/verification library are built; no route, page or tool exposes them.

## Current state (measured by the reviewer on 2026-11-03; re-verify)

- Migrations `20260922190000_human_tasks.sql` (human_tasks, human_task_quotes, claims, submissions, uploads, disputes, reviews, events) and `20260925200000_human_tasks_settlement.sql`; lib `api/_lib/human-tasks/{chain,external,money,state,verification}.js`.
- Missing: routes, pages (`/tasks` returns 404), agent tools, tests, docs.

## Step 0: re-derive the current state

Run these first. Skip any task whose outcome already exists, and say so in the report.

```
cd /home/user/three.ws
ls api/_lib/human-tasks api | grep -iE "task"
grep -rn "human-tasks" api src --include=*.js -l | grep -v "_lib/human-tasks"
curl -s -o /dev/null -w '%{http_code}\n' https://three.ws/tasks
sed -n 1,60p api/_lib/human-tasks/state.js; npm run db:status 2>&1 | tail -6
```

Before changing anything, also record the baseline so you can prove you broke nothing:

    git status --short | head -20
    git log --oneline -5
    npx vitest run 2>&1 | tail -8    # note the failing-file count; it is your baseline, not your job unless this order says so

## Tasks

1. Tests first (`tests/human-tasks-state.test.js`, `tests/human-tasks-money.test.js`): legal state transitions only; only the poster can accept a quote; a submission after expiry is rejected; the escrow release amount equals quote minus platform fee; disputes freeze release.
2. Routes under `api/human-tasks/`: create, list, get, quote, accept quote, claim, submit (with upload), verify, dispute, review, cancel; zod bodies; auth; `vercel.json` entries.
3. Pages `/tasks` (browse), `/tasks/new`, `/tasks/:id` with timeline; entries in `data/pages.json`. States: skeleton, empty ("No open tasks. Post one."), error, hover/focus/active, mobile.
4. Agent tools `post_human_task`, `list_task_quotes`, `accept_task_quote`, `verify_task_submission` in `api/_mcpagent/`, escrow-creating tools in the financial tier.
5. Escrow via `chain.js` on devnet: fund, release and refund proven on devnet with throwaway keypairs; script `scripts/qa-human-task-devnet.mjs`.
6. Docs `docs/human-tasks.md`, changelog.

## Definition of done

Every line must be verified with the actual command output or browser observation in front of you. Never claim a line you did not verify.

- [ ] Unit tests pass.
- [ ] `node scripts/qa-human-task-devnet.mjs` prints funded, released and refunded devnet signatures.
- [ ] Pages verified in a browser in all states.
- [ ] Every test you wrote or touched passes (`npx vitest run <those files>`; Playwright specs with `npx playwright test <spec>`). Bug fixes landed test-first: the new test failed before the fix for the reason the bug describes, and passes after.
- [ ] `npx vitest run` shows no new failing files compared with the Step 0 baseline.
- [ ] Any UI you changed was exercised in a real browser on a dev server (`npx vite --port <free port> --strictPort`): no console errors or warnings from your code, real network calls returning real data, and hover, focus, active, empty, error and loading (skeleton) states all designed and observed.
- [ ] `npm run check:rules -- --paths <every file you touched>` exits 0.
- [ ] Documentation is true: the feature doc or README describes what now exists, `STRUCTURE.md` has a row for any new surface or directory, a new page is in `data/pages.json`, and any user-visible change has a `data/changelog.json` entry followed by `npm run build:pages`. `npm run audit:docs` reports nothing new.
- [ ] You reviewed `git diff --staged` line by line before committing, and every changed line is justified.

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| No devnet SOL | `solana airdrop` with retry across RPCs. |
| Upload storage | Use the existing R2/GCS storage helper used by Forge uploads. |
| Missing credential or env var | Read it from the live Cloud Run service: `node scripts/read-service-env.mjs` (or `gcloud run services describe three-ws-api --region us-central1`). Never trust `vercel env pull`; it returns empty secrets. To set one key, use `gcloud run services update --update-env-vars`, never `--set-env-vars` (that replaces the whole set). Load `.claude/skills/self-unblock-playbook/SKILL.md` for the full table. |
| Database schema needed | Write the migration beside the existing ones, read `npm run db:status` first, and remember `npm run db:migrate` applies immediately with no dry run. |
| GCP resource, GPU, or quota | GCP spend for quality and reliability is pre-approved (project `aerial-vehicle-466722-p5`). Create what you need; never downgrade quality to save credits. Do not onboard a new paid third-party API without the owner. |
| Tests failing that you did not touch | Compare with your Step 0 baseline. Pre-existing failures are not yours to fix unless this order says so; report them in one line. Never delete or skip a test to get green. |
| A file changed under you | Another session edited it. Re-read it, keep their change, and apply yours on top. Never `git stash`, `git reset`, `git checkout -- <path>`, or revert work you did not write. |
| Upstream API down or rate-limited | Find the root cause, add a real fallback or retry with backoff, and keep going. Never ship fake data in its place. |

## Gates in this order

- Mainnet escrow funding or release is an on-chain spend: render recipient, amount, token and chain and stop for the owner's yes. All asks batched into one message at the end.

## Close out (required)

1. Verify every Definition of done line with real output in front of you.
2. Commit with explicit paths and a message that describes the diff: `type(scope): what changed and why a reader would care`. Split unrelated changes into separate commits. If the diff references a crypto project other than $THREE, stop and ask the owner before that commit (CLAUDE.md commit gate).
3. If every Definition of done line passes, delete this work order in your final commit (`git rm prompts/finish/974-plan-human-tasks-escrow-marketplace-routes-pages.md`) and append one dated line to `prompts/finish/_context/plan-PROGRESS.md` (create it if missing): the date, `974-plan-human-tasks-escrow-marketplace-routes-pages.md`, the commit SHAs, and one sentence on what shipped.
4. If the last step belongs to the owner or an outside party, finish everything else, keep this file, add a dated "Status" paragraph directly under its title saying exactly what remains and who owns it, and append the same to `prompts/finish/_context/plan-PROGRESS.md`.
5. Never push or deploy unless the owner's message that started this session explicitly told you to. Leave the ship as one command (`git push threews main`, then `npm run deploy:gcp:full` per `.claude/skills/deploy-runbook/SKILL.md`) and name it in the report.

## Final report

Reply with, in this order and nothing else: what Step 0 measured; what you changed (files and commit SHAs); evidence for each Definition of done line; the one batched owner message, if any gate was hit; one line per judgment call. No trailing questions.

## Source material (verbatim)

The planning docs this order was derived from, copied on 2026-11-03 so this order stands alone even if they move or are deleted. Typography was normalized to the house style (dashes become hyphens, uppercase unfinished-work markers are lowercased, and a code comment that reads like a statement gets a trailing period so the repo lint does not mistake it for commented-out code); nothing else was changed. Where a source still exists, the live file may be newer: re-read it, and trust the code over both.

### `docs/prompts/31-human-task-fulfillment.md` (whole file)

~~~~markdown
# 31. Physical-world tasks: agents hire humans with escrowed USDC

Read `docs/prompts/README.md` first.

## The problem

An agent can pay other agents and paid APIs. It cannot get something done in the physical world: pick up an item, deliver a package, photograph a location, stand in a line. The `api/irl/` surfaces cover presence, not work. Competitors have shown the pattern: the agent posts a task with a bounty, a human accepts, does it, and gets paid.

## Build

- **Task marketplace:** migrations for `human_tasks` (poster agent, title, instructions, location or remote, deadline, bounty in USDC, escrow reference, status: open, accepted, submitted, approved, disputed, paid, cancelled), `human_task_claims`, `human_task_submissions` (photos and notes in GCS), `human_task_reviews`.
- **Escrow:** the bounty is locked from the agent wallet on post through the platform signer, released on approval, refunded on cancel before acceptance or on a dispute resolved for the poster; disputes go to a review queue with an owner-gated resolution. Same custody ledger and guards as everywhere else.
- **Tools:** `human_task_post` (`confirm_spend`, quotes the bounty and fee first), `human_task_list`, `human_task_status`, `human_task_approve` (`confirm_release`), `human_task_cancel`, `human_task_dispute`.
- **Worker side:** `/tasks` (in `data/pages.json`) for humans: browse by location and category, accept, submit proof, get paid to a connected wallet or a card from prompt 12; identity verification level per task tier; ratings both ways feeding `docs/agent-reputation.md`.
- **Optional external fulfillment:** an adapter interface for third-party human-task networks so a task can be mirrored there when our pool has no taker; onboarding any such network is owner-gated, so ship the adapter and list the credential.
- Docs: `docs/human-tasks.md` linked from `docs/start-here.md`; changelog entry tagged `feature`.

## Acceptance

- Post a small task from the QA agent and stop at the owner confirmation table (gate 1); with the yes, accept it from a second QA account, submit proof, approve, and see the payout signature.
- Cancelling before acceptance refunds escrow.
- `npm test` green.
~~~~

