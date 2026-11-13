// api/cron/forge-thumbnail-backfill.js: the legacy PNG upgrade must not starve
// behind rows the renderer has given up on.
//
// The cron renders previewless models first and only then upgrades rows still
// pointing at the original 768² PNG to the 512² WebP. It gated the upgrade on
// `coverage.missing === 0`, but rows whose render attempts are exhausted stay
// "missing" forever. Production on 2026-11-13 had missing 439, exhausted 439,
// and 18,189 legacy PNG rows that the upgrade therefore never touched. The
// properties pinned here:
//   1. when every missing row is exhausted, the tick runs the upgrade
//   2. when there is real render work, the tick renders (and the upgrade waits)
//   3. a render tick that claims nothing spends the tick on the upgrade
import { test, expect, vi, beforeEach } from 'vitest';

let cov = { total: 0, covered: 0, missing: 0, exhausted: 0 };
const renderBatch = vi.fn(async () => ({ results: [], claimed: 0, rendered: 0, failed: 0, aborted: null }));
const upgradeLegacyBatch = vi.fn(async () => ({ scanned: 25, upgraded: 25, failed: 0 }));

vi.mock('../api/_lib/cron-auth.js', () => ({ requireCron: () => true }));
vi.mock('../api/_lib/forge-store.js', () => ({ forgeStoreEnabled: () => true }));
vi.mock('../api/_lib/forge-thumbs.js', () => ({
	coverage: async () => cov,
	renderBatch: (...a) => renderBatch(...a),
	upgradeLegacyBatch: (...a) => upgradeLegacyBatch(...a),
}));

const handler = (await import('../api/cron/forge-thumbnail-backfill.js')).default;

function makeRes() {
	return {
		statusCode: 0,
		body: null,
		headersSent: false,
		writableEnded: false,
		setHeader() {},
		getHeader() {},
		status(code) { this.statusCode = code; return this; },
		end(payload) {
			this.writableEnded = true;
			if (payload && this.body === null) {
				try { this.body = JSON.parse(payload); } catch { this.body = payload; }
			}
			return this;
		},
		json(payload) { this.body = payload; return this; },
	};
}

async function tick() {
	const res = makeRes();
	await handler({ method: 'GET', url: '/api/cron/forge-thumbnail-backfill', headers: {} }, res);
	return res;
}

beforeEach(() => {
	renderBatch.mockClear();
	upgradeLegacyBatch.mockClear();
});

test('exhausted-only missing rows do not block the legacy PNG upgrade', async () => {
	cov = { total: 54756, covered: 54317, missing: 439, exhausted: 439 };
	const res = await tick();
	expect(res.statusCode).toBe(200);
	expect(upgradeLegacyBatch).toHaveBeenCalledTimes(1);
	expect(renderBatch).not.toHaveBeenCalled();
	expect(res.body.upgrade).toMatchObject({ upgraded: 25 });
});

test('renderable rows still render first', async () => {
	cov = { total: 100, covered: 90, missing: 10, exhausted: 2 };
	renderBatch.mockResolvedValueOnce({ results: [], claimed: 8, rendered: 8, failed: 0, aborted: null });
	const res = await tick();
	expect(res.statusCode).toBe(200);
	expect(renderBatch).toHaveBeenCalledTimes(1);
	expect(upgradeLegacyBatch).not.toHaveBeenCalled();
});

test('a render tick that claims nothing runs the upgrade', async () => {
	cov = { total: 100, covered: 90, missing: 10, exhausted: 2 };
	const res = await tick();
	expect(renderBatch).toHaveBeenCalledTimes(1);
	expect(upgradeLegacyBatch).toHaveBeenCalledTimes(1);
	expect(res.body.upgrade).toMatchObject({ upgraded: 25 });
});
