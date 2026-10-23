# The Pump.fun Trading Arena: what remains

**Trimmed 2026-10-23.** Phases 0 to 6 of the original master plan are shipped and verified
(Arena `/play/arena`, proof page `/trader/:id`, `/strategy-lab`, custodial `/mirror` and
non-custodial `/dashboard/copy`, anti-gaming in `api/_lib/copy-eligibility.js`, Risk Officer in
`workers/agent-sniper/risk-officer.js`, public trade receipts, tournaments, meta-allocator).
Re-verified this session: `npx vitest run` on the risk officer, copy eligibility, copy engine,
copy earnings, tournament scoring and arena tournament API suites, 121 tests passing.
Hot-streak badges on the Arena board shipped in `d06feb19b` (`api/_lib/win-streak.js`).
The full original text is in git history (`git log -- prompts/finish/918-roadmap-pumpfun-trading-arena.md`).

**The only promoted coin is `$THREE`.** Launched or traded pump.fun coins are user runtime data.

## Owner-gated (do not do without a yes)

1. Arm the Risk Officer to `enforce` (changes what real SOL buys): `SNIPER_RISK_OFFICER=enforce`
   via `--update-env-vars` (never `--set-env-vars`), or per strategy via `risk_officer_level`,
   only after the shadow-P&L query in `workers/agent-sniper/README.md` shows `block` and
   `caution` reviews losing more than `none` across enough closed, joined rows.
2. Refill the sniper fleet's trading capital (a SOL spend). Last measured 2026-10-10: 6/11 armed
   wallets tradeable, 0.2827 SOL needed, funding master holds 0.0250 SOL. Row 19 of
   [production-100-OWNER-ACTIONS.md](_context/production-100-OWNER-ACTIONS.md).

## Unshipped product ideas from section 5 (build, no gate)

- Live spectator chat per agent during active trading.
- "Clone the champ": one-tap fork of a top agent's strategy into paper mode.
- "Backtest battle": 24h public paper forward-test ranking of submitted strategies.
- Push of a hot-streak event to an agent's followers (the board badge is shipped).

## Retire this prompt when it is done (required)

1. Verify every Definition of done line against actual command output in front
   of you. Never claim a line you did not verify.
2. Record the outcome in this campaign's PROGRESS or INDEX file if it has one.
3. Commit with explicit paths and a subject that describes the diff (house
   style: type(scope): what changed and why a reader cares), and delete this
   prompt file in that same commit:

       git rm prompts/finish/918-roadmap-pumpfun-trading-arena.md

   A finished order left on disk reads as open work to the next agent, so the
   shrinking directory is the campaign's progress ledger.

If a line genuinely cannot pass inside this session (an external party must
respond, or an owner-gated action is the final step), finish everything else,
leave this file in place, and state exactly which line remains and who owns it.
Never delete this file on a partial.
