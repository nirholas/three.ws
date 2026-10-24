# 432. `RUN-ORDER.md` routes every fresh agent session to dead links; rewrite it from the live queue

How to run: paste this file's repo path into a fresh Claude Code chat in this repository and say "run this work order". Runnable now, no gate. This is a documentation-accuracy fix, not a code fix: no test file is applicable (nothing under `tests/` exercises `prompts/*.md` prose), so the "bug fixes are test-first" clause does not apply; the verification is mechanical link-checking, specified in Step 0 and the Definition of done.

## Operating clause (binding)

- Read CLAUDE.md first. CLAUDE.md overrides everything, including this file.
- Finish 100% in this session. Never end the turn with a question, an option list, or an unexecuted plan.
- The only permitted stops are the CLAUDE.md stop-and-ask gates (spend/on-chain, push/deploy, posting externally, the crypto-project commit gate, destroying unrecoverable data). This order touches none of them.
- The em-dash and en-dash characters are banned in everything you write.
- Concurrent agents share this worktree: stage explicit paths only (never `git add -A` or `git add .`), re-check `git status` and `git diff --staged` before committing.
- Do not re-rank or second-guess which open orders matter most as part of this order; that is a separate, ongoing job (the evolve scout lane does it per session, dated). This order's job is narrower: make `RUN-ORDER.md` and `README.md`'s queue table stop citing files that do not exist, and make `RUN-ORDER.md`'s probe numbers current instead of six weeks stale.

## Why this matters (measured 2026-10-24)

`prompts/README.md` line 18 tells every fresh agent: "Why the order is what it is:
[RUN-ORDER.md](RUN-ORDER.md). It ranks the queue into tiers against live production
measurements." `RUN-ORDER.md` itself tells the agent its whole point is to be pasted and followed
link by link: "sort the folder by name and you are reading it in priority order, so you can open
one, run it, and open the next without consulting anything" (line 4-5).

Every link in `RUN-ORDER.md`'s P0 through P6 tables was checked against the live directory on
2026-10-24 and every single one is dead:

    for f in finish/402-auto-restore-green-gate.md finish/swarm-100-sweep-console.md \
      finish/fix-queue-03-cron-drift-garment-sweep.md finish/production-100-04b-fact-check-publish-run.md \
      finish/swarm-100-sweep-authed-audit.md finish/quality-bar-07-design-system-sweep.md \
      finish/quality-bar-04-pbr-texture-material-realism.md finish/quality-bar-08-mobile-performance.md \
      finish/swarm-100-sweep-perf.md finish/quality-bar-03-gpu-fleet-scaleout.md \
      finish/quality-bar-10-avatar-likeness-irl-people.md finish/swarm-100-sweep-i18n.md \
      finish/roadmap-generation-suite.md finish/gcp-credits-05-catalog-animation-seeding.md \
      finish/event-06-photo-mode-share.md finish/event-02-play-polish-sweep.md \
      finish/openai-pr-06-docs-accuracy-reconciliation.md finish/openai-pr-07-final-verification-and-submit.md \
      finish/backlog-05-r2-bucket-cors.md finish/backlog-09-telegram-bots-durability.md \
      finish/roadmap-native-widgets.md finish/home-00-CONTEXT.md finish/swarm-100-route-launch.md; do
      [ -f "prompts/$f" ] && echo "EXISTS: $f" || echo "MISSING: $f"
    done
    # -> every single row printed MISSING on 2026-10-24

The document's own band table (lines 9-20) claims counts that do not match the directory either:
it claims 149 route-audit orders at `100`-`248` and 14 Home orders at `300`-`313`; the live
directory (`ls prompts/finish/*.md | wc -l` -> 96 on 2026-10-24) has zero files in either numeric
range. Its top probe block (lines 27-37) is dated 2026-09-06 and quotes a production state (a
different git SHA, a different healthz down-count, a different sponsor-wallet SOL shortfall) that
has been superseded by dozens of commits and several already-shipped/retired orders since
(confirmed: order `402` it names at line 70 no longer exists; order `400` it names at line 69 no
longer exists either).

