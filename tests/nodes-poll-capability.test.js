// A node may only poll for capabilities it registered. Otherwise any registered
// key can drain queues for work it never declared it could run.

import { describe, it, expect, vi } from 'vitest';

const claim = vi.fn(async () => null);
const getNode = vi.fn();
const touchNode = vi.fn(async () => {});
vi.mock('../api/_lib/inference-nodes.js', () => ({
	claimJob: (...a) => claim(...a),
	getNode: (...a) => getNode(...a),
	touchNode: (...a) => touchNode(...a),
	verifyNodeSignature: () => true,
}));
vi.mock('../api/_lib/rate-limit.js', async (importOriginal) => {
	const actual = await importOriginal();
	return { ...actual, limits: new Proxy(actual.limits, { get: (t, k) => (k === 'nodeJobIp' ? async () => ({ success: true }) : t[k]) }) };
});

const { default: handler } = await import('../api/nodes/jobs.js');

function call(capability) {
	const ts = Date.now();
	const req = { method: 'GET', url: `/api/nodes/jobs?node=N1&capability=${capability}&ts=${ts}&sig=x`, headers: {}, query: {} };
	let body = '';
	const headers = {};
	const res = {
		statusCode: 200, headersSent: false, writableEnded: false,
		setHeader: (k, v) => { headers[k.toLowerCase()] = v; },
		getHeader: (k) => headers[k.toLowerCase()],
		end: (c) => { body = c ?? ''; res.writableEnded = true; },
	};
	return handler(req, res).then(() => ({ status: res.statusCode, body: body ? JSON.parse(body) : null }));
}

describe('GET /api/nodes/jobs capability scope', () => {
	it('403s a capability the node never registered and claims nothing', async () => {
		getNode.mockResolvedValue({ public_key: 'N1', capabilities: [{ capability: 'text-embedding', model: 'm' }] });
		const out = await call('image-gen');
		expect(out.status).toBe(403);
		expect(claim).not.toHaveBeenCalled();
		expect(touchNode).not.toHaveBeenCalled();
	});
	it('serves a registered capability', async () => {
		getNode.mockResolvedValue({ public_key: 'N1', capabilities: [{ capability: 'text-embedding', model: 'm' }] });
		const out = await call('text-embedding');
		expect(out.status).toBe(200);
		expect(claim).toHaveBeenCalledOnce();
		expect(touchNode).toHaveBeenCalledWith({ publicKey: 'N1', capability: 'text-embedding' });
	});
});
