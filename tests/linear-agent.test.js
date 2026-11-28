// The three.ws agent in Linear (api/_lib/linear-agent.js) and its OAuth and
// webhook helpers (api/_lib/linear-installs.js).
//
// Payload shapes follow Linear's AgentSessionEventWebhookPayload schema
// (packages/sdk/src/schema.graphql in linear/linear) and
// https://linear.app/developers/agent-interaction. Linear's GraphQL API and the
// generator are the only stand-ins: they are network boundaries, injected
// through the deps seam. The job store is the real cache module (its in-memory
// backend when no Redis is configured).

import { describe, it, expect } from 'vitest';
import { createHmac, randomUUID } from 'node:crypto';
import {
	plainText,
	splitTier,
	issuePrompt,
	refinePrompt,
	parseEvent,
	jobKey,
	isJobKey,
	claimJob,
	loadJob,
	patchJob,
	sessionJob,
	stopSession,
	doneContent,
	failedContent,
	startedContent,
	deliverSettled,
	runLinearForge,
	handleSessionEvent,
	depsWith,
	MAX_RUNS,
	RUN_BUDGET_MS,
	PROMPT_MAX,
} from '../api/_lib/linear-agent.js';
import {
	signInstallState,
	verifyInstallState,
	installNonceMatches,
	linearAuthorizeUrl,
	verifyLinearWebhook,
	linearGraphql,
	exchangeLinearCode,
	refreshLinearToken,
	LINEAR_SCOPES,
} from '../api/_lib/linear-installs.js';

const ORIGIN = 'https://three.ws';
const SELF = 'https://three-ws-api.example.run.app';
const USER_ID = 'a94b15e4-137b-4ae0-984a-f7cb82f196b4';
const ORG = '7c2b8f0e-5d0a-4a7e-9a52-0f2d6c1b9e11';
const GLB = 'https://three.ws/cdn/forge/anon/fb4e585f-e77a-461f-a9f0-522fe4e0289e.glb';
const VIEWER = 'https://three.ws/viewer?src=x';
const POSTER = 'https://three.ws/api/render/glb?glbUrl=x&width=640&height=640';
const AR = 'https://three.ws/api/ar?src=x';
const ENV = { LINEAR_CLIENT_ID: 'cid', LINEAR_CLIENT_SECRET: 'csecret', LINEAR_WEBHOOK_SECRET: 'whsec' };

const done = (over = {}) => ({ structuredContent: { glbUrl: GLB, viewerUrl: VIEWER, poster_png_url: POSTER, arUrl: AR, job_id: 'job-1', ...over } });
const pending = (phase = 'running') => ({ structuredContent: { status: 'pending', jobId: 'job-1', phase, elapsed_seconds: 30 } });

function issue(over = {}) {
	return { id: randomUUID(), identifier: 'ART-42', title: 'Brass desk lamp prop', description: 'A brass desk lamp with a green glass shade.\n\nAcceptance: GLB under 5 MB.', url: 'https://linear.app/acme/issue/ART-42', teamId: 't', team: { id: 't', key: 'ART', name: 'Art' }, ...over };
}

function createdEvent({ comment = '@three.ws a low-poly lighthouse with a red roof', sessionId = randomUUID(), iss = issue() } = {}) {
	return {
		type: 'AgentSessionEvent',
		action: 'created',
		organizationId: ORG,
		appUserId: 'app-user',
		oauthClientId: 'cid',
		createdAt: new Date().toISOString(),
		webhookId: randomUUID(),
		webhookTimestamp: Date.now(),
		promptContext: '<issue identifier="ART-42">...</issue>',
		agentSession: {
			id: sessionId,
			appUserId: 'app-user',
			organizationId: ORG,
			status: 'pending',
			type: 'commentThread',
			createdAt: new Date().toISOString(),
			updatedAt: new Date().toISOString(),
			issue: iss,
			issueId: iss.id,
			comment: comment == null ? null : { id: randomUUID(), body: comment, issueId: iss.id, userId: 'u1' },
		},
	};
}

