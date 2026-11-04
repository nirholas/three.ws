// Minimal Node req/res doubles for driving paidEndpoint() handlers in tests.
import { Readable } from 'node:stream';

export function mockReqRes({ method = 'GET', headers = {}, url = '/' } = {}) {
	const lower = {};
	for (const [k, v] of Object.entries(headers)) lower[k.toLowerCase()] = v;
	const req = Object.assign(new Readable({ read() {} }), {
		method,
		url,
		headers: lower,
		connection: { remoteAddress: '127.0.0.1' },
		socket: { remoteAddress: '127.0.0.1' },
	});
	req.push(null);
	const chunks = [];
	const resHeaders = {};
	const res = {
		statusCode: 200,
		writableEnded: false,
		setHeader(k, v) {
			resHeaders[k.toLowerCase()] = v;
		},
		getHeader(k) {
			return resHeaders[k.toLowerCase()];
		},
		end(body) {
			if (body !== undefined) chunks.push(body);
			res.writableEnded = true;
		},
		write(chunk) {
			chunks.push(chunk);
		},
		get body() {
			return chunks.join('');
		},
		get headers() {
			return resHeaders;
		},
	};
	return { req, res };
}

export function readChallenge(res) {
	const header = res.getHeader('payment-required');
	return header
		? JSON.parse(Buffer.from(String(header), 'base64').toString('utf8'))
		: JSON.parse(res.body);
}
