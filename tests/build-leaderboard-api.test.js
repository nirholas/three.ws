// GET /api/build/leaderboard before the first Build round opens. "No round yet"
// is the page's empty state, not a missing resource: answering it with a 404
// made /build/leaderboard log "Failed to load resource" on every visit while
// production had zero rounds (console sweep, 2026-11-12). A round asked for by
// name that does not exist is still a 404.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const state = { round: null, entries: [] };
vi.mock('../api/_lib/build-program.js', () => ({
	resolveRound: vi.fn(async () => state.round),
	leaderboardFor: vi.fn(async () => state.entries),
}));

const { default: handler } = await import('../api/build/leaderboard.js');

function call(url) {
	return new Promise((resolve) => {
		const headers = {};
		const res = {
			statusCode: 200,
			headersSent: false,
			setHeader: (k, v) => {
				headers[k.toLowerCase()] = v;
			},
			getHeader: (k) => headers[k.toLowerCase()],
			writeHead(code, h = {}) {
				this.statusCode = code;
				for (const [k, v] of Object.entries(h)) headers[k.toLowerCase()] = v;
				return this;
			},
			end(body) {
				this.headersSent = true;
				resolve({ status: this.statusCode, body: body ? JSON.parse(String(body)) : null });
			},
		};
		handler({ method: 'GET', url, headers: { host: 'three.ws' } }, res);
	});
}

describe('GET /api/build/leaderboard', () => {
	beforeEach(() => {
		state.round = null;
		state.entries = [];
	});

	it('answers 200 with no round and no entries before any round exists', async () => {
		const r = await call('/api/build/leaderboard');
		expect(r.status).toBe(200);
		expect(r.body.round).toBeNull();
		expect(r.body.entries).toEqual([]);
	});

	it('still answers 404 for a named round that does not exist', async () => {
		const r = await call('/api/build/leaderboard?round=nope');
		expect(r.status).toBe(404);
		expect(r.body.error).toBe('round_not_found');
	});

	it('ranks the resolved round', async () => {
		state.round = { id: 'r1', slug: 'round-1', title: 'Round 1', status: 'open', endsAt: null, statsComputedAt: null };
		state.entries = [{ rank: 1, name: 'a', score: 3 }];
		const r = await call('/api/build/leaderboard');
		expect(r.status).toBe(200);
		expect(r.body.round.slug).toBe('round-1');
		expect(r.body.entries).toHaveLength(1);
	});
});