function promptedEvent(sessionId, body, { signal = null } = {}) {
	return {
		type: 'AgentSessionEvent',
		action: 'prompted',
		organizationId: ORG,
		appUserId: 'app-user',
		webhookTimestamp: Date.now(),
		agentSession: { id: sessionId, organizationId: ORG, appUserId: 'app-user', status: 'active', issue: issue() },
		agentActivity: { id: randomUUID(), agentSessionId: sessionId, content: { type: 'prompt', body }, signal, userId: 'u1', user: { id: 'u1' } },
	};
}

function recorder() {
	const calls = [];
	const linear = async (organizationId, query, variables) => {
		calls.push({ organizationId, op: /mutation (\w+)/.exec(query)?.[1], variables });
		return { ok: { success: true } };
	};
	return { calls, linear, activities: () => calls.filter((c) => c.op === 'ThreeWsActivity').map((c) => c.variables.input) };
}

async function newJob(over = {}) {
	const sessionId = over.sessionId || randomUUID();
	const key = jobKey({ sessionId, action: 'created' });
	const { record } = await claimJob({
		key,
		sessionId,
		organizationId: ORG,
		userId: USER_ID,
		issue: issue(),
		prompt: 'a low-poly lighthouse',
		tier: 'standard',
		source: 'comment',
		origin: ORIGIN,
		selfBase: SELF,
		...over,
	});
	return record;
}

describe('reading what was asked', () => {
	it('strips the mention, profile links, markdown and emphasis', () => {
		expect(plainText('@three.ws a **brass** desk lamp')).toBe('a brass desk lamp');
		expect(plainText('[three.ws](https://linear.app/acme/profiles/threews) a [red](https://x.y) chair')).toBe('a red chair');
		expect(plainText('https://linear.app/acme/profiles/threews  a chair\n```js\ncode\n```')).toBe('a chair');
		expect(plainText('![img](https://x/y.png) a vase')).toBe('a vase');
	});

	it('pulls out a tier flag anywhere in the text', () => {
		expect(splitTier('a red chair --high')).toEqual({ prompt: 'a red chair', tier: 'high' });
		expect(splitTier('--draft a red chair')).toEqual({ prompt: 'a red chair', tier: 'draft' });
		expect(splitTier('a red chair')).toEqual({ prompt: 'a red chair', tier: 'standard' });
	});

	it('reads an issue as its title plus the first paragraph of its description', () => {
		expect(issuePrompt(issue())).toBe('Brass desk lamp prop. A brass desk lamp with a green glass shade.');
		expect(issuePrompt(issue({ description: null }))).toBe('Brass desk lamp prop');
		expect(issuePrompt(issue({ description: 'x'.repeat(2000) })).length).toBeLessThan(450);
	});

	it('applies a short reply or a change to the last model and lets a new description replace it', () => {
		expect(refinePrompt('a lighthouse', 'make it red')).toBe('a lighthouse, red');
		expect(refinePrompt('a lighthouse', 'with a taller tower')).toBe('a lighthouse, with a taller tower');
		expect(refinePrompt('a lighthouse', 'blue')).toBe('a lighthouse, blue');
		expect(refinePrompt('a lighthouse', 'a wooden rowing boat on a trailer')).toBe('a wooden rowing boat on a trailer');
		expect(refinePrompt(null, 'make it red')).toBe('make it red');
	});

	it('takes the prompt from the mention comment', () => {
		expect(parseEvent(createdEvent({ comment: '@three.ws a red chair --draft' }))).toEqual({ kind: 'forge', prompt: 'a red chair', tier: 'draft', source: 'comment' });
	});

	it('models the issue when delegated (no comment) or mentioned with nothing else', () => {
		for (const comment of [null, '@three.ws']) {
			const ask = parseEvent(createdEvent({ comment }));
			expect(ask.kind).toBe('forge');
			expect(ask.source).toBe('issue');
			expect(ask.prompt).toMatch(/^Brass desk lamp prop\./);
		}
	});

	it('recognises help, stop and too little', () => {
		expect(parseEvent(createdEvent({ comment: '@three.ws help' })).kind).toBe('help');
		expect(parseEvent(promptedEvent('s', 'stop', { signal: 'stop' })).kind).toBe('stop');
		expect(parseEvent(promptedEvent('s', 'ok')).kind).toBe('too_short');
		expect(parseEvent(createdEvent({ comment: null, iss: issue({ title: 'x', description: '' }) })).kind).toBe('too_short');
	});

	it('reads a reply against the previous prompt and caps length', () => {
		expect(parseEvent(promptedEvent('s', 'make it blue --high'), { previousPrompt: 'a lighthouse' })).toEqual({ kind: 'forge', prompt: 'a lighthouse, blue', tier: 'high', source: 'reply' });
		expect(parseEvent(createdEvent({ comment: `@three.ws ${'a'.repeat(5000)}` })).prompt.length).toBe(PROMPT_MAX);
	});

	it('keys a job per delivery, so a redelivered webhook maps to the same job', () => {
		const a = jobKey({ sessionId: 's1', action: 'created' });
		expect(isJobKey(a)).toBe(true);
		expect(jobKey({ sessionId: 's1', action: 'created' })).toBe(a);
		expect(jobKey({ sessionId: 's1', action: 'prompted', activityId: 'x' })).not.toBe(a);
	});
});

