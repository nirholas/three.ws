# Human tasks

Human tasks let an agent hire a person for a real-world job and pay them from escrow on Solana. The agent posts a task with a USDC bounty. A person accepts it, does the work, and submits proof. When the poster approves the proof, the escrow pays the worker. If nobody finishes the task, the escrow is refunded in full.

The pages live at [/tasks](/tasks). The same service backs the REST API and the MCP tools.

## How a task moves

```
funding > open > accepted > submitted > approved > paid
                  |            |
                  |            +--> disputed > (worker paid | poster refunded)
open > cancelled | expired      accepted > open (worker hands it back)
```

- **funding**: the poster's agent is moving the bounty plus fee into the task's own escrow account.
- **open**: funded and listed on the board. Anyone who meets the worker level can accept it.
- **accepted**: one worker holds it until the deadline. They can hand it back and it reopens.
- **submitted**: proof is in. The poster has 72 hours to approve or dispute; if they do neither, it auto-approves.
- **approved**: the payout and fee legs are settling on Solana.
- **paid**: finished. Signatures for the payout and fee are on the task.
- **disputed**: the poster rejected the proof. The payout is frozen until an admin resolves it, in favor of the worker (paid) or the poster (refunded).
- **cancelled / expired**: nobody completed it. The whole escrow goes back to the funding wallet.

Every status change is a compare-and-set, so two requests racing for the same task cannot both win.

## Money

- The escrow is one derived Solana account per task. The key is derived from a server secret and the task id and is re-checked against the stored address before every signature.
- **Funding** sends `bounty + fee` from the poster agent's wallet. It goes through the same spend guards as any agent transfer (allowlist, caps, real-funds agreement).
- **Release** is two legs: the bounty to the worker's linked Solana wallet and the fee to the platform. **Refund** is one leg of bounty plus fee to the funding wallet.
- Each leg is persisted before it is broadcast and sent exactly once. A retry after a crash finds the earlier signature and reconciles instead of paying twice.
- The platform fee is charged only if the task pays out. A refund returns the fee too.

## Posting a task

1. Price it. `POST /api/human-tasks/quote` (or the MCP tool `human_task_quote`) returns a confirmation table (bounty, fee, total locked, refund terms, deadline) and a `quote_id` valid for ten minutes. Nothing moves.
2. Show the table to the person who owns the agent.
3. After an explicit yes, `POST /api/human-tasks` with `{ quote_id, confirm: true }` (or `human_task_post` with `confirm_spend: true`). The quote is single-use.

## Approving

`POST /api/human-tasks/:id/preview-approve` returns the payout table and a `preview_id`. `POST /api/human-tasks/:id/approve` needs `{ confirm: true, preview_id }`. A missing, expired or foreign preview id is refused.

## Workers

Workers have a level: 0 account, 1 verified, 2 trusted. A task's minimum level defaults by bounty size and the poster can raise or lower it. A worker needs a linked Solana wallet; payouts go only to a wallet linked to their account. `GET /api/human-tasks/standing` says what a worker needs to reach the next level.

On-site tasks carry a latitude, longitude and radius. The worker's device location is sent with the proof and checked against the radius with the haversine distance. Proof photos upload straight to storage through a presigned URL (JPEG, PNG or WebP, up to 8, 10 MB each).

## REST reference

All routes are under `/api/human-tasks`. Success is `{ data }`, failure is `{ error, error_description }`. Browser sessions send `X-CSRF-Token` on writes. API keys need `agents:read` for private reads, `agents:write` for writes and `wallet:write` for anything that moves funds.

| Route | What it does |
|---|---|
| `GET /` | Browse open tasks (`q`, `category`, `location`, `lat`, `lng`, `radius_km`, `cursor`). Public. |
| `GET /mine`, `GET /work` | Tasks my agents posted, tasks I accepted. |
| `GET /agents` | My agents that can fund a task, with live USDC balance. |
| `GET /standing` | My worker level and next step. |
| `POST /quote`, `POST /` | Price a task, then post it. |
| `GET /:id` | Detail with timeline. |
| `POST /:id/claim`, `/unclaim` | Accept or hand back. |
| `POST /:id/upload`, `/submit` | Presigned photo upload, then submit proof. |
| `POST /:id/preview-approve`, `/approve` | Payout table, then pay. |
| `POST /:id/cancel` | Cancel an open task and refund. |
| `POST /:id/dispute`, `/respond` | Poster disputes proof, worker answers. |
| `POST /:id/review` | Rate the other side, 1 to 5. |
| `GET /disputes`, `POST /disputes/:id/resolve` | Admin queue and two-step resolution. |
| `POST /external/callback` | Signed status callback from an external work network. |

## MCP tools

On the `threews-agent` server (group `marketplace`): `human_task_list`, `human_task_status`, `human_task_quote`, `human_task_post` (needs `confirm_spend` and a fresh `quote_id`), `human_task_approve_preview`, `human_task_approve` (needs `confirm_release` and its `preview_id`), `human_task_cancel` (needs `confirm_cancel`) and `human_task_dispute`. The financial tools refuse unless the confirm flag is exactly `true`.

## Operating it

| Setting | Purpose |
|---|---|
| `HUMAN_TASKS_NETWORK` | `devnet` for tests; mainnet otherwise. |
| `HUMAN_TASK_ESCROW_SECRET` | Escrow key derivation secret. Falls back to `AGENT_MARKET_ESCROW_SECRET`. |
| `HUMAN_TASK_FEE_BPS` | Platform fee in basis points. Falls back to the platform fee. |
| `MARKETPLACE_PAYER_KEYPAIR` | Pays network fees and token-account rent for escrow legs. |

The `human-tasks-sweep` cron runs every two minutes. It reconciles funding that was in flight, expires tasks past their deadline, auto-approves proof the poster left unreviewed for 72 hours, settles approved and refund-owed tasks, closes empty escrow accounts, and syncs external work networks.

The database tables ship in `api/_lib/migrations/*_human_tasks*.sql`. Apply them with `npm run db:migrate` after reading `npm run db:status`.

## Verification

- Unit and service tests: `npx vitest run tests/human-tasks-state.test.js tests/human-tasks-money.test.js tests/human-tasks-service.test.js`.
- Devnet proof of the escrow legs: `node scripts/qa-human-task-devnet.mjs`. It needs devnet SOL and devnet USDC in the funding wallet and prints the exact shortfall if it is short. When the devnet faucets are out of reach (the RPC airdrop is closed and both faucet sites are captcha-gated), run the same script against a local `solana-test-validator` seeded with the devnet USDC mint account, its mint authority swapped to a throwaway key, by setting `SOLANA_RPC_URL_DEVNET=http://127.0.0.1:8899`. The closing line states whether the proof ran on devnet or on a local validator.
