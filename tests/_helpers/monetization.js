import { Readable } from 'node:stream';

let counter = 0;

export function createTestAgent(overrides = {}) {
	const userId = `user-${++counter}`;
	const agentId = `agent-${counter}-test-0000-0000-000000000000`;
	const agent = {
		id: agentId,
		user_id: userId,
		name: 'Test Agent',
		meta: {
			payments: {
				configured: true,
				provider: 'pumpfun',
				mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
				receiver: 'So11111111111111111111111111111111111111112',
				cluster: 'mainnet',
				default_price: { amount: '1000000', currency: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v' },
			},
		},
		...overrides,
	};
	return { agent, session: { id: userId } };
}

export function createTestUser() {
	const userId = `user-${++counter}`;
	return { session: { id: userId } };
}

export function makeReq({ method = 'GET', url = '/', headers = {}, body = null, query = null } = {}) {
	const base = body
		? Readable.from([Buffer.from(JSON.stringify(body))])
		: Readable.from([]);
	base.method = method;
	base.url = url;
	base.headers = {
		host: 'localhost',
		...(body ? { 'content-type': 'application/json' } : {}),
		...headers,
	};
	if (query) base.query = query;
	return base;
}

export function makeRes() {
	return {
		statusCode: 200,
		headers: {},
		body: '',
		writableEnded: false,
		setHeader(k, v) {
			this.headers[k.toLowerCase()] = v;
		},
		end(chunk) {
			if (chunk !== undefined) this.body += chunk;
			this.writableEnded = true;
		},
	};
}

export async function invoke(handler, reqOpts) {
	const req = makeReq(reqOpts);
	const res = makeRes();
	await handler(req, res);
	const payload = res.body ? JSON.parse(res.body) : null;
	return { res, status: res.statusCode, body: payload };
}
