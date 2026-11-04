// Live smoke test against the real three.ws platform. It needs an API key in
// THREE_WS_API_KEY and is skipped, with the reason printed, when none is set.
// It signs in, lists the account's agents, and when one exists creates a
// server-mode schedule (every 30 minutes, above the 5-minute floor), reads it
// back from /api/v1/automations, and deletes it again.

import { afterAll, describe, expect, it } from 'vitest';
import { whoami } from '../src/commands/auth.js';
import { addSchedule, removeSchedule } from '../src/scheduler.js';
import { createAgentContext } from '../src/session.js';
import { tempEnv } from './helpers.js';

const KEY = process.env.THREE_WS_API_KEY || '';
const SKIP_REASON = 'live smoke test skipped: set THREE_WS_API_KEY to a three.ws API key to run it';
if (!KEY) console.info(SKIP_REASON);

describe.skipIf(!KEY)('live three.ws platform', () => {
	const t = tempEnv({ THREE_WS_API_KEY: KEY, ...(process.env.THREE_WS_ORIGIN ? { THREE_WS_ORIGIN: process.env.THREE_WS_ORIGIN } : {}) });
	const ctx = createAgentContext({ env: t.env, mcp: false });
	afterAll(async () => {
		await ctx.close();
		t.cleanup();
	});

	it('whoami resolves the key to a user without printing it', async () => {
		const r = await whoami({ env: t.env });
		expect(r.signedIn).toBe(true);
		expect(r.userId).toBeTruthy();
		expect(r.key).not.toBe(KEY);
		expect(r.source).toBe('env THREE_WS_API_KEY');
	});

	it('creates, reads back and deletes a server-mode schedule on an owned agent', async () => {
		const agents = await ctx.platform.listAgents({ limit: 5 });
		if (!agents.length) {
			console.info('live schedule check skipped: this account owns no agents');
			return;
		}
		const agentId = agents[0].id;
		const cron = await addSchedule({ store: ctx.store, platform: ctx.platform, agentId, when: 'every 30 minutes', prompt: 'live smoke check from the agent-cli tests', mode: 'server', tz: 'UTC' });
		try {
			expect(cron.mode).toBe('server');
			expect(cron.server_automation_id).toBeTruthy();
			const listed = await ctx.platform.listAutomations();
			const remote = listed.find((a) => a.id === cron.server_automation_id);
			expect(remote).toBeTruthy();
			expect(remote.trigger).toMatchObject({ type: 'schedule', cron: '*/30 * * * *' });
		} finally {
			await removeSchedule({ store: ctx.store, platform: ctx.platform, id: cron.id });
		}
		const after = await ctx.platform.listAutomations();
		expect(after.some((a) => a.id === cron.server_automation_id)).toBe(false);
	});
});
