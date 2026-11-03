// The picker asks /api/auth/vroid/status before anything else. While the Hub
// app is not registered it must answer 200 {configured:false} even to a
// signed-out visitor, so the "coming soon" state shows without a failing call.

import { describe, expect, it, vi } from 'vitest';

vi.mock('../api/_lib/vroid/config.js', async (orig) => ({ ...(await orig()), vroidConfigured: () => false }));
vi.mock('../api/_lib/auth.js', async (orig) => ({ ...(await orig()), getSessionUser: vi.fn(async () => null) }));

const { default: handler } = await import('../api/auth/vroid/[action].js');

describe('GET /api/auth/vroid/status', () => {
	it('answers 200 configured:false when the Hub app is not registered, signed in or not', async () => {
		const r = { statusCode: 0, headers: {}, setHeader(k, v) { this.headers[k] = v; }, getHeader(k) { return this.headers[k]; }, end(b) { this.body = b; } };
		await handler({ method: 'GET', headers: {}, url: '/api/auth/vroid/[action]?action=status' }, r);
		expect(r.statusCode).toBe(200);
		expect(JSON.parse(r.body)).toMatchObject({ configured: false, connected: false });
	});
});
