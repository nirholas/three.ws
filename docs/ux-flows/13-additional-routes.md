# Additional High-Value Routes

UX Flow Atlas, cluster 13. Traced from real source. Covers twelve routes that clusters 01 to 12 did not cite, chosen by atlas weight: the trading hub, Mission Control, the Agora world, credits, payment sessions, the prompt library, agent wallets, the master wallet, the airdrop scanner, event markets, the labor market and the MCP connect page. Route to source mapping is resolved through `vercel.json` `routes[]`. `npm run audit:ux-flows` checks that every route in a heading below resolves and that every file cited here exists.

---

### Trading Hub: `/trading`
- **Source:** `pages/trading.html`, `src/trading-hub.js`, `src/trading-hub-data.js`, `src/trading-hub-format.js`
- **Entry point:** Nav and the `/sniper` family. Route `/trading/?` maps to `/trading.html`.
- **Prerequisites / gates:** None. Read-only and anonymous-friendly.
- **Steps (5):**
  1. Land on the page. The status pill and vitals tiles render skeletons while two requests run.
  2. `GET /api/sniper/status` fills the pill (live, warn, down, muted or unknown tone from `describeFleet`) and seven tiles: Mode, Strategies armed, Open positions, Launch feed, Wallets funded, Funded to date, Uptime. Each tile has hover, focus and `aria-describedby` help text.
  3. `GET /api/sniper/leaderboard?window=all&sort=score` fills the scoreboard with up to six agents that have closed trades.
  4. Read the static pipeline (Signal, Score, Firewall, Size and spend, Laddered exit) and the safety rails, which link `/docs/custody` and `/docs/risk-acknowledgment`.
  5. Follow a call to action: `/play/arena`, `/docs/agent-sniper` or `/leaderboard`, or open any of the 23 surfaces in the Learn directory.
- **Decision points / branches:** Fleet state selects the pill tone. Tab visibility pauses the 30 second poll and a `visibilitychange` forces a refresh.
- **External calls / dependencies:** `GET /api/sniper/status`, `GET /api/sniper/leaderboard`.
- **Success state:** A live pill, populated vitals and a ranked scoreboard that keeps refreshing.
- **Empty / error states:** Status failure shows "Fleet status unavailable". An empty scoreboard says "No closed trades yet" and links `/sniper/experiments`. A scoreboard failure says "The scoreboard is unavailable" and links `/leaderboard`.
- **Step count:** 5 (3 automatic).

---

### Mission Control: `/terminal`
- **Source:** `pages/terminal.html`, `src/mission-control/index.js`, `src/mission-control/feed.js`, `src/mission-control/positions.js`, `src/mission-control/focus.js`, `src/mission-control/trade.js`, `src/mission-control/keyboard.js`, `src/mission-control/store.js`, `src/mission-control/realtime.js`, `src/mission-control/enrich.js`, `src/mission-control/trades-tape.js`
- **Entry point:** Nav and trading hub. `?network=devnet` selects devnet, any other value is mainnet.
- **Prerequisites / gates:** None to watch. Trading needs a signed-in account and an agent with a Solana address.
- **Steps (7):**
  1. `mountMissionControl(root, {network})` resolves the session with `getMe`. Only a signed-in user triggers `loadUserAgents`. Anonymous visitors get a read-only cockpit.
  2. The feed opens `/api/pump/trades-stream` over SSE and seeds from `GET /api/pump/intel?view=feed`. Positions open `/api/sniper/stream`. The radar reads `GET /api/sniper/radar`.
  3. Select a coin with `j` and `k` or the arrow keys. Focus loads `GET /api/pump/coin`, `GET /api/pump/safety`, `GET /api/intel/smart-money`, and polls `GET /api/pump/dex-trades` about every 8 seconds. The tape opens `/api/pump/trades-stream?mint=`.
  4. Pick a tradable agent. Holdings come from `GET /api/agents/:id/solana/holdings`.
  5. Press `b` or `s` to open a buy or sell. The first trade shows a confirm modal.
  6. Confirming sends `POST /api/agents/:id/solana/trade` with an idempotency key and a slippage cap. The firewall and MEV checks run server side.
  7. Choosing express mode stores `mc:express:v1` per agent in localStorage, so later trades skip the modal.
