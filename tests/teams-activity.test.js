// Teams activity feed notifications: the Graph sender (token cache, deep link,
// request contract, retry, permanent failure), the pure mapping, and a guard
// that the manifest declares exactly the activity types the sender can send.

import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

process.env.DATABASE_URL ||= 'postgres://pglite.test/db';

const holder = vi.hoisted(() => ({ targets: [], stored: null, sent: [], failed: [] }));
vi.mock('../api/_lib/teams-identity.js', () => ({
	identitiesForUser: async () => holder.targets,
	recordSent: async (i) => holder.sent.push(i),
	recordFailure: async (i, code) => holder.failed.push({ ...i, code }),
}));
vi.mock('../api/_lib/notify-prefs.js', () => ({ readStoredPrefs: async () => holder.stored }));

const lib = await import('../api/_lib/teams-activity.js');

const ENV = { MS_TEAMS_BOT_APP_ID: 'bot-app', MS_TEAMS_BOT_APP_PASSWORD: 'secret', MS_APP_ID: 'teams-app-id' };
const TENANT = '11111111-1111-4111-8111-111111111111';
const USER = '22222222-2222-4222-8222-222222222222';
const AGENT = '3f2b6a1c-9d4e-4f7a-8b2c-1e5d7a9c0b4f';

const tokenRes = (expires_in = 3600) => ({ ok: true, status: 200, json: async () => ({ access_token: 'tok', expires_in }) });
const graphRes = (status, headers = {}) => ({
	ok: status < 300,
	status,
	headers: { get: (k) => headers[k.toLowerCase()] ?? null },
	text: async () => '',
});

/** A fetch that answers token requests and replays `graph` responses in order. */
function fakeFetch(graph) {
	const calls = [];
	const impl = async (url, init) => {
		calls.push({ url: String(url), init });
		if (String(url).includes('/oauth2/v2.0/token')) return tokenRes();
		return graph.shift() ?? graphRes(202);
	};
	impl.calls = calls;
	return impl;
}
const graphCalls = (f) => f.calls.filter((c) => c.url.includes('/teamwork/sendActivityNotification'));
const tokenCalls = (f) => f.calls.filter((c) => c.url.includes('/oauth2/v2.0/token'));

const base = { tenantId: TENANT, aadObjectId: USER, activityType: 'forgeJobCompleted', topic: '3D model ready', params: { prompt: 'a red fox' }, subEntityId: 'job:abc' };

beforeEach(() => {
	lib.resetGraphTokens();
	Object.assign(holder, { targets: [], stored: null, sent: [], failed: [] });
});

describe('buildDeepLink', () => {
	it('deep links the personal tab with the subEntityId in the context query', () => {
		const url = new URL(lib.buildDeepLink({ appId: 'teams-app-id', subEntityId: `agent:${AGENT}` }));
		expect(url.origin + url.pathname).toBe('https://teams.microsoft.com/l/entity/teams-app-id/threews-agents');
		expect(JSON.parse(url.searchParams.get('context'))).toEqual({ subEntityId: `agent:${AGENT}` });
	});
	it('opens the tab root without a subEntityId', () => {
		expect(lib.buildDeepLink({ appId: 'x' })).toBe('https://teams.microsoft.com/l/entity/x/threews-agents');
	});
});

describe('graphToken', () => {
	it('mints one token per tenant and reuses it until five minutes before expiry', async () => {
		let t = 1_000_000;
		const f = fakeFetch([]);
		const opts = { fetchImpl: f, env: ENV, now: () => t };
		await lib.graphToken(TENANT, opts);
		await lib.graphToken(TENANT, opts);
		expect(tokenCalls(f)).toHaveLength(1);
		await lib.graphToken('other-tenant', opts);
		expect(tokenCalls(f)).toHaveLength(2);
		expect(tokenCalls(f)[0].url).toContain(`/${TENANT}/oauth2/v2.0/token`);
		const body = tokenCalls(f)[0].init.body;
		expect(body.get('grant_type')).toBe('client_credentials');
		expect(body.get('scope')).toBe('https://graph.microsoft.com/.default');
		t += 3600_000 - 5 * 60_000 + 1;
		await lib.graphToken(TENANT, opts);
		expect(tokenCalls(f)).toHaveLength(3);
	});
	it('throws token_failed when the tenant has not consented', async () => {
		const f = async () => ({ ok: false, status: 400, json: async () => ({ error: 'invalid_client' }) });
		await expect(lib.graphToken(TENANT, { fetchImpl: f, env: ENV })).rejects.toMatchObject({ code: 'token_failed', retryable: false });
	});
});

