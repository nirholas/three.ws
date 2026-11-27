# prompts/awaiting-owner/

Work orders whose code, tests and docs are finished and committed, and whose only remaining step
belongs to the owner: a production or worker deploy, a key or OAuth app, a funding transfer or
other spend, a store or directory listing, a licence, or a product decision. Nothing an agent can
do on its own is left in any of them.

They were moved here from [../finish/](../finish/) on 2026-11-27 by the
[queue audit](../finish/_context/queue-audit-2026-11-27.md), which checked every order against
the code rather than against its own status line. Keeping them out of `finish/` means agents and
the evolve loop ([../../docs/ops/evolve.md](../../docs/ops/evolve.md), which reads only
`finish/`) stop spending sessions re-verifying finished work.

## What each order still needs

The audit's **CODE-DONE/OWNER** section lists every order here with its exact remaining step,
grouped by the owner action that clears it:

- A. One production deploy (`npm run deploy:gcp:full`).
- B. Worker or service deploys.
- C. Credentials, env vars and OAuth apps.
- D. Funding and on-chain actions (every one needs the owner's yes).
- E. Migrations, already applied in production; a follow-up check remains.
- F. Publishing, listings, store submissions and outreach.
- G. Owner decisions and licences.
- H. The GCP billing hold.
- I. Owner checks, hardware and outside inputs.

Thirteen owner-waiting orders (902, 911, 913, 914, 917, 954, 957, 958, 961, 962, 965, 970 and
978) are still in `finish/`. Moving them changes lines that name other crypto projects, so the
move waits on the owner's approval under the CLAUDE.md commit gate.

## Using an order here

1. The owner does the step the audit names for that order (or tells an agent to, where the step
   is a deploy or config change an agent can run once approved).
2. Paste the order into a fresh Claude Code chat to run it. Its step 0 re-measures the current
   state, and its definition of done is the check that the owner step worked.
3. When every definition-of-done line is verified, `git mv` the order to
   [../archive/](../archive/) and add its row to [../archive/README.md](../archive/README.md).
   Some orders still say "delete this file" or name their old `finish/` path: archive them
   anyway, the same way as every other retired order.
4. If running it turns up agent work that is not done, `git mv` it back to `../finish/` with a
   dated line saying what is missing.

Filenames keep their numbers, so a link or note that names an order by number still identifies
the same work.
