import { describe, it, expect, afterEach } from 'vitest';
import http from 'node:http';
import express from 'express';
import compression from 'compression';
import { shouldCompress, isUnbufferedStream } from '../server/compression-filter.mjs';

// A live stream must reach a client that accepts an encoding while it is still
// being written. /api/tty sends ANSI frames as text/plain for seconds, and with
// the default compression filter a `br`/`gzip` client got the first byte only
// after the last frame (9.8 s on production, 2026-10-08).

const servers = [];
afterEach(() => {
	while (servers.length) servers.pop().close();
});

function boot(filter) {
	const app = express();
	app.use(filter ? compression({ filter }) : compression());
	app.get('/stream', (req, res) => {
		res.setHeader('content-type', 'text/plain; charset=utf-8');
		res.setHeader('x-accel-buffering', 'no');
		res.flushHeaders();
		res.write('frame-1\n'.repeat(200));
		setTimeout(() => res.end('frame-2\n'), 600);
	});
	app.get('/json', (req, res) => {
		res.json({ rows: Array.from({ length: 400 }, (_, i) => ({ i, label: 'compress me' })) });
	});
	return new Promise((resolve) => {
		const server = app.listen(0, '127.0.0.1', () => {
			servers.push(server);
			resolve(`http://127.0.0.1:${server.address().port}`);
		});
	});
}

// Milliseconds from request to the first body byte, plus the response headers.
function firstByte(url) {
	return new Promise((resolve, reject) => {
		const started = Date.now();
		const req = http.get(url, { headers: { 'accept-encoding': 'br, gzip' } }, (res) => {
			res.once('data', () => {
				resolve({ ms: Date.now() - started, headers: res.headers });
				res.resume();
			});
			res.on('error', reject);
		});
		req.on('error', reject);
	});
}

describe('compression and live streams', () => {
	it('the default filter holds an unbuffered text stream until it ends (the bug)', async () => {
		const base = await boot(null);
		const { ms } = await firstByte(`${base}/stream`);
		expect(ms).toBeGreaterThanOrEqual(500);
	});

	it('shouldCompress lets an x-accel-buffering: no stream through as it is written', async () => {
		const base = await boot(shouldCompress);
		const { ms, headers } = await firstByte(`${base}/stream`);
		expect(ms).toBeLessThan(400);
		expect(headers['content-encoding']).toBeUndefined();
	});

	it('shouldCompress still compresses an ordinary response', async () => {
		const base = await boot(shouldCompress);
		const { headers } = await firstByte(`${base}/json`);
		expect(headers['content-encoding']).toMatch(/br|gzip/);
	});

	it('reads the header case- and space-insensitively', () => {
		const res = (value) => ({ getHeader: () => value });
		expect(isUnbufferedStream(res(' No '))).toBe(true);
		expect(isUnbufferedStream(res('yes'))).toBe(false);
		expect(isUnbufferedStream(res(undefined))).toBe(false);
	});
});

describe('the production server uses the stream-aware filter', () => {
	it('server/index.mjs mounts compression with shouldCompress', async () => {
		const { readFileSync } = await import('node:fs');
		const src = readFileSync(new URL('../server/index.mjs', import.meta.url), 'utf8');
		expect(src).toMatch(/app\.use\(compression\(\{\s*filter:\s*shouldCompress\s*\}\)\)/);
	});
});
