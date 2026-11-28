// Slack Marketplace readiness: what a listed, distributed Slack app needs beyond
// the chat gateway itself.
//
//   Installs that start from the Slack Marketplace or the public /slack page.
//   The installer may have no three.ws account, so the install leg must not
//   demand a sign-in, and the OAuth callback must be bound to the browser that
//   started it (a state signed with a nonce that is also in a cookie), never to
//   whoever's session happens to be present.
//
//   The App Home tab. Opening the app in Slack publishes a home view that says
//   what the app does and whether this person's DM is paired, so a fresh
//   workspace is never met by a blank screen.
//
// The receiver runs over a real socket, the store on a real Postgres (PGlite
// from the shipped migrations); Slack is answered at the fetch boundary.

import http from 'node:http';
import { describe, it, expect, beforeAll, beforeEach, afterAll, afterEach, vi } from 'vitest';
import { createGatewayDb, seedPairedChat } from './_db.js';

const holder = vi.hoisted(() => ({ db: null, user: null }));
vi.mock('../../../api/_lib/db.js', async (importOriginal) => {
	const actual = await importOriginal();
	return { ...actual, sql: (strings, ...values) => holder.db.sql(strings, ...values) };
});
vi.mock('../../../api/_lib/auth.js', async (importOriginal) => {
	const actual = await importOriginal();
	return { ...actual, getSessionUser: async () => holder.user };
});

process.env.SLACK_SIGNING_SECRET = 'fixture-slack-signing-secret';
process.env.SLACK_CLIENT_ID = '1111111111.2222222222';
process.env.SLACK_CLIENT_SECRET = 'fixture-slack-client-secret';
process.env.WALLET_ENCRYPTION_KEY ||= 'fixture-wallet-encryption-key-0123456789abcdef';

const { classifySlackDelivery } = await import('../../../api/_lib/gateway/webhooks.js');
const { default: receiver } = await import('../../../api/gateway/slack.js');
const { createSlackAdapter } = await import('../src/adapters/slack.js');
const { createDrainer } = await import('../src/drain.js');
const store = await import('../../../api/_lib/gateway/store.js');

const quietLog = { debug() {}, info() {}, warn() {}, error() {} };
const OAUTH_ANSWER = { ok: true, access_token: 'fixture-bot-token-market', team: { id: 'T0MARKET01', name: 'Fixture Co' }, bot_user_id: 'U0MARKBOT1', app_id: 'A0FIXAPP01' };

let server;
const realFetch = globalThis.fetch;
let slackCalls = [];

async function get(path, { cookie } = {}) {
	const { port } = server.address();
	const res = await realFetch(`http://127.0.0.1:${port}${path}`, { redirect: 'manual', headers: cookie ? { cookie } : {} });
	return { status: res.status, location: res.headers.get('location'), setCookie: res.headers.get('set-cookie') };
}

/** Start an install and return the state Slack would echo back plus the cookie the browser keeps. */
async function startInstall() {
	const res = await get('/api/gateway/slack?leg=install');
	const url = new URL(res.location);
	const cookie = (res.setCookie || '').split(';')[0];
	return { res, url, state: url.searchParams.get('state'), cookie };
}

const installs = () => holder.db.query('SELECT team_id, team_name, bot_user_id, bot_token, installed_by, revoked_at FROM gateway_slack_installs');

beforeAll(async () => {
	holder.db = await createGatewayDb();
	server = http.createServer((req, res) => receiver(req, res));
	await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
});
afterAll(async () => {
	await new Promise((resolve) => server.close(resolve));
});
beforeEach(async () => {
	holder.user = null;
	slackCalls = [];
	await holder.db.exec('TRUNCATE gateway_inbox, gateway_slack_installs, gateway_links, agent_identities, users RESTART IDENTITY CASCADE');
	// Only slack.com is answered here; the test's own requests to the receiver go out for real.
	vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
		const u = String(url);
		if (u.startsWith('https://slack.com/api/oauth.v2.access')) {
			slackCalls.push({ url: u, body: Object.fromEntries(new URLSearchParams(String(init.body))) });
			return Response.json(OAUTH_ANSWER);
		}
		return realFetch(url, init);
	});
});
afterEach(() => {
	vi.restoreAllMocks();
});