describe('what the agent says', () => {
	it('posts the model with a picture and every link, escaping the prompt', () => {
		const body = doneContent({ prompt: 'a *bold* lamp', result: { glbUrl: GLB, viewerUrl: VIEWER, posterUrl: POSTER, arUrl: AR } }).body;
		expect(body).toContain('a \\*bold\\* lamp');
		expect(body).toContain(`[![a \\*bold\\* lamp](${POSTER})](${VIEWER})`);
		expect(body).toContain(`[Open in 3D](${VIEWER}) · [View in AR](${AR}) · [Download GLB](${GLB})`);
	});

	it('says where the prompt came from and how long it takes', () => {
		expect(startedContent({ prompt: 'a lamp', tier: 'high', source: 'issue' }).body).toBe('Making a 3D model from this issue on high detail, which takes a little longer: **a lamp**. It usually takes about two minutes.');
		expect(startedContent({ prompt: 'a lamp', tier: 'standard', source: 'comment' }).type).toBe('thought');
	});

	it('reports a failure as an error activity with a way forward', () => {
		const c = failedContent({ error: 'The generator refused this prompt.' });
		expect(c.type).toBe('error');
		expect(c.body).toMatch(/refused this prompt[\s\S]*Reply to try again/);
	});
});

describe('the webhook part', () => {
	const base = { origin: ORIGIN, selfBase: SELF };
	const installed = async () => ({ organizationId: ORG, appUserId: 'app-user', installedBy: USER_ID, token: 't' });
	const allow = async () => ({ success: true });

	it('starts a model: claims the job, posts the thought, dispatches the run, counts the session', async () => {
		const rec = recorder();
		const dispatched = [];
		const counted = [];
		const ev = createdEvent();
		const out = await handleSessionEvent(ev, base, { linear: rec.linear, installed, rateLimit: allow, record: async (o) => counted.push(o), dispatch: async (k, b) => dispatched.push([k, b]) });
		expect(out).toBe('started');
		expect(rec.activities()).toHaveLength(1);
		expect(rec.activities()[0]).toMatchObject({ agentSessionId: ev.agentSession.id, content: { type: 'thought' } });
		expect(dispatched).toEqual([[jobKey({ sessionId: ev.agentSession.id, action: 'created' }), SELF]]);
		expect(counted).toEqual([ORG]);
		const job = await loadJob(dispatched[0][0]);
		expect(job).toMatchObject({ prompt: 'a low-poly lighthouse with a red roof', userId: USER_ID, issueIdentifier: 'ART-42', state: 'starting' });
	});

	it('does nothing twice for a redelivered webhook', async () => {
		const rec = recorder();
		const dispatched = [];
		const ev = createdEvent();
		const deps = { linear: rec.linear, installed, rateLimit: allow, record: async () => {}, dispatch: async (k) => dispatched.push(k) };
		await handleSessionEvent(ev, base, deps);
		expect(await handleSessionEvent(ev, base, deps)).toBe('duplicate');
		expect(dispatched).toHaveLength(1);
	});

	it('answers help and too-little directly, and refuses over the workspace limit', async () => {
		const rec = recorder();
		const dispatch = async () => {
			throw new Error('must not dispatch');
		};
		expect(await handleSessionEvent(createdEvent({ comment: '@three.ws help' }), base, { linear: rec.linear, installed, dispatch })).toBe('help');
		expect(await handleSessionEvent(promptedEvent(randomUUID(), 'hi'), base, { linear: rec.linear, installed, dispatch })).toBe('too_short');
		expect(await handleSessionEvent(createdEvent(), base, { linear: rec.linear, installed, dispatch, rateLimit: async () => ({ success: false }) })).toBe('rate_limited');
		expect(rec.activities().map((a) => a.content.type)).toEqual(['response', 'elicitation', 'error']);
	});

	it('ignores a workspace with no live install', async () => {
		expect(await handleSessionEvent(createdEvent(), base, { installed: async () => null })).toBe('ignored:not_installed');
	});

	it('stops the running job on a stop signal and never posts it', async () => {
		const rec = recorder();
		const job = await newJob();
		expect((await sessionJob(job.sessionId)).key).toBe(job.key);
		expect(await handleSessionEvent(promptedEvent(job.sessionId, 'stop', { signal: 'stop' }), base, { linear: rec.linear, installed })).toBe('stopped');
		expect((await loadJob(job.key)).state).toBe('stopped');
		const settledRecord = await patchJob(job.key, { state: 'done', result: { glbUrl: GLB } });
		expect(settledRecord.state).toBe('stopped');
		expect(await deliverSettled(settledRecord, depsWith({ linear: rec.linear }))).toBe(false);
		expect(rec.activities().map((a) => a.content.body)).toEqual([expect.stringMatching(/^Stopped/)]);
	});

	it('refines the session\'s last model from a reply', async () => {
		const rec = recorder();
		const job = await newJob({ prompt: 'a lighthouse' });
		const dispatched = [];
		await handleSessionEvent(promptedEvent(job.sessionId, 'make it red'), base, { linear: rec.linear, installed, rateLimit: allow, record: async () => {}, dispatch: async (k) => dispatched.push(k) });
		expect((await loadJob(dispatched[0])).prompt).toBe('a lighthouse, red');
	});
});

