// The three.ws Basecamp chatbot's chat logic (api/_lib/basecamp-forge.js).
//
// Payload shapes follow Basecamp's chatbot documentation
// (https://github.com/basecamp/bc3-api/blob/master/sections/chatbots.md):
// a command POST carries { command, creator { id, name, attachable_sgid },
// callback_url }, and a later line is a POST of { content } to callback_url.
// The generator and Basecamp's callback endpoint are the only stand-ins: they
// are network boundaries, injected through the deps seam. The job store is the
// real cache module (its in-memory backend when no Redis is configured).

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
	parseCommand,
	callbackTarget,
	creatorOf,
	jobKey,
	isJobKey,
	claimJob,
	loadJob,
	patchJob,
	doneHtml,
	failedHtml,
	startedHtml,
	duplicateHtml,
	deliverSettled,
	runBasecampForge,
	dispatchRun,
	depsWith,
	DEDUPE_WINDOW_MS,
	MAX_RUNS,
	RUN_BUDGET_MS,
	PROMPT_MAX,
} from '../api/_lib/basecamp-forge.js';

const ORIGIN = 'https://three.ws';
const SELF = 'https://three-ws-api.example.run.app';
const CALLBACK = 'https://3.basecampapi.com/195539477/integrations/2uH9aHLEVhhaXKPaqrj8yw/buckets/2085958496/chats/9007199254741775/lines';
const SGID = 'BAh7CEkiCGdpZAY6BkVUSSIrZ2lkOi8vYmMzL1BlcnNvbi8xMDQ5NzE1OTEzP2V4cGlyZXNfaW4GOwBUSSIMcHVycG9zZQY7AFRJIg9hdHRhY2hhYmxlBjsAVEkiD2V4cGlyZXNfYXQGOwBUMA==--919d2c8b11ff403eefcab9db42dd26846d0c3102';
const USER_ID = 'a94b15e4-137b-4ae0-984a-f7cb82f196b4';
const GLB = 'https://three.ws/cdn/forge/anon/fb4e585f-e77a-461f-a9f0-522fe4e0289e.glb';
const VIEWER = 'https://three.ws/forge/view/fb4e585f';
const POSTER = 'https://three.ws/api/render/glb?glbUrl=x&width=640&height=640';
const AR = 'https://three.ws/ar/fb4e585f';

let n = 0;
async function newJob(over = {}) {
	n += 1;
	const prompt = over.prompt || `a low-poly lighthouse ${n}`;
	const key = jobKey({ connectionId: `conn-${n}`, callbackUrl: CALLBACK, creatorId: '1049715913', prompt, tier: 'standard' }, Date.now() + n);
	const { record } = await claimJob({
		key,
		prompt,
		tier: 'standard',
		connectionId: `conn-${n}`,
		userId: USER_ID,
		by: { id: '1049715913', name: 'Victor Cooper', sgid: SGID },
		callbackUrl: CALLBACK,
		origin: ORIGIN,
		selfBase: SELF,
		...over,
	});
	return record;
}

function basecamp(statuses = [201]) {
	const posts = [];
	let i = 0;
	const fetch = async (url, init) => {
		const status = statuses[Math.min(i++, statuses.length - 1)];
		posts.push({ url, body: JSON.parse(init.body), headers: init.headers });
		if (status === 0) throw new Error('ECONNRESET');
		return new Response('{}', { status });
	};
	return { posts, fetch };
}

function clock(start = Date.UTC(2026, 10, 28, 12)) {
	let t = start;
	return { now: () => t, sleep: async (ms) => { t += ms; } };
}

const done = (over = {}) => ({ structuredContent: { glbUrl: GLB, viewerUrl: VIEWER, poster_png_url: POSTER, arUrl: AR, job_id: 'job-1', ...over } });
const pending = (phase = 'running') => ({ structuredContent: { status: 'pending', jobId: 'job-1', phase, elapsed_seconds: 30 } });