describe('sendActivityNotification', () => {
	it('posts the documented body to the recipient with the deep link as the topic webUrl', async () => {
		const f = fakeFetch([graphRes(204)]);
		await lib.sendActivityNotification(base, { fetchImpl: f, env: ENV, sleep: async () => {} });
		const [call] = graphCalls(f);
		expect(call.url).toBe(`https://graph.microsoft.com/v1.0/users/${USER}/teamwork/sendActivityNotification`);
		expect(call.init.headers.authorization).toBe('Bearer tok');
		const body = JSON.parse(call.init.body);
		expect(body).toMatchObject({
			activityType: 'forgeJobCompleted',
			topic: { source: 'text', value: '3D model ready' },
			templateParameters: [{ name: 'prompt', value: 'a red fox' }],
		});
		expect(JSON.parse(new URL(body.topic.webUrl).searchParams.get('context'))).toEqual({ subEntityId: 'job:abc' });
	});
	it('retries a 429 after the Retry-After delay, then succeeds', async () => {
		const f = fakeFetch([graphRes(429, { 'retry-after': '7' }), graphRes(202)]);
		const sleep = vi.fn(async () => {});
		await expect(lib.sendActivityNotification(base, { fetchImpl: f, env: ENV, sleep })).resolves.toMatchObject({ ok: true });
		expect(sleep).toHaveBeenCalledWith(7);
		expect(graphCalls(f)).toHaveLength(2);
	});
	it('retries 5xx with backoff and gives up after three attempts as a retryable error', async () => {
		const f = fakeFetch([graphRes(503), graphRes(503), graphRes(503)]);
		const sleep = vi.fn(async () => {});
		await expect(lib.sendActivityNotification(base, { fetchImpl: f, env: ENV, sleep })).rejects.toMatchObject({ code: 'rejected', retryable: true });
		expect(graphCalls(f)).toHaveLength(3);
		expect(sleep.mock.calls.map((c) => c[0])).toEqual([1, 2]);
	});
	it.each([[403, 'consent_missing'], [404, 'not_installed']])('treats %i as the permanent failure %s with no retry', async (status, code) => {
		const f = fakeFetch([graphRes(status)]);
		await expect(lib.sendActivityNotification(base, { fetchImpl: f, env: ENV, sleep: async () => {} })).rejects.toMatchObject({ code, retryable: false });
		expect(graphCalls(f)).toHaveLength(1);
	});
	it('refuses to run unconfigured', async () => {
		await expect(lib.sendActivityNotification(base, { fetchImpl: fakeFetch([]), env: {} })).rejects.toMatchObject({ code: 'not_configured' });
	});
});

describe('activityFor', () => {
	it('maps each notification type to its activity type, params and deep link target', () => {
		expect(lib.activityFor('forge_complete', { prompt: 'fox', creation_id: 'c1' })).toMatchObject({ activityType: 'forgeJobCompleted', subEntityId: 'job:c1', params: { prompt: 'fox' } });
		expect(lib.activityFor('forge_failed', { prompt: 'fox', teams_job_key: 'teams-x' })).toMatchObject({ activityType: 'forgeJobFailed', subEntityId: 'job:teams-x' });
		expect(lib.activityFor('mention', { agent_name: 'Ada', agent_id: AGENT, actor: 'Sam' })).toMatchObject({ activityType: 'agentMentioned', subEntityId: `agent:${AGENT}`, params: { agent: 'Ada', actor: 'Sam' } });
		for (const t of ['reply', 'dm_received', 'mail_received']) expect(lib.activityFor(t, {}).activityType).toBe('agentMessageReceived');
		expect(lib.activityFor('agent_loop_report', { message: 'done' }).activityType).toBe('agentTaskCompleted');
		expect(lib.activityFor('skill_purchased', {})).toBeNull();
	});
});