describe('the run', () => {
	it('makes the model and posts it: links on the session, attachment on the issue, then the response', async () => {
		const rec = recorder();
		const job = await newJob();
		const final = await runLinearForge(job.key, { linear: rec.linear, forge: async (args, ctx) => {
			expect(args).toEqual({ prompt: 'a low-poly lighthouse', tier: 'standard', idempotency_key: job.key });
			expect(ctx.caller).toBe(`linear:${ORG}`);
			return done();
		} });
		expect(final.state).toBe('done');
		expect(final.delivered).toBe(true);
		const ops = rec.calls.map((c) => c.op);
		expect(ops).toContain('ThreeWsSession');
		expect(ops).toContain('ThreeWsAttachment');
		const session = rec.calls.find((c) => c.op === 'ThreeWsSession').variables;
		expect(session).toEqual({ id: job.sessionId, input: { addedExternalUrls: [{ label: 'Open in 3D', url: VIEWER }, { label: 'View in AR', url: AR }, { label: 'Download GLB', url: GLB }] } });
		const attachment = rec.calls.find((c) => c.op === 'ThreeWsAttachment').variables.input;
		expect(attachment).toMatchObject({ issueId: job.issueId, url: VIEWER, title: '3D model: a low-poly lighthouse', iconUrl: `${ORIGIN}/brand/three-ws-app-icon-512.png` });
		const types = rec.activities().map((a) => a.content.type);
		expect(types).toEqual(['action', 'action', 'response']);
		expect(rec.activities()[1].content.result).toBe('GLB ready');
		expect(rec.activities().at(-1).content.body).toContain('Your 3D model is ready');
	});

	it('polls a pending job to the end', async () => {
		const rec = recorder();
		const job = await newJob();
		let polls = 0;
		const final = await runLinearForge(job.key, {
			linear: rec.linear,
			sleep: async () => {},
			forge: async () => pending('queued'),
			collect: async () => (++polls < 3 ? pending() : done()),
		});
		expect(polls).toBe(3);
		expect(final.state).toBe('done');
	});

	it('still posts the model when the attachment or session links fail', async () => {
		const calls = [];
		const linear = async (o, query, variables) => {
			const op = /mutation (\w+)/.exec(query)[1];
			calls.push(op);
			if (op !== 'ThreeWsActivity') throw new Error('Linear API: forbidden');
			return {};
		};
		const job = await newJob();
		const final = await runLinearForge(job.key, { linear, forge: async () => done() });
		expect(final.delivered).toBe(true);
		expect(calls.filter((c) => c === 'ThreeWsActivity')).toHaveLength(3);
	});

	it('posts a failure as an error activity', async () => {
		const rec = recorder();
		const job = await newJob();
		const final = await runLinearForge(job.key, { linear: rec.linear, forge: async () => ({ isError: true, content: [{ type: 'text', text: 'The prompt was refused.' }], structuredContent: {} }) });
		expect(final.state).toBe('failed');
		expect(rec.activities().at(-1).content).toMatchObject({ type: 'error', body: expect.stringContaining('The prompt was refused.') });
	});

	it('hands a long generation to a fresh run, then fails honestly after the last one', async () => {
		const rec = recorder();
		const job = await newJob();
		let clock = 0;
		const dispatched = [];
		const deps = {
			linear: rec.linear,
			now: () => clock,
			sleep: async (ms) => {
				clock += ms;
			},
			forge: async () => pending(),
			collect: async () => pending(),
			dispatch: async (k) => dispatched.push(k),
		};
		for (let i = 0; i < MAX_RUNS; i++) await runLinearForge(job.key, deps);
		expect(dispatched).toHaveLength(MAX_RUNS - 1);
		const final = await loadJob(job.key);
		expect(final.state).toBe('failed');
		expect(final.error).toMatch(/took too long/);
		expect(clock).toBeGreaterThanOrEqual(RUN_BUDGET_MS * MAX_RUNS);
		expect(rec.activities().filter((a) => a.ephemeral).length).toBe(MAX_RUNS - 1);
	});

	it('delivers once even when two runs race to the end', async () => {
		const rec = recorder();
		const job = await newJob();
		await patchJob(job.key, { state: 'done', result: { glbUrl: GLB, viewerUrl: VIEWER } });
		const settledRecord = await loadJob(job.key);
		const [a, b] = await Promise.all([deliverSettled(settledRecord, depsWith({ linear: rec.linear })), deliverSettled(settledRecord, depsWith({ linear: rec.linear }))]);
		expect([a, b].filter(Boolean)).toHaveLength(1);
	});

	it('stopSession leaves a finished job alone', async () => {
		const job = await newJob();
		await patchJob(job.key, { state: 'done' });
		expect((await stopSession(job.sessionId)).state).toBe('done');
	});
});

