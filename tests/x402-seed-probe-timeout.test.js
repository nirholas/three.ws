// x402-seed-cron opens every tick by probing /api/x402/dance-tip for the live
// payment requirements. When that probe aborted at its 20s timeout the
// rejection escaped the handler as an HTTP 500 and an ops alert (seen
// 2026-11-06, 20.02s), even though a tick that cannot read the challenge has
// spent nothing and has nothing to seed. Every other gate in the cron reports
// that as a 200 skip; the next tick tries again.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const probe = vi.hoisted(() => ({ impl: null }));

vi.mock('../api/_lib/cron-auth.js', () => ({ requireCron: () => true }));
vi.mock('../api/_lib/redis.js', async (orig) => ({ ...(await orig()), getRedis: () => null }));
vi.mock('../api/_lib/x402/pay.js', async (orig) => ({
	...(await orig()),
	fetchWithTimeout: (...args) => probe.impl(...args),
}));

const { default: handler } = await import('../api/cron/x402-seed-cron.js');

function call() {
	const res = {
		statusCode: 200,
		headersSent: false,
		writableEnded: false,
		body: '',
		setHeader() {},
		getHeader() {},
		end(chunk) {
			this.body += chunk ?? '';
			this.writableEnded = true;
			this.headersSent = true;
		},
	};
	return handler({ method: 'GET', url: '/api/cron/x402-seed-cron', headers: {} }, res).then(() => res);
}

describe('x402-seed-cron dance-tip probe', () => {
	beforeEach(() => {
		delete process.env.X402_SEED_ENABLED;
	});

	it('skips the tick with a 200 when the probe times out', async () => {
		probe.impl = vi.fn(async () => {
			throw new DOMException('This operation was aborted', 'AbortError');
		});
		const res = await call();
		expect(probe.impl).toHaveBeenCalledTimes(1);
		expect(res.statusCode).toBe(200);
		const body = JSON.parse(res.body);
		expect(body).toMatchObject({ ok: false, skipped: true });
		expect(body.reason).toMatch(/dance-tip probe failed/);
	});

	it('skips the tick with a 200 when the probe cannot connect', async () => {
		probe.impl = vi.fn(async () => {
			throw new TypeError('fetch failed');
		});
		const res = await call();
		expect(res.statusCode).toBe(200);
		expect(JSON.parse(res.body)).toMatchObject({ ok: false, skipped: true });
	});
});