- **Decision points / branches:** Anonymous or signed in. Mainnet or devnet. Confirm modal or express. Keys: `1` to `6`, `/`, `x`, `g`, `?` and `Esc` cover panel focus, search, close, jump and help.
- **External calls / dependencies:** The SSE streams and endpoints named above, plus `GET /api/sniper/leaderboard` and `GET /api/sniper/history`.
- **Success state:** A trade confirmation with the signature and an updated position row.
- **Empty / error states:** Connection chips read live, reconnecting or down after repeated failures. A down feed says "unreachable" and shows no invented rows. The radar has a designed empty state. Trade errors map to plain messages: firewall_blocked, insufficient_funds, spend_limit_exceeded, daily_budget_exceeded, slippage_exceeded and network_error.
- **Step count:** 3 to read, 7 to trade.

---

### Agora: `/agora`
- **Source:** `pages/agora.html`, `src/agora/agora-world.js`, `src/agora/player-mode.js`
- **Entry point:** Nav, `/city`, and deep links. Route `/agora/?` maps to `/agora.html`.
- **Prerequisites / gates:** None to watch. The me-hud actions (post, hire, claim, complete, vouch) need a session.
- **Steps (5):**
  1. A loading overlay reports boot progress while the world builds and `GET /api/agora/citizens?limit=200` resolves (prefetched).
  2. The 3D commons renders its citizens. A roster list lets keyboard users step through them.
  3. Click or choose a citizen to open its passport.
  4. Press "Enter the Commons" (an `aria-pressed` toggle). It lazily imports `src/agora/player-mode.js` and joins the `agora_world` room. Movement is WASD, Shift to run, Space, `E` to interact, and drag to orbit.
  5. Deep links self-mount panels: `?task=` opens the trust surface, `?arena=` the arena, `?guild=` the guild, and `?play=1` enters automatically.
- **Decision points / branches:** Watch or enter. The choice is remembered in `localStorage['agora:mode']`. Signed in users get the me-hud.
- **External calls / dependencies:** `GET /api/agora/citizens`, the `agora_world` realtime room.
- **Success state:** A populated commons, and in player mode a controllable avatar among other visitors.
- **Empty / error states:** No citizens shows "The Commons is quiet" with links to `/docs/agora.md` and `/city`. A failed boot shows "Couldn't reach the Commons" with a Try again button. A failed room join turns the button into "Enter failed - retry".
- **Step count:** 3 to watch, 5 to play.

---

### Credits: `/credits`
- **Source:** `pages/credits.html`, `src/credits.js`
- **Entry point:** Account menu, the `/payments` insufficient credits link, and `/login?next=/credits`.
- **Prerequisites / gates:** A signed-in account. A Solana wallet to deposit.
- **Steps (7):**
  1. The page shows a loading state, then `GET /api/credits` returns balance, lifetime totals, the deposit address, accepted assets (SOL, USDC and $THREE with a bonus percent), a holder tier, buy presets and the first ledger page.
  2. Choose an asset and an amount, or a preset. A best effort live USD estimate comes from the price chain in `usd-price.js`.
  3. Press Deposit. The platform Solana adapter connects the wallet.
  4. `doDeposit` builds a SOL or SPL transfer to the deposit wallet, loading web3.js on demand and using the `/api/solana-rpc` proxy.
  5. Sign in the wallet. The transaction is broadcast.
  6. `POST /api/credits/deposit` with `{asset, tx_signature, network}` verifies it. A `pending` reply polls until finalized. A `replay` reply says "Already credited".
  7. The status line reads "Added $X ... plus a $Y bonus. New balance ...".
- **Decision points / branches:** Connected wallet flow or the manual path of pasting a signature and pressing Verify. Copy address is available for either. The ledger pages with `?cursor=` behind a "load more" button.
- **External calls / dependencies:** `GET /api/credits`, `POST /api/credits/deposit`, the Solana RPC proxy and the wallet adapter.
- **Success state:** An updated balance and a new ledger row.
- **Empty / error states:** A 401 shows the sign in state linking `/login?next=/credits`. A load failure shows a retry button and a status link. No wallet shows "No Solana wallet detected. Install Phantom to deposit." Offline and unreachable are separate messages. A 429 says "Too many requests". A failed "load more" shows an inline error with retry.
- **Step count:** 7 on the wallet path, 3 on the manual path.

---

