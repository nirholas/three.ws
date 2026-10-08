# @three-ws/agents

**The typed TypeScript client for the three.ws v1 Agents API.**

Construct a client with an API key, then create, start and chat with agents,
run goals, schedule automations, and move funds from Solana agent wallets, with
retries, timeouts, idempotency keys, typed errors and a client-side confirm gate
on every call that moves money.

```ts
import { ThreeAgents } from "@three-ws/agents";

const client = new ThreeAgents({ apiKey: process.env.THREE_WS_API_KEY! });
const agent = await client.createAgent({ name: "Momentum Alpha", strategy: "momentum" });
await client.startAgent(agent.id);
const reply = await client.sendMessage(agent.id, { message: "What is trending right now?" });
console.log(reply.content);
```

## Contents

- [Status](#status)
- [Install and build](#install-and-build)
- [Getting a key](#getting-a-key)
- [Runnable example](#runnable-example)
- [Configuration](#configuration)
- [Core concepts](#core-concepts)
- [API reference](#api-reference)
- [Errors](#errors)
- [Requirements](#requirements)

## Status

Read this before building on the package.

- **Not on npm yet.** `@three-ws/agents` returns 404 from the registry. Build it
  from this directory (below) and depend on the built `dist/`. Publishing is an
  owner-approved step: `npm run release` from this directory runs `npm publish
  --access public`, and `prepublishOnly` gates it on `typecheck`, `test` and `build`.
- **The client is complete; most server routes are not mounted yet.** On
  2026-10-08 production answered these methods: `getModels()` (`GET /models`),
  `getFreeTierStatus()` (`GET /me/free-tier`), `startAgent()` and `stopAgent()`
  (`POST /agents/:id/start|stop`). Every other method calls a `/api/v1` path that
  production answers with `404 not_found` (or, under `/agents/:id/...`, with the
  on-chain card resolver's `400 invalid_caip`). The server-side logic for those
  routes exists in [api/_lib/agents-v1/](../../api/_lib/agents-v1) but has no
  route entry under `api/v1/` yet. The errors are typed, so a caller sees a
  `NotFoundError` or `ValidationError`, never a crash.
- `npm test` (`vitest run packages/agents-sdk/tests`) and `npm run examples`
  (`scripts/run-examples.mjs`) name directories that are not in the tree; use
  `npm run typecheck` and `npm run build` to verify a change.

## Install and build

From the repo root (`tsup` and `typescript` resolve from the root `node_modules`):

```bash
cd packages/agents-sdk
npx tsup          # writes dist/index.js (ESM), dist/index.cjs (CJS) and .d.ts types
npx tsc --noEmit  # type check
```

One entry, ESM and CJS, with declarations and source maps. The on-chain error
classes are imported from [solana-agent-sdk/src/errors.ts](../../solana-agent-sdk/src/errors.ts)
by relative path and inlined by tsup, so the built package has **zero runtime
dependencies**. It runs on Node 20+, Deno, Bun and browsers (anything with `fetch`).

## Getting a key

`apiKey` is a three.ws API key (`sk_live_...`). Create one with
`npx three-ws setup` ([docs/cli.md](../../docs/cli.md)) or on
[/dashboard/api](https://three.ws/dashboard/api). Model calls need a key with the
`inference` scope; agent writes need `agents:write`.

## Runnable example

This runs today against production. Save it as `example.mjs` in this directory
after building:

```js
import { ThreeAgents, ConfirmationRequiredError, VERSION } from "./dist/index.js";

const client = new ThreeAgents({ apiKey: process.env.THREE_WS_API_KEY ?? "sk_live_example" });
console.log(VERSION, client.baseUrl); // 0.1.0 https://three.ws/api/v1

// Free-tier allowance and the models it covers.
console.log(await client.getFreeTierStatus());
// { limit: 20, used: 0, remaining: 20, reset_at: '...', anonymous: true, signed_in_limit: 100, models: [...] }

// The model catalog.
console.log(await client.getModels());

// Fund-moving calls are refused before any request unless confirm is literally true.
try {
  await client.transfer("agent-id", { quoteId: "q" });
} catch (err) {
  console.log(err instanceof ConfirmationRequiredError, err.confirmFlag, err.previewMethod); // true confirm transferQuote
}
```

```bash
node example.mjs
```

## Configuration

```ts
const client = new ThreeAgents({
  apiKey: process.env.THREE_WS_API_KEY!, // required
  baseUrl: "https://three.ws/api/v1",    // default
  timeout: 30_000,                        // per attempt, ms
  retries: 2,                             // after the first attempt, on 5xx, network errors and timeouts
  retryDelay: 1_000,                      // retry n waits retryDelay * 2^n plus up to 20% jitter
  fetch: globalThis.fetch,                // any fetch implementation
  headers: { "x-team": "research" },      // sent on every request
});
```

Every method takes `RequestOptions` as its last argument to override `timeout`
or `retries`, pass an `AbortSignal`, or supply your own `idempotencyKey`.

## Core concepts

**Agent lifecycle.** `createAgent` (optionally from a `strategy` preset:
`momentum`, `sniper`, `defi-yield`, `macro-hedge`, `monitor-exit`,
`conservative`) creates an agent; a preset fills the skills, persona and default
automations you leave out. An agent's status is `running` (its automations,
intents and runs may execute) or `stopped`. `startAgent` and `stopAgent` switch
between them without deleting anything; `deleteAgent` stops automations and
cancels open runs.

**Chat versus runs.** `sendMessage` is one turn and returns the reply with
usage, cost, tool calls and any transaction signatures. `createRun` hands the
agent a goal and lets the server-side tool loop work toward it inside a credit
budget, an on-chain budget and a step limit; follow it with `streamRun` (Server-Sent
Events, resumed from the last event id when the connection drops) or `getRunSteps`.

**Custodial versus non-custodial.** `swapQuote` with an `agentId` trades from the
agent's custodial wallet, and `swapExecute` then needs `confirm: true` and signs
server-side. Without `agentId` the quote is built for your own wallet and
`swapExecute` returns an unsigned base64 transaction for you to sign.

**Money needs a preview and a yes.** `transfer` and `setExternalWallet` throw
`ConfirmationRequiredError` before any request unless their `confirm` flag is
literally `true`. Call the preview method the error names (`transferQuote`,
`getWallet`) and show the result first.

**Idempotency.** Every non-GET request carries an `Idempotency-Key` that is
reused across retries, so a retried create, transfer or swap acts at most once.

**Pagination.** List methods return `Page<T>` (`data`, `hasMore`, `nextCursor`,
`requestId`). `client.paginate(fetchPage)` walks every page:

```ts
for await (const agent of client.paginate((cursor) => client.listAgents({ cursor }))) console.log(agent.name);
```

## API reference

Paths are relative to `baseUrl`. Live means production answered it on 2026-10-08.

### Agents

| Method | Route | Live |
|---|---|---|
| `createAgent(params)` | `POST /agents` | no |
| `getAgent(agentId)` | `GET /agents/:id` | no |
| `listAgents({ limit, cursor })` | `GET /agents` | no |
| `updateAgent(agentId, patch)` | `PATCH /agents/:id` | no |
| `startAgent(agentId)` | `POST /agents/:id/start` | yes |
| `stopAgent(agentId)` | `POST /agents/:id/stop` | yes |
| `deleteAgent(agentId)` | `DELETE /agents/:id` | no |

### Chat and runs

| Method | Route | Live |
|---|---|---|
| `sendMessage(agentId, { message, model?, temperature? })` | `POST /agents/:id/messages` | no |
| `getMessages(agentId, { limit, before })` | `GET /agents/:id/messages` | no |
| `createRun(agentId, { goal, budgetCreditsUsd?, budgetUsd?, maxSteps?, toolsAllowed?, schedule? })` | `POST /agents/:id/runs` | no |
| `listRuns(agentId, page)` | `GET /agents/:id/runs` | no |
| `getRun(runId)` | `GET /runs/:id` | no |
| `updateRun(runId, params)` | `PATCH /runs/:id` | no |
| `cancelRun(runId)` | `POST /runs/:id/cancel` | no |
| `getRunSteps(runId, page)` | `GET /runs/:id/steps` | no |
| `streamRun(runId)` | `GET /runs/:id/events` (SSE) | no |

### Skills

| Method | Route | Live |
|---|---|---|
| `listSkills()` | `GET /skills` | no |
| `listCommunitySkills({ q, tag, author, limit })` | `GET /skills/community` | no |
| `getCommunitySkill(slug)` | `GET /skills/community/:slug` | no |
| `listCustomSkills(agentId)`, `getCustomSkill(agentId, skillId)` | `GET /agents/:id/skills/custom[/:skillId]` | no |
| `createCustomSkill`, `updateCustomSkill`, `deleteCustomSkill` | `POST`, `PATCH`, `DELETE /agents/:id/skills/custom[/:skillId]` | no |
| `importCommunitySkill(agentId, slug, { enabled })` | `POST /agents/:id/skills/custom/import` | no |

### Automations

| Method | Route | Live |
|---|---|---|
| `createAutomation(params)` | `POST /automations` | no |
| `listAutomations(agentId, page)` | `GET /agents/:id/automations` | no |
| `deleteAutomation(automationId)` | `DELETE /automations/:id` | no |

### Intelligence

| Method | Route | Live |
|---|---|---|
| `getPrice(mint)` | `GET /intel/price` | no |
| `getTopMovers(params)` | `GET /intel/top-movers` | no |
| `getIndicators({ mint, indicators, interval })` | `GET /intel/indicators` | no |
| `getSignals(mint)` | `GET /intel/signals` | no |
| `getAnomalies()`, `getMacro()` | `GET /intel/anomalies`, `GET /intel/macro` | no |

### Catalog and account

| Method | Route | Live |
|---|---|---|
| `getModels()` | `GET /models` | yes |
| `getFreeTierStatus()` | `GET /me/free-tier` | yes |
| `getUsage()`, `getBudget()` | `GET /me/usage`, `GET /me/budget` | no |
| `getTransactions(page)` | `GET /me/transactions` | no |
| `listIntegrations()`, `saveIntegration(provider, params)`, `removeIntegration(provider)` | `/me/integrations[/:provider]` | no |
| `generateLinkCode(params)`, `redeemLinkCode({ code })` | `POST /me/link-code[/redeem]` | no |
| `setExternalWallet(agentId, { ..., confirm: true })` | `PUT /agents/:id/external-wallet` | no |

### Wallet and swap

| Method | Route | Live |
|---|---|---|
| `getWallet(agentId, { network })` | `GET /agents/:id/wallet` | no |
| `getWalletHistory(agentId, { limit, cursor, network, category })` | `GET /agents/:id/wallet/history` | no |
| `transferQuote(agentId, params)` | `POST /agents/:id/wallet/transfer/quote` | no |
| `transfer(agentId, { quoteId, confirm: true })` | `POST /agents/:id/wallet/transfer` | no |
| `swapQuote(params)` | `POST /swap/quote` | no |
| `swapExecute(params)` | `POST /swap/execute` | no |

Request and response types for every method are exported from the package
(`CreateAgentParams`, `MessageReply`, `Run`, `RunEvent`, `SwapQuote`, `Wallet`,
`Page<T>` and the rest, from [src/types.ts](src/types.ts)).

## Errors

Every HTTP failure is a subclass of `ThreeAgentsError` carrying `status`, the
stable `code`, the `requestId` (quote it to support), the envelope's `details`,
the `rateLimit` headers, `method` and `path`.

| Class | When |
|---|---|
| `AuthenticationError` | 401: key missing, malformed, revoked or expired. |
| `PermissionError` | 403: key lacks a scope (`scope` names it) or the resource is someone else's. |
| `NotFoundError` | 404. |
| `ValidationError` | 400/422, with per-field `fields`. Also thrown client-side for an empty id. |
| `RateLimitError` | 429, with `retryAfter` in seconds. |
| `InsufficientFundsError` | The wallet or credit balance cannot cover the call. |
| `ConfirmationRequiredError` | A fund-moving call without its confirm flag; names `confirmFlag` and `previewMethod`. |
| `ServerError` | 5xx after the retries are spent. |
| `TimeoutError` | An attempt exceeded `timeout` (`timeoutMs`). |
| `ConnectionError` | The request never got a response. |

On-chain failures reuse the classes from `@three-ws/solana-agent`:
`SolanaAgentError`, `SwapError`, `SimulationError`, `ConfirmationTimeoutError`,
`TransactionRejectedError`, `WalletNotConnectedError`, `WalletCapabilityError`,
`MissingTokenAccountError`.

```ts
import { RateLimitError, ThreeAgentsError } from "@three-ws/agents";

try {
  await client.getFreeTierStatus();
} catch (err) {
  if (err instanceof RateLimitError) console.log(`retry in ${err.retryAfter}s`);
  else if (err instanceof ThreeAgentsError) console.log(err.status, err.code, err.requestId);
  else throw err;
}
```

Also exported: `parseSse(stream)` (the SSE parser `streamRun` uses), `VERSION`,
`DEFAULT_BASE_URL`, and the `FetchLike` and `ResponseMeta` types.

## Requirements

Node 20+ (or any runtime with `fetch`, `AbortSignal` and `ReadableStream`).

## Related

- [docs/api-reference.md](../../docs/api-reference.md): the HTTP API.
- [solana-agent-sdk/](../../solana-agent-sdk): wallet and swap primitives, and the on-chain error classes.
- [packages/three-ws-cli](../three-ws-cli): `npx three-ws setup` mints the key.

## License

Apache-2.0. See [LICENSE](LICENSE).
