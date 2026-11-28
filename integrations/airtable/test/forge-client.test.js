import { describe, it, expect, vi } from 'vitest';
const LAMP = 'https://three.ws/cdn/forge/7538fb22fd50/420980dd-1c07-4830-b0db-0eacd12cf6de.glb';
import { PHASES, phaseForForgeStatus } from '../frontend/queue.js';
import { lineAnswer } from '../../../api/_lib/forge-line.js';
import { AbortedError, ForgeClient, ForgeError, modelPageUrl, posterUrl } from '../frontend/forge-client.js';
import { exchange, instantSleep, replayFetch } from './replay.js';

const KEY = 'sk_live_fixture-key-not-real-000000';
const done = exchange.polls.at(-1).body;

describe('ForgeClient against recorded production answers', () => {
	it('submits, polls and returns the model, its page and preview', async () => {
		const { fetchImpl, calls } = replayFetch();
		const client = new ForgeClient({ apiKey: KEY, fetchImpl, sleep: instantSleep });
		const statuses = [];
		const result = await client.generate(exchange.prompt, 'draft', { onStatus: (s) => statuses.push(s) });

		expect(result.glbUrl).toBe(done.glb_url);
		expect(result.pageUrl).toBe(`https://three.ws/m/${done.creation_id}`);
		expect(result.previewImageUrl).toBe(done.preview_image_url);
		expect(statuses.at(-1)).toBe('done');

		const [submit] = calls;
		expect(submit.url).toBe('https://three.ws/api/forge');
		expect(submit.method).toBe('POST');
		expect(submit.headers.authorization).toBe(`Bearer ${KEY}`);
		expect(submit.headers['x-forge-client']).toBe('airtable-extension');
		expect(submit.body).toEqual({ prompt: exchange.prompt, tier: 'draft', path: 'image', aspect_ratio: '1:1' });
		expect(calls[1].url).toBe(`https://three.ws/api/forge?job=${encodeURIComponent(exchange.submit.body.job_id)}`);
	});

	it('takes a cached answer without polling and finds the page from the file name', async () => {
		const { fetchImpl, calls } = replayFetch({ cached: true });
		const client = new ForgeClient({ apiKey: KEY, fetchImpl, sleep: instantSleep });
		const result = await client.generate(exchange.prompt, 'draft');
		expect(calls).toHaveLength(1);
		expect(exchange.cached.body.creation_id).toBeNull();
		expect(result.pageUrl).toBe(`https://three.ws/m/${done.creation_id}`);
		expect(result.cached).toBe(true);
	});

	it('reports the production 401 as an auth problem', async () => {
		const { fetchImpl } = replayFetch({ script: [exchange.unauthorized] });
		const client = new ForgeClient({ apiKey: KEY, fetchImpl, sleep: instantSleep });
		const error = await client.generate('a wooden chair', 'draft').catch((e) => e);
		expect(error).toBeInstanceOf(ForgeError);
		expect(error.isAuth).toBe(true);
		expect(error.message).toBe(exchange.unauthorized.body.message);
	});

	it('refuses to send without a key or with a too-short prompt', async () => {
		const { fetchImpl, calls } = replayFetch();
		const noKey = new ForgeClient({ fetchImpl, sleep: instantSleep });
		expect((await noKey.generate('a wooden chair', 'draft').catch((e) => e)).isAuth).toBe(true);
		const client = new ForgeClient({ apiKey: KEY, fetchImpl, sleep: instantSleep });
		expect((await client.generate('ab', 'draft').catch((e) => e)).code).toBe('invalid_prompt');
		expect(calls).toHaveLength(0);
	});

	it('waits out a 429 using retry-after, then succeeds', async () => {
		const sleep = vi.fn(instantSleep);
		const { fetchImpl, calls } = replayFetch({
			script: [{ status: 429, body: { error: 'rate_limited', message: 'Slow down.' }, headers: { 'retry-after': '7' } }],
		});
		const client = new ForgeClient({ apiKey: KEY, fetchImpl, sleep });
		const result = await client.generate(exchange.prompt, 'draft');
		expect(result.glbUrl).toBe(done.glb_url);
		expect(sleep.mock.calls[0][0]).toBe(7000);
		expect(calls[1].method).toBe('POST');
	});

	it('reports a rate-limit wait so the list can say three.ws is busy', async () => {
		const { fetchImpl } = replayFetch({
			script: [{ status: 429, body: { error: 'rate_limited', message: 'Slow down.' }, headers: { 'retry-after': '7' } }],
		});
		const onStatus = vi.fn();
		const client = new ForgeClient({ apiKey: KEY, fetchImpl, sleep: instantSleep, now: () => 0 });
		await client.generate(exchange.prompt, 'draft', { onStatus });
		expect(onStatus.mock.calls[0]).toEqual(['rate_limited', 0, 7000]);
		expect(phaseForForgeStatus('rate_limited')).toBe('throttled');
		expect(PHASES.throttled).toBe('three.ws is busy, retrying');
	});

	it('keeps its place in the Forge waiting line until its turn, however many check-ins that takes', async () => {
		// Built by Forge's own answer builder, so a change to the line contract fails here.
		const queued = (position, etaSeconds) => {
			const answer = lineAnswer({ action: 'queued', position, ahead: position - 1, depth: position, etaSeconds, intervalSeconds: 20, checkAgainSeconds: 10 });
			return { status: answer.status, body: answer.body, headers: answer.headers };
		};
		const script = [queued(5, 180), queued(4, 140), queued(3, 100), queued(2, 60), queued(1, 45)];
		const { fetchImpl, calls } = replayFetch({ script });
		const onStatus = vi.fn();
		const client = new ForgeClient({ apiKey: KEY, fetchImpl, sleep: instantSleep, now: () => 0 });
		const result = await client.generate(exchange.prompt, 'draft', { onStatus });
		expect(result.glbUrl).toBe(done.glb_url);
		expect(calls.filter((c) => c.method === 'POST')).toHaveLength(6);
		expect(onStatus.mock.calls[0]).toEqual(['in_line', 0, 10000, { position: 5, etaSeconds: 180 }]);
		expect(onStatus.mock.calls[4]).toEqual(['in_line', 0, 10000, { position: 1, etaSeconds: 45 }]);
		expect(phaseForForgeStatus('in_line')).toBe('waiting');
	});

	it('waits out a full Forge (503 forge_full) like a rate limit', async () => {
		const full = lineAnswer({ action: 'full', depth: 40, maxDepth: 40, retryAfterSeconds: 30 });
		const { fetchImpl } = replayFetch({ script: [{ status: full.status, body: full.body, headers: full.headers }] });
		const onStatus = vi.fn();
		const client = new ForgeClient({ apiKey: KEY, fetchImpl, sleep: instantSleep, now: () => 0 });
		expect((await client.generate(exchange.prompt, 'draft', { onStatus })).glbUrl).toBe(done.glb_url);
		expect(onStatus.mock.calls[0]).toEqual(['rate_limited', 0, 30000]);
	});

	it('keeps polling through a 503 from the job endpoint', async () => {
		const { fetchImpl } = replayFetch({ script: [exchange.submit, { status: 503, body: { error: 'unavailable' } }] });
		const client = new ForgeClient({ apiKey: KEY, fetchImpl, sleep: instantSleep });
		expect((await client.generate(exchange.prompt, 'draft')).glbUrl).toBe(done.glb_url);
	});

	it('surfaces a failed job with its reason', async () => {
		const { fetchImpl } = replayFetch({
			script: [exchange.submit, { status: 200, body: { status: 'failed', error: 'The image step could not find one object.' } }],
		});
		const client = new ForgeClient({ apiKey: KEY, fetchImpl, sleep: instantSleep });
		const error = await client.generate(exchange.prompt, 'draft').catch((e) => e);
		expect(error.code).toBe('failed');
		expect(error.message).toBe('The image step could not find one object.');
	});

	it('stops when aborted', async () => {
		const controller = new AbortController();
		const { fetchImpl } = replayFetch();
		const client = new ForgeClient({ apiKey: KEY, fetchImpl, sleep: instantSleep });
		const pending = client.generate(exchange.prompt, 'draft', { signal: controller.signal, onStatus: () => controller.abort() });
		await expect(pending).rejects.toBeInstanceOf(AbortedError);
	});

	it('times out a job that never finishes', async () => {
		let t = 0;
		const { fetchImpl } = replayFetch({ script: [exchange.submit, ...Array.from({ length: 400 }, () => exchange.polls[0])] });
		const client = new ForgeClient({ apiKey: KEY, fetchImpl, sleep: instantSleep, now: () => (t += 5000) });
		expect((await client.generate(exchange.prompt, 'draft').catch((e) => e)).code).toBe('timeout');
	});

	it('names an unreachable host instead of throwing a bare TypeError', async () => {
		const client = new ForgeClient({ apiKey: KEY, fetchImpl: async () => { throw new TypeError('Failed to fetch'); }, sleep: instantSleep });
		const error = await client.generate('a wooden chair', 'draft').catch((e) => e);
		expect(error.code).toBe('unreachable');
		expect(error.message).toMatch(/Could not reach three\.ws/);
	});
});

describe('modelPageUrl', () => {
	it('falls back to the viewer when no creation id can be found', () => {
		expect(modelPageUrl('https://three.ws', 'https://cdn.example/x.glb', null)).toBe(
			'https://three.ws/viewer?src=https%3A%2F%2Fcdn.example%2Fx.glb',
		);
	});
});

describe('posterUrl', () => {
	it('points at the creation poster when the GLB is stored under a creation id', () => {
		expect(posterUrl('https://three.ws', LAMP)).toBe('https://three.ws/api/forge/420980dd-1c07-4830-b0db-0eacd12cf6de/og');
	});

	it('has no poster for a GLB that did not come from Forge', () => {
		expect(posterUrl('https://three.ws', 'https://cdn.example/x.glb')).toBeNull();
	});
});
