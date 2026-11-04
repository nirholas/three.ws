// Live smoke test against a real deployment. Runs only when THREE_WS_API_KEY is
// set (optionally THREE_WS_BASE_URL); otherwise it is reported as skipped.
// Read-only apart from one agent it creates and always deletes.
import { afterAll, describe, expect, it } from 'vitest';
import { ThreeAgents } from '../src/index.ts';

const key = process.env.THREE_WS_API_KEY;
const live = key ? describe : describe.skip;

live('live API (THREE_WS_API_KEY)', () => {
	const c = key ? new ThreeAgents({ apiKey: key, baseUrl: process.env.THREE_WS_BASE_URL || undefined, timeout: 60_000 }) : null;
	let createdId = null;

	afterAll(async () => {
		if (createdId) await c.deleteAgent(createdId).catch(() => {});
	});

	it('lists models and free-tier status', async () => {
		expect(await c.getModels()).toBeTruthy();
		expect(await c.getFreeTierStatus()).toBeTruthy();
	});

	it('creates, reads and deletes an agent', async () => {
		const agent = await c.createAgent({ name: `sdk-live-${Date.now()}` });
		createdId = agent.id;
		expect((await c.getAgent(agent.id)).id).toBe(agent.id);
		await c.deleteAgent(agent.id);
		createdId = null;
		await expect(c.getAgent(agent.id)).rejects.toMatchObject({ name: 'NotFoundError' });
	});

	it('serves account and intel reads', async () => {
		expect(await c.getBudget()).toHaveProperty('balanceUsd');
		expect(await c.getUsage()).toHaveProperty('plan');
		expect(await c.getMacro({ window: '1h' })).toHaveProperty('macro');
	});
});
