// The published-skill manifest hands importers absolute URLs. Those URLs must
// anchor on the configured app origin, never on a client-sent Host or
// X-Forwarded-Host, or a cached response could point importers at an attacker.

import { describe, it, expect, vi } from 'vitest';

const manifestSpy = vi.fn(async (origin) => ({ homepage: origin }));
vi.mock('../api/_lib/skill-import-store.js', () => ({
	publishedManifest: (...a) => manifestSpy(...a),
	publishedSkillFile: async () => null,
	unpublishSkill: vi.fn(),
	listMyPublications: vi.fn(),
}));
vi.mock('../api/_lib/env.js', () => ({
	env: { APP_ORIGIN: 'https://app.example.test', isProduction: true, ISSUER: 'http://t', MCP_RESOURCE: 'http://t' },
}));
vi.mock('../api/_lib/auth.js', () => ({ getRequestUser: async () => null, hasScope: () => true }));
vi.mock('../api/_lib/db.js', () => ({ sql: vi.fn(async () => []) }));
vi.mock('../api/_lib/rate-limit.js', () => ({
	limits: new Proxy({}, { get: () => async () => ({ success: true }) }),
	clientIp: () => '203.0.113.9',
}));
vi.mock('../api/_lib/csrf.js', () => ({ requireCsrf: async () => true }));
vi.mock('../api/_lib/http.js', () => ({
	cors: () => false,
	wrap: (fn) => fn,
	json: (res, status, body) => { res.statusCode = status; res.body = body; },
	text: () => {},
	error: (res, status) => { res.statusCode = status; },
	readJson: async () => ({}),
	rateLimited: () => {},
}));

const { default: handler } = await import('../api/skill-imports.js');

describe('GET /api/skill-imports/published/manifest.json', () => {
	it('ignores client-supplied forwarded and host headers', async () => {
		const res = {};
		await handler(
			{
				method: 'GET',
				url: '/api/skill-imports?route=published/manifest.json',
				headers: { 'x-forwarded-host': 'evil.example', host: 'evil.example' },
			},
			res,
		);
		expect(manifestSpy).toHaveBeenCalledWith('https://app.example.test');
		expect(res.body.homepage).toBe('https://app.example.test');
	});
});
