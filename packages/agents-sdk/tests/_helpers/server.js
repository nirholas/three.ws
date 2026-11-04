// A real node:http server the SDK talks to over a socket. Each test scripts the
// replies; the server records every request it receives.
import http from 'node:http';

export async function startServer(handler) {
	const seen = [];
	const server = http.createServer((req, res) => {
		const chunks = [];
		req.on('data', (c) => chunks.push(c));
		req.on('end', () => {
			const raw = Buffer.concat(chunks).toString('utf8');
			const rec = {
				method: req.method,
				url: req.url,
				path: new URL(req.url, 'http://x').pathname,
				query: Object.fromEntries(new URL(req.url, 'http://x').searchParams),
				headers: req.headers,
				body: raw ? JSON.parse(raw) : undefined,
			};
			seen.push(rec);
			handler(rec, res, seen.length);
		});
	});
	await new Promise((r) => server.listen(0, '127.0.0.1', r));
	const { port } = server.address();
	return {
		seen,
		baseUrl: `http://127.0.0.1:${port}/api/v1`,
		close: () => new Promise((r) => { server.closeAllConnections?.(); server.close(r); }),
	};
}

export function json(res, status, body, headers = {}) {
	res.writeHead(status, { 'content-type': 'application/json', ...headers });
	res.end(JSON.stringify(body));
}