describe('parseCommand', () => {
	it('reads a plain prompt at the standard tier', () => {
		expect(parseCommand('a red velvet armchair')).toEqual({ kind: 'forge', prompt: 'a red velvet armchair', tier: 'standard' });
	});

	it('reads --draft and --high anywhere in the text and drops them from the prompt', () => {
		expect(parseCommand('--draft a red chair')).toEqual({ kind: 'forge', prompt: 'a red chair', tier: 'draft' });
		expect(parseCommand('a red chair --HIGH')).toEqual({ kind: 'forge', prompt: 'a red chair', tier: 'high' });
	});

	it('does not treat a flag glued to a word as a tier', () => {
		expect(parseCommand('a sign that says no--draft')).toMatchObject({ tier: 'standard', prompt: 'a sign that says no--draft' });
	});

	it('answers help for empty, help, ? and usage', () => {
		for (const raw of ['', '   ', 'help', 'HELP', '?', 'usage', 'commands', null, undefined]) expect(parseCommand(raw)).toEqual({ kind: 'help' });
	});

	it('strips Ping markup and a leading !name, and decodes entities', () => {
		expect(parseCommand('<div>!threews a <strong>brass</strong> lamp &amp; shade</div>')).toEqual({ kind: 'forge', prompt: 'a brass lamp & shade', tier: 'standard' });
		expect(parseCommand('!threews help')).toEqual({ kind: 'help' });
	});

	it('refuses a prompt shorter than three characters', () => {
		expect(parseCommand('hi')).toEqual({ kind: 'too_short' });
		expect(parseCommand('--high ok')).toEqual({ kind: 'too_short' });
	});

	it('caps a very long prompt', () => {
		expect(parseCommand('x'.repeat(PROMPT_MAX + 500)).prompt).toHaveLength(PROMPT_MAX);
	});
});

describe('callbackTarget', () => {
	it('accepts a Basecamp line URL and reads the account id from it', () => {
		expect(callbackTarget(CALLBACK)).toEqual({ url: CALLBACK, account: '195539477' });
		expect(callbackTarget(`${CALLBACK}.json`)?.account).toBe('195539477');
	});

	it('refuses every host that is not Basecamp, including look-alikes', () => {
		for (const host of ['evil.com', 'basecampapi.com.evil.com', 'evilbasecampapi.com', '169.254.169.254', 'localhost']) {
			expect(callbackTarget(CALLBACK.replace('3.basecampapi.com', host))).toBeNull();
		}
	});

	it('refuses http, credentials, ports and other paths', () => {
		expect(callbackTarget(CALLBACK.replace('https:', 'http:'))).toBeNull();
		expect(callbackTarget(CALLBACK.replace('https://', 'https://u:p@'))).toBeNull();
		expect(callbackTarget(CALLBACK.replace('basecampapi.com', 'basecampapi.com:8443'))).toBeNull();
		expect(callbackTarget('https://3.basecampapi.com/195539477/people.json')).toBeNull();
		expect(callbackTarget('not a url')).toBeNull();
		expect(callbackTarget(42)).toBeNull();
		expect(callbackTarget(`${CALLBACK}?${'a'.repeat(2100)}`)).toBeNull();
	});
});

describe('creatorOf', () => {
	it('keeps a well-formed sgid, the numeric id and the name', () => {
		expect(creatorOf({ id: 1049715913, name: '  Victor   Cooper ', attachable_sgid: SGID })).toEqual({ id: '1049715913', name: 'Victor Cooper', sgid: SGID });
	});

	it('drops an sgid that could break out of the attachment tag', () => {
		expect(creatorOf({ id: 1, name: 'x', attachable_sgid: '"><script>alert(1)</script>--abcdef0123456789abcd' }).sgid).toBeNull();
		expect(creatorOf({ id: 'x1', name: 'x' }).id).toBeNull();
		expect(creatorOf(null)).toBeNull();
	});
});

