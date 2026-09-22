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
