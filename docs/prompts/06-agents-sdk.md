# 06. `@three-ws/agents`: the TypeScript SDK with the agent-lifecycle idiom

Read `docs/prompts/README.md` first.

## The problem

Our published SDKs are `@three-ws/sdk` (embed and `AgentKit(...).mount()`), `@three-ws/solana-agent` (wallet and swap primitives with a good error hierarchy in `solana-agent-sdk/src/errors.ts`) and `@three-ws/agent-payments`. None gives a backend developer the five-line experience the best platforms document: construct a client with a key, `createAgent`, `startAgent`, `sendMessage`, read the reply. There is no retry or timeout configuration, no typed error classes for HTTP failures, and `sdk/README.md` has a nav bar but not a full reference.

## Build

A new package `packages/agents-sdk/` published as `@three-ws/agents`. TypeScript, ESM and CJS builds, zero runtime dependencies beyond `fetch` (Node 20+), generated types from the `v1` routes in prompt 05 (use an OpenAPI document generated from those routes and checked into `docs/api/openapi.json`; `openapi-typescript` is fine).

### Client

```ts
import { ThreeAgents } from "@three-ws/agents";
const client = new ThreeAgents({
  apiKey: process.env.THREE_WS_API_KEY!,
  baseUrl: "https://three.ws/api/v1",
  timeout: 30_000,
  retries: 2,
  retryDelay: 1_000,
});
const agent = await client.createAgent({ name: "Momentum Alpha", strategy: "momentum" });
await client.startAgent(agent.id);
const reply = await client.sendMessage(agent.id, { message: "What is trending right now?" });
```

Methods, one per route in prompt 05: `createAgent`, `getAgent`, `listAgents`, `updateAgent`, `startAgent`, `stopAgent`, `deleteAgent`, `sendMessage`, `getMessages`, `createRun`, `listRuns`, `getRun`, `updateRun`, `cancelRun`, `getRunSteps`, `streamRun` (async iterator over SSE), `listSkills`, `listCustomSkills`, `createCustomSkill`, `updateCustomSkill`, `deleteCustomSkill`, `importCommunitySkill`, `createAutomation`, `listAutomations`, `deleteAutomation`, `getPrice`, `getTopMovers`, `getIndicators`, `getSignals`, `getAnomalies`, `getModels`, `getFreeTierStatus`, `getUsage`, `getBudget`, `getTransactions`, `getWallet`, `getWalletHistory`, `transfer` (requires `confirm: true` and refuses without it), `swapQuote`, `swapExecute` (non-custodial: returns an unsigned base64 transaction for the caller to sign, plus the custodial agent-wallet path when `agentId` is passed and `confirm: true`), `launchToken` (prompt 15), `listIntegrations`, `saveIntegration`, `removeIntegration`, `generateLinkCode`, `setExternalWallet`, and typed methods for perps, lending, predictions, marketplace bids, mail and cards as those briefs land (add them in the same change as each brief).

Retries on 5xx, network errors and timeouts with exponential backoff and an idempotency key on every POST that creates or moves value. Rate-limit headers are surfaced on the error.

### Errors

`ThreeAgentsError` base, then `AuthenticationError`, `PermissionError` (scope missing, names the scope), `NotFoundError`, `ValidationError` (with field details), `RateLimitError` (with `retryAfter`), `InsufficientFundsError`, `ConfirmationRequiredError` (names the confirm flag and the preview method), `ServerError`, `TimeoutError`. Reuse the on-chain errors from `@three-ws/solana-agent` rather than duplicating them.

### README

`packages/agents-sdk/README.md` with a real table of contents and these sections: quick start, installation, getting a key (`npx three-ws setup` from prompt 01 or the settings page), configuration, core concepts (agent lifecycle diagram, custodial versus non-custodial paths, runs, automations), full API reference with request and response for every method, strategy presets, skills catalog, models, automation system, swap guide, error handling, types, best practices, pricing and rate limits, examples, requirements, contributing. Every snippet runs against production as a test fixture (`examples/` directory, executed in CI-free local test with a QA key from `AUDIT_EMAIL` provisioning).

## Docs and wiring

- `docs/api-reference.md` and `docs/start-here.md` link the SDK as the primary backend path.
- `sdk/README.md` gains a section pointing backend developers to `@three-ws/agents`.
- `STRUCTURE.md` row, `data/changelog.json` entry tagged `sdk, feature`.
- Publish to npm is push-gated; prepare the release so it is one command and say so in the report.

## Acceptance

- The quick start above runs end to end with a real key and prints a reply.
- `transfer` without `confirm: true` throws `ConfirmationRequiredError` naming `confirm`.
- A 503 from the server is retried twice and then surfaces as `ServerError` with the request id.
- Type check passes; `npm test` green with unit tests for retry, errors and every method's request shape.
