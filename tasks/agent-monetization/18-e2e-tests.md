# Task 18 — End-to-End Tests: Agent Monetization Flow

## Goal
Automated tests that cover the complete monetization flow: set price → caller pays → revenue recorded → owner withdraws. These are integration tests that hit real DB (test schema) and real API handlers.

## Success Criteria
- All happy-path scenarios pass
- Key error paths are covered (insufficient balance, wrong owner, replay)
- Tests are isolated (each test creates its own users/agents, cleans up after)
- Tests run with `npm test` without side effects on production data

## Test File
`/tests/agent-monetization.test.js`

Use the existing test framework (Vitest based on the project setup). Reference `/tests/` for existing patterns.

## Test Cases

### 1. Pricing CRUD
```js
test('owner can set and read skill price', async () => {
  const { agent, session } = await createTestAgent();
  await setPricing(session, agent.id, 'answer-question', { amount: 1000000, chain: 'solana', ... });
  const prices = await getPricing(agent.id);
  expect(prices[0].amount).toBe(1000000);
});

test('non-owner gets 403', async () => {
  const { agent } = await createTestAgent();
  const { session: otherSession } = await createTestUser();
  const res = await setPricing(otherSession, agent.id, 'answer-question', { ... });
  expect(res.status).toBe(403);
});
```

### 2. x402 Manifest
```js
test('manifest returns price when skill is priced', async () => {
  // set price, then fetch manifest
  const manifest = await getManifest(agent.id, 'answer-question');
  expect(manifest.amount).toBe(1000000);
});

test('manifest returns 404 when skill is not priced', async () => {
  const res = await fetch(`/api/agents/${agent.id}/x402/free-skill/manifest`);
  expect(res.status).toBe(404);
});
```

### 3. Revenue Attribution
```js
test('consuming an intent creates revenue event', async () => {
  // Create intent, mark paid, consume
  await consumeIntent(intentId, payerAddress);
  const events = await db.query(
    'SELECT * FROM agent_revenue_events WHERE intent_id = $1', [intentId]
  );
  expect(events.length).toBe(1);
  expect(events[0].fee_amount).toBe(Math.floor(1000000 * 0.025));
  expect(events[0].net_amount).toBe(1000000 - events[0].fee_amount);
});

test('double-consumption is rejected', async () => {
  await consumeIntent(intentId, payerAddress);
  const res2 = await consumeIntent(intentId, payerAddress);
  expect(res2.status).toBe(409);
});
```

### 4. Revenue Dashboard
```js
test('revenue endpoint returns correct totals', async () => {
  // Insert test revenue events
  const data = await getRevenue(session);
  expect(data.summary.gross_total).toBeGreaterThan(0);
  expect(data.by_skill.length).toBeGreaterThan(0);
});
```

### 5. Withdrawals
```js
test('owner can withdraw available balance', async () => {
  // Seed revenue events, then request withdrawal
  const w = await requestWithdrawal(session, { amount: 950000, ... });
  expect(w.status).toBe('pending');
});

test('over-withdrawal is rejected', async () => {
  const res = await requestWithdrawal(session, { amount: 9999999999, ... });
  expect(res.status).toBe(422);
  expect(res.error).toBe('insufficient_balance');
});
```

### 6. Rate Limiting
```js
test('payment intent creation is rate-limited', async () => {
  // Send 25 intent requests from the same payer address
  // At least some should return 429
  const results = await Promise.all(Array(25).fill(null).map(() => createIntent(...)));
  expect(results.some(r => r.status === 429)).toBe(true);
});
```

## Test Helpers to Create

```js
// tests/_helpers/monetization.js
export async function createTestAgent(overrides = {}) { ... }
export async function setPricing(session, agentId, skill, price) { ... }
export async function getPricing(agentId) { ... }
export async function getManifest(agentId, skill) { ... }
export async function consumeIntent(intentId, payerAddress) { ... }
export async function getRevenue(session, params = {}) { ... }
export async function requestWithdrawal(session, body) { ... }
```

## Files to Create
- `/tests/agent-monetization.test.js`
- `/tests/_helpers/monetization.js`

## Verify
```bash
npm test -- tests/agent-monetization.test.js
# All tests pass, no leftover test data in DB
```
