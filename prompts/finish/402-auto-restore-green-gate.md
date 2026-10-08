# 402. Restore a green `npm run gate`: 17 of its 55 steps fail on `main`

How to run: paste this file's repo path into a fresh Claude Code chat in this repository and say "run this work order". Runnable now, no gate. Written by the evolve scout lane on 2026-10-08 from the measurements below. Independent of [401](401-auto-restore-green-vitest.md) (that one owns `npm run test:core`; this one owns every other gate step), so either can run first.

## Operating clause (binding)

- Read CLAUDE.md first. CLAUDE.md overrides everything, including this file.
- Finish 100% in this session. Never end the turn with a question, an option list, or an unexecuted plan. A judgment call goes in one line of the final report; it never becomes a question that halts work.
- The only permitted stops are the CLAUDE.md stop-and-ask gates: spending real funds or any irreversible on-chain write, git push or a production deploy, posting to an external channel, committing content that names a crypto project other than $THREE, and destroying unrecoverable data. **The coin gate bites here**: several MCP packages and manifests this order regenerates name third-party projects. Regenerating an existing file whose third-party references were already committed is not new content, but any NEW listing copy, overlay text or doc prose you write must not name another crypto project. If a fix cannot avoid it, leave that hunk uncommitted and list it in the report.
- No mocks, no fake data, no unfinished-work markers, no commented-out code. Never make a guard pass by weakening the guard, deleting its check, or raising a budget without a dated reason that states the measured number.
- The em-dash and en-dash characters are banned in everything you write.
- Concurrent agents share this worktree: stage explicit paths only (never `git add -A` or `git add .`), re-check `git status` and `git diff --staged` before each commit, and commit each step's fix as its own topical commit.
- Before committing, run `npm run check:rules -- --paths <files you touched>`. It must exit 0.

## Why this matters (measured 2026-10-08, 17:45 UTC, `main` at `aa23c8fd0`)

`npm run gate` is the repository's own definition of a shippable tree, and `npm run check:claude` inside it is what keeps CLAUDE.md true for every agent. It is a `&&` chain, so the first red step hides the rest. Running each of its 55 steps on its own gave 38 green and these 17 red:

