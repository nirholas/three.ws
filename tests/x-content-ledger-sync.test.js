import { describe, it, expect } from 'vitest';

import { markPublished } from '../api/_lib/x-content/state.js';

describe('the queue learns what the publish ledger sent', () => {
	it('marks every item the ledger published as posted, whatever status the checkout still says', () => {
		const items = [
			{ id: 'sent-approved', status: 'approved' },
			{ id: 'sent-review', status: 'review' },
			{ id: 'already-posted', status: 'posted' },
			{ id: 'waiting', status: 'approved' },
		];
		const published = [
			{ id: 'sent-approved', publishedAt: '2026-11-01T16:00:00Z' },
			{ id: 'sent-review', publishedAt: '2026-10-15T16:00:00Z' },
			{ id: 'already-posted', publishedAt: '2026-10-01T16:00:00Z' },
			{ id: 'not-in-queue', publishedAt: '2026-09-01T16:00:00Z' },
		];
		expect(markPublished(items, published)).toEqual(['sent-approved', 'sent-review']);
		expect(items.map((item) => item.status)).toEqual(['posted', 'posted', 'posted', 'approved']);
	});

	it('changes nothing when the ledger is empty, as it is without a database', () => {
		const items = [{ id: 'a', status: 'approved' }];
		expect(markPublished(items, [])).toEqual([]);
		expect(markPublished(items, undefined)).toEqual([]);
		expect(items[0].status).toBe('approved');
	});
});