describe('slack install without a three.ws account (Marketplace and /slack)', () => {
	it('tells the public /slack page whether Add to Slack works, without a sign-in', async () => {
		const { port } = server.address();
		const live = await realFetch(`http://127.0.0.1:${port}/api/gateway/slack?leg=status`);
		expect(live.status).toBe(200);
		expect(await live.json()).toEqual({ available: true, install_url: '/api/gateway/slack?leg=install' });

		const saved = process.env.SLACK_CLIENT_SECRET;
		delete process.env.SLACK_CLIENT_SECRET;
		try {
			const off = await realFetch(`http://127.0.0.1:${port}/api/gateway/slack?leg=status`);
			expect(await off.json()).toEqual({ available: false, install_url: null });
		} finally {
			process.env.SLACK_CLIENT_SECRET = saved;
		}
	});

	it('sends a signed-out visitor straight to Slack consent with a state bound to a cookie', async () => {
		const { res, url, state, cookie } = await startInstall();
		expect(res.status).toBe(302);
		expect(`${url.origin}${url.pathname}`).toBe('https://slack.com/oauth/v2/authorize');
		expect(url.searchParams.get('client_id')).toBe('1111111111.2222222222');
		expect(url.searchParams.get('redirect_uri')).toBe('https://three.ws/api/gateway/slack?leg=oauth');
		expect(url.searchParams.get('scope').split(',')).toContain('chat:write');
		expect(state).toBeTruthy();
		expect(res.setCookie).toMatch(/HttpOnly/i);
		expect(res.setCookie).toMatch(/SameSite=Lax/i);
		expect(res.setCookie).toMatch(/Secure/i);
		const nonce = cookie.split('=')[1];
		expect(nonce.length).toBeGreaterThanOrEqual(16);
		expect(state).toContain(nonce);
	});

	it('completes a signed-out install: stores the sealed token with no owner and lands on /slack', async () => {
		const { state, cookie } = await startInstall();
		const res = await get(`/api/gateway/slack?leg=oauth&code=fixture-code&state=${encodeURIComponent(state)}`, { cookie });
		expect(res.status).toBe(302);
		expect(res.location).toBe('/slack?installed=1&team=T0MARKET01&app=A0FIXAPP01');
		expect(slackCalls).toHaveLength(1);
		expect(slackCalls[0].body).toMatchObject({ code: 'fixture-code', client_id: '1111111111.2222222222' });
		const [row] = await installs();
		expect(row).toMatchObject({ team_id: 'T0MARKET01', team_name: 'Fixture Co', bot_user_id: 'U0MARKBOT1', installed_by: null, revoked_at: null });
		expect(row.bot_token).not.toContain('fixture-bot-token-market');
		expect(res.setCookie).toMatch(/Max-Age=0/);
	});

	it('refuses a callback whose browser never started the install (no cookie, or another cookie)', async () => {
		const { state } = await startInstall();
		const noCookie = await get(`/api/gateway/slack?leg=oauth&code=fixture-code&state=${encodeURIComponent(state)}`);
		expect(noCookie.location).toBe('/slack?install=expired');
		const other = await startInstall();
		const wrongCookie = await get(`/api/gateway/slack?leg=oauth&code=fixture-code&state=${encodeURIComponent(state)}`, { cookie: other.cookie });
		expect(wrongCookie.location).toBe('/slack?install=expired');
		expect(slackCalls).toHaveLength(0);
		expect(await installs()).toEqual([]);
	});

	it('refuses a callback with no state at all, and says so on /slack', async () => {
		const res = await get('/api/gateway/slack?leg=oauth&code=fixture-code');
		expect(res.location).toBe('/slack?install=expired');
		expect(slackCalls).toHaveLength(0);
	});

	it('sends a cancelled consent back to /slack with the reason', async () => {
		const { state, cookie } = await startInstall();
		const res = await get(`/api/gateway/slack?leg=oauth&error=access_denied&state=${encodeURIComponent(state)}`, { cookie });
		expect(res.location).toBe('/slack?install=cancelled');
	});

	it('records the signed-in owner who installed from Connections and returns them there', async () => {
		const [user] = await holder.db.query('INSERT INTO users DEFAULT VALUES RETURNING id');
		holder.user = { id: user.id };
		const { state, cookie } = await startInstall();
		const res = await get(`/api/gateway/slack?leg=oauth&code=fixture-code&state=${encodeURIComponent(state)}`, { cookie });
		expect(res.location).toBe('/settings/connections?slack=installed#tab-connections');
		const [row] = await installs();
		expect(row.installed_by).toBe(user.id);
	});
});

