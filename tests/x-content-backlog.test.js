import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

import { audienceForEntry, draftBacklog, headForEntry } from '../api/_lib/x-content/backlog.js';

const entry = (key, section, score, extra = {}) => ({ key, kind: ['package', 'worker', 'service'].includes(section) ? section : 'page', section, title: key, url: key.startsWith('/') ? key : null, coverage: 'no', live: { ok: true }, score, ...extra });

describe('draft backlog', () => {
	it('leaves out what was announced, what is down, what is covered, and account pages', () => {
		const entries = [
			entry('/a', 'build', 90),
			entry('/announced', 'build', 99, { coverage: 'announced' }),
			entry('/down', 'build', 98, { live: { ok: false } }),
			entry('/queued', 'build', 97),
			entry('/settings', 'account', 96),
		];
		const { rows, open } = draftBacklog(entries, [{ id: 'q', covers: ['/queued'] }]);
		expect(open).toBe(1);
		expect(rows.map((row) => row.key)).toEqual(['/a']);
		expect(rows[0].url).toBe('https://three.ws/a');
	});

	it('counts an older item without covers as covering the pages it links and the packages it names', () => {
		const entries = [entry('/linked', 'build', 90), entry('@three-ws/named-mcp', 'package', 80), entry('@three-ws/by-id', 'package', 70), entry('/open', 'build', 60)];
		const items = [
			{ id: 'old-page', posts: [{ text: 'Try it: three.ws/linked' }] },
			{ id: 'old-pkg', posts: [{ text: 'npm install @three-ws/named-mcp' }] },
			{ id: 'by-id', posts: [{ text: 'A post with no link.' }] },
		];
		expect(draftBacklog(entries, items).rows.map((row) => row.key)).toEqual(['/open']);
	});

	it('interleaves readers instead of following the score into one section', () => {
		const entries = [entry('/c1', 'crypto', 100), entry('/c2', 'crypto', 99), entry('/c3', 'crypto', 98), entry('@x/sdk', 'package', 60), entry('/learn-a', 'learn', 40)];
		const { rows } = draftBacklog(entries, [], { limit: 4 });
		expect(rows.map((row) => row.key)).toEqual(['/c1', '@x/sdk', '/learn-a', '/c2']);
		expect(rows.map((row) => row.audience)).toEqual(['community', 'developer', 'educator', 'community']);
	});

	it('filters to one reader on request', () => {
		const entries = [entry('/c1', 'crypto', 100), entry('@x/sdk', 'package', 60)];
		expect(draftBacklog(entries, [], { audience: 'developer' }).rows.map((row) => row.key)).toEqual(['@x/sdk']);
	});

	it('suggests a code head for installables, a GIF for pages that move, and a live capture otherwise', () => {
		expect(headForEntry(entry('@x/sdk', 'package', 1))).toBe('code');
		expect(headForEntry(entry('/flow', 'build', 1, { moves: true }))).toBe('gif');
		expect(headForEntry(entry('/genesis', 'build', 1))).toBe('shot');
		expect(audienceForEntry(entry('/settings', 'account', 1))).toBeNull();
	});

	it('finds open surfaces in the committed ledger for every audience it maps', () => {
		const ledger = JSON.parse(readFileSync('data/announcements.json', 'utf8'));
		const queue = JSON.parse(readFileSync('data/x-content/queue.json', 'utf8'));
		const { rows } = draftBacklog(ledger.entries, queue.items, { limit: 30 });
		expect(new Set(rows.map((row) => row.audience)).size).toBeGreaterThanOrEqual(4);
	});
});

describe('items by landing page', () => {
	it('joins a landing page to the items that cover it or link to it', async () => {
		const { itemsByLanding } = await import('../api/_lib/x-content/backlog.js');
		const map = itemsByLanding([
			{ id: 'genesis', covers: ['/genesis', '@three-ws/sdk'], posts: [{ text: 'Breed two agents: three.ws/genome.' }] },
			{ id: 'forge', posts: [{ text: 'Try it at https://three.ws/forge/ today, or start at three.ws' }] },
		]);
		expect([...map.get('/genesis')]).toEqual(['genesis']);
		expect([...map.get('/genome')]).toEqual(['genesis']);
		expect([...map.get('/forge')]).toEqual(['forge']);
		expect([...map.get('/')]).toEqual(['forge']);
		expect(map.has('@three-ws/sdk')).toBe(false);
	});
});
