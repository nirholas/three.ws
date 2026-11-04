// The share funnel counter: allowlisted, atomic, non-identifying, fail-open.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const calls = [];
let failWith = null;
vi.mock('../api/_lib/db.js', () => ({
	sql: (strings, ...values) => {
		calls.push({ text: strings.join('?'), values });
		if (failWith) return Promise.reject(failWith);
		return Promise.resolve([]);
	},
}));

const { recordShareEvent, isShareEvent, SHARE_SURFACES, SHARE_KINDS } = await import(
	'../api/_lib/share-funnel.js'
);

beforeEach(() => {
	calls.length = 0;
	failWith = null;
});

describe('share funnel allowlist', () => {
	it('accepts every documented surface and kind', () => {
		for (const s of SHARE_SURFACES) for (const k of SHARE_KINDS) expect(isShareEvent(s, k)).toBe(true);
		expect(SHARE_SURFACES).toEqual(['ar', 'oembed_agent', 'oembed_play', 'creation_page', 'og_image', 'diorama_share']);
		expect(SHARE_KINDS).toEqual(['view', 'action', 'cta_click']);
	});

	it('rejects anything else without touching the database', async () => {
		for (const [s, k] of [['ar', 'click'], ['nope', 'view'], ['/m/abc-123', 'view'], [undefined, 'view'], ['ar', undefined]]) {
			expect(await recordShareEvent(s, k)).toBe(false);
		}
		expect(calls).toHaveLength(0);
	});
});

describe('recordShareEvent', () => {
	it('increments atomically with an upsert on (day, surface, kind)', async () => {
		expect(await recordShareEvent('ar', 'action')).toBe(true);
		expect(calls).toHaveLength(1);
		const text = calls[0].text.replace(/\s+/g, ' ');
		expect(text).toMatch(/on conflict \(day, surface, kind\) do update set count = share_funnel_daily\.count \+ 1/);
	});

	it('binds only the surface and kind (the day is computed in SQL), never an identifier', async () => {
		await recordShareEvent('creation_page', 'cta_click');
		expect(calls[0].values).toEqual(['creation_page', 'cta_click']);
		expect(calls[0].text).not.toMatch(/ip|user_id|creation_id|path|url/i);
	});

	it('does not throw when the database fails', async () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		failWith = new Error('connection refused');
		await expect(recordShareEvent('oembed_agent', 'view')).resolves.toBe(false);
		expect(warn).toHaveBeenCalled();
		warn.mockRestore();
	});
});
