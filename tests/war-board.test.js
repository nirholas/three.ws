// @vitest-environment jsdom
//
// The war room on the Coin Wars arena's terminal cards (src/play/war-board.js).
//
// /play/war is only ever reached with a signed pairing from a coin world's war
// portal, so every other arrival lands on a dead end. The property under test is
// that the dead end is never blank: whatever /api/wars answers with (live
// battles, a queue, a ladder, an empty ledger, or nothing at all), the card ends
// in a designed state and in a link into a world where a war can be started.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mountWarBoard } from '../src/play/war-board.js';

const THREE_MINT = 'FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump';
const RIVAL_MINT = 'THREEsynthetic1111111111111111111111111111';

let host = null;
let handle = null;

function respond(data, { ok = true, status = 200 } = {}) {
	global.fetch = vi.fn(async () => ({
		ok,
		status,
		json: async () => (ok ? { data } : { error: 'server_error', error_description: 'ledger down' }),
	}));
}

function mount(opts = {}) {
	host = document.createElement('div');
	document.body.appendChild(host);
	handle = mountWarBoard(host, opts);
	return new Promise((resolve) => setTimeout(resolve, 0));
}

const board = () => host.querySelector('.war-board');
const rows = () => [...host.querySelectorAll('.war-board-link')];
const textOf = () => board().textContent;

beforeEach(() => {
	vi.useRealTimers();
});

afterEach(() => {
	handle?.dispose();
	handle = null;
	host?.remove();
	host = null;
	vi.restoreAllMocks();
});

describe('the war room', () => {
	it('paints a loading state before the first answer lands', async () => {
		let release;
		global.fetch = vi.fn(() => new Promise((r) => { release = r; }));
		host = document.createElement('div');
		document.body.appendChild(host);
		handle = mountWarBoard(host, {});

		expect(board().querySelectorAll('.war-board-skeleton-row').length).toBe(3);
		expect(textOf()).toContain('Reading the league');
		release({ ok: true, status: 200, json: async () => ({ data: {} }) });
	});

	it('tells a player where to start when the ledger is empty', async () => {
		respond({ live: [], queue: { available: true, waiting: [] }, standings: [], ledgerAvailable: true });
		await mount({});

		expect(textOf()).toContain('The ladder is empty');
		expect(textOf()).toContain('war portal');
		// An empty state that offers no door is a dead end with extra words.
		expect(rows().length).toBe(0);
		const hrefs = [...board().querySelectorAll('a')].map((a) => a.getAttribute('href'));
		expect(hrefs).toContain('/docs/coin-wars');
		expect(hrefs).toContain('/play');
	});

	it('renders a live battle as a link into that coin world, carrying the match key', async () => {
		respond({
			live: [{
				matchKey: 'm-42',
				phase: 'live',
				scoreCap: 15,
				endsAt: Date.now() + 90_000,
				a: { mint: THREE_MINT, name: 'three', symbol: 'THREE', score: 7, fighters: 3 },
				b: { mint: RIVAL_MINT, name: 'Synthetic', symbol: 'SYN', score: 4, fighters: 2 },
			}],
			queue: { available: true, waiting: [] },
			standings: [],
			ledgerAvailable: true,
		});
		await mount({});

		expect(textOf()).toContain('Live now');
		expect(textOf()).toContain('$THREE 7 - 4 $SYN');
		expect(textOf()).toContain('5 fighters on the field');

		const href = rows()[0].getAttribute('href');
		expect(href.startsWith('/play?')).toBe(true);
		const q = new URLSearchParams(href.slice('/play?'.length));
		expect(q.get('coin')).toBe(THREE_MINT);
		expect(q.get('symbol')).toBe('THREE');
		expect(q.get('war')).toBe('m-42');
	});

	it('reads a queued community as an invitation, not a status line', async () => {
		respond({
			live: [],
			queue: { available: true, waiting: [{ mint: RIVAL_MINT, symbol: 'SYN', since: Date.now() - 90_000 }] },
			standings: [],
			ledgerAvailable: true,
		});
		await mount({});

		expect(textOf()).toContain('Waiting for an opponent');
		expect(textOf()).toContain('Queued 2m ago');
		expect(rows()[0].getAttribute('href')).toContain(`coin=${RIVAL_MINT}`);
	});

	it('says so when matchmaking is offline rather than reading as "nobody wants to fight"', async () => {
		respond({ live: [], queue: { available: false, waiting: [] }, standings: [], ledgerAvailable: true });
		await mount({});
		expect(textOf()).toContain('Matchmaking is offline');
	});

	it('ranks the ladder and pins the player\'s own community when it falls below the cut', async () => {
		const standings = [];
		for (let i = 0; i < 6; i++) {
			standings.push({
				mint: `SYNTHETICmint${i}1111111111111111111111`,
				symbol: `S${i}`,
				rating: 1200 - i * 10,
				wins: 6 - i, losses: i, draws: 0, streak: 0,
			});
		}
		standings.push({ mint: THREE_MINT, symbol: 'THREE', rating: 990, wins: 1, losses: 4, draws: 1, streak: -3 });
		respond({ live: [], queue: { available: true, waiting: [] }, standings, ledgerAvailable: true });
		await mount({ coin: THREE_MINT });

		const labels = rows().map((r) => r.textContent);
		expect(labels.length).toBe(6);            // the top five, plus the pinned row
		expect(labels[0]).toContain('#1');
		expect(labels[5]).toContain('$THREE');
		expect(labels[5]).toContain('#7');
		expect(labels[5]).toContain('3 straight losses');
		expect(rows()[5].classList.contains('is-yours')).toBe(true);
	});

	it('offers a retry, not a blank panel, when the board read fails', async () => {
		respond(null, { ok: false, status: 500 });
		await mount({});

		expect(textOf()).toContain('The league board is unreachable');
		const retry = board().querySelector('.war-board-retry');
		expect(retry).toBeTruthy();

		respond({ live: [], queue: { available: true, waiting: [] }, standings: [], ledgerAvailable: true });
		retry.click();
		await new Promise((r) => setTimeout(r, 0));
		expect(textOf()).toContain('The ladder is empty');
	});

	it('says the ladder is unreadable rather than showing an empty one', async () => {
		respond({ live: [], queue: { available: true, waiting: [] }, standings: [], ledgerAvailable: false });
		await mount({});
		expect(textOf()).toContain('The battle ledger is unreachable');
	});

	it('renders a hostile coin name as text, never as markup', async () => {
		respond({
			live: [],
			queue: { available: true, waiting: [{ mint: RIVAL_MINT, name: '<img src=x onerror=alert(1)>', since: Date.now() }] },
			standings: [],
			ledgerAvailable: true,
		});
		await mount({});

		expect(host.querySelector('img[src="x"]')).toBeNull();
		// Rendered through textContent, and clipped to the label budget like any
		// other community name.
		expect(board().querySelector('.war-board-title').textContent).toBe('<img src=x onerror=alert');
	});

	it('stops polling and leaves no node behind once disposed', async () => {
		respond({ live: [], queue: { available: true, waiting: [] }, standings: [], ledgerAvailable: true });
		await mount({});
		expect(board()).toBeTruthy();
		handle.dispose();
		handle = null;
		expect(host.querySelector('.war-board')).toBeNull();
	});
});