| Step | First lines of the failure |
|---|---|
| `check:claude` | `CLAUDE.md claims 100% README coverage but 2 dir(s) have none: workers/agent-gateway, services/autopilot`; also `path .claude/worktrees/ is referenced but does not exist` (that directory exists only on a machine that has spawned subagent worktrees, so the check fails on every fresh clone and in evolve's worktree) |
| `check:model-viewer` | two `<model-viewer>` versions in the tree: majority 4.0.0, `4.3.1` in `src/erc8004/register-ui.js` |
| `check:event` | `public/event.json` window ended 2026-09-25T17:00Z, "countdown, agenda, fireworks, souvenir grant and event leaderboard are all silently dormant" |
| `audit:mcp` | 37 violations across 52 manifests, e.g. `packages/x402-mcp/server.json: version 0.2.2 ≠ package.json 0.2.3` (seven packages bumped `package.json` without `server.json`) |
| `audit:mcp-golden` | 39 contract changes vs the golden fixture (new tools such as `preview_transfer` in `packages/portfolio-mcp`, and a whole new `packages/solana-memo-media-mcp`) |
| `audit:mcp-safety` | a preview mint tool in one MCP package "declares destructiveHint:false but its handler shows funds-transfer, which cannot be undone" (the audit names the file) |
| `audit:mcp-catalog` | `public/mcp-catalog.json is stale` |
| `audit:mcp-listing` | no curated listing copy for `packages/solana-memo-media-mcp/server.json` |
| `audit:mcp-surfaces` | resource/prompt listings stale in `server.json`, `server-agent.json`, `public/.well-known/mcp.json` |
| `audit:docs` | 7 findings: dead link `satellites/oracle-desk/README.md:126 -> .env.example`, `workers/agent-gateway` has no README, 5 served docs missing from `data/pages.json` (`docs/grok.md` and four `docs/ibm-community-*` posts) |
| `check:docs-freshness` | `106 stale / 468 watch / 129 fresh`, budget 5 stale, "over budget by 101" |
| `audit:motion-tokens` | `497 literal(s) in transitions (baseline 158)` |
| `audit:guards` | `scripts/check-xai-models.mjs looks like a guard but is not in data/guards.json` |
| `check:announce` | `activity-mcp-hero` media in the manifest but its file is missing; `data-desk-hero` never captured |
| `check:skills-pack` | `public/skill.md` stale: run `node scripts/build-skills-pack.mjs` |
| `audit:tour-global` | `public/tour-builder/tour.global.js` stale: run `npm run build:tour-global` |
| `check:doc-media` | `forge-prompt-panel.webp no longer matches the manifest sha256` (generated image edited by hand) |

The two with user-facing weight: `audit:mcp-safety` (an MCP client is told a fund-moving tool is safe to call without confirmation) and `audit:mcp-surfaces` / `audit:mcp-catalog` (what the MCP registries and `/.well-known/mcp.json` advertise is not what the servers serve).

## Step 0: re-derive the current state

    git log --oneline -1
    node -e 'console.log(require("./package.json").scripts.gate.split("&&").map(s=>s.trim().replace(/^npm run /,"")).join("\n"))' > /tmp/gate-steps.txt
    for s in $(cat /tmp/gate-steps.txt); do npm run -s $s > /tmp/gate-$s.log 2>&1; echo "$? $s"; done | tee /tmp/gate-results.txt | grep -v '^0 '

`audit:upstreams` rewrites `data/upstream-baseline.json` as a side effect; if it shows in `git status` after the sweep and you did not mean to update it, restore it with `git checkout -- data/upstream-baseline.json`. `test:gate` and `test:gate-3d` were green on 2026-10-08; if they are red now, they are in scope too. Steps already green when you measure are done; skip them.

## Tasks

Work in this order (safety first, then what the public sees, then hygiene):

1. **`audit:mcp-safety`.** Read the named handler. If it can move funds, set `destructiveHint: true` (and `readOnlyHint: false`); if the audit misreads a preview that only builds an unsigned transaction, prove it from the code and fix the audit's detection rather than the annotation, with a test in the audit's test file. Rebuild that package's published catalog after.
2. **MCP manifests, catalog and listings** (`audit:mcp`, `audit:mcp-golden`, `audit:mcp-catalog`, `audit:mcp-listing`, `audit:mcp-surfaces`). Bring each `server.json` version to its `package.json`. Review the 39 golden contract changes one by one: each ADDED or CHANGED tool must trace to a commit that intended it (`git log -S '<tool name>'`); then refresh with `node scripts/audit-mcp-golden.mjs --update`. A REMOVED tool with no intentional commit is a regression to fix in code, not in the fixture. Regenerate the catalog and surfaces with the scripts each audit names. Write the missing listing overlay in plain product language describing what the package does, without naming any third-party crypto project.
3. **`check:claude`.** Write `workers/agent-gateway/README.md` and `services/autopilot/README.md` to the CLAUDE.md standard (what it does, how to run it, its public surface, one runnable example) from the code itself. For `.claude/worktrees/`, fix the checker (`scripts/check-claude-md.mjs`) to accept a path that is gitignored runtime state (confirm it is in `.gitignore`), or reword the CLAUDE.md line so it names the cleanup script instead of the path; either way the check must pass on a fresh clone. Run `npm run check:claude` after.
4. **`audit:docs`.** Add `docs/grok.md` to `data/pages.json`. For the four `docs/ibm-community-*` posts, decide publish vs `UNPUBLISHED_DOCS` (they read as drafts for an external community; the script's message says to record the reason). Fix the oracle-desk dead link to a file that exists or remove the link.
5. **`check:model-viewer`.** Move `src/erc8004/register-ui.js` to the pinned version; read `api/_lib/model-viewer-cdn.js` first.
6. **`check:event`.** The meetup is over. Read `scripts/check-event*.mjs` and the event docs to find the documented post-event state (an archived or cleared `public/event.json`, or `npm run event:schedule` for the next one). Do not invent a new event date. If the only documented path is scheduling, archive the event so the guard reports "no active event" rather than "dormant", and make the guard accept that state explicitly with a test.
7. **Regenerations**: `node scripts/build-skills-pack.mjs`, `npm run build:tour-global`, and re-capture `forge-prompt-panel.webp` with the doc-media capture script (`check:doc-media` names it; use `npx vite --port 3107` if it needs a dev server, never port 3000). For `check:announce`, run `npm run announce:media` for the two shots; if capture needs an authed page, use `npm run audit:web:login` first.
8. **`audit:guards`.** Register `scripts/check-xai-models.mjs` in `data/guards.json` with the stage it runs in (find who calls it), or add an exempt pattern with the reason.
9. **`audit:motion-tokens`** (497 vs baseline 158). Find which commits added the 339 new literals (`git log -S` on a few), replace them with the existing motion tokens the audit expects (read the audit script for the token names), and re-run until the count is at or below the baseline. Do not raise the baseline.
10. **`check:docs-freshness`** (106 stale, budget 5). Run `npm run docs:freshness -- --doc <path>` on the stale docs ordered by how user-facing they are (`docs/` pages linked from `data/pages.json` first), read the commits each one names, and correct what drifted. Refresh as many as the session allows, at least 30. Then set `maxStale` in `data/docs-freshness-budget.json` to the measured remaining count, with a dated reason naming this order and the count, so the budget ratchets down from an honest number instead of being permanently red. Leave a new scout-band order (`prompts/finish/4xx-auto-docs-freshness-remainder.md`, next free number, same standard as this file) for the remainder.

## Definition of done

- [ ] Re-running the step 0 loop prints no failing step (`grep -v '^0 ' /tmp/gate-results.txt` is empty), with `test:gate` and `test:gate-3d` still 0.
- [ ] `npm run gate` exits 0 end to end.
- [ ] `git diff <step-0 sha> -- data/docs-freshness-budget.json` shows a dated reason with a number, and the remainder order file exists if any docs are still stale.
- [ ] `git diff <step-0 sha> -- scripts/audit-*.mjs scripts/check-*.mjs` contains no deleted check and no loosened threshold except the documented freshness ratchet.
- [ ] `npm run check:rules -- --paths <files you touched>` exits 0.
- [ ] `git status --short` shows nothing left from this order except hunks deliberately held for the coin gate, each listed in the report.

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| A regenerated manifest or catalog contains another crypto project's name | It was already committed upstream of the generator; regenerating is fine. New prose you author must avoid it. If unsure, hold that hunk and list it. |
| You cannot tell whether a golden-fixture change was intended | `git log -S` the tool name; a tool added in a `feat(...)` commit is intended. A tool that vanished with no commit saying so is a regression to fix. |
| A capture script needs a browser or a login | `npx playwright install chromium`; `npm run audit:web:login` mints the QA session from `AUDIT_EMAIL` / `AUDIT_PASSWORD` in `.env` (or `npm run audit:web:provision` if they are missing). |
| The docs-freshness remainder is too large for one session | That is expected: ratchet the budget to the honest count with a dated reason and write the remainder order. That is the documented escape hatch, not a shortcut. |
| Another agent fixes some steps while you work | Re-run the loop; do not redo their work. |
| The event guard has no "over" state | Add it with a test; a guard that can only be satisfied by inventing a future event is a guard bug. |

## Close out (required)

1. Verify every Definition of done line with the command output in front of you. Never claim a line you did not verify.
2. Commit with explicit paths, one topical commit per step (e.g. `fix(mcp): mark the preview mint tool destructive because its handler transfers funds`).
3. If every line passes, delete this file in the final commit (`git rm prompts/finish/402-auto-restore-green-gate.md`) and append a dated entry to `prompts/finish/_context/production-100-PROGRESS.md` with the commit SHAs. If a line cannot pass, leave the file, log which line remains and why.
4. Final report, in this order: the step 0 failing list; per step, the root cause and commit SHA; the final loop output; held hunks, if any; one-line judgment calls. No trailing questions.
