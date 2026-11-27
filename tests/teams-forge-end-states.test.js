// Every way a Teams or Copilot "Create a 3D model" card can end, and the paths
// that make sure it does end: a model, or a message that says what happened and
// what to do next (api/_lib/teams-forge.js, teams-forge-cards.js,
// teams-forge-bot.js, api/cron/teams-forge-sweep.js).
//
// Like tests/teams-forge.test.js, the generator (forge_free, collectJob) and the
// Bot Connector are the only stand-ins: they are the network boundaries, passed
// through the documented deps seam. The job store and the active-job index are
// the real cache module and its in-memory backend. Every card is validated
// against the published Adaptive Cards 1.5 schema.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import Ajv from 'ajv';
import draft06 from 'ajv/dist/refs/json-schema-draft-06.json' with { type: 'json' };
import { handleActivity } from '../api/_lib/teams-bot.js';
import {
	forgeKey,
	loadJob,
	claimJob,
	patchJob,
	runTeamsForge,
	refreshStatus,
	sweepTeamsForge,
	activeKeys,
	JOB_MAX_AGE_MS,
	THROTTLE_RETRY_MAX_S,
} from '../api/_lib/teams-forge.js';
import { forgeErrorCard, forgeFinishedCard, forgeProgressCard, escapeMarkdown, PROMPT_MAX, CARD_MAX_BYTES } from '../api/_lib/teams-forge-cards.js';
import { TOOLS } from '../api/_mcp-studio/tools.js';

const { id: schemaId, ...schemaBody } = JSON.parse(readFileSync(new URL('./fixtures/adaptive-card-1.5.schema.json', import.meta.url), 'utf8'));
const ajv = new Ajv({ strict: false, allErrors: true, validateFormats: false });
ajv.addMetaSchema(draft06);
const validateCard = ajv.compile({ $id: schemaId, ...schemaBody });