describe('jobKey', () => {
	const base = { connectionId: 'c', callbackUrl: CALLBACK, creatorId: '1', prompt: 'a chair', tier: 'standard' };
	const t = Date.UTC(2026, 10, 28, 12, 0, 0);

	it('is a valid job key and stable inside the dedupe window', () => {
		const k = jobKey(base, t);
		expect(isJobKey(k)).toBe(true);
		expect(jobKey(base, t + DEDUPE_WINDOW_MS - 1)).toBe(k);
	});

	it('changes with the window, the person, the room, the tier and the prompt', () => {
		const k = jobKey(base, t);
		expect(jobKey(base, t + DEDUPE_WINDOW_MS)).not.toBe(k);
		expect(jobKey({ ...base, creatorId: '2' }, t)).not.toBe(k);
		expect(jobKey({ ...base, callbackUrl: `${CALLBACK}.json` }, t)).not.toBe(k);
		expect(jobKey({ ...base, tier: 'high' }, t)).not.toBe(k);
		expect(jobKey({ ...base, prompt: 'a table' }, t)).not.toBe(k);
	});
});

describe('the lines posted in the room', () => {
	const record = { prompt: 'a <b>bold</b> "lamp"', tier: 'standard', by: { sgid: SGID }, state: 'done', result: { glbUrl: GLB, viewerUrl: VIEWER, posterUrl: POSTER, arUrl: AR } };

	it('escapes the prompt everywhere it appears', () => {
		for (const html of [doneHtml(record), failedHtml({ ...record, state: 'failed' }), startedHtml(record), duplicateHtml({ ...record, state: 'running' })]) {
			expect(html).not.toContain('<b>bold</b>');
			expect(html).toContain('&lt;b&gt;bold&lt;/b&gt;');
		}
	});

	it('mentions the requester, shows the poster and links the viewer, AR and GLB', () => {
		const html = doneHtml(record);
		expect(html.startsWith(`<bc-attachment sgid="${SGID}"></bc-attachment> `)).toBe(true);
		expect(html).toContain(`<img src="${POSTER.replace(/&/g, '&amp;')}"`);
		expect(html).toContain('>Open in 3D</a>');
		expect(html).toContain('>View in AR on your phone</a>');
		expect(html).toContain(`<a href="${GLB}">Download GLB</a>`);
		expect(doneHtml(record, { mention: false })).not.toContain('bc-attachment');
	});

	it('leaves out a poster that is not https', () => {
		expect(doneHtml({ ...record, result: { ...record.result, posterUrl: 'javascript:alert(1)' } })).not.toContain('<img');
	});

	it('repeats a finished result without the mention when the command is repeated', () => {
		expect(duplicateHtml(record)).toBe(doneHtml(record, { mention: false }));
	});
});

describe('claimJob', () => {
	it('creates a record once and returns it untouched on a repeat', async () => {
		const record = await newJob();
		expect(record.state).toBe('starting');
		const again = await claimJob({ ...record, prompt: 'something else' });
		expect(again.created).toBe(false);
		expect(again.record.prompt).toBe(record.prompt);
	});

	it('never moves a settled record back to running', async () => {
		const record = await newJob();
		await patchJob(record.key, { state: 'done', result: { glbUrl: GLB } });
		await patchJob(record.key, { state: 'running' });
		expect((await loadJob(record.key)).state).toBe('done');
	});
});

