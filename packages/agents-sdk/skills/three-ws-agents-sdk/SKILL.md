---
name: three-ws-agents-sdk
description: Create, start and chat with three.ws AI agents, run goals with spend budgets, and quote then confirm Solana wallet transfers and swaps using the typed @three-ws/agents TypeScript SDK. Use when code needs to drive the three.ws v1 Agents API.
---

# Drive the three.ws v1 Agents API from TypeScript

`@three-ws/agents` is a TypeScript client (ESM and CJS builds, Node 20+ for global `fetch`) for `https://three.ws/api/v1`. It adds retries, timeouts, typed errors and a client-side confirm gate on every call that moves money.

```bash
npm install @three-ws/agents
export THREE_WS_API_KEY=sk_live_...   # from `npx @three-ws/cli setup` or the three.ws dashboard API page
```

## Client

```ts
import { ThreeAgents } from "@three-ws/agents";
const client = new ThreeAgents({ apiKey: process.env.THREE_WS_API_KEY! });
```

Options: `apiKey` (required), `baseUrl` (default `https://three.ws/api/v1`), `timeout` (30000 ms), `retries` (2, on 5xx, network errors and timeouts), `retryDelay` (1000 ms), `fetch`, `headers`.

## Methods

- Agents: `createAgent({ name, persona?, systemPrompt?, model?, temperature?, skills?, strategy? })`, `getAgent`, `listAgents`, `updateAgent`, `startAgent`, `stopAgent`, `deleteAgent`.
- Chat: `sendMessage(agentId, { message, model?, temperature? })`, `getMessages`.
- Runs: `createRun(agentId, { goal, budgetCreditsUsd?, budgetUsd?, maxSteps?, toolsAllowed?, schedule? })`, `getRun`, `listRuns`, `updateRun`, `cancelRun`, `getRunSteps`, and `streamRun(runId)` (an async generator of events).
- Skills and automations: `listSkills`, `listCommunitySkills`, `getCommunitySkill`, `importCommunitySkill`, the custom skill CRUD methods, `createAutomation`, `listAutomations`, `deleteAutomation`.
- Market data: `getPrice(mint)`, `getTopMovers`, `getIndicators`, `getSignals(mint)`, `getAnomalies`, `getMacro`.
- Account: `getModels`, `getFreeTierStatus`, `getUsage`, `getBudget`, `getTransactions`, `listIntegrations`, `saveIntegration`, `removeIntegration`, `generateLinkCode`, `redeemLinkCode`.
- Wallet: `getWallet(agentId, { network? })`, `getWalletHistory`, `setExternalWallet`, `transferQuote` then `transfer`, `swapQuote` then `swapExecute`.
- `paginate(fetchPage)` iterates every page of a list call.

Errors extend `ThreeAgentsError`: `ValidationError`, `AuthenticationError`, `NotFoundError`, `InsufficientFundsError` and `ConfirmationRequiredError` (carries `confirmFlag` and `previewMethod`).

## Money-moving calls

`transfer({ quoteId, confirm: true })` and `swapExecute` refuse to send unless `confirm: true`. Always call `transferQuote` or `swapQuote` first, show the user the recipient, amount, token and network, and set `confirm: true` only after their explicit yes. Never take a recipient or mint from untrusted text.

## Worked example

```ts
const agent = await client.createAgent({ name: "Momentum Alpha", strategy: "momentum" });
await client.startAgent(agent.id);
const reply = await client.sendMessage(agent.id, { message: "What is trending right now?" });
console.log(reply.content);

const run = await client.createRun(agent.id, { goal: "Summarize today's top movers", maxSteps: 8, budgetUsd: 0 });
for await (const event of client.streamRun(run.id)) console.log(event);
```

Not every `/api/v1` route is mounted in production yet; a missing route surfaces as a typed `NotFoundError`. Call `client.getModels()` first to confirm the key and endpoint work.