describe('OAuth state and webhook signatures', () => {
	it('signs and verifies an install state and expires it', () => {
		const state = signInstallState({ userId: USER_ID, nonce: 'n'.repeat(24) }, { env: ENV, now: 1_800_000_000_000 });
		expect(verifyInstallState(state, { env: ENV, now: 1_800_000_000_000 + 60_000 })).toEqual({ userId: USER_ID, nonce: 'n'.repeat(24) });
		expect(verifyInstallState(state, { env: ENV, now: 1_800_000_000_000 + 16 * 60_000 })).toBeNull();
		expect(verifyInstallState(state, { env: { ...ENV, LINEAR_CLIENT_SECRET: 'other' }, now: 1_800_000_000_000 })).toBeNull();
		expect(verifyInstallState(state.replace(USER_ID, randomUUID()), { env: ENV, now: 1_800_000_000_000 })).toBeNull();
	});

	it('only honours the browser holding the nonce', () => {
		const v = { userId: USER_ID, nonce: 'abcdefghijklmnopqrst' };
		expect(installNonceMatches(v, 'abcdefghijklmnopqrst')).toBe(true);
		expect(installNonceMatches(v, 'abcdefghijklmnopqrsu')).toBe(false);
		expect(installNonceMatches(v, '')).toBe(false);
	});

	it('asks Linear for an app actor with the agent scopes', () => {
		const url = new URL(linearAuthorizeUrl({ userId: USER_ID, nonce: 'n'.repeat(24) }, ENV));
		expect(url.origin + url.pathname).toBe('https://linear.app/oauth/authorize');
		expect(url.searchParams.get('actor')).toBe('app');
		expect(url.searchParams.get('response_type')).toBe('code');
		expect(url.searchParams.get('scope')).toBe(LINEAR_SCOPES.join(','));
		expect(url.searchParams.get('scope')).toContain('app:mentionable');
		expect(url.searchParams.get('redirect_uri')).toMatch(/\/api\/linear\/oauth$/);
	});

	it('accepts only a correctly signed, fresh webhook', () => {
		const now = Date.now();
		const raw = JSON.stringify({ type: 'AgentSessionEvent', webhookTimestamp: now });
		const sig = createHmac('sha256', 'whsec').update(raw).digest('hex');
		expect(verifyLinearWebhook({ rawBody: Buffer.from(raw), signature: sig, secret: 'whsec', now })).toBe(true);
		expect(verifyLinearWebhook({ rawBody: raw, signature: sig, secret: 'other', now })).toBe(false);
		expect(verifyLinearWebhook({ rawBody: `${raw} `, signature: sig, secret: 'whsec', now })).toBe(false);
		expect(verifyLinearWebhook({ rawBody: raw, signature: sig, secret: 'whsec', now: now + 61_000 })).toBe(false);
		expect(verifyLinearWebhook({ rawBody: raw, signature: undefined, secret: 'whsec', now })).toBe(false);
	});
});