describe('deliverSettled', () => {
	it('posts the finished line once to the callback URL', async () => {
		const record = await newJob();
		const settledRecord = await patchJob(record.key, { state: 'done', result: { glbUrl: GLB, viewerUrl: VIEWER }, settledAt: 1 });
		const bc = basecamp([201]);
		const deps = depsWith({ fetch: bc.fetch, ...clock() });
		expect(await deliverSettled(settledRecord, deps)).toBe(201);
		expect(await deliverSettled(settledRecord, deps)).toBeNull();
		expect(bc.posts).toHaveLength(1);
		expect(bc.posts[0].url).toBe(CALLBACK);
		expect(bc.posts[0].body.content).toContain('Your 3D model is ready');
		expect((await loadJob(record.key)).delivered).toBe(true);
	});

	it('retries without the mention when Basecamp rejects the line', async () => {
		const record = await newJob();
		const settledRecord = await patchJob(record.key, { state: 'done', result: { glbUrl: GLB }, settledAt: 1 });
		const bc = basecamp([422, 201]);
		expect(await deliverSettled(settledRecord, depsWith({ fetch: bc.fetch, ...clock() }))).toBe(201);
		expect(bc.posts[0].body.content).toContain('bc-attachment');
		expect(bc.posts[1].body.content).not.toContain('bc-attachment');
	});

	it('backs off on 5xx and network errors, then records the failure', async () => {
		const record = await newJob();
		const settledRecord = await patchJob(record.key, { state: 'failed', error: 'no', settledAt: 1 });
		const bc = basecamp([503, 0, 503]);
		const c = clock();
		const t0 = c.now();
		expect(await deliverSettled(settledRecord, depsWith({ fetch: bc.fetch, ...c }))).toBe(503);
		expect(bc.posts).toHaveLength(3);
		expect(c.now() - t0).toBe(1000 + 2000 + 4000);
		const stored = await loadJob(record.key);
		expect(stored.delivered).toBe(false);
		expect(stored.deliveryStatus).toBe(503);
	});

	it('posts nothing for a job that has not settled', async () => {
		const record = await newJob();
		const bc = basecamp();
		expect(await deliverSettled(record, depsWith({ fetch: bc.fetch }))).toBeNull();
		expect(bc.posts).toHaveLength(0);
	});
});

