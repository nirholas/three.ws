# 420. Fix the interactive-state regression: two clickable selectors with no hover rule

How to run: paste this file's repo path into a fresh Claude Code chat in this repository and say "run this work order". Runnable now, no gate, no owner action required.

## Operating clause (binding)

- Read CLAUDE.md first. CLAUDE.md overrides everything, including this file.
- Finish 100% in this session. Never end the turn with a question, an option list, or an unexecuted plan.
- Bug fixes are test-first: the failure is reproduced below. Confirm it fails for the stated reason, fix it, confirm green, commit test and fix together.
- Concurrent agents share this worktree: stage explicit paths only (never `git add -A` or `git add .`), re-check `git status` and `git diff --staged` before committing.
- No em-dash/en-dash anywhere you write.

## Step 0: re-derive the current state

    npm run audit:states

As measured 2026-10-24, this fails with:

    ✗ interactive-state gaps increased: 2 clickable selector(s) with no hover rule (baseline 0).

      src/earnings.css: 1 (was 0)
          .er-toggle
      public/marketplace.css: 1 (was 0)
          .sp-bundle > summary

`scripts/audit-interactive-states.baseline.json` currently reads `{"total": 0, "perFile": {}}` (confirm with `cat scripts/audit-interactive-states.baseline.json`), so this is a genuine regression against a clean baseline, not a pre-existing known gap. `scripts/audit-interactive-states.mjs` flags any CSS selector that sets `cursor: pointer` (promising the element is clickable) with no sibling `:hover` rule; this is the automated form of the CLAUDE.md definition-of-done requirement "every interactive element has hover, active, and focus states."

Confirm each site directly:

    grep -n '\.er-toggle' src/earnings.css
    grep -n '\.sp-bundle' public/marketplace.css

`src/earnings.css` line 134: `.er-toggle { display: inline-flex; align-items: center; gap: 10px; cursor: pointer; font-size: var(--text-sm); }` is a label wrapping a checkbox toggle on the earnings page; line 136 already gives its inner `input` a `:focus-visible` ring, but `.er-toggle` itself has no `:hover`.

`public/marketplace.css` line 5506: `.sp-bundle > summary { cursor: pointer; font-size: 13px; margin-bottom: var(--space-sm); }` is a disclosure `<summary>` for the publish-skill supply-chain scan results; line 5572 already gives it a `:focus-visible` ring (`#sp-check:focus-visible, .sp-bundle > summary:focus-visible { outline: 2px solid var(--accent, #00d9ff); outline-offset: 2px; }`), but no `:hover`.

If step 0 now passes (`✓` / gaps at or below baseline), run `git log --oneline -5 -- src/earnings.css public/marketplace.css scripts/audit-interactive-states.baseline.json` to find the fix and retire this order per the "Never blocked" table.

## Root cause

Both selectors were added (or had `cursor: pointer` added) without a matching `:hover` rule, and nothing caught it before merge because `npm run audit:states` is not wired into a pre-commit hook, only into manual/CI-style runs. The baseline mechanism exists precisely to catch this kind of drift, and it did: `total` went from 0 to 2.

## Task

1. In `src/earnings.css`, add a `:hover` rule immediately after the existing `.er-toggle` block (after line 134), following this file's own token conventions used elsewhere (e.g. `var(--ink-dim)`, `var(--stroke-strong)` as seen in `.er-run`/`.er-confirm` nearby). A minimal, consistent choice: lighten the label text or add a subtle background, for example:

       .er-toggle:hover { color: var(--ink); }

   Adjust to whatever reads correctly against `.er-toggle`'s actual rendered content (a checkbox plus label text) when checked visually; the exact tokens matter less than that a visible, non-zero change occurs on hover.

2. In `public/marketplace.css`, add a `:hover` rule immediately after the existing `.sp-bundle > summary` block (after line 509), following the same file's own precedent for similar clickable summary/button elements (e.g. `.market-sort:hover { background: var(--surface-2); border-color: var(--accent); }` at line 156). A consistent choice:

       .sp-bundle > summary:hover { color: var(--accent); }

   or a background treatment if that reads better against the surrounding `.sp-bundle`/`.sp-scan` block styling; verify visually.

3. Re-run `npm run audit:states` and confirm it reports 0 gaps (back to baseline).
4. Do not run `--update` on the baseline; the fix should restore the existing 0-total baseline, not raise it to accept the regression.

## Done when

- `npm run audit:states` exits with `✓` (gaps at 0, matching `scripts/audit-interactive-states.baseline.json`'s existing `{"total": 0}`).
- `scripts/audit-interactive-states.baseline.json` is unchanged (still `{"total": 0, "perFile": {}}`); the fix closes the gap in the CSS, not by relaxing the baseline.
- Visual check: open `/earnings` and the publish-skill flow (wherever `.sp-bundle` renders, search `src/` for the class to find the page) in a browser or describe the rendered change if a browser is unavailable, confirming the new hover states are visible and not jarring.
- `npm run test:core` shows no new failures versus the pre-change baseline.
- `git diff` touches only: `src/earnings.css`, `public/marketplace.css`.
- Committed on `evolve` with an explicit-path commit naming the fix.
- This file is removed, with a dated entry added to `prompts/finish/_context/production-100-PROGRESS.md` citing the commit SHA.

## Never blocked

| Looks like a blocker | It is not | Do this |
|---|---|---|
| Unsure of the exact hover color/background to use | The audit only checks that a `:hover` rule exists for the selector, not its specific visual treatment | Pick a token-based treatment consistent with nearby rules in the same file (cited above), confirm it renders visibly, move on |
| Tempted to fix by raising the baseline with `--update` | That locks in the regression instead of fixing it; the baseline exists to catch exactly this drift | Add the missing `:hover` rules instead; only ever lower the baseline (via `--update`) when gaps are proven below it, never to accept new ones |
| Step 0 already passes when you check | Another agent may have shipped this | Confirm via `git log --oneline -5 -- src/earnings.css public/marketplace.css`, verify both selectors now have `:hover` rules, retire this order without further changes |
| A browser is not available to visually confirm the hover treatment | Visual confirmation is a nice-to-have, not a blocker on an automated-audit-driven CSS fix | State in the report that the visual check could not be performed and why; the mechanical audit passing is the authoritative done-check |

## Report format

State: the step-0 "before" `audit:states` failure output, the exact `:hover` rule added to each file with its line number, the "after" `audit:states` output (must show `✓`), confirmation the baseline file is unchanged, the `npm run test:core` before/after failure counts, and the commit SHA.