function expectValidCard(card) {
	if (!validateCard(card)) throw new Error(`card fails the Adaptive Cards 1.5 schema: ${JSON.stringify(validateCard.errors.slice(0, 5))}`);
	// Teams refuses a card message over 28 KB.
	expect(Buffer.byteLength(JSON.stringify(card))).toBeLessThan(CARD_MAX_BYTES);
	// Teams shows at most six actions on a card.
	expect((card.actions || []).length).toBeLessThanOrEqual(6);
	for (const block of card.body) if (block.type === 'Image') expect(block.url).toMatch(/^https:\/\//);
	for (const a of card.actions || []) if (a.type === 'Action.OpenUrl') expect(a.url).toMatch(/^https:\/\//);
}

const SERVICE = 'https://smba.trafficmanager.net/amer/';
const ORIGIN = 'https://three.ws';
const SELF = 'https://three-ws-api.example.run.app';
const CONVERSATION = '19:end-states@thread.skype';
const USER = { id: '29:1endStatesUser', name: 'Ada Lovelace', aadObjectId: 'a1b2c3d4-0000-4000-8000-000000000001' };
const GLB = 'https://media.three.ws/forge/end/model.glb';
const POSTER = 'https://media.three.ws/forge/end/poster.png';

let seq = 0;
const nextId = () => `f:end${Date.now()}${++seq}`;

const pending = (jobId) => ({
	content: [{ type: 'text', text: 'still rendering' }],
	structuredContent: { status: 'pending', jobId, job_id: jobId, phase: 'running', elapsed_seconds: 30, eta_seconds: 90 },
});
const done = (jobId) => ({
	content: [{ type: 'text', text: 'done' }],
	structuredContent: { status: 'done', glbUrl: GLB, viewerUrl: `${ORIGIN}/viewer?src=${encodeURIComponent(GLB)}`, poster_png_url: POSTER, job_id: jobId },
});
// The exact envelopes forge_free hands back for a refused submit
// (api/_mcp-studio/tools.js finishMesh over gpt-forge-client.js startForge).
const busy = (retryAfter = 45) => ({
	isError: true,
	content: [{ type: 'text', text: `The 3D generator is busy right now. Try again in about ${retryAfter}s.` }],
	structuredContent: { error: true, message: `The 3D generator is busy right now. Try again in about ${retryAfter}s.`, failure_code: 'busy', retry_after: retryAfter },
});
const dailyLimit = (resetAt) => ({
	isError: true,
	content: [{ type: 'text', text: 'The 3D generator is busy right now. Try again in about 36000s.' }],
	structuredContent: { error: true, message: 'x', failure_code: 'busy', retry_after: 36000, limit: 'generation_daily', reset_at: resetAt },
});
const signIn = () => ({
	isError: true,
	content: [{ type: 'text', text: 'Could not generate the model right now. Please try again.' }],
	structuredContent: { error: true, message: 'x', failure_code: 'sign_in_required' },
});

function harness({ connector = true, forge, collect = async () => pending('job-1'), start = 1_800_000_000_000 } = {}) {
	const calls = { forge: [], collect: [], update: [], send: [], reply: [], dispatch: [], sleep: [] };
	let clock = start;
	let posted = 0;
	const deps = {
		now: () => clock,
		sleep: async (ms) => {
			calls.sleep.push(ms);
			clock += ms;
		},
		dispatch: async (key, base) => calls.dispatch.push({ key, base }),
		collect: async (...a) => {
			calls.collect.push(a);
			clock += 6_000;
			return collect(...a);
		},
		rateLimit: async () => null,
		notify: async () => {},
		userFor: async () => null,
		connector: {
			connectorConfigured: () => connector,
			sendToConversation: async (a) => {
				calls.send.push(a);
				return { id: `1:posted${++posted}` };
			},
			replyToActivity: async (a) => {
				calls.reply.push(a);
				return { id: `1:reply${++posted}` };
			},
			updateActivity: async (a) => {
				calls.update.push(a);
				return {};
			},
		},
		...(forge
			? {
					forge: async (args, ctx, origin) => {
						calls.forge.push({ args, ctx, origin });
						return forge(args, ctx, origin, calls.forge.length);
					},
				}
			: {}),
	};
	return { calls, deps, ctx: { origin: ORIGIN, selfBase: SELF, deps }, advance: (ms) => (clock += ms), now: () => clock };
}

async function seedJob(patch = {}, { now = Date.now(), prompt = 'a weathered brass ship compass' } = {}) {
	const key = forgeKey(CONVERSATION, nextId());
	await claimJob({ key, prompt, tier: 'standard', by: USER, conversation: { id: CONVERSATION, serviceUrl: SERVICE }, origin: ORIGIN }, { now });
	if (Object.keys(patch).length) await patchJob(key, patch);
	return key;
}

const updatedCard = (calls) => calls.update.at(-1).activity.attachments[0].content;
const cardText = (card) => JSON.stringify(card);

afterEach(() => vi.unstubAllGlobals());

describe('end state: success', () => {
	it('posts a finished card with the preview image, Open in 3D, Download GLB and the model page', async () => {
		const h = harness({ forge: async () => pending('job-ok'), collect: async () => done('job-ok') });
		const key = await seedJob({ activityId: '1:posted' }, { now: h.now() });
		const final = await runTeamsForge(key, h.deps);
		expect(final).toMatchObject({ state: 'done', broadcast: true });
		const card = updatedCard(h.calls);
		expectValidCard(card);
		expect(card.body.find((b) => b.type === 'Image')).toMatchObject({ url: POSTER, altText: expect.stringContaining('brass ship compass') });
		expect(card.actions.map((a) => a.title)).toEqual(['Open in 3D', 'Download GLB', 'Make a variation', 'Model page', 'Report']);
		expect(card.refresh).toBeUndefined();
	});
});

describe('end state: throttled', () => {
	it('waits the stated time once and retries on its own, showing when it will retry, then finishes with the model', async () => {
		const h = harness({
			forge: async (_a, _c, _o, n) => (n === 1 ? busy(45) : pending('job-after-wait')),
			collect: async () => done('job-after-wait'),
		});
		const key = await seedJob({ activityId: '1:posted' }, { now: h.now() });
		const seen = [];
		const origPatch = h.deps.sleep;
		h.deps.sleep = async (ms) => {
			const rec = await loadJob(key);
			if (rec.state === 'waiting') seen.push(forgeProgressCard(rec, { now: h.now() }));
			return origPatch(ms);
		};
		const final = await runTeamsForge(key, h.deps);
		expect(h.calls.forge).toHaveLength(2);
		expect(h.calls.sleep[0]).toBe(45_000);
		expect(final.state).toBe('done');
		expect(seen).toHaveLength(1);
		expectValidCard(seen[0]);
		const retryAt = new Date(1_800_000_000_000 + 45_000).toISOString().replace(/\.\d{3}Z$/, 'Z');
		expect(cardText(seen[0])).toContain('busy');
		expect(cardText(seen[0])).toContain(`{{TIME(${retryAt})}}`);
	});

	it('when it stays busy, settles with a card that names the time to try again, never a stale relative wait', async () => {
		const h = harness({ forge: async () => busy(45) });
		const key = await seedJob({ activityId: '1:posted' }, { now: h.now() });
		const final = await runTeamsForge(key, h.deps);
		expect(final).toMatchObject({ state: 'failed', failure: 'throttled' });
		expect(h.calls.forge.length).toBeGreaterThan(1);
		const card = updatedCard(h.calls);
		expectValidCard(card);
		const text = cardText(card);
		expect(text).toContain('The 3D generator is busy');
		expect(text).toMatch(/Try again after \{\{TIME\(\d{4}-\d{2}-\d{2}T[\d:]+Z\)\}\}/);
		expect(text).not.toContain('in about 45s');
		expect(card.actions.find((a) => a.verb === 'forge.retry')).toBeTruthy();
	});

	it('does not sit out a wait longer than it can afford: it settles at once with the time', async () => {
		const h = harness({ forge: async () => busy(THROTTLE_RETRY_MAX_S + 60) });
		const key = await seedJob({ activityId: '1:posted' }, { now: h.now() });
		const final = await runTeamsForge(key, h.deps);
		expect(h.calls.forge).toHaveLength(1);
		expect(h.calls.sleep).toHaveLength(0);
		expect(final).toMatchObject({ state: 'failed', failure: 'throttled' });
	});
});

describe('end state: limit reached', () => {
	it('says the daily limit is reached and when it resets, without a Try again that cannot work', async () => {
		const resetAt = '2027-01-15T00:00:00.000Z';
		const h = harness({ forge: async () => dailyLimit(resetAt) });
		const key = await seedJob({ activityId: '1:posted' }, { now: h.now() });
		const final = await runTeamsForge(key, h.deps);
		expect(h.calls.forge).toHaveLength(1);
		expect(final).toMatchObject({ state: 'failed', failure: 'limit' });
		const card = updatedCard(h.calls);
		expectValidCard(card);
		const text = cardText(card);
		expect(text).toContain('daily limit');
		expect(text).toContain('{{DATE(2027-01-15T00:00:00Z');
		expect(card.actions?.find((a) => a.verb === 'forge.retry')).toBeUndefined();
	});
});

describe('end state: sign-in or account linking needed', () => {
	it('says three.ws could not confirm the request, and how linking works, instead of a generic failure', async () => {
		const h = harness({ forge: async () => signIn() });
		const key = await seedJob({ activityId: '1:posted' }, { now: h.now() });
		const final = await runTeamsForge(key, h.deps);
		expect(final).toMatchObject({ state: 'failed', failure: 'sign_in' });
		const card = updatedCard(h.calls);
		expectValidCard(card);
		const text = cardText(card);
		expect(text).toContain('could not confirm');
		expect(text).toContain('link');
		expect(text).not.toContain('Could not generate the model right now');
		expect(card.actions.find((a) => a.type === 'Action.OpenUrl')?.url).toBe(`${ORIGIN}/dashboard/settings`);
	});
});

describe('end state: generation failed', () => {
	it('says what failed, with Try again', async () => {
		const h = harness({
			forge: async () => pending('job-bad'),
			collect: async () => ({
				isError: true,
				content: [{ type: 'text', text: 'Generation failed: the mesh came back empty. Start a new generation.' }],
				structuredContent: { status: 'failed', job_id: 'job-bad', reason: 'generation_failed', remedy: 'Start a new generation.' },
			}),
		});
		const key = await seedJob({ activityId: '1:posted' }, { now: h.now() });
		const final = await runTeamsForge(key, h.deps);
		expect(final).toMatchObject({ state: 'failed', failure: 'failed', error: 'Generation failed: the mesh came back empty.' });
		const card = updatedCard(h.calls);
		expectValidCard(card);
		expect(cardText(card)).toContain('Generation failed: the mesh came back empty.');
		expect(card.actions[0]).toMatchObject({ title: 'Try again', verb: 'forge.retry', data: { key } });
	});
});

describe('end state: timed out', () => {
	it('a job still not finished past the maximum age settles as timed out and the card says so', async () => {
		const h = harness({ collect: async () => pending('job-slow') });
		const key = await seedJob({ state: 'running', jobId: 'job-slow', activityId: '1:posted' }, { now: h.now() });
		h.advance(JOB_MAX_AGE_MS + 1_000);
		const record = await refreshStatus(key, h.deps);
		expect(record).toMatchObject({ state: 'failed', failure: 'timeout' });
		expect(h.calls.collect).toHaveLength(1);
		const card = updatedCard(h.calls);
		expectValidCard(card);
		expect(cardText(card)).toContain('did not finish');
		expect(card.actions.find((a) => a.verb === 'forge.retry')).toBeTruthy();
	});

	it('a model that finished just before the cutoff is still delivered, never declared dead', async () => {
		const h = harness({ collect: async () => done('job-late') });
		const key = await seedJob({ state: 'running', jobId: 'job-late', activityId: '1:posted' }, { now: h.now() });
		h.advance(JOB_MAX_AGE_MS + 1_000);
		expect(await refreshStatus(key, h.deps)).toMatchObject({ state: 'done' });
	});
});

describe('no orphaned cards: the sweep', () => {
	it('finishes a job whose run died, and replaces the posted card for the whole chat', async () => {
		const h = harness({ collect: async () => done('job-orphan') });
		const key = await seedJob({ state: 'running', jobId: 'job-orphan', activityId: '1:posted' }, { now: h.now() });
		expect(await activeKeys()).toContain(key);
		h.advance(3 * 60_000);
		const report = await sweepTeamsForge(h.deps);
		expect(report.settled).toBeGreaterThanOrEqual(1);
		expect((await loadJob(key)).state).toBe('done');
		expect(h.calls.update.some((u) => u.activityId === '1:posted')).toBe(true);
		expectValidCard(updatedCard(h.calls));
		expect(await activeKeys()).not.toContain(key);
	});

	it('fails a job that never reached the generator and says so on the card', async () => {
		const h = harness();
		const key = await seedJob({ activityId: '1:posted-stale' }, { now: h.now() });
		h.advance(10 * 60_000);
		await sweepTeamsForge(h.deps);
		expect(await loadJob(key)).toMatchObject({ state: 'failed', failure: 'failed' });
		const update = h.calls.update.find((u) => u.activityId === '1:posted-stale');
		expectValidCard(update.activity.attachments[0].content);
	});

	it('leaves a job alone while its run is alive', async () => {
		let release;
		const gate = new Promise((r) => (release = r));
		const h = harness({ forge: async () => (await gate, pending('job-live')), collect: async () => done('job-live') });
		const key = await seedJob({ activityId: '1:posted-live' }, { now: h.now() });
		const running = runTeamsForge(key, h.deps);
		await new Promise((r) => setTimeout(r, 0));
		h.advance(3 * 60_000);
		const before = h.calls.collect.length;
		await sweepTeamsForge(h.deps);
		expect(h.calls.collect.length).toBe(before);
		release();
		expect((await running).state).toBe('done');
	});

	it('runs as an authenticated cron and refuses a caller without the secret', async () => {
		process.env.CRON_SECRET = 'sweep-test-secret';
		const { default: handler } = await import('../api/cron/teams-forge-sweep.js');
		const call = async (headers) => {
			const res = fakeRes();
			await handler({ method: 'GET', headers, url: '/api/cron/teams-forge-sweep' }, res);
			return res;
		};
		expect((await call({})).statusCode).toBe(401);
		const ok = await call({ authorization: 'Bearer sweep-test-secret' });
		expect(ok.statusCode).toBe(200);
		expect(JSON.parse(ok.body)).toMatchObject({ ok: true });
	});
});

describe('duplicate activities share one generation', () => {
	it('two identical submits arriving together create one job and dispatch it once', async () => {
		const h = harness({ connector: false });
		const activity = {
			type: 'invoke',
			name: 'composeExtension/submitAction',
			id: nextId(),
			serviceUrl: SERVICE,
			from: USER,
			conversation: { id: CONVERSATION },
			channelId: 'msteams',
			value: { commandId: 'createModel', commandContext: 'compose', data: { prompt: 'a pewter goblet', tier: 'standard' } },
		};
		const [a, b] = await Promise.all([handleActivity(activity, h.ctx), handleActivity(structuredClone(activity), h.ctx)]);
		expect(h.calls.dispatch).toHaveLength(1);
		const key = forgeKey(CONVERSATION, activity.id);
		expect(a.composeExtension.attachments[0].content.refresh.action.data.key).toBe(key);
		expect(b.composeExtension.attachments[0].content.refresh.action.data.key).toBe(key);
	});

	it('two identical forge messages in a personal chat start one job and post one reply stream', async () => {
		const h = harness({ connector: true });
		const message = {
			type: 'message',
			id: nextId(),
			text: 'forge a pewter goblet',
			from: USER,
			serviceUrl: SERVICE,
			conversation: { id: 'a:personal-dup', conversationType: 'personal' },
			channelId: 'msteams',
		};
		await Promise.all([handleActivity(message, h.ctx), handleActivity(structuredClone(message), h.ctx)]);
		expect(h.calls.dispatch).toHaveLength(1);
		const texts = [...h.calls.reply, ...h.calls.send].map((c) => JSON.stringify(c.activity));
		expect(texts.filter((t) => t.includes('already on its way'))).toHaveLength(0);
		expect(texts.filter((t) => t.includes('Starting the 3D generator'))).toHaveLength(1);
	});

	it('two runs of the same job never submit twice', async () => {
		const h = harness({ forge: async () => pending('job-once'), collect: async () => done('job-once') });
		const key = await seedJob({}, { now: h.now() });
		await Promise.all([runTeamsForge(key, h.deps), runTeamsForge(key, h.deps)]);
		expect(h.calls.forge).toHaveLength(1);
	});
});

describe('the messaging endpoint refuses what Microsoft did not sign', () => {
	const activity = { type: 'message', id: 'f:unsigned', text: 'forge a fox', serviceUrl: SERVICE, from: USER, conversation: { id: 'a:unsigned' }, channelId: 'msteams' };
	const post = async (headers) => {
		process.env.MS_TEAMS_BOT_APP_ID = '5d1c2b3a-0000-4000-8000-00000000b071';
		const { default: handler } = await import('../api/microsoft-teams/messages.js');
		const { Readable } = await import('node:stream');
		const req = Object.assign(Readable.from([Buffer.from(JSON.stringify(activity))]), {
			method: 'POST',
			url: '/api/microsoft-teams/messages',
			headers: { 'content-type': 'application/json', host: 'three.ws', 'x-forwarded-for': '203.0.113.9', ...headers },
		});
		const res = fakeRes();
		await handler(req, res);
		return res;
	};
	it('answers 401 with no token and starts nothing', async () => {
		const res = await post({});
		expect(res.statusCode).toBe(401);
		expect(JSON.parse(res.body).error).toBe('missing_token');
		expect(await loadJob(forgeKey('a:unsigned', 'f:unsigned'))).toBeNull();
	});
	it('answers 401 to a token that is not a valid signed JWT', async () => {
		const res = await post({ authorization: 'Bearer not.a.jwt' });
		expect(res.statusCode).toBe(401);
		expect(JSON.parse(res.body).error).toBe('invalid_token');
		expect(await loadJob(forgeKey('a:unsigned', 'f:unsigned'))).toBeNull();
	});
});

describe('cards stay inside Teams limits and render prompts as text', () => {
	const hostile = `- [click](https://evil.example) **bold** <b>x</b> {{DATE(2017-02-14T06:08:39Z, LONG)}} \`code\`\n1. item ${'w'.repeat(PROMPT_MAX)}`.slice(0, PROMPT_MAX);
	const base = { key: 'teams-' + 'a'.repeat(40), prompt: hostile, tier: 'standard', by: { id: USER.id, name: '**Mallory** [x](https://evil.example)' }, createdAt: 1, origin: ORIGIN };

	it('every card for a maximum-length hostile prompt validates, fits, and keeps markup inert', () => {
		const cards = [
			forgeProgressCard({ ...base, state: 'running', jobId: 'j', status: { phase: 'running', elapsed: 10, eta: 20 } }, { now: 2 }),
			forgeFinishedCard({ ...base, state: 'done', result: { glbUrl: GLB, viewerUrl: `${ORIGIN}/m/1`, posterUrl: POSTER }, settledAt: 5000 }, { origin: ORIGIN }),
			forgeErrorCard({ ...base, state: 'failed', failure: 'failed', error: 'x'.repeat(5000) }),
			forgeErrorCard({ ...base, state: 'failed', failure: 'throttled', retryAt: 1_800_000_045_000 }),
			forgeErrorCard({ ...base, state: 'failed', failure: 'limit', retryAt: 1_800_000_045_000 }),
			forgeErrorCard({ ...base, state: 'failed', failure: 'sign_in' }),
			forgeErrorCard({ ...base, state: 'failed', failure: 'timeout' }),
		];
		for (const card of cards) {
			expectValidCard(card);
			const text = cardText(card);
			expect(text).not.toContain('{{DATE(2017');
			expect(text).not.toContain('](https://evil.example)');
		}
		// A long error is cut to something a card can show.
		const longError = cards[2].body.find((b) => String(b.text).startsWith('xxx'));
		expect(longError.text.length).toBeLessThanOrEqual(400);
	});

	it('escapes list and heading markers at the start of a line', () => {
		expect(escapeMarkdown('- one\n1. two\n# three')).toBe('\\- one\n1\\. two\n\\# three');
	});

	it('drops a preview image or link that is not https instead of sending a card Teams rejects', () => {
		const card = forgeFinishedCard(
			{ ...base, state: 'done', result: { glbUrl: GLB, viewerUrl: 'javascript:alert(1)', posterUrl: 'http://insecure.example/p.png' } },
			{ origin: ORIGIN },
		);
		expectValidCard(card);
		expect(card.body.find((b) => b.type === 'Image')).toBeUndefined();
		expect(card.actions.find((a) => a.title === 'Model page')).toBeUndefined();
	});
});

describe('forge_free keeps the reason a submit was refused', () => {
	const respond = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
	const run = async (status, body) => {
		vi.stubGlobal('fetch', async (url) => (String(url).includes('/api/gpt-forge') ? respond(status, body) : respond(503, { error: 'unavailable' })));
		return TOOLS.forge_free.handler({ prompt: 'a pewter goblet', tier: 'standard' }, null, { headers: { host: 'three.ws' } }, { deadline: Date.now() + 5_000 });
	};
	it('a throttled submit carries the code and the wait', async () => {
		const r = await run(429, { error: 'rate_limited', message: 'busy', retry_after: 45 });
		expect(r.isError).toBe(true);
		expect(r.structuredContent).toMatchObject({ failure_code: 'busy', retry_after: 45 });
	});
	it('a daily limit carries the limit and when it resets', async () => {
		const r = await run(429, { error: 'daily_limit_reached', limit: 'generation_daily', message: 'limit', retry_after: 36000, reset_at: '2027-01-15T00:00:00.000Z' });
		expect(r.structuredContent).toMatchObject({ failure_code: 'busy', limit: 'generation_daily', reset_at: '2027-01-15T00:00:00.000Z' });
	});
	it('a refused account carries sign_in_required', async () => {
		const r = await run(401, { error: 'sign_in_required', message: 'Sign in' });
		expect(r.structuredContent).toMatchObject({ failure_code: 'sign_in_required' });
	});
});

function fakeRes() {
	const res = {
		statusCode: 200,
		headers: {},
		body: '',
		headersSent: false,
		writableEnded: false,
		setHeader(k, v) {
			this.headers[String(k).toLowerCase()] = v;
		},
		getHeader(k) {
			return this.headers[String(k).toLowerCase()];
		},
		writeHead(code, h = {}) {
			this.statusCode = code;
			for (const [k, v] of Object.entries(h)) this.setHeader(k, v);
			this.headersSent = true;
			return this;
		},
		write(chunk) {
			this.body += String(chunk);
			return true;
		},
		end(chunk) {
			if (chunk) this.body += String(chunk);
			this.writableEnded = true;
			this.headersSent = true;
			return this;
		},
		flushHeaders() {},
		on() {},
		once() {},
	};
	return res;
}