describe('runBasecampForge', () => {
	let savedSecret;
	beforeEach(() => {
		savedSecret = process.env.CRON_SECRET;
		process.env.CRON_SECRET = 'test-platform-secret';
	});
	afterEach(() => {
		if (savedSecret === undefined) delete process.env.CRON_SECRET;
		else process.env.CRON_SECRET = savedSecret;
	});

	it('makes the model on the owner account and posts it in the room', async () => {
		const record = await newJob();
		const bc = basecamp([201]);
		const calls = [];
		const forge = async (args, ctx, origin) => {
			calls.push({ args, ctx, origin });
			ctx.onProgress({ job_id: 'job-1', phase: 'running' });
			return done();
		};
		const final = await runBasecampForge(record.key, { forge, fetch: bc.fetch, ...clock() });
		expect(final.state).toBe('done');
		expect(final.result).toMatchObject({ glbUrl: GLB, viewerUrl: VIEWER, posterUrl: POSTER, arUrl: AR });
		expect(calls[0].args).toEqual({ prompt: record.prompt, tier: 'standard', idempotency_key: record.key });
		expect(calls[0].origin).toBe(ORIGIN);
		expect(calls[0].ctx.caller).toBe(`basecamp:${record.connectionId}`);
		expect(calls[0].ctx.creatorAuth['x-forge-on-behalf-user']).toBe(USER_ID);
		expect(bc.posts).toHaveLength(1);
		expect(bc.posts[0].body.content).toContain(`<a href="${GLB}">Download GLB</a>`);
	});

	it('polls a pending job until it finishes', async () => {
		const record = await newJob();
		const bc = basecamp([201]);
		const collected = [pending(), pending(), done()];
		const final = await runBasecampForge(record.key, {
			forge: async () => pending('queued'),
			collect: async (origin, jobId) => {
				expect([origin, jobId]).toEqual([ORIGIN, 'job-1']);
				return collected.shift();
			},
			fetch: bc.fetch,
			...clock(),
		});
		expect(final.state).toBe('done');
		expect(collected).toHaveLength(0);
		expect(bc.posts).toHaveLength(1);
	});

	it('posts the failure when the generator refuses the prompt', async () => {
		const record = await newJob();
		const bc = basecamp([201]);
		const final = await runBasecampForge(record.key, {
			forge: async () => ({ isError: true, content: [{ type: 'text', text: 'That prompt was refused by the safety screen.' }] }),
			fetch: bc.fetch,
			...clock(),
		});
		expect(final.state).toBe('failed');
		expect(bc.posts[0].body.content).toContain('That 3D model did not finish');
		expect(bc.posts[0].body.content).toContain('refused by the safety screen');
	});

	it('fails honestly when the generator never accepts the job', async () => {
		const record = await newJob();
		const bc = basecamp([201]);
		const final = await runBasecampForge(record.key, {
			forge: async () => { throw new Error('ETIMEDOUT'); },
			fetch: bc.fetch,
			...clock(),
		});
		expect(final.state).toBe('failed');
		expect(final.error).toMatch(/could not be reached: ETIMEDOUT/);
		expect(bc.posts).toHaveLength(1);
	});

	it('hands a long generation to a fresh run, and gives up after the last one', async () => {
		const record = await newJob();
		const bc = basecamp([201]);
		const dispatched = [];
		const deps = {
			forge: async () => pending(),
			collect: async () => pending(),
			dispatch: async (key, base) => { dispatched.push([key, base]); },
			fetch: bc.fetch,
			...clock(),
		};
		let final = await runBasecampForge(record.key, deps);
		expect(final.state).toBe('running');
		expect(dispatched).toEqual([[record.key, SELF]]);
		expect(bc.posts).toHaveLength(0);

		for (let i = 2; i <= MAX_RUNS; i++) final = await runBasecampForge(record.key, deps);
		expect(dispatched).toHaveLength(MAX_RUNS - 1);
		expect(final.state).toBe('failed');
		expect(final.error).toMatch(/took too long/);
		expect(final.runs).toBe(MAX_RUNS);
		expect(bc.posts).toHaveLength(1);
	});

	it('keeps each run inside its budget', async () => {
		const record = await newJob();
		const c = clock();
		const t0 = c.now();
		await runBasecampForge(record.key, { forge: async () => pending(), collect: async () => pending(), dispatch: async () => {}, fetch: basecamp().fetch, ...c });
		expect(c.now() - t0).toBeLessThan(RUN_BUDGET_MS + 10_000);
	});

	it('only delivers when asked to run a job that already settled', async () => {
		const record = await newJob();
		await patchJob(record.key, { state: 'done', result: { glbUrl: GLB }, settledAt: 1 });
		const bc = basecamp([201]);
		let forged = false;
		await runBasecampForge(record.key, { forge: async () => { forged = true; }, fetch: bc.fetch, ...clock() });
		expect(forged).toBe(false);
		expect(bc.posts).toHaveLength(1);
	});

	it('returns null for a key with no job', async () => {
		expect(await runBasecampForge(`bc-${'0'.repeat(40)}`)).toBeNull();
	});
});

describe('dispatchRun', () => {
	it('starts the run on the service with the platform bearer', async () => {
		const seen = [];
		const fetchImpl = async (url, init) => {
			seen.push({ url, init });
			return new Response('', { status: 202 });
		};
		const key = `bc-${'a'.repeat(40)}`;
		expect(await dispatchRun(key, SELF, { fetchImpl, env: { CRON_SECRET: 's3cret' } })).toBe('remote');
		expect(seen[0].url).toBe(`${SELF}/api/basecamp/forge-run`);
		expect(seen[0].init.headers.authorization).toBe('Bearer s3cret');
		expect(JSON.parse(seen[0].init.body)).toEqual({ key });
	});

	it('runs in this process when the endpoint refuses, fails or has no secret', async () => {
		const key = `bc-${'b'.repeat(40)}`;
		expect(await dispatchRun(key, SELF, { fetchImpl: async () => new Response('no', { status: 401 }), env: { CRON_SECRET: 's' } })).toBe('local');
		expect(await dispatchRun(key, SELF, { fetchImpl: async () => { throw new Error('down'); }, env: { CRON_SECRET: 's' } })).toBe('local');
		expect(await dispatchRun(key, SELF, { env: {} })).toBe('local');
	});
});