// ── App Home ─────────────────────────────────────────────────────────────────

const homeDelivery = (tab = 'home') => ({
	type: 'event_callback',
	team_id: 'T0FIXTURE1',
	event_id: 'Ev0FIXHOME1',
	event: { type: 'app_home_opened', user: 'U0FIXOWNER', channel: 'D0FIXHOME1', tab, event_ts: '1762961000.000100' },
});

function fakeSlack(answer = () => null) {
	const calls = [];
	const fetchImpl = async (url, init = {}) => {
		calls.push({ url: String(url), body: JSON.parse(init.body) });
		return answer(String(url)) || Response.json({ ok: true });
	};
	return { calls, adapter: createSlackAdapter({ env: {}, fetch: fetchImpl, tokenFor: async () => 'xoxb-fixture-never-sent' }) };
}

const blockText = (view) => JSON.stringify(view.blocks);

describe('slack App Home', () => {
	it('queues a Home tab open and ignores the Messages tab', () => {
		const home = classifySlackDelivery({ contentType: 'application/json', rawBody: JSON.stringify(homeDelivery()) });
		expect(home).toMatchObject({ type: 'enqueue', dedupeKey: 'home:Ev0FIXHOME1', chatKey: 'slack:D0FIXHOME1', payload: { kind: 'slack_home', team_id: 'T0FIXTURE1' } });
		const messages = classifySlackDelivery({ contentType: 'application/json', rawBody: JSON.stringify(homeDelivery('messages')) });
		expect(messages).toEqual({ type: 'ignore' });
	});

	it('maps a Home open to a quiet event that never speaks in the DM', () => {
		const { adapter } = fakeSlack();
		expect(adapter.normalize({ kind: 'slack_home', team_id: 'T0FIXTURE1', event: homeDelivery().event })).toMatchObject({
			platform: 'slack', homeOpened: true, quiet: true, chatType: 'home', chatId: 'T0FIXTURE1:D0FIXHOME1', userId: 'U0FIXOWNER', teamId: 'T0FIXTURE1',
		});
	});

	it('publishes onboarding with pairing steps to someone whose DM is not paired', async () => {
		const { adapter, calls } = fakeSlack();
		const event = adapter.normalize({ kind: 'slack_home', team_id: 'T0FIXTURE1', event: homeDelivery().event });
		const fallback = vi.fn();
		await adapter.handle(event, adapter.gateway(event), fallback);
		expect(fallback).not.toHaveBeenCalled();
		expect(calls).toHaveLength(1);
		expect(calls[0].url).toBe('https://slack.com/api/views.publish');
		expect(calls[0].body.user_id).toBe('U0FIXOWNER');
		expect(calls[0].body.view.type).toBe('home');
		const text = blockText(calls[0].body.view);
		expect(text).toContain('Not connected yet');
		expect(text).toContain('/three link');
		expect(text).toContain('https://three.ws/settings/connections');
	});

	it('shows a paired owner which agent the DM talks to', async () => {
		await seedPairedChat(holder.db, { platform: 'slack', chatId: 'T0FIXTURE1:D0FIXHOME1', platformUserId: 'U0FIXOWNER' });
		const { adapter, calls } = fakeSlack();
		const event = adapter.normalize({ kind: 'slack_home', team_id: 'T0FIXTURE1', event: homeDelivery().event });
		await adapter.handle(event, adapter.gateway(event), vi.fn());
		const text = blockText(calls[0].body.view);
		expect(text).toContain('Connected');
		expect(text).toContain('Test Agent');
		expect(text).not.toContain('Not connected yet');
	});

	it('hands every other event to the shared gateway core', async () => {
		const { adapter } = fakeSlack();
		const event = { platform: 'slack', chatId: 'T0FIXTURE1:D0FIXTURE01', chatType: 'dm', userId: 'U0FIXOWNER', text: 'hi' };
		const fallback = vi.fn(async () => 'core-answered');
		const gw = adapter.gateway(event);
		expect(await adapter.handle(event, gw, fallback)).toBe('core-answered');
		expect(fallback).toHaveBeenCalledWith(event, gw);
	});

	it('never apologises into the DM when publishing the Home view keeps failing', async () => {
		const { adapter, calls } = fakeSlack((url) => (url.endsWith('views.publish') ? new Response('bad gateway', { status: 502 }) : null));
		const drainer = createDrainer({
			adapters: new Map([['slack', adapter]]),
			config: { concurrency: 1, pollMs: 50, leaseSeconds: 60, maxAttempts: 1, backoffBaseMs: 10, backoffMaxMs: 10, turnTimeoutMs: 10_000, sweepMs: 60_000, pruneKeepDays: 7, shutdownGraceMs: 1000, backlogTtlSeconds: 21_600, chatKeys: null },
			log: quietLog,
		});
		await store.enqueueInbox({ platform: 'slack', dedupeKey: 'home:Ev0FIXHOME1', chatKey: 'slack:D0FIXHOME1', payload: { kind: 'slack_home', team_id: 'T0FIXTURE1', event: homeDelivery().event } });
		await drainer.tick();
		await Promise.allSettled([...drainer.inflight.values()]);
		const [row] = await holder.db.query('SELECT status FROM gateway_inbox');
		expect(row.status).toBe('failed');
		expect(calls.map((c) => c.url)).toEqual(['https://slack.com/api/views.publish']);
	});
});

