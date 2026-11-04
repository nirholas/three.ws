// scanVenue: the I/O half of the no-arbitrage scanner. The venue is a stand-in
// object with the same listEvents/getOrderbook surface as
// api/_lib/predictions/solana-venue.js, so the real candidate selection, caps and
// scoring run against controlled books.
import { describe, it, expect } from 'vitest';

import { scanVenue, DEFAULT_MODELS } from '../api/_lib/predictions/arb.js';

const DAY = 86_400_000;
const future = new Date(Date.now() + 7 * DAY).toISOString();
const past = new Date(Date.now() - DAY).toISOString();

function market(id, { yes, no, close = future, status = true } = {}) {
	return {
		id,
		event_id: `E-${id}`,
		title: id,
		provider: 'example',
		tradable: status,
		close_time: close,
		outcomes: [
			{ side: 'yes', buy_price: yes },
			{ side: 'no', buy_price: no },
		],
	};
}

// A two-sided book whose best YES ask is `yes` and best NO ask is `no`: the YES
// ask is 1 minus the best NO bid and vice versa.
const twoSided = (yes, no) => ({ yes_bids: [[+(1 - no).toFixed(4), 500]], no_bids: [[+(1 - yes).toFixed(4), 500]] });
const oneSided = (yes) => ({ yes_bids: [], no_bids: [[+(1 - yes).toFixed(4), 500]] });

function venueOf(events, books = {}) {
	const reads = [];
	return {
		id: 'stub',
		reads,
		async listEvents({ start, limit }) {
			const page = events.slice(start, start + limit);
			return { events: page, has_more: start + limit < events.length };
		},
		async getOrderbook(id) {
			reads.push(id);
			return books[id] ?? twoSided(0.5, 0.52);
		},
	};
}

const models = (thresholds) => ({ ...DEFAULT_MODELS, thresholds: { ...DEFAULT_MODELS.thresholds, ...thresholds } });

describe('scanVenue', () => {
	it('stops at max_markets_scanned even when one event carries more markets than the cap', async () => {
		const big = { title: 'big', markets: Array.from({ length: 200 }, (_, i) => market(`M${i}`, { yes: 0.5, no: 0.52 })) };
		const venue = venueOf([big]);
		const scan = await scanVenue(venue, { models: models({ max_markets_scanned: 60, max_books_fetched: 30 }) });
		expect(scan.scanned_markets).toBe(60);
		expect(venue.reads.length).toBe(30);
	});

	it('skips a market whose close time has passed even when the venue still reports it open', async () => {
		const ev = { title: 'e', markets: [market('OPEN', { yes: 0.5, no: 0.52 }), market('CLOSED', { yes: 0.5, no: 0.52, close: past })] };
		const venue = venueOf([ev]);
		const scan = await scanVenue(venue, { models: models({}) });
		expect(scan.scanned_markets).toBe(1);
		expect(venue.reads).toEqual(['OPEN']);
	});

	it('spends the book budget on the candidates nearest par first', async () => {
		const ev = {
			title: 'e',
			markets: [
				market('FAR', { yes: 0.55, no: 0.5 }),
				market('NEAR', { yes: 0.49, no: 0.5 }),
				market('MID', { yes: 0.5, no: 0.52 }),
			],
		};
		const venue = venueOf([ev]);
		await scanVenue(venue, { models: models({ max_books_fetched: 2 }) });
		expect(venue.reads).toEqual(['NEAR', 'MID']);
	});

	it('counts every book it read, and separately the two-sided books it could score', async () => {
		const ev = { title: 'e', markets: [market('A', { yes: 0.5, no: 0.52 }), market('B', { yes: 0.5, no: 0.52 }), market('C', { yes: 0.5, no: 0.52 })] };
		const venue = venueOf([ev], { B: oneSided(0.5), C: oneSided(0.5) });
		const scan = await scanVenue(venue, { models: models({}) });
		expect(scan.books_read).toBe(3);
		expect(scan.books_scored).toBe(1);
		expect(scan.opportunities.map((r) => r.market_id)).toEqual(['A']);
	});

	it('does not count a book the venue failed to return as read', async () => {
		const ev = { title: 'e', markets: [market('A', { yes: 0.5, no: 0.52 }), market('B', { yes: 0.5, no: 0.52 })] };
		const venue = venueOf([ev]);
		const real = venue.getOrderbook;
		venue.getOrderbook = async (id) => {
			if (id === 'B') throw new Error('upstream 503');
			return real(id);
		};
		const scan = await scanVenue(venue, { models: models({}) });
		expect(scan.books_read).toBe(1);
		expect(scan.books_failed).toBe(1);
	});
});
