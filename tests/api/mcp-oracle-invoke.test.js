// invokeEndpoint (api/_mcporacle/invoke.js) runs the real Oracle endpoint
// handlers in process. These cases drive it with the repo's own json()/error()
// response helpers and a real wrap() so the adapter is proven against the same
// response surface the live endpoints use, including a thrown fault.

import { describe, it, expect } from 'vitest';
import { json, error, wrap } from '../../api/_lib/http.js';
import { invokeEndpoint } from '../../api/_mcporacle/invoke.js';

describe('invokeEndpoint', () => {
	it('returns status, parsed body and the query the handler saw', async () => {
		const handler = async (req, res) => {
			const q = new URL(req.url, 'http://x').searchParams;
			json(res, 200, { q: q.get('q'), limit: q.get('limit'), ip: req.headers['x-forwarded-for'] });
		};
		const r = await invokeEndpoint(handler, '/api/oracle/search', { query: { q: 'three', limit: 3, skip: undefined, blank: '' }, ip: '198.51.100.4' });
		expect(r.status).toBe(200);
		expect(r.body).toEqual({ q: 'three', limit: '3', ip: '198.51.100.4' });
	});

	it('carries a 4xx error body and Retry-After through', async () => {
		const handler = async (_req, res) => {
			res.setHeader('retry-after', '9');
			error(res, 429, 'rate_limited', 'slow down');
		};
		const r = await invokeEndpoint(handler, '/api/oracle/stats');
		expect(r.status).toBe(429);
		expect(r.retryAfter).toBe(9);
		expect(r.body.error).toBe('rate_limited');
	});

	it('turns a fault inside a wrapped endpoint into a 5xx answer, not a hang or a throw', async () => {
		const handler = wrap(async () => {
			throw new Error('boom');
		});
		const r = await invokeEndpoint(handler, '/api/oracle/stats');
		expect(r.status).toBeGreaterThanOrEqual(500);
	});

	it('resolves with an empty body when the handler returns without responding', async () => {
		const r = await invokeEndpoint(async () => {}, '/api/oracle/stats');
		expect(r.body).toBeNull();
	});
});
