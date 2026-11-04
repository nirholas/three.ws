// @vitest-environment jsdom
//
// The read-only community board tab in the /play chat panel (work order 727).
// It reads the coin's persisted stream through the same-origin proxy
// (GET /api/community/messages) and must design every state: a skeleton while
// loading, an empty board, an unreachable server with a retry, and a
// deployment without community boards. It never prints a poster's wallet.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CommunityBoard, boardAge } from '../src/game/community-board.js';
import { NET_UNREACHABLE } from '../src/game/net-error.js';

const THREE = 'FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump';
const NOW = Date.parse('2026-11-04T18:30:00Z');

let panel;
beforeEach(() => {
	document.body.replaceChildren();
	panel = document.createElement('div');
	document.body.appendChild(panel);
});

const post = (over = {}) => ({
	id: 'p1', token: THREE, content: 'gm builders', username: 'nova', avatar: null,
	wallet: 'THREEsynthetic1111111111111111111111111111', likes: 3, replies: 0,
	createdAt: '2026-11-04T18:25:00Z', ...over,
});

function deferred() {
	let resolve, reject;
	const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
	return { promise, resolve, reject };
}

describe('CommunityBoard', () => {
	it('loads nothing until the tab is opened, then asks for this coin', async () => {
		const load = vi.fn(async () => [post()]);
		const board = new CommunityBoard({ panel, load, now: () => NOW });
		board.setCoin(THREE);
		expect(load).not.toHaveBeenCalled();
		await board.open();
		expect(load).toHaveBeenCalledWith(THREE, { limit: 30 });
	});

	it('shows a skeleton and marks the panel busy while loading', async () => {
		const d = deferred();
		const board = new CommunityBoard({ panel, load: () => d.promise, now: () => NOW });
		board.setCoin(THREE);
		const run = board.open();
		expect(panel.getAttribute('aria-busy')).toBe('true');
		expect(panel.querySelectorAll('.cc-board-skel').length).toBeGreaterThan(0);
		expect(panel.querySelector('[role="status"]').textContent).toMatch(/loading/i);
		d.resolve([post()]);
		await run;
		expect(panel.hasAttribute('aria-busy')).toBe(false);
		expect(panel.querySelector('.cc-board-skel')).toBeNull();
	});

	it('renders posts with name, age and counts, never the wallet', async () => {
		const board = new CommunityBoard({ panel, load: async () => [post()], now: () => NOW });
		board.setCoin(THREE);
		await board.open();
		const item = panel.querySelector('.cc-board-post');
		expect(item.querySelector('b').textContent).toBe('nova');
		expect(item.querySelector('time').textContent).toBe('5m');
		expect(item.querySelector('.cc-board-text').textContent).toBe('gm builders');
		expect(item.querySelector('.cc-board-stats').textContent).toContain('3 likes');
		expect(panel.textContent).not.toContain('THREEsynthetic');
	});

	it('treats post text as text, never markup', async () => {
		const board = new CommunityBoard({ panel, load: async () => [post({ content: '<img src=x onerror=alert(1)>' })], now: () => NOW });
		board.setCoin(THREE);
		await board.open();
		expect(panel.querySelector('img')).toBeNull();
		expect(panel.querySelector('.cc-board-text').textContent).toBe('<img src=x onerror=alert(1)>');
	});

	it('loads an avatar only from https', async () => {
		const board = new CommunityBoard({
			panel,
			load: async () => [post({ id: 'a', avatar: 'javascript:alert(1)' }), post({ id: 'b', avatar: 'https://pbs.twimg.com/profile_images/1/a.jpg' })],
			now: () => NOW,
		});
		board.setCoin(THREE);
		await board.open();
		const imgs = panel.querySelectorAll('.cc-board-avatar img');
		expect(imgs).toHaveLength(1);
		expect(imgs[0].getAttribute('src')).toBe('https://pbs.twimg.com/profile_images/1/a.jpg');
	});

	it('designs the empty board', async () => {
		const board = new CommunityBoard({ panel, load: async () => [], now: () => NOW });
		board.setCoin(THREE);
		await board.open();
		expect(panel.querySelector('.cc-board-notice-title').textContent).toBe('No posts on this board yet.');
	});

	it('explains a dropped connection and recovers on retry', async () => {
		const load = vi.fn()
			.mockRejectedValueOnce(new TypeError('Failed to fetch'))
			.mockResolvedValueOnce([post()]);
		const board = new CommunityBoard({ panel, load, now: () => NOW });
		board.setCoin(THREE);
		await board.open();
		const alert = panel.querySelector('[role="alert"]');
		expect(alert.textContent).toContain(NET_UNREACHABLE);
		alert.querySelector('.cc-board-retry').click();
		await vi.waitFor(() => expect(panel.querySelector('.cc-board-text')?.textContent).toBe('gm builders'));
		expect(load).toHaveBeenCalledTimes(2);
	});

	it('says plainly when this deployment has no community boards, with no dead retry', async () => {
		const err = Object.assign(new Error('CoinCommunities is not configured'), { status: 503, code: 'cc_unconfigured' });
		const board = new CommunityBoard({ panel, load: async () => { throw err; }, now: () => NOW });
		board.setCoin(THREE);
		await board.open();
		expect(panel.textContent).toMatch(/isn't connected to community boards/);
		expect(panel.querySelector('.cc-board-retry')).toBeNull();
	});

	it('does not refetch on every tab switch, only when stale', async () => {
		let now = NOW;
		const load = vi.fn(async () => [post()]);
		const board = new CommunityBoard({ panel, load, now: () => now });
		board.setCoin(THREE);
		await board.open();
		await board.open();
		expect(load).toHaveBeenCalledTimes(1);
		now += 61_000;
		await board.open();
		expect(load).toHaveBeenCalledTimes(2);
	});

	it('ignores a slow answer for a coin the player already left', async () => {
		const d = deferred();
		const board = new CommunityBoard({ panel, load: () => d.promise, now: () => NOW });
		board.setCoin(THREE);
		const run = board.open();
		board.setCoin('THREEsynthetic2222222222222222222222222222');
		d.resolve([post()]);
		await run;
		expect(panel.querySelector('.cc-board-post')).toBeNull();
	});
});

describe('boardAge', () => {
	it('reads as a short age', () => {
		expect(boardAge('2026-11-04T18:29:30Z', NOW)).toBe('now');
		expect(boardAge('2026-11-04T16:30:00Z', NOW)).toBe('2h');
		expect(boardAge('2026-11-01T18:30:00Z', NOW)).toBe('3d');
		expect(boardAge('not a date', NOW)).toBe('');
	});
});