describe('uninstall', () => {
	async function postSigned(body) {
		const { createHmac } = await import('node:crypto');
		const raw = JSON.stringify(body);
		const ts = String(Math.floor(Date.now() / 1000));
		const sig = 'v0=' + createHmac('sha256', process.env.SLACK_SIGNING_SECRET).update(`v0:${ts}:${raw}`).digest('hex');
		const { port } = server.address();
		return realFetch(`http://127.0.0.1:${port}/api/gateway/slack`, {
			method: 'POST',
			headers: { 'content-type': 'application/json', 'x-slack-request-timestamp': ts, 'x-slack-signature': sig },
			body: raw,
		});
	}

	it.each(['app_uninstalled', 'tokens_revoked'])('erases the stored bot token when Slack sends %s', async (type) => {
		const { state, cookie } = await startInstall();
		await get(`/api/gateway/slack?leg=oauth&code=fixture-code&state=${encodeURIComponent(state)}`, { cookie });
		const res = await postSigned({ type: 'event_callback', team_id: 'T0MARKET01', event_id: `Ev0${type.length}UNINST`, event: { type, tokens: { bot: ['U0MARKBOT1'] } } });
		expect(res.status).toBe(200);
		const [row] = await installs();
		expect(row.revoked_at).not.toBeNull();
		expect(row.bot_token).toBe('');
		const { slackTokenFor } = await import('../../../api/_lib/gateway/slack-installs.js');
		expect(await slackTokenFor('T0MARKET01', {})).toBeNull();
	});
});