### Payment Sessions: `/payments`
- **Source:** `pages/payments.html`
- **Entry point:** Account menu, MCP docs, `/credits`. Route `/payments/?` maps to `/payments.html`.
- **Prerequisites / gates:** A signed-in account and credits to budget from.
- **Steps (6):**
  1. `GET /api/pay/session?limit=50` returns items and stats. Filter chips cover all, active, exhausted, expired and cancelled.
  2. Press `N` or New session to open the create modal: budget in USD, label, expiry, per transaction cap, allowed and blocked hosts, approval threshold, per rail daily cap and network.
  3. Submit sends `POST /api/pay/session`. The one time token is shown with copy buttons for the token and for `PAYMENT_SESSION_TOKEN=...`, plus an MCP hint.
  4. Expand a card to load `GET /api/pay/session/:id/executions?limit=10`.
  5. Edit a session through `PATCH /api/pay/session/:id`.
  6. Cancel with `DELETE`, after a confirm dialog that says unspent budget returns to credits.
- **Decision points / branches:** Filter. Create, edit or cancel. `Esc` closes either modal.
- **External calls / dependencies:** The `/api/pay/session` family.
- **Success state:** A toast and an updated card or stats row.
- **Empty / error states:** A 401 shows "Sign in to manage sessions" with `/login?r=/payments` and doc links. `insufficient_credits` links to `/credits`. Executions have their own Retry.
- **Step count:** 6.

---

### Prompt Library: `/prompts`
- **Source:** `pages/prompts.html`, `src/prompt-library/page.js`, `src/prompt-library/page.css`
- **Entry point:** Nav, docs and the `/docs/prompts` page.
- **Prerequisites / gates:** None.
- **Steps (5):**
  1. Fetch `/prompts.json`, built from `data/prompt-library.json` by `scripts/build-prompt-library.mjs`. A skeleton shows while loading.
  2. Search with the box (`/` focuses it) and narrow by category and setup chips (`aria-pressed`). State lives in the `q`, `category` and `setup` URL parameters, so any view is shareable.
  3. Press Copy prompt. It uses the clipboard API and falls back to a textarea and `execCommand`. The button reads "Copied", or "Press Ctrl+C" when copying is blocked.
  4. Or press Open in Claude, which opens `https://claude.ai/new?q=<encoded prompt>`.
  5. Copy link stores `#id` for the card. Long prompts have a Show all and Show less expander.
- **Decision points / branches:** Copy, open in Claude or link. The toolbar also offers "Copy the whole library", `/prompts.txt` and `/prompts.json`.
- **External calls / dependencies:** `/prompts.json` only. No account.
- **Success state:** The prompt text is on the clipboard or open in a new Claude chat.
- **Empty / error states:** "No prompt matches that yet" with Clear filters and an Add a prompt link. A load failure offers Try again and a link to the plain text version. An `aria-live` region announces result counts.
- **Step count:** 3.

---

### Agent Wallet: `/agent-wallet`
- **Source:** `pages/agent-wallet.html`, `src/agent-wallet.js`, `src/agent-wallet-hub/index.js`, `src/agent-wallet-hub/registry.js`
- **Entry point:** Agent profile wallet links. The agent id comes from `?id=` or from a `/agents/:id/wallet` path. `?tab=` picks the opening tab.
- **Prerequisites / gates:** A signed-in owner. Wallets are private to the owner.
- **Steps (4):**
  1. With an id that is a valid UUID, `GET /api/agents/:id` loads the agent and mounts the hub.
  2. With no id, `GET /api/auth/me` is checked first (it answers 200 with a null user for anonymous visitors, which avoids a console 401), then `GET /api/agents` lists the caller's agents.
  3. One agent mounts its hub directly. Several show a picker, each with a Ready or Preparing state, plus Manage agents and Create an agent links.
  4. The hub exposes one tab per module under `src/agent-wallet-hub/tabs`, for example balance, deposit, trade, withdraw, policy, custody and recovery.
- **Decision points / branches:** Named or own wallets. One agent or many.
- **External calls / dependencies:** `GET /api/agents/:id`, `GET /api/auth/me`, `GET /api/agents`, plus each tab's own endpoints.
- **Success state:** The hub for the chosen agent, with the page title set to the agent name.
- **Empty / error states:** Signed out shows "Sign in to open an agent wallet" with `/login?next=/agent-wallet` and `/register`. No agents shows "No agents yet" with a Create an agent link. A bad id shows "That agent link is not valid". A 404 shows "Agent not found". A network failure shows "Couldn't load your wallets" or "Couldn't load this wallet", each with retry.
- **Step count:** 3.

---

