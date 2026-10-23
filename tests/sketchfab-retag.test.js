import { describe, it, expect } from 'vitest';
import {
	AI_TAG,
	buildPatch,
	planRetag,
	sfFetch,
	listModels,
	applyChange,
} from '../scripts/sketchfab-retag.mjs';

const tag = (n) => ({ name: n, slug: n });

describe('sketchfab-retag', () => {
	it('adds createdwithai after the existing tags and sends only tags', () => {
		const body = buildPatch({ uid: 'a', tags: [tag('threews'), tag('ai-generated')] });
		expect(body).toEqual({ tags: ['threews', 'ai-generated', AI_TAG] });
	});

	it('returns null when the tag is already present (case-insensitive)', () => {
		expect(buildPatch({ uid: 'a', tags: [tag('CreatedWithAI')] })).toBeNull();
	});

	it('plans only the models missing the tag', () => {
		const plan = planRetag([
			{ uid: '1', name: 'x', tags: [tag('a')] },
			{ uid: '2', name: 'y', tags: [tag(AI_TAG)] },
			{ uid: '3', name: 'z', tags: [] },
		]);
		expect(plan.total).toBe(3);
		expect(plan.compliant).toBe(1);
		expect(plan.changes.map((c) => c.uid)).toEqual(['1', '3']);
	});

	it('waits Retry-After on 429 then succeeds', async () => {
		const waits = [];
		let n = 0;
		const f = async () =>
			n++ === 0
				? { status: 429, headers: new Headers({ 'retry-after': '3' }) }
				: { status: 200, headers: new Headers() };
		const res = await sfFetch('u', {}, f, async (ms) => waits.push(ms));
		expect(res.status).toBe(200);
		expect(waits).toEqual([3000]);
	});

	it('follows pagination and sends an authenticated PATCH with a tags-only body', async () => {
		const calls = [];
		const f = async (url, init = {}) => {
			calls.push({ url, init });
			if (url.includes('cursor=2'))
				return { ok: true, status: 200, headers: new Headers(), json: async () => ({ results: [{ uid: '2' }], next: null }) };
			if (init.method === 'PATCH') return { ok: true, status: 204, headers: new Headers() };
			return { ok: true, status: 200, headers: new Headers(), json: async () => ({ results: [{ uid: '1' }], next: 'https://api.sketchfab.com/v3/me/models?cursor=2' }) };
		};
		const models = await listModels({ token: 't' }, f);
		expect(models.map((m) => m.uid)).toEqual(['1', '2']);
		expect(calls[0].url).toContain('/me/models');
		await applyChange({ uid: 'abc', body: { tags: ['x', AI_TAG] } }, 't', f);
		const patch = calls.at(-1);
		expect(patch.init.method).toBe('PATCH');
		expect(patch.url).toBe('https://api.sketchfab.com/v3/models/abc');
		expect(patch.init.headers.authorization).toBe('Token t');
		expect(JSON.parse(patch.init.body)).toEqual({ tags: ['x', AI_TAG] });
	});
});
