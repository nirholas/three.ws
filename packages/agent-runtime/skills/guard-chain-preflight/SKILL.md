---
name: guard-chain-preflight
description: Preflight an agent tool call through the seven-layer GuardChain, run the plan/execute AgentRuntime loop with human approval, and verify a hash-chained action ledger using @three-ws/agent-runtime. Use when adding guardrails or an audit trail to an agent that can move funds.
---

# Guard chain preflight and action ledger

`@three-ws/agent-runtime` is a pure engine (ESM, Node 18+, one dependency `tokenx`): no chain SDKs, no database, no HTTP. Every external fact is injected.

Install: `npm install @three-ws/agent-runtime`

## Preflight a tool call

```js
import { GuardChain, SpendGuard, TradeGuard, createX402Hook } from '@three-ws/agent-runtime';

const chain = new GuardChain({
  defiGuard: new TradeGuard(),
  spendGuard: new SpendGuard({ perTxMaxUsd: 5_000 }),
  x402Hook: createX402Hook(5), // $5 per hour autonomy budget
});

const verdict = await chain.evaluate({
  identifier: 'solana_swap',
  apiName: 'solana_swap',
  arguments: { inputMint: '...', amount: 120, slippageBps: 300 },
  valueUsd: 18_400,
  userTier: 'pro',
});
// verdict.decision, verdict.blockedBy, verdict.modifiedArguments,
// verdict.coverageScore, verdict.blindSpots
```

Layer order: `security_blacklist`, `intervention`, `capability`, `permission`, `defi_guard`, `spend_guard`, `x402`. The chain does not short-circuit. Layers that could not evaluate (for example no `checkCapability` or `checkPermission` resolver injected) are reported as `blindSpots` and lower `coverageScore`. Treat a blind spot as unprotected, not as a pass. Inject both resolvers (each `async (request) => ({ allowed })`) to reach coverage 100.

Never run a tool whose verdict is `block`. For `require_approval`, ask the human first.

## Register new fund-moving tools

```js
import { registerFundMovingTool, registerMutatingApi } from '@three-ws/agent-runtime';
registerFundMovingTool('my_bridge_tool');
registerMutatingApi('executeBridgeV2');
```

An unregistered fund-moving tool shows up as a critical `TOOL_UNREGISTERED` blind spot.

## Decision loop

```js
import { AgentRuntime, GeneralChatAgent } from '@three-ws/agent-runtime';
const agent = new GeneralChatAgent({ modelRuntimeConfig: { model: '...', provider: '...' } });
agent.modelRuntime = myStreamingLlm; // async generator yielding { content?, tool_calls? }
agent.tools = { get_price: async (args) => fetchPrice(args) };

let state = AgentRuntime.createInitialState({ operationId: 'op-1' });
state.messages.push({ role: 'user', content: 'What is SOL at?' });
const runtime = new AgentRuntime(agent);
let context;
while (state.status !== 'done' && state.status !== 'error') {
  const step = await runtime.step(state, context);
  state = step.newState; context = step.nextContext;
  if (state.status === 'waiting_for_human') break; // show state.pendingToolsCalling
}
```

After approval continue with `runtime.approveToolCall(state, approvedCall)`. Cancel and resume with `runtime.interrupt()` and `runtime.resume()`.

## Verify a ledger

```js
import { computeEntryHash, verifyChain } from '@three-ws/agent-runtime';
const result = verifyChain(rows); // rows carry entryHash and prevHash, sorted by seq internally
// result.valid, result.brokenAtIndex, result.brokenAtSeq, result.reason
```

Other exports: `SpendGuard`, `InterventionChecker`, `TransactionPipeline` (dependency order, rollback), `DecisionJournal`, `SelfReflection`, `ExitDecisionEngine`, `ToolRelevanceScorer`, `verifyChainWindow`.