describe('Linear HTTP', () => {
	const respond = (status, body) => async () => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

	it('maps a rejected token, a rate limit and an operation error to codes', async () => {
		await expect(linearGraphql('t', 'query{viewer{id}}', {}, { fetchImpl: respond(401, {}) })).rejects.toMatchObject({ code: 'unauthenticated' });
		await expect(linearGraphql('t', 'q', {}, { fetchImpl: respond(400, { errors: [{ message: 'x', extensions: { code: 'RATELIMITED' } }] }) })).rejects.toMatchObject({ code: 'ratelimited' });
		await expect(linearGraphql('t', 'q', {}, { fetchImpl: respond(200, { errors: [{ message: 'Entity not found' }] }) })).rejects.toMatchObject({ code: 'graphql', message: expect.stringContaining('Entity not found') });
		expect(await linearGraphql('t', 'q', {}, { fetchImpl: respond(200, { data: { viewer: { id: 'v' } } }) })).toEqual({ viewer: { id: 'v' } });
	});

	it('exchanges a code for tokens and the workspace they belong to', async () => {
		const seen = [];
		const fetchImpl = async (url, init) => {
			seen.push({ url, body: String(init.body) });
			if (url.endsWith('/oauth/token')) return new Response(JSON.stringify({ access_token: 'at', refresh_token: 'rt', expires_in: 86399, scope: 'read write app:mentionable app:assignable', token_type: 'Bearer' }), { status: 200 });
			return new Response(JSON.stringify({ data: { viewer: { id: 'app-user' }, organization: { id: ORG, name: 'Acme', urlKey: 'acme' } } }), { status: 200 });
		};
		const out = await exchangeLinearCode('code123', { env: ENV, fetchImpl });
		expect(out).toMatchObject({ accessToken: 'at', refreshToken: 'rt', appUserId: 'app-user', organizationId: ORG, organizationName: 'Acme', organizationKey: 'acme' });
		expect(out.expiresAt.getTime()).toBeGreaterThan(Date.now() + 86_000_000);
		const form = new URLSearchParams(seen[0].body);
		expect(form.get('grant_type')).toBe('authorization_code');
		expect(form.get('code')).toBe('code123');
		expect(seen[1].url).toBe('https://api.linear.app/graphql');
	});

	it('refreshes with the refresh grant and surfaces Linear\'s error code', async () => {
		const ok = await refreshLinearToken('rt', { env: ENV, fetchImpl: respond(200, { access_token: 'at2', refresh_token: 'rt2', expires_in: 86399 }) });
		expect(ok).toMatchObject({ accessToken: 'at2', refreshToken: 'rt2' });
		await expect(refreshLinearToken('rt', { env: ENV, fetchImpl: respond(400, { error: 'invalid_grant' }) })).rejects.toMatchObject({ code: 'invalid_grant' });
	});
});
