# Usage control and spend: dollar caps, token ceilings, the spend page, top-ups and the way out of the free tier

Every model call an agent makes on three.ws is paid from the owner's prepaid
credits, and every agent can carry two kinds of cap on that spend: a **dollar
budget** (per day and per month) and **token ceilings** (per hour, per day and
per run). Both are checked before the model is called, so a capped agent never
runs a call it cannot pay for. When an agent hits a ceiling it pauses, its
owner is told, and the owner decides: resume, extend the ceiling once for this
window, or raise it. The [/spend](https://three.ws/spend) page shows where the
money goes, what the month will cost, and every alert at 50, 80 and 100 percent
of any cap.

| Piece | Where | Source |
|---|---|---|
| Spend page | [/spend](https://three.ws/spend), `/spend?agent=<id>` to focus one agent | [pages/spend.html](../pages/spend.html), [src/spend-page.js](../src/spend-page.js) |
| Spend read model | `GET /api/me/spend?days=30&agent=<id>` | [api/spend/me.js](../api/spend/me.js) |
| Token ceilings | `GET/PUT/DELETE /api/agents/:id/token-budget`, `POST .../resume`, `POST .../extend` | [api/agents/_id/token-budget.js](../api/agents/_id/token-budget.js) over [api/_lib/token-budgets.js](../api/_lib/token-budgets.js) |
| Dollar budget | `PATCH /api/agents/:id` with `inferenceBudget` | [api/_lib/inference-billing.js](../api/_lib/inference-billing.js) |
| Counters | `agent_token_usage` | [api/_lib/migrations/20261010173000_agent_token_budgets.sql](../api/_lib/migrations/20261010173000_agent_token_budgets.sql) |
| Top-ups | `GET /api/credits`, `POST /api/credits/deposit` in SOL, USDC or $THREE | [api/credits/index.js](../api/credits/index.js), [api/_lib/credit-deposit.js](../api/_lib/credit-deposit.js), guide: [payment-sessions.md](./payment-sessions.md#prepaid-credits) |
| Free tier | the `429 free_tier_exhausted` body and its `choices` | [api/_lib/free-tier.js](../api/_lib/free-tier.js) |
| Tests | the race at the ceiling, pause once per window, extend once, alert latches, projections, the free-tier body | [tests/token-budgets.test.js](../tests/token-budgets.test.js), [tests/inference-billing.test.js](../tests/inference-billing.test.js), [tests/credit-deposit-network.test.js](../tests/credit-deposit-network.test.js) |

---

## Two caps, one gate

| Cap | Set with | Windows | When it is hit |
|---|---|---|---|
| Dollar budget | `PATCH /api/agents/:id` `{ "inferenceBudget": { "daily": 2, "monthly": 40 } }` | UTC day, UTC month | `402 inference_budget_exhausted`, automations stop, `inference_budget_exhausted` notification |
| Token ceilings | `PUT /api/agents/:id/token-budget` `{ "hourly": 50000, "daily": 500000, "per_run": 20000 }` | UTC hour, UTC day, one run | `429 token_budget_paused`, the agent pauses, `token_budget_paused` notification plus one "extend once" approval |

Both caps run inside the same check (`assertAgentBudget` in
[api/_lib/inference-billing.js](../api/_lib/inference-billing.js)), so every
surface that meters an agent inherits both: v1 runs, agent messages, the
trading copilot and the OpenAI-compatible `/api/v1` lane. A call that fails
the gate never reaches a provider.

### How the token gate admits a call

1. Before the model call, the gate **reserves** the caller's token estimate
   (one token when it has none) in every capped window with a single
   conditional upsert: `tokens + reserved + estimate <= ceiling`. Two calls
   racing for the last tokens of a window serialize on the row lock and
   exactly one is admitted. The test for that race is in
   [tests/token-budgets.test.js](../tests/token-budgets.test.js).
2. The call runs.
3. After the call, **settlement** books the real token count, releases the
   reservation, and walks the marks: 50 and 80 percent notify the owner once
   per window; 100 percent pauses the agent.

Window keys are the UTC hour (`2026-10-10T14`), the UTC day (`2026-10-10`) or
the run id. An hourly or daily pause clears itself when its window rolls over;
a per-run pause ends with the run.

### What a pause does

- The agent's status becomes `stopped` and its autopilot is switched off, so
  no automation keeps hitting the ceiling.
- The owner gets a `token_budget_paused` notification on every connected
  channel (bell, push, Telegram, Discord, email per the
  [notification preferences](./notifications.md)) with a link to
  `/spend?agent=<id>`.
- One **extend once** approval opens in the [approval inbox](./approvals.md)
  (venue `token_budget`, never auto-approved). Approving it raises this
  window's ceiling by the extension (half the cap by default, never under
  1,000 tokens) and resumes the agent. A second extension for the same window
  is refused with `409 already_extended`.
- Every refused call answers with the same body:

```json
{
  "error": "token_budget_paused",
  "message": "Scout is paused: it reached its hourly token ceiling (50,000 of 50,000 tokens). Resume it with POST /api/agents/<id>/token-budget/resume, extend the ceiling once with POST /api/agents/<id>/token-budget/extend, or raise it with PUT /api/agents/<id>/token-budget.",
  "agent_id": "<id>",
  "window": "hour",
  "limit_tokens": 50000,
  "ceiling_tokens": 50000,
  "used_tokens": 50000,
  "window_key": "2026-10-10T14",
  "resets_at": "2026-10-10T15:00:00.000Z",
  "retry_after_seconds": 1800,
  "approval_id": "<approval id or null>",
  "recover": {
    "resume": { "method": "POST", "path": "/api/agents/<id>/token-budget/resume" },
    "extend_once": { "method": "POST", "path": "/api/agents/<id>/token-budget/extend", "body": { "window": "hour", "extra_tokens": 25000 }, "approval_id": "<approval id or null>" },
    "raise": { "method": "PUT", "path": "/api/agents/<id>/token-budget", "body": { "hourly_tokens": 100000 } },
    "spend_page": "/spend?agent=<id>"
  }
}
```

## The token ceiling API

Owner only. A browser session is the owner; a bearer key needs `wallet:read`
(or `profile`) to read and `wallet:write` to change caps, resume or extend.

```
GET    /api/agents/:id/token-budget
PUT    /api/agents/:id/token-budget          { hourly?, daily?, per_run? }   tokens; null or omitted = no cap
DELETE /api/agents/:id/token-budget
POST   /api/agents/:id/token-budget/resume
POST   /api/agents/:id/token-budget/extend   { window?, extra_tokens? }
```

```bash
curl -s https://three.ws/api/agents/$AGENT/token-budget \
  -X PUT -H 'authorization: Bearer sk_live_...' -H 'content-type: application/json' \
  -d '{ "hourly": 50000, "daily": 500000, "per_run": 20000 }'
```

`GET` and `PUT` answer with the same read model:

```json
{
  "agent": { "id": "<id>", "name": "Scout", "status": "running" },
  "token_budget": {
    "hourly_tokens": 50000, "daily_tokens": 500000, "per_run_tokens": 20000,
    "updated_at": "2026-10-10T14:02:11.000Z",
    "paused": null,
    "extensions": {},
    "windows": [
      { "window": "hour", "key": "2026-10-10T14", "limit_tokens": 50000, "extension_tokens": 0, "ceiling_tokens": 50000,
        "used_tokens": 12840, "reserved_tokens": 0, "calls": 9, "pct": 25.7, "exhausted": false,
        "resets_at": "2026-10-10T15:00:00.000Z", "alerts": [] },
      { "window": "day", "key": "2026-10-10", "limit_tokens": 500000, "extension_tokens": 0, "ceiling_tokens": 500000,
        "used_tokens": 212400, "reserved_tokens": 0, "calls": 131, "pct": 42.5, "exhausted": false,
        "resets_at": "2026-10-11T00:00:00.000Z", "alerts": [] }
    ]
  }
}
```

Rules: every cap is a whole number of tokens above zero and at most one
billion; `hourly` cannot exceed `daily`; a `PUT` whose new caps give a paused
agent room again lifts the pause and restarts the agent. `DELETE` removes
every cap and restarts an agent the ceiling had stopped.

**Resume** (`POST .../resume`) lifts a pause and restarts the agent, but only
when the window has room again (it rolled over, or the ceiling was raised or
extended). Otherwise it answers `409 still_capped` with the same `recover` block as
the refusal, so a resume never readmits a call the next gate would refuse.

**Extend once** (`POST .../extend`) opens the extension approval for the
paused window (or the named `window`) and approves it in the same call, so the
audit trail reads the same whether the owner tapped the notification or hit
the endpoint. `extra_tokens` is optional (default: half the cap, at least
1,000). The second extension for a window is `409 already_extended`.

## Alerts at 50, 80 and 100 percent

Every cap raises a `spend_cap_alert` notification the first time a window
crosses 50 percent and again at 80 percent. The 100 percent mark is the
pause itself (`token_budget_paused` for tokens, `inference_budget_exhausted`
for dollars). The latches live on the agent (`meta.spend_alerts`) keyed by
window, so a mark fires once per window and resets when the window does. The
spend page and `GET /api/me/spend` read the same latches, so the page and the
bell always agree.

## The spend page

[/spend](https://three.ws/spend) is the owner's view of all of it: balance and
month-to-date spend, a card per agent with its dollar caps and token ceilings
(use, percent, extension, pause with **Resume** and **Extend once** buttons,
and inline cap editing), usage by day, by model and by tool for the chosen
range, the month-end projection, and the alert list. `?agent=<id>` focuses one
agent, which is where every pause notification links.

`GET /api/me/spend?days=30&agent=<id>` returns what the page renders. A browser
session or a bearer key with `inference`, `wallet:read`, `wallet:write` or
`profile`; `days` is 1 to 90.

```json
{
  "generated_at": "2026-10-10T14:05:00.000Z",
  "range_days": 30,
  "balance_usd": 18.42,
  "lifetime_spent_usd": 61.58,
  "month": {
    "key": "2026-10", "to_date_usd": 6.11, "calls": 940, "last_7_days_usd": 3.9,
    "days_elapsed": 9.59, "days_in_month": 31,
    "projected_usd": 19.75, "projected_from_week_usd": 18.04,
    "balance_lasts_days": 33.1, "resets_at": "2026-11-01T00:00:00.000Z"
  },
  "agents": [
    {
      "id": "<id>", "name": "Scout", "status": "running",
      "usd": { "daily_usd": 2, "monthly_usd": 40, "today_usd": 0.81, "month_usd": 6.11, "calls_today": 120,
               "windows": [ { "window": "daily", "key": "2026-10-10", "limit_usd": 2, "used_usd": 0.81, "pct": 40.5, "exhausted": false, "resets_at": "2026-10-11T00:00:00.000Z", "alerts": [] } ] },
      "tokens": { "hourly_tokens": 50000, "daily_tokens": 500000, "per_run_tokens": 20000, "paused": null, "extensions": {}, "windows": [ "..." ] },
      "pause": null
    }
  ],
  "by_day": [ { "day": "2026-10-10", "agent_id": "<id>", "usd": 0.81, "calls": 120, "tokens": 212400 } ],
  "by_model": [ { "model": "three-ws/agent", "provider": "nvidia", "usd": 5.2, "calls": 800, "input_tokens": 3100000, "output_tokens": 420000 } ],
  "by_tool": [ { "tool": "search_catalog", "kind": "mcp", "calls": 44, "ok": 44, "usd": 0, "tokens": 0, "last_at": "2026-10-10T13:58:00.000Z" } ],
  "alerts": [ { "agent_id": "<id>", "agent_name": "Scout", "cap": "tokens", "window": "day", "threshold": 50, "pct": 42.5, "limit": 500000, "used": 212400, "unit": "tokens", "resets_at": "2026-10-11T00:00:00.000Z" } ]
}
```

`projected_usd` scales month-to-date by the days elapsed; `projected_from_week_usd`
extends the trailing seven days over the rest of the month, which is the one
that moves first when an agent starts or stops. `balance_lasts_days` is how
long the balance covers the trailing-week pace (`null` with no spend).

## Topping up: SOL, USDC and $THREE

Credits are bought by sending SOL, USDC or $THREE to the platform deposit
wallet and verifying the transfer. `GET /api/credits` lists every accepted
asset with its rate from live config, and the [/credits](https://three.ws/credits)
page renders that list rather than its own copy:

```json
"deposit": {
  "wallet": "<platform deposit address>",
  "network": "mainnet",
  "assets": [
    { "asset": "SOL",   "label": "SOL",    "mint": null,   "decimals": 9, "native": true,  "rate": { "kind": "live_price", "source": "mainnet quote at verification" }, "bonus_bps": 0 },
    { "asset": "USDC",  "label": "USDC",   "mint": "<USDC mint>", "decimals": 6, "native": false, "rate": { "kind": "fixed", "usd_per_unit": 1, "source": "published rate" }, "bonus_bps": 0 },
    { "asset": "THREE", "label": "$THREE", "mint": "<$THREE mint>", "decimals": 6, "native": false, "rate": { "kind": "live_price", "source": "mainnet quote at verification" }, "bonus_bps": 0 }
  ],
  "accepts": ["SOL", "USDC", "THREE"]
}
```

- **SOL and $THREE** are credited at the mainnet quote at verification time.
- **USDC** is credited at the published fixed rate (`USDC_CREDIT_RATE` in
  [api/_lib/pricing/catalog.js](../api/_lib/pricing/catalog.js)): credits are
  USD-denominated, so one USDC is one dollar of credits. The verifier reads the
  deposit wallet's USDC token-account delta from the finalized transaction,
  the same way it reads $THREE.
- **Paying in $THREE earns a bonus.** The size is owner policy, read live from
  `creditBonusBps()` in [api/_lib/token/config.js](../api/_lib/token/config.js)
  (environment `THREE_CREDIT_BONUS_BPS`, basis points, default no bonus) and
  surfaced as `bonus_bps` in the catalog and `credit_bonus_bps` in the public
  token config. The deposit page shows the percentage from that field, never
  from copy. The bonus lands as a separate `grant` row (`action`
  `deposit.three_bonus`) on the same ledger, keyed to the deposit, so a
  re-verified signature replays instead of granting twice, and it never
  counts toward `lifetime_deposited_usd`.

`POST /api/credits/deposit { "asset": "USDC", "tx_signature": "<sig>" }`
answers with `credited_usd`, `bonus_usd`, `bonus_bps` and the new balance. The
full contract, pending and error cases are in
[payment-sessions.md](./payment-sessions.md#post-apicreditsdeposit).

## When the free tier runs out

Signed-out and free-model calls meter a daily allowance per model. Once it is
used, every surface (`/api/brain/chat`, agent copilot, v1 messages, `/api/v1`)
answers `429 free_tier_exhausted` with a `Retry-After` header and a body that
carries the ways forward, so a client can act without reading docs:

```json
{
  "error": "free_tier_exhausted",
  "message": "You have used all 20 free messages for today. ...",
  "limit": 20, "used": 20,
  "reset_at": "2026-10-11T00:00:00.000Z", "retry_after_seconds": 35700,
  "model": "three-ws/agent",
  "choices": [
    { "action": "wait", "reset_at": "2026-10-11T00:00:00.000Z", "retry_after_seconds": 35700 },
    { "action": "top_up", "url": "https://three.ws/credits",
      "catalog": { "method": "GET", "path": "/api/credits" },
      "deposit": { "method": "POST", "path": "/api/credits/deposit", "body": { "asset": "<SOL|USDC|THREE>", "tx_signature": "<signature>" } },
      "requires_sign_in": false },
    { "action": "bring_your_own_key", "url": "https://three.ws/docs/inference-billing#bring-your-own-key",
      "set_key": { "method": "PATCH", "path": "/api/user/provider-keys", "body": { "<provider>": "<key>" } },
      "requires_sign_in": false },
    { "action": "paid_fallback", "method": "POST", "path": "/api/brain/chat",
      "body_patch": { "paid_fallback": true }, "bills": "credits", "requires_sign_in": false }
  ]
}
```

The `paid_fallback` choice is the one-step approval: resend the same request
with `paid_fallback: true` merged into the body and it bills your credits
instead of the free allowance (the credit gate runs first, so an empty balance
is `402 insufficient_credits` rather than a silent charge). It appears only on
surfaces that can honor it: `/api/brain/chat`, `POST /api/agents/:id/copilot`
and `POST /api/v1/agents/:id/messages`. The v1 lane wraps the same body under
`error.details`.

### Bring your own key

Store a provider key with `PATCH /api/user/provider-keys` (`{ "anthropic":
"sk-ant-..." }`, `null` to remove) or from the account page. Calls that route
to that provider are billed by the provider and never metered against the
free tier or your credits. The `GET` returns only which providers are set,
never a value; keys are encrypted at rest.

## Configuration

| Variable | Required | Meaning |
|---|---|---|
| `THREE_CREDIT_BONUS_BPS` | no | Bonus credits for paying credits in $THREE, in basis points. Default: no bonus. See [hold-to-access.md](./hold-to-access.md). |
| `CREDITS_DEPOSIT_WALLET_SOLANA` | yes, for deposits | The platform deposit wallet; falls back to the $THREE treasury wallet. |

Related: [Payment sessions](./payment-sessions.md), [Approvals](./approvals.md),
[Notifications](./notifications.md), [STRUCTURE.md](../STRUCTURE.md).
