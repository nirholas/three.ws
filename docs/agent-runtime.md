# The agent runtime and the transaction guard

Every fund-moving tool an agent can call in [three.ws/chat](https://three.ws/chat) now passes
through a policy engine before it runs. This page explains what that engine is, what the
verdict you see in the transaction-approval modal means, and how developers can use the same
engine, `@three-ws/agent-runtime`, in their own agents.

## What happens when an agent tries to move money

Say you ask the chat agent to "send 2 SOL to my friend". The model emits a `solana_transfer`
tool call. Before that tool's code executes, and before your wallet ever prompts, the chat
client posts the call to `POST /api/agent/guard`, which evaluates it through seven independent
enforcement layers, in order:

1. **Security blacklist** - argument-level rules that force-block known-dangerous shapes
   (drainer-style destinations, destructive commands), regardless of any other setting.
2. **Human intervention** - the approval policy for this tool (`never` / `required` /
   `always`), combined with your session's approval mode.
3. **Capability** - is there a capability token covering this tool? (Skipped and reported
   when no validator is wired.)
4. **Permission** - the agent's permission level for this tool. (Same skip semantics.)
5. **Trade guard** - dollar-denominated policy: per-tier transaction caps, rolling 24-hour
   and 7-day windows, an auto-execute ceiling above which a human must sign off, an MEV
   slippage clamp, and a protocol audit lookup.
6. **Spend envelope** - the per-agent hard envelope: per-transaction / daily caps, a reserve
   floor, and a token + destination firewall.
7. **x402 budget** - for paid HTTP calls, the hourly autonomy budget.

The result is one verdict: `allow`, `require_approval`, or `block`.

- A **block** never reaches your wallet. The tool returns an error to the model explaining
  which layer refused and why, and the model tells you in plain language.
- Anything else proceeds into the familiar approval modal, now showing the verdict: a
  "cleared" or "review advised" chip, any warnings (for example "Slippage reduced to 100 bps
  for MEV protection"), and anything the platform *could not* check.

Two details worth knowing:

- **USD notionals are resolved server-side.** For SOL-denominated calls (SOL transfers,
  SOL-input swaps, pump.fun buys) the server multiplies the amount by the live SOL price, so
  the dollar caps compare against real numbers. When no notional can be resolved, the guard
  does not guess: the verdict carries a `VALUE_UNRESOLVED` finding instead.
- **The chain never short-circuits.** All seven layers always run, so the verdict can report
  that a call blocked by one layer also carried risk another layer saw, and, more
  importantly, which layers never evaluated the call at all. A guard that never ran looks
  exactly like a guard that passed; this engine treats that as a first-class finding
  ("blind spots") with a coverage score.

## The engine: `@three-ws/agent-runtime`

The endpoint is a thin shell over [`packages/agent-runtime`](../packages/agent-runtime), a
standalone, chain-agnostic package that also ships:

- **`AgentRuntime` + `GeneralChatAgent`** - a plan/execute decision loop for building agents:
  streaming LLM calls, parallel tool batches, human-in-the-loop pauses (approve / prompt /
  select), cost limits, interrupt and resume, and automatic context compression.
- **`ActionLedger`** - hash-chained ledger primitives (`computeEntryHash`, `verifyChain`):
  every recorded action commits to the entire history, so editing or deleting any historical
  row is detectable at the exact index it happened. The construction originated in the
  three.ws economy master ledger.
- **`TransactionPipeline`** - executes multi-step plans (approve → swap → bridge) in
  dependency order with rollback on failure and per-step approval gates.
- Reasoning utilities: structured self-correction on failed tool calls, response-quality
  evaluation, tool-relevance scoring, and token counting.

Quick taste (the same call the chat client makes, in library form):

```js
import { GuardChain, SpendGuard, TradeGuard } from '@three-ws/agent-runtime';

const chain = new GuardChain({
  defiGuard: new TradeGuard(),
  spendGuard: new SpendGuard({ perTxMaxUsd: 5000, firewall: { denyDestinations: ['0xbad'] } }),
});

const verdict = await chain.evaluate({
  identifier: 'solana_transfer',
  apiName: 'solana_transfer',
  arguments: { recipient: '9x…', amount: 250 },
  valueUsd: 42_000,
});
// verdict.decision === 'block' (free tier caps at $10,000 per tx)
```

The package README, [packages/agent-runtime/README.md](../packages/agent-runtime/README.md),
documents the full API, the tool registries, and how to register your own fund-moving tools.

## The endpoint

`POST /api/agent/guard` - open (no auth), rate-limited per IP, stateless. Evaluation uses
only what you send; nothing is stored and nothing executes.

```bash
curl -s https://three.ws/api/agent/guard \
  -H 'content-type: application/json' \
  -d '{
    "calls": [{
      "identifier": "solana_swap",
      "arguments": { "inputMint": "So11111111111111111111111111111111111111112", "amount": 120, "slippageBps": 300 }
    }],
    "userTier": "pro",
    "spend": { "perTxMaxUsd": 50000 }
  }'
```

Response: `{ "engine": "@three-ws/agent-runtime", "verdicts": [...] }`, one entry per call,
each `{ identifier, apiName, verdict }`. The verdict always carries `decision`, `reason`, a
per-layer trace (`layers`), `warnings`, `blindSpots`, `coverageScore`, and `totalElapsedMs`.
Two fields appear only when they apply: `blockedBy` (plus a `code`) names the layer that
refused a `block`, and `modifiedArguments` carries safer parameters when the engine
recommends them (the chat client applies those before executing).

Body fields: `calls[]` (each: `identifier`, `apiName`, `arguments`, optional `valueUsd`,
`protocol`, `destination`, `token`, `interventionConfig`, `executionPath`, `x402`), plus
request-level `approvalMode`, `allowList`, `confirmedHistory`, `userTier`, `userSwapCaps`,
`userSwapVolume`, `balanceUsd`, `agentId`, `userId`, `spend` (a SpendGuard envelope), and
`x402HourlyBudgetUsd`.

## The server-side agent loop: `POST /api/agent/run`

The same runtime also powers a full server-side agent: pick **"three.ws Agent · server
tools"** in the /chat model picker and your message is answered by a tool-using loop running
on the platform instead of a single model call. Per message it can:

- look up **live token prices, 24h change, and market cap** (CoinGecko),
- list **trending tokens**,
- **search the web**,
- read **SOL balances** for any wallet,
- run the **trade-firewall safety verdict** on a mint (rug/honeypot checks with a simulated
  buy+sell round trip),
- check **smart-money activity** on a mint,
- resolve **.sol names**.

Every tool is read-only and every planned call is preflighted through the GuardChain in
headless mode before it executes; a blacklisted call is fed back to the model as a blocked
error, never run. The loop cannot move funds: no tool in the server registry transfers,
swaps, or signs, and the wallet tools stay client-side behind the approval modal. A tool
that throws ends the agent's turn, so the keyless upstreams behind these tools are called
through the shared retrying fetch (`api/_lib/upstream-fetch.js`); web search in particular
retries once and then returns an empty result with an `unavailable` note the model can
narrate around, rather than costing the whole answer.

For developers the endpoint speaks the **OpenAI chat-completions wire format** in both
directions, so any OpenAI-compatible client can point at it:

```bash
curl -N https://three.ws/api/agent/run \
  -H 'content-type: application/json' \
  -d '{"messages":[{"role":"user","content":"Is SOL up today, and is <mint> safe to buy?"}],"stream":true}'
```

Streaming responses are standard `chat.completion.chunk` SSE frames; tool activity is
surfaced as SSE comment lines (`: tool token_price`), which OpenAI parsers ignore by spec.
Set `"stream": false` for a plain `chat.completion` JSON. The loop runs up to four tool
rounds per request, is anonymous, and is rate-limited per IP. Under the hood it is
`AgentRuntime` from the package above driving the shared free-first LLM chain
([api/_lib/llm-tool-chain.js](../api/_lib/llm-tool-chain.js), the same lanes as the trading
copilot) over the registry in [api/_lib/agent-tools.js](../api/_lib/agent-tools.js).

One behavior worth knowing when using it from /chat: in agent mode the client-side tools
(3D forge, wallet actions) are not offered to the model; it plans with its own server
registry. Switch back to a plain model for wallet actions, which always go through the
approval modal and the `/api/agent/guard` preflight.

## Autonomous runs: budgets, receipts and replay

A run is an agent working toward one goal on its own, one checkpointed step at a time, on
the server. You start one with the `create_agent_run` MCP tool (or an `agent_prompt`
automation), and it keeps going after the request that started it returns: the
`/api/cron/agent-automations` job runs every minute and advances every queued, scheduled or
running run until it finishes. Runs live in `agent_runs` and `agent_run_steps`; the
engine is [api/_lib/agents-v1/runs.js](../api/_lib/agents-v1/runs.js).

**Two budgets.** Every run has both a step budget and a dollar budget.

- `max_steps` (1 to 60) caps **model turns**. A turn is one model call plus the tool batch it
  asked for. When the turns run out, the run ends with the best answer it has.
- `budget_usd` caps paid model spend. `0` keeps the run on free model lanes, so it costs
  nothing. When the spend reaches the budget, the run stops with status `budget_exhausted`
  and an error saying how much it spent. You can raise the budget with `update_agent_run` and
  resume it.

**Cancel takes effect between steps.** The engine checks for a cancel request before every
step. A queued, scheduled or paused run cancels at once. A running run finishes the step it
is on, then stops; until then it reports `cancel_requested`. No step is cut off halfway, so
the step trail is always complete.

**A summary when it ends.** Every finished run, whether completed, failed, cancelled or
stopped at its budget, gets a plain-language `summary`, for example: "Completed after 2 model
turns in 4s. Made 1 tool call: token_price. Ran on free model lanes only, with no credit
spend. Result: The current price of SOL is $109.87 USD."

**Step receipts.** Each step stores a SHA-256 receipt over the previous step's receipt plus
this step's run id, sequence number, kind, tool, input and output
([api/_lib/agents-v1/run-receipts.js](../api/_lib/agents-v1/run-receipts.js)). Because each
receipt includes the one before it, editing, dropping or reordering any step breaks the
chain at that step. `get_agent_run_steps` and the replay endpoint recompute the chain on
every full read and return `{ verified, checked, brokenAt }`. They also pair each
`tool_call` with its `tool_result` (or `tool_blocked`) into a tool trace with the tool name,
input, output, status (`ok`, `error`, `blocked`, `pending`), latency and the receipt that
vouches for both halves.

### The Runs tab

On an agent's page, the owner sees a **Runs** tab (`/agents/<id>?view=runs`). It lists the
agent's runs newest first, with status, goal, model turns used, spend and where each run came
from (MCP, REST, automation). Selecting a run shows:

- meters for model turns, credits, tool calls (with failures) and timing,
- the run's summary,
- the receipt-chain verdict ("Verified" across N steps, or "Broken" at the step that fails),
- a timeline of every step: model turns with model, tokens, cost and latency; tool calls and
  results with their input and output; and each step's short receipt hash (click to copy),
- **Replay**, which steps through the timeline in order, plus a scrubber to jump to any step.

While a run is live the tab polls for new steps every 2.5 seconds (paused while the tab is
hidden) and offers **Cancel run**. The selected run stays in the URL (`&run=<id>`), so the
`replay_url` from `create_agent_run` opens straight onto it.

The tab reads `/api/agent-run-replay` ([api/agent-run-replay.js](../api/agent-run-replay.js)),
which is owner-only and accepts a session cookie or a bearer token:

| Request | Returns |
|---|---|
| `GET /api/agent-run-replay?agent=<agent_id>[&before=<run_id>]` | `{ runs, hasMore, nextBefore }`, 25 per page, each run with `turns` |
| `GET /api/agent-run-replay?run=<run_id>[&after=<seq>]` | `{ run, live, steps, toolTraces, receiptChain, nextAfter, hasMore }`; `receiptChain` is computed on a full read (`after` 0) |
| `POST /api/agent-run-replay?run=<run_id>&action=cancel` | `{ run, status }` where status is `cancelled` or `cancel_requested`; needs the CSRF token |

```bash
curl -s "https://three.ws/api/agent-run-replay?run=<run_id>" \
  -H "authorization: Bearer $THREE_WS_API_KEY" | jq '.data.receiptChain, .data.toolTraces'
```

The MCP tools that drive all of this are listed in
[docs/mcp.md](./mcp.md#agent-lifecycle-runs-and-automations).

## Related surfaces

- [Agent Sniper](./agent-sniper.md) - the autonomous trading pipeline with its own trade
  firewall and hash-chained decision ledger; this package generalizes those ideas into a
  reusable engine.
- [`@three-ws/agent-guards`](../packages/agent-guards) - the client SDK for custodial wallet
  spend policies (`/api/agents/:id/trade/limits`). The runtime evaluates arbitrary tool
  calls anywhere; agent-guards manages the platform-custody leash.
- [STRUCTURE.md](../STRUCTURE.md) - where everything lives.
