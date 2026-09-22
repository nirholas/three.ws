# 10. Whole-agent marketplace: listings, bids, and custody transfer

Read `docs/prompts/README.md` first.

## The problem

The marketplace sells skills (prices, trials, reviews, on-chain licensing, agent-to-agent purchase in `api/marketplace/purchase-as-agent.js`) and catalogs agents (`api/marketplace/[action].js`: categories, fork, bookmark, publish), but nobody can buy or sell an agent itself. There is no listing, bid, offer or auction table in `api/_lib/schema.sql`. `api/marketplace/asset-price.js` mentions buying the agent itself with nothing behind it. A whole-agent transfer moves identity, persona, skills, history, and the custodial wallet, which is what makes it valuable and what makes it need care.

## Build

### Data

Migrations for `agent_listings` (agent, seller, ask price in USDC and optional `$THREE` price, min bid, expiry, status, whether the wallet balance is included or swept first, whether history is included), `agent_bids` (listing, bidder, amount, escrow reference, status: open, accepted, rejected, withdrawn, expired), `agent_transfers` (listing, buyer, seller, amount, fee, signature, custody rotation record), and `agent_marketplace_history`.

### Escrow and settlement

Bids lock funds: the bidder's agent wallet or connected wallet transfers USDC into a per-listing escrow account derived by the platform signer (`api/_lib/solana-signers.js`), refunded on reject, withdraw or expiry through a cron `marketplace-escrow-sweep`. On accept: escrow pays the seller minus the platform fee, and the fee follows the existing flywheel (`api/cron/economy-tick.js` and the buyback crons), then custody rotates.

Custody rotation on transfer: generate a fresh keypair for the agent through `api/_lib/agent-wallet.js`, sweep the old wallet's balances to the new one (or to the seller's payout address if the listing excludes the balance), rotate every encrypted secret, revoke the seller's API keys and sessions for that agent, clear allowlists and spend limits to conservative defaults, reassign ownership, and record every step in `agent_custody_events`. The old key is destroyed; the seller cannot retain access. Write this as one idempotent state machine that can resume after any failure.

### Routes and tools

Under `api/v1/marketplace/agents/` with MCP tools on `/api/mcp-agent` under the prompt 03 policy:

- `browse_marketplace`, `browse_public_agents`, `get_listing`, `get_marketplace_history`.
- `create_marketplace_listing` (financial because it commits the agent; `confirm_listing`), `delist_marketplace_listing` (`confirm_delist`).
- `place_bid` (financial, `confirm_bid`, locks escrow), `get_my_bids`, `get_received_bids`, `accept_marketplace_bid` (financial, `confirm_accept`, triggers settlement and rotation), `reject_marketplace_bid`, `withdraw_marketplace_bid` (financial).
- `buy_now` for listings with an ask price.

### UI

- `/marketplace/agents` browse (in `data/pages.json`): cards with the 3D avatar, persona summary, skills, wallet balance if included, trade history summary and reputation from `docs/agent-reputation.md`, ask and top bid, time left.
- Listing detail with bid form (wallet connect or agent wallet), bid history, and the "what transfers" checklist.
- Seller dashboard: received bids with accept and reject, listing management.
- Agent profile pages gain a "For sale" badge and link.
- Every state designed, including the transfer-in-progress state with step-by-step progress and the failure state with the resume action.

## Docs and wiring

`docs/agent-marketplace.md` (new) linked from `docs/start-here.md`: how listing, bidding, escrow, fees and custody rotation work, with the state machine drawn as a diagram. `docs/api-reference.md` section. `STRUCTURE.md` rows. `data/changelog.json` entry tagged `feature`.

## Acceptance

- List a QA agent, place a bid from a second QA account with a small USDC amount, and stop at the owner confirmation table before escrow moves (gate 1). With the yes: accept, and verify the buyer owns the agent, the old keypair no longer signs, and the seller's key is revoked.
- Kill the rotation state machine mid-way in a test and confirm it resumes to completion.
- `npm test` green.
