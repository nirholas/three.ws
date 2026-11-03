/**
 * Stored-XSS guard for the plugin marketplace publish route.
 *
 * src/marketplace.js renders a plugin's manifest_url and manifest.homepage as
 * the href of a button on the public detail page, so a javascript: URL stored
 * by a publisher runs script in the viewer's session on click. The publish
 * boundary must accept only http(s) for both.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const sqlMock = vi.fn();
vi.mock('../api/_lib/db.js', () => ({
	sql: (...a) => sqlMock(...a),
	isDbUnavailableError: () => false,
	isDbCapacityError: () => false,
	isStoragePressured: async () => ({ pressured: false }),
}));
const ok = () => ({ success: true, limit: 60, remaining: 59, reset: Date.now() + 60_000 });
vi.mock('../api/_lib/rate-limit.js', () => ({
	limits: { widgetRead: vi.fn(async () => ok()), pluginPublishUser: vi.fn(async () => ok()) },
	clientIp: () => '203.0.113.7',
}));
vi.mock('../api/_lib/auth.js', () => ({
	getSessionUser: async () => ({ id: '99999999-8888-4777-8666-555555555555' }),
	authenticateBearer: async () => null,
	extractBearer: () => null,
}));
vi.mock('../api/_lib/csrf.js', () => ({ requireCsrf: async () => true }));

const { default: handler } = await import('../api/plugins/[action].js');

function makeRes() {
	const r = { statusCode: 200, _h: {}, _b: null, writableEnded: false, headersSent: false };
	r.setHeader = (k, v) => { r._h[k.toLowerCase()] = v; };
	r.getHeader = (k) => r._h[k.toLowerCase()];
	r.end = (b) => { r._b = b ?? r._b; r.writableEnded = true; };
	r.json = () => (r._b ? JSON.parse(r._b) : undefined);
	return r;
}
async function publish(body) {
	const res = makeRes();
	await handler(
		{
			method: 'POST',
			url: '/api/plugins/publish',
			headers: { origin: 'https://three.ws', 'content-type': 'application/json' },
			socket: { remoteAddress: '203.0.113.7' },
			body,
		},
		res,
	);
	return res;
}

const base = {
	identifier: 'my-plugin',
	meta: { title: 'My Plugin' },
	api: [{ name: 'do_thing', description: 'Does the thing' }],
};

beforeEach(() => sqlMock.mockReset());

describe('POST /api/plugins/publish URL schemes', () => {
	it('rejects a javascript: manifest_url', async () => {
		const res = await publish({ manifest_json: base, manifest_url: 'javascript:alert(document.cookie)' });
		expect(res.statusCode).toBe(400);
		expect(sqlMock).not.toHaveBeenCalled();
	});

	it('rejects a javascript: homepage inside the manifest', async () => {
		const res = await publish({ manifest_json: { ...base, homepage: 'javascript:alert(1)' } });
		expect(res.statusCode).toBe(422);
		expect(sqlMock).not.toHaveBeenCalled();
	});

	it('accepts https manifest_url and homepage', async () => {
		sqlMock
			.mockResolvedValueOnce([{ id: 'p', identifier: 'my-plugin', author_id: 'u', name: 'My Plugin', tags: [] }])
			.mockResolvedValueOnce([{ display_name: 'x' }]);
		const res = await publish({
			manifest_json: { ...base, homepage: 'https://example.com' },
			manifest_url: 'https://example.com/manifest.json',
		});
		expect(res.statusCode).toBe(200);
	});
});
