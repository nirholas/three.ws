# prompts/archive/

Finished work orders. Each file here was moved out of [../finish/](../finish/) after every line of
its definition of done was verified against the code (tests run, deliverables present, any live or
manual check evidenced). They are a read-only record of what shipped: never paste one into a chat
to run it, and never treat its "Current state" section as current.

Orders retired before 2026-11-06 were deleted instead of archived and remain readable only in git
history (`git log --diff-filter=D -- prompts/finish/`).

| Order | Shipped in | Verified 2026-11-06 |
|---|---|---|
| 735 hire-agent Blink and actions.json discovery | `cb9c71287`, `dbbb45f42` | `tests/actions-hire.test.js` passes; `public/.well-known/solana/actions.json` rules, `vercel.json` route and sweep cron, share-hire button on the agent page, `docs/solana-actions.md`, changelog |
| 749 X content queue validator errors | `015de971b`, `90a2f5c02` and the 2026-11-04 queue refreshes | `npm run x:content -- check` exits 0, `check:announce` passes, both named test files pass, no item newly approved since 2026-11-03, `intel-globe` still paused |
| 779 ENS and DNS name-claim verification | `3eeee3faf` | `tests/agent-name-claims.test.js` passes (the order allows unit coverage for the live curl); `specs/ENS_AGENT_CLAIM.md` no longer says "does not yet verify" |