describe('manifest guard', () => {
	const manifest = JSON.parse(readFileSync('integrations/microsoft/copilot-teams/manifest.template.json', 'utf8'));
	const declared = manifest.activities.activityTypes;
	it('declares exactly the activity types the sender can send', () => {
		expect(declared.map((a) => a.type).sort()).toEqual(lib.ACTIVITY_TYPES.map((a) => a.type).sort());
	});
	it('only uses template placeholders the sender fills', () => {
		const samples = { forge_complete: {}, forge_failed: {}, agent_loop_report: {}, mention: {}, reply: {} };
		for (const a of declared) {
			const from = lib.ACTIVITY_TYPES.find((t) => t.type === a.type).from[0];
			const params = Object.keys(lib.activityFor(from, samples[from] || {}).params);
			for (const [, name] of a.templateText.matchAll(/\{(\w+)\}/g)) expect(params).toContain(name);
		}
	});
	it('names the bot app in webApplicationInfo and maps subPageId into the tab URL', () => {
		expect(manifest.webApplicationInfo.id).toBe('${MS_TEAMS_BOT_APP_ID}');
		expect(manifest.staticTabs.find((t) => t.entityId === 'threews-agents').contentUrl).toContain('sub={subPageId}');
	});
});

describe('deliverTeamsNotification', () => {
	const target = { tenant_id: TENANT, aad_object_id: USER, installed: true, last_error_code: null };
	const deps = (fetchImpl) => ({ fetchImpl, env: ENV, sleep: async () => {} });

	it('sends the Forge completion payload to a linked person and records it', async () => {
		holder.targets = [target];
		const f = fakeFetch([graphRes(202)]);
		const n = await lib.deliverTeamsNotification({ userId: 'u1', type: 'forge_complete', payload: { prompt: 'a red fox', teams_job_key: 'teams-abc' } }, deps(f));
		expect(n).toBe(1);
		const body = JSON.parse(graphCalls(f)[0].init.body);
		expect(body.activityType).toBe('forgeJobCompleted');
		expect(body.templateParameters).toEqual([{ name: 'prompt', value: 'a red fox' }]);
		expect(JSON.parse(new URL(body.topic.webUrl).searchParams.get('context'))).toEqual({ subEntityId: 'job:teams-abc' });
		expect(holder.sent).toEqual([{ tenantId: TENANT, aadObjectId: USER }]);
	});
	it('sends nothing when unlinked, uninstalled, switched off, unconfigured or not a Teams event', async () => {
		const f = fakeFetch([]);
		const ev = { userId: 'u1', type: 'forge_complete', payload: {} };
		expect(await lib.deliverTeamsNotification(ev, deps(f))).toBe(0);
		holder.targets = [{ ...target, installed: false }];
		expect(await lib.deliverTeamsNotification(ev, deps(f))).toBe(0);
		holder.targets = [target];
		holder.stored = { teams: { events: { forgeJobCompleted: false } } };
		expect(await lib.deliverTeamsNotification(ev, deps(f))).toBe(0);
		holder.stored = null;
		expect(await lib.deliverTeamsNotification(ev, { ...deps(f), env: {} })).toBe(0);
		expect(await lib.deliverTeamsNotification({ ...ev, type: 'skill_purchased' }, deps(f))).toBe(0);
		expect(f.calls).toHaveLength(0);
	});
	it('keeps agentTaskCompleted off until chosen', async () => {
		holder.targets = [target];
		const f = fakeFetch([]);
		const ev = { userId: 'u1', type: 'agent_loop_report', payload: { message: 'done' } };
		expect(await lib.deliverTeamsNotification(ev, deps(f))).toBe(0);
		holder.stored = { teams: { events: { agentTaskCompleted: true } } };
		expect(await lib.deliverTeamsNotification(ev, deps(fakeFetch([graphRes(202)])))).toBe(1);
	});
	it('records a permanent failure once and never throws', async () => {
		holder.targets = [target];
		const f = fakeFetch([graphRes(403)]);
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		await expect(lib.deliverTeamsNotification({ userId: 'u1', type: 'forge_failed', payload: { prompt: 'x' } }, deps(f))).resolves.toBe(0);
		expect(holder.failed).toEqual([{ tenantId: TENANT, aadObjectId: USER, code: 'consent_missing' }]);
		warn.mockRestore();
	});
	it('does not record transient exhaustion', async () => {
		holder.targets = [target];
		const f = fakeFetch([graphRes(500), graphRes(500), graphRes(500)]);
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		await lib.deliverTeamsNotification({ userId: 'u1', type: 'forge_failed', payload: {} }, deps(f));
		expect(holder.failed).toEqual([]);
		warn.mockRestore();
	});
});