### Master Wallet: `/wallet`
- **Source:** `pages/wallet.html`, `src/master-wallet.js`, `src/wallet-api.js`, `src/wallet-deposit.js`
- **Entry point:** Account dashboard, and `/login?next=` after sign in. The route `/wallet` and `/wallet/` map to `/wallet.html`.
- **Prerequisites / gates:** A signed-in account.
- **Steps (6):**
  1. `GET /api/user/wallet` decides the phase: loading, anon (401), empty, ready or error.
  2. In the empty phase, "Create my master wallet" sends `POST /api/user/wallet`, which creates a Solana and an EVM keypair held by the platform and encrypted at rest.
  3. The ready view has three tabs, Send, Fund and History. Deposit shows a QR code and address to fund the wallet.
  4. Send: enter a destination and an amount (Max fills the balance), preview, then confirm. Both go to `POST /api/user/wallet/send`. A risk acknowledgment gate applies.
  5. Fund: pick one of the owner's agents from `GET /api/agents`, preview, then confirm through `POST /api/user/wallet/fund-agent`.
  6. History reads `GET /api/user/wallet/history?limit=20`. After a deposit the page watches the balance and announces what landed.
- **Decision points / branches:** Send or fund. Preview then confirm or cancel. No funds move before the confirm step.
- **External calls / dependencies:** The `/api/user/wallet` family and `GET /api/agents`.
- **Success state:** A "Sent ..." notice with an explorer link, and a refreshed balance.
- **Empty / error states:** Anonymous shows a sign in hero. Empty shows the create hero. A load failure shows "We could not load your wallet" with Try again. Fund with no agents shows "No agent to fund yet". History with no rows shows "No transactions yet". Error codes map to plain copy, such as insufficient_balance, insufficient_sol_for_fees, no_agent_wallet, rate_limited and network_error.
- **Step count:** 3 to create, 3 to send or fund.
- **Finding:** `public/wallet.html` is a second copy of this page that loads a module named user-wallet which does not exist in `src/`. The Vite entry in `vite.config.js` is `pages/wallet.html`, so the built page is the one traced here, but a public copy that references a missing module would render an empty `#mw-root` if the static file were ever served instead.

---

### Airdrop Scanner: `/airdrops`
- **Source:** `pages/airdrops.html`, `src/airdrops.js`
- **Entry point:** Nav and the wallet portfolio. `/airdrops?address=<addr>` deep links to a scan.
- **Prerequisites / gates:** None. A public address is enough, no wallet connection.
- **Steps (4):**
  1. With no address, `GET /api/crypto/airdrops` returns the registry and the directory grid shows each program with chain, status (Confirmed, Upcoming or Speculation), criteria, estimate and a source link.
  2. Paste a Solana or EVM address, or choose a recent chip. Recents share the `twx_portfolio_recent` list with `/portfolio`.
  3. `GET /api/crypto/airdrops?address=...` scans the wallet. The URL updates with `replaceState`.
  4. The report shows a qualified ring, an estimated value range, eight measured activity stats (unmeasured values read "not measured"), and program cards filterable by eligibility, each with met and missing criteria.
- **Decision points / branches:** Directory or report. Filter by eligibility bucket. A report also lists programs for the other chain family.
- **External calls / dependencies:** `GET /api/crypto/airdrops`.
- **Success state:** A scored report with a fine print line giving registry date and scan time, stating that estimates are speculation.
- **Empty / error states:** No tracked programs shows "No programs are being tracked right now" and links the portfolio. A 400 says "That address does not look right". A 429 says "Slow down a moment". A 503 says "Scan source unavailable". Anything else says "Could not scan this wallet". A filter with no matches says no programs scored that bucket.
- **Step count:** 3.

---

### Event Markets: `/event-markets`
- **Source:** `pages/event-markets.html`, `src/event-markets/browse.js`, `src/event-markets/common.js`
- **Entry point:** Nav, `/event`, and the leaderboard and forecasters pages (`/event-markets/leaderboard`, `/event-markets/forecasters`).
- **Prerequisites / gates:** None to browse.
- **Steps (4):**
  1. The page loads the Live tab: open markets, soonest lock first. Tabs are Live, Closing soon (locking within 24 hours) and Resolved (newest first).
  2. Filter by source and search by text. State is in the `view`, `source` and `q` URL parameters.
  3. Each request is `GET /api/event-markets?status=...&limit=24` with optional `source_kind`, `q` and `cursor`. A generation counter discards stale responses.
  4. Open a card to reach the market page. Cards show status, source, the top three outcomes and a lock countdown or winner.
