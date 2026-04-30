# Task 14 — SDK: Payment Support for Programmatic Callers

## Goal
Update the TypeScript SDK (`/sdk/`) so that programmatic callers (MCP clients, third-party apps) can discover skill prices, initiate x402 payments, and invoke paid skills — all without a browser UI.

## Success Criteria
- `agent.getSkillPrices()` returns pricing info for all skills
- `agent.invokeSkill(skill, args, { paymentOptions })` handles payment automatically when a price is required
- Payment is skipped if the skill is free
- Caller can pass a wallet signer to the SDK for signing payments
- All new methods are documented with JSDoc

## New SDK Methods

### `AgentClient.getSkillPrices(agentId)`
```ts
async getSkillPrices(agentId: string): Promise<SkillPrice[]>
// Calls GET /api/agents/:id/pricing
// Returns: [{ skill, amount, currencyMint, chain, isActive }]
```

### `AgentClient.invokeSkill(agentId, skill, args, options?)`
```ts
async invokeSkill(
  agentId: string,
  skill: string,
  args: Record<string, unknown>,
  options?: { signer?: WalletSigner }
): Promise<SkillResult>
```

Internally:
1. `GET /api/agents/:id/x402/:skill/manifest`
2. If 404 (free) → call skill directly
3. If 200 (priced) → if no `signer` provided → throw `PaymentRequiredError`
4. If signer provided → build and sign payment → call skill with payment proof

### `PaymentRequiredError`
```ts
class PaymentRequiredError extends Error {
  constructor(public readonly manifest: X402Manifest) {
    super(`Skill requires payment: ${manifest.amount} ${manifest.currencySymbol}`);
  }
}
```

### `WalletSigner` Interface
```ts
interface WalletSigner {
  address: string;
  chain: 'solana' | 'base';
  signPayment(manifest: X402Manifest): Promise<string>; // returns signed payment proof
}
```

Callers provide their own signer implementation (Solana: use `@solana/web3.js` Keypair; Base: use `viem` or `ethers`). The SDK doesn't bundle wallet libraries.

## Files to Touch
- `/sdk/src/agent-client.ts` (or equivalent main client file)
- `/sdk/src/types.ts` — add `SkillPrice`, `X402Manifest`, `WalletSigner`, `PaymentRequiredError`
- `/sdk/src/index.ts` — export new types

## Do NOT Change
- Existing SDK methods
- SDK build config

## Verify
```ts
import { AgentClient } from '@threews/sdk';

const client = new AgentClient({ baseUrl: 'https://3d.irish' });

// Discover prices
const prices = await client.getSkillPrices('agent-uuid');
// [{ skill: 'answer-question', amount: 1000000, ... }]

// Free skill — no payment needed
const result = await client.invokeSkill('agent-uuid', 'greet', {});

// Paid skill — no signer → throws PaymentRequiredError
try {
  await client.invokeSkill('agent-uuid', 'answer-question', { query: 'hello' });
} catch (e) {
  if (e instanceof PaymentRequiredError) {
    console.log('Need to pay:', e.manifest.amount);
  }
}
```
