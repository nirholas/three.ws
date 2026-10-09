// The forge seed cron gives up on a generation the lane never resolves.
//
// Every 'pending' row counts against maxPending(), and pollPending only ever
// moved a row on when its poll said done or failed. A job the lane lost kept
// answering queued (or the poll kept erroring), so the row held its slot for
// good: one hunyuan3d job sat pending from 2026-09-17 to 2026-10-09, and once
// SEED_CRON_MAX_PENDING was set to 1 it stopped seeding entirely.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const queries = [];
let pendingRows = [];
vi.mock('../api/_lib/db.js', () => ({
	sql: (strings, ...values) => {
		const text = strings.join('?');
		queries.push({ text, values });
		if (/select[\s\S]*from forge_seed_jobs[\s\S]*status = 'pending'/.test(text)) return Promise.resolve(pendingRows);
		return Promise.resolve([]);
	},
}));

const { pollPending } = await import('../api/cron/forge-seed-cron.js');

const row = (id, ageMinutes) => ({
	id,
	user_id: 'user-1',
	raw_client_id: 'client-1',
	job_id: `forge-${id}`,
	prompt: 'a lighthouse keeper in an oilskin coat',
	model_category: 'avatar',
	started_at: new Date(Date.now() - ageMinutes * 60_000).toISOString(),
});

const failUpdates = () => queries.filter((q) => /update forge_seed_jobs[\s\S]*status = 'failed'/.test(q.text));

function answer(body, status = 200) {
	vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })));
}

describe('pollPending stall expiry', () => {
	beforeEach(() => {
		queries.length = 0;
		pendingRows = [];
	});
	afterEach(() => vi.unstubAllGlobals());

	it('leaves a young job that is still queued alone', async () => {
		pendingRows = [row('young', 5)];
		answer({ status: 'queued' });
		const results = await pollPending('https://three.ws');
		expect(results).toEqual([{ job_id: 'forge-young', status: 'queued' }]);
		expect(failUpdates()).toHaveLength(0);
	});

	it('fails a job still queued past the stall window and frees its slot', async () => {
		pendingRows = [row('lost', 3 * 24 * 60)];
		answer({ status: 'queued' });
		const [result] = await pollPending('https://three.ws');
		expect(result.status).toBe('failed');
		expect(result.error).toMatch(/stalled past 60m \(last poll: queued\)/);
		const [update] = failUpdates();
		expect(update.values).toContain('lost');
		// Guarded so a row another tick already closed out is never reopened.
		expect(update.text).toMatch(/and status = 'pending'/);
	});

	it('fails a stalled job whose poll errors on transport', async () => {
		pendingRows = [row('unreachable', 90)];
		vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('fetch failed'); }));
		const [result] = await pollPending('https://three.ws');
		expect(result.status).toBe('failed');
		expect(result.error).toMatch(/poll error/);
		expect(failUpdates()).toHaveLength(1);
	});

	it('still publishes a stalled job that turns out to be done', async () => {
		pendingRows = [row('late', 90)];
		answer({ status: 'done', glb_url: 'https://three.ws/m.glb', creation_id: 'c-1', backend: 'trellis_selfhost' });
		const [result] = await pollPending('https://three.ws');
		expect(result.status).toBe('generated');
		expect(failUpdates()).toHaveLength(0);
	});
});
