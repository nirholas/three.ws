// The bounty feed: each source's recorded real response maps to one listing
// shape, one source failing never fails the refresh, listings dedupe by url,
// and expired listings drop out. Fixtures in tests/fixtures/bounties/ are real
// upstream responses (descriptions trimmed), not invented payloads.

import fs from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const calls = [];
vi.mock('../api/_lib/db.js', () => {
	const sql = async (strings, ...values) => {
		const text = strings.join('?');
		calls.push({ text, values });
		if (/INSERT INTO bounty_listings/.test(text)) return [{ id: `id-${calls.length}` }];
		if (/UPDATE bounty_listings SET status = 'closed'/.test(text)) return [];
		return [];
	};
	return { sql };
});

const { mapHackathon: mapDevfolio } = await import('../api/_lib/bounties/sources/devfolio.js');
const { mapHackathon: mapDevpost } = await import('../api/_lib/bounties/sources/devpost.js');
const { mapIssue } = await import('../api/_lib/bounties/sources/github.js');
const { finalizeListing } = await import('../api/_lib/bounties/normalize.js');
const { refreshSource, refreshSources } = await import('../api/_lib/bounties/store.js');
const { dedupeByUrl, serializeListing, encodeCursor, decodeCursor, sourceHealth } = await import('../api/_lib/bounties/feed.js');

const fixture = (name) => JSON.parse(fs.readFileSync(path.join(import.meta.dirname, 'fixtures', 'bounties', `${name}.json`), 'utf8'));

const REQUIRED = ['source', 'externalId', 'kind', 'title', 'url', 'venue', 'requirements', 'skills', 'submitMode', 'status'];

describe('source normalization', () => {
	it('maps every recorded hackathon-platform hit to a valid listing', () => {
		const hits = fixture('devfolio').hits.hits.map((h) => finalizeListing(mapDevfolio(h._source))).filter(Boolean);
		expect(hits.length).toBeGreaterThan(0);
		for (const l of hits) {
			for (const k of REQUIRED) expect(l[k], k).toBeDefined();
			expect(l.source).toBe('devfolio');
			expect(l.url).toMatch(/^https:\/\//);
			expect(l.kind).toBe('hackathon');
		}
	});

	it('maps every recorded hackathon-directory record to a valid listing', () => {
		const items = fixture('devpost').hackathons.map((h) => finalizeListing(mapDevpost(h))).filter(Boolean);
		expect(items.length).toBeGreaterThan(0);
		for (const l of items) {
			for (const k of REQUIRED) expect(l[k], k).toBeDefined();
			expect(l.source).toBe('devpost');
			expect(l.url).toMatch(/^https:\/\//);
		}
	});

	it('maps every recorded code-bounty issue to a valid listing', () => {
		const items = fixture('github').items.map((i) => finalizeListing(mapIssue(i))).filter(Boolean);
		expect(items.length).toBeGreaterThan(0);
		for (const l of items) {
			for (const k of REQUIRED) expect(l[k], k).toBeDefined();
			expect(l.source).toBe('github');
		}
	});

	it('rejects a record with no https url', () => {
		expect(finalizeListing({ source: 's', externalId: '1', title: 't', url: 'http://x.test' })).toBeNull();
		expect(finalizeListing({ source: 's', externalId: '1', title: 't' })).toBeNull();
	});

	it('marks a listing past its deadline closed', () => {
		const l = finalizeListing({ source: 's', externalId: '1', title: 't', url: 'https://x.test/a', deadline: '2020-01-01T00:00:00Z', status: 'open' });
		expect(l.status).toBe('closed');
	});
});

describe('dedupe and serialization', () => {
	it('dedupes by url, keeping the entry with the larger reward and ignoring a trailing slash', () => {
		const out = dedupeByUrl([
			{ url: 'https://a.test/x/', source: 'devpost', rewardUsd: 100 },
			{ url: 'https://a.test/x', source: 'devfolio', rewardUsd: 500 },
			{ url: 'https://a.test/y', source: 'devfolio', rewardUsd: null },
		]);
		expect(out).toHaveLength(2);
		expect(out.find((l) => l.url.startsWith('https://a.test/x')).rewardUsd).toBe(500);
	});

	it('round-trips an opaque cursor and rejects a tampered one as offset 0', () => {
		expect(decodeCursor(encodeCursor(60))).toBe(60);
		expect(decodeCursor('not-a-cursor')).toBe(0);
		expect(decodeCursor(undefined)).toBe(0);
	});

	it('serializes a row without leaking raw or the triage hash', () => {
		const row = {
			id: 'u1', source: 'devpost', external_id: 'e', kind: 'hackathon', title: 'T', summary: 's', url: 'https://x.test/a', venue: 'V',
			reward_usd: '1200.00', reward_currency: 'USD', reward_amount: '1200', deadline: '2030-01-01T00:00:00Z', requirements: ['r'], skills: ['ai'],
			status: 'open', submit_mode: 'checklist', raw: { secret: 1 }, triage_hash: 'h', triage: { category: 'ai' }, first_seen_at: '2026-11-01T00:00:00Z',
		};
		const s = serializeListing(row);
		expect(s.rewardUsd).toBe(1200);
		expect(s.triage).toEqual({ category: 'ai' });
		expect(JSON.stringify(s)).not.toContain('secret');
		expect(s).not.toHaveProperty('triage_hash');
	});

	it('reports a source with no recent listings as stale and one never seen as empty', () => {
		const now = Date.parse('2026-11-04T12:00:00Z');
		const health = sourceHealth(
			[
				{ id: 'a', label: 'A' },
				{ id: 'b', label: 'B' },
				{ id: 'c', label: 'C' },
			],
			[
				{ source: 'a', open: 4, usd: 10, last_seen: '2026-11-04T11:30:00Z' },
				{ source: 'b', open: 2, usd: 0, last_seen: '2026-11-03T01:00:00Z' },
			],
			now,
		);
		expect(health.map((h) => [h.id, h.status])).toEqual([['a', 'ok'], ['b', 'stale'], ['c', 'empty']]);
	});
});

describe('refresh', () => {
	beforeEach(() => {
		calls.length = 0;
	});

	const good = {
		id: 'good',
		fetchListings: async () => [{ source: 'good', externalId: '1', title: 'T', url: 'https://x.test/1', kind: 'bounty' }],
	};
	const down = { id: 'down', fetchListings: async () => { throw new Error('upstream 502'); } };

	it('a failing source is reported and does not fail the others', async () => {
		const { results } = await refreshSources([down, good]);
		expect(results.find((r) => r.source === 'down')).toMatchObject({ ok: false, error: expect.stringContaining('502') });
		expect(results.find((r) => r.source === 'good')).toMatchObject({ ok: true, upserted: 1 });
	});

	it('a failing source closes nothing', async () => {
		await refreshSource(down);
		expect(calls.some((c) => /SET status = 'closed'/.test(c.text))).toBe(false);
	});

	it('an external source answering empty is an outage and closes nothing', async () => {
		await refreshSource({ id: 'devpost', fetchListings: async () => [] });
		expect(calls.some((c) => /SET status = 'closed'/.test(c.text))).toBe(false);
	});

	it('the platform program source answering empty is real and closes its stale rounds', async () => {
		await refreshSource({ id: 'three-build', fetchListings: async () => [] });
		expect(calls.some((c) => /SET status = 'closed'/.test(c.text) && c.values.includes('three-build'))).toBe(true);
	});

	it('expired listings are closed after every refresh', async () => {
		await refreshSources([good]);
		expect(calls.some((c) => /deadline < now\(\)/.test(c.text))).toBe(true);
	});
});