- **Decision points / branches:** Tab, source filter, search. Load more follows the cursor.
- **External calls / dependencies:** `GET /api/event-markets`.
- **Success state:** A grid of market cards linking into each market.
- **Empty / error states:** Filtered empty shows "No markets match those filters" with Clear filters. Unfiltered empty explains that every three.ws event opens a market and links `/event`. A first page failure shows an error panel with retry, and a later page failure shows an inline alert. A live region announces results.
- **Step count:** 2 to browse.

---

### Labor Market: `/labor-market`
- **Source:** `pages/labor-market.html`, `src/labor-market.js`
- **Entry point:** Nav and `#b/<id>` deep links to a bounty drawer. Route `/labor-market/?` maps to `/labor-market.html`.
- **Prerequisites / gates:** Watching is anonymous. Posting, bidding and awarding need a session and an owned agent. Posting also needs bounty escrow configured on the server.
- **Steps (7):**
  1. `GET /api/labor/feed` fills three tabs, Open, In flight and Settled, plus a settlement ticker. The page polls on a timer and `r` refreshes. Filters cover skill, minimum reward, search and sort.
  2. Open a bounty card. `GET /api/labor/bounty?id=` fills a drawer with a lifecycle stepper, bids with score and rationale, and payout receipts.
  3. A signed in owner of a worker agent submits a bid with `POST /api/labor/bid`.
  4. The poster awards a bid with `POST /api/labor/award`. The worker delivers with `POST /api/labor/deliver`.
  5. Verification is an attestation (pass or fail with a reason code) sent to `POST /api/labor/escrow`, which settles or refunds the escrow. Moderators can release or refund a stuck bounty through `/api/labor/release` without touching the escrow key.
  6. To post, open the post modal, fill in the brief, skill and reward in $THREE, and submit `POST /api/labor/post`. The reward is escrowed on chain and the toast links the escrow transaction.
  7. Owners can opt an agent into autonomy with `GET` and `POST /api/labor/policy`.
- **Decision points / branches:** Poster, worker or moderator view. Keys `1`, `2`, `3` switch tabs, `/` focuses search, `?` shows help, `Esc` closes.
- **External calls / dependencies:** The `/api/labor/*` endpoints and `GET /api/agents` for the owner's workers.
- **Success state:** Toasts such as "Bid placed.", "Bid awarded." and "Bounty posted & escrowed." and a drawer that moves to the next lifecycle step.
- **Empty / error states:** Each tab has its own empty state ("No open bounties yet", "Nothing in flight", "No settlements yet"). A feed failure shows "Market unavailable" with a retry. A missing bounty shows "Couldn't load this bounty". Signed out visitors see "Sign in and own an agent to bid, award, or post." Posting with escrow offline toasts that escrow is not online on this server yet.
- **Step count:** 2 to watch, 3 to bid, 4 to post.

---

### MCP Connect: `/connect`
- **Source:** `pages/connect.html`
- **Entry point:** Docs, the MCP catalog and onboarding. `?client=` and `?server=` preselect a client and a server.
- **Prerequisites / gates:** None for the free servers. Some servers need sign in or pay per call.
- **Steps (5):**
  1. The page fetches `/.well-known/mcp.json` (the server directory) and `/mcp-catalog.json` (tool counts from source) in parallel.
  2. Choose a server card. Each has an auth pill: "Free, sign-in optional", "No sign-in", "Pay per call" or "Sign in".
  3. Choose a client tab: Claude, ChatGPT, Grok, Claude Code, Cursor, VS Code, IBM Bob or Other. The URL keeps the choice.
  4. Copy the generated command or JSON snippet with the copy button, which writes to the clipboard.
  5. For the studio server, a cloud install mints a token through `POST /api/mcp-studio/install`. The token is stored in localStorage and the connector URLs for each client are shown.
- **Decision points / branches:** Which server, which client, local config or hosted connector.
- **External calls / dependencies:** `/.well-known/mcp.json`, `/mcp-catalog.json`, `POST /api/mcp-studio/install`.
- **Success state:** A ready to paste snippet for the chosen client and server.
- **Empty / error states:** If the directory cannot load, the note reads "Couldn't load the server list, so you're set up for the main three.ws server below, which works on its own." and the default `https://three.ws/api/mcp` is used. Install failure shows the API message or "Couldn't create a token", and a network failure shows "Couldn't reach three.ws". A blocked clipboard selects the snippet and the button reads "Press Ctrl+C".
- **Step count:** 4.
