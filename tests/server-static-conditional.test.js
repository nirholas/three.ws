import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { startTestServer } from './helpers/test-server.js';

// A static file whose conditional request cannot be honoured must answer with
// the request's own status, never 500. Production 2026-10-08: Cloud CDN
// revalidated /robots.txt and /hdri/studio.hdr with a precondition the freshly
// deployed file no longer met; send() raised 412 Precondition Failed and the
// static handler flattened it to a 500 (14 in a week, all logged as server
// faults and handed to the edge as errors).

const dir = fileURLToPath(new URL('../dist/__static-conditional-test__/', import.meta.url));
const FILE = '/__static-conditional-test__/probe.txt';

let BASE;
let server;

beforeAll(async () => {
	mkdirSync(dir, { recursive: true });
	writeFileSync(`${dir}probe.txt`, 'static conditional probe\n');
	server = await startTestServer();
	BASE = server.base;
}, 60000);

afterAll(() => {
	server?.close();
	rmSync(dir, { recursive: true, force: true });
});

describe('static conditional requests', () => {
	it('serves the file normally', async () => {
		const res = await fetch(`${BASE}${FILE}`);
		expect(res.status).toBe(200);
		expect(await res.text()).toBe('static conditional probe\n');
	});

	it('answers 412, not 500, when If-Match does not match', async () => {
		const res = await fetch(`${BASE}${FILE}`, { headers: { 'if-match': '"not-this-etag"' } });
		expect(res.status).toBe(412);
	});

	it('answers 412, not 500, when the file changed after If-Unmodified-Since', async () => {
		const res = await fetch(`${BASE}${FILE}`, { headers: { 'if-unmodified-since': 'Thu, 01 Jan 1970 00:00:00 GMT' } });
		expect(res.status).toBe(412);
	});

	it('answers 416 for a range past the end of the file', async () => {
		const res = await fetch(`${BASE}${FILE}`, { headers: { range: 'bytes=999999-' } });
		expect(res.status).toBe(416);
	});
});