`README.md`'s own queue table (the `| Prefix | What it is |` block) is less actively misleading
because it hedges itself ("Counts are the state measured on 2026-09-03... trust the directory,
never this table," line 70), but it still describes `home-`, `quality-bar-`, `event-`,
`fix-queue-`, `gcp-credits-`, `roadmap-`, `openai-pr-`, `swarm-100-` as campaigns with open orders,
and every file each of those rows names by path (`finish/home-00-CONTEXT.md`, the `swarm-100-route-*`
examples in `RUN-ORDER.md`'s P5 section, etc.) is confirmed missing above. A fresh agent session
reading either file first (as the scout lane's own briefing and `README.md` line 7 both instruct:
"Open a work order there, paste it, run it") wastes a full turn discovering this, which is exactly
the kind of stall CLAUDE.md's self-unblock playbook exists to prevent, except here the fix is
simply correcting the document instead of routing around it.

This is high leverage because it is read first, every session, before any other order.

## Step 0: re-derive the current state

    git log --oneline -1
    ls prompts/finish/*.md | wc -l
    ls prompts/finish/*.md | xargs -n1 basename | sort
    ls prompts/finish/_context/*.md | xargs -n1 basename | sort
    curl -s https://three.ws/api/version
    curl -s https://three.ws/api/healthz | python3 -m json.tool | head -60
    git rev-parse --short main

Re-run the dead-link loop in "Why this matters" against the current directory; the exact filenames
may have shifted (more orders retired, a few new ones filed) since this order was written, but the
underlying problem, a ranking document pointing at files that no longer exist, will reproduce
against whatever the current gap is. Treat the loop as a technique, not a fixed list.

## Tasks

1. Build the actual current queue table: `ls prompts/finish/*.md | xargs -n1 basename | sort`, group by prefix (the part before the first `-NN-` or the campaign word, matching `README.md`'s existing prefix convention), and count each group. Cross-check against `prompts/finish/_context/*-PROGRESS.md` and `*-00-CONTEXT.md`/`*-00-INDEX.md` files for any campaign-level framing worth keeping (campaign narrative, shared facts, numbering conventions); do not invent new framing, carry forward what is still true and drop what names missing files.
2. Rewrite `prompts/README.md`'s "## The queue" table (the `| Prefix | What it is |` block) so every row only names files that exist today, and the intro sentence above it states today's real total count and today's date instead of 2026-09-03's. Keep the table's existing voice and format; this is a content refresh, not a restructure. Drop any prefix row entirely if zero files with that prefix exist (e.g. if `home-`, `event-`, `fix-queue-`, `gcp-credits-`, `quality-bar-`, `swarm-100-`, `openai-pr-`, `roadmap-`, `backlog-` truly have no open files left per task 1's count, say so plainly as retired-and-removed-from-the-table rather than leaving a stale row).
3. Rewrite `RUN-ORDER.md` end to end against the current directory: new Step-0-style probe block at the top (today's `api/version`, `api/healthz`, `git rev-parse --short main`, commits-ahead-of-production count) dated today; new tier tables (P0 onward, keep the existing tier concept: owner-only actions first, then highest-value runnable work, in descending priority) built only from files that exist, cross-referenced one by one against `prompts/finish/_context/production-100-OWNER-ACTIONS.md` so owner-gated rows are correctly flagged and non-gated rows are not. Keep the file's existing structure (the "Not tasks" section, "Keeping this file true" section) since those are still accurate; replace only the stale probe block and the tier tables.
4. Grep both rewritten files for every path they cite (`grep -oE '\[[^]]*\]\(([^)]*\.md)\)' prompts/README.md prompts/RUN-ORDER.md` or equivalent) and confirm each resolves to a real file with `[ -f ... ]` before committing. Zero dead links is the bar, not "fewer dead links."
5. Do not touch any file under `prompts/finish/` other than `README.md` and `RUN-ORDER.md` themselves; do not retire, rewrite, or renumber any individual work order as part of this task.

## Definition of done

- [ ] Every markdown link inside `prompts/README.md` and `prompts/RUN-ORDER.md` that points at a path under `prompts/` resolves to a real file (verified by a shell loop, output shown in the report).
- [ ] `RUN-ORDER.md`'s top probe block is dated today with real command output, not copied from this file or any prior version.
- [ ] `README.md`'s queue table lists only prefixes with at least one existing file in `prompts/finish/`, with today's date and today's real total count.
- [ ] No work order file under `prompts/finish/` was deleted, retired, renumbered, or edited by this order.
- [ ] `npm run check:rules -- --paths prompts/README.md prompts/RUN-ORDER.md` exits 0 (if this script does not lint `prompts/`, say so in the report rather than skipping the check silently).
- [ ] Commit with explicit paths; subject names the actual fix (e.g. `docs(prompts): rebuild RUN-ORDER.md and README's queue table from the live directory, not the 2026-09-06 snapshot`).

## Never blocked

| Looks like a blocker | It is not | Do this |
|---|---|---|
| Deciding the "right" priority order for 96 live files feels like a big judgment call | This order is not asking you to re-rank the queue's substance, only to stop citing dead files and refresh the probe numbers; keep the existing tier logic and campaign groupings, just populate them with what is actually in the directory today | If a campaign's relative priority genuinely changed, say so in one line of the report; do not treat it as a blocker or a question |
| Some campaign's `_context/*-PROGRESS.md` is itself ambiguous about whether the campaign is fully retired | Check the directory, not the prose: zero matching files in `prompts/finish/` for that prefix means retired from the table, regardless of what a progress log claims | Trust `ls`, not a status line, exactly as `README.md`'s own conventions section already instructs |
| `npm run check:rules` has no lint rule that covers prose files under `prompts/` | That is a finding to report, not a reason to skip verification | Run the manual dead-link grep loop from task 4 regardless, and say plainly in the report whether `check:rules` covered this or not |

## Close out (required)

1. Verify every Definition of done line with the command output in front of you.
2. Commit with explicit paths (`prompts/README.md`, `prompts/RUN-ORDER.md`).
3. Delete this file in the final commit (`git rm prompts/finish/432-auto-rewrite-stale-run-order-doc.md`) once every Definition of done line is verified green, and append a dated entry to `prompts/finish/_context/production-100-PROGRESS.md` with the commit SHA. If a line cannot pass, leave the file and say which line remains and why.
4. Final report, in this order: the dead-link count found before the fix and the zero-dead-link confirmation after, the new queue table/tier summary, the commit SHA. No trailing questions.
