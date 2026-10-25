// fetchSafePublicUrl must honour opts.maxBytes: a chunked response with no
// (or a lying) content-length is cut off at the cap instead of buffered whole.

import { describe, it, expect, afterEach } from 'vitest';
import { fetchSafePublicUrl, MaxBytesExceededError } from '../api/_lib/ssrf-guard.js';

const realFetch = globalThis.fetch;
afterEach(() => {
	globalThis.fetch = realFetch;
});

function chunkedBody(chunks, size) {
	let sent = 0;
	return new ReadableStream({
		pull(controller) {
			if (sent >= chunks) return controller.close();
			sent++;
			controller.enqueue(new Uint8Array(size));
		},
	});
}

describe('fetchSafePublicUrl maxBytes', () => {
	it('aborts a streamed body that grows past the cap', async () => {
		globalThis.fetch = async () => new Response(chunkedBody(1000, 1024), { status: 200 });
		const res = await fetchSafePublicUrl('https://8.8.8.8/a.glb', {}, { maxBytes: 4096 });
		await expect(res.arrayBuffer()).rejects.toBeInstanceOf(MaxBytesExceededError);
	});

	it('rejects up front when the advertised content-length exceeds the cap', async () => {
		globalThis.fetch = async () =>
			new Response(new Uint8Array(8), { status: 200, headers: { 'content-length': '999999' } });
		await expect(
			fetchSafePublicUrl('https://8.8.8.8/a.glb', {}, { maxBytes: 4096 }),
		).rejects.toBeInstanceOf(MaxBytesExceededError);
	});

	it('passes a body within the cap through unchanged', async () => {
		globalThis.fetch = async () => new Response(chunkedBody(2, 1024), { status: 200 });
		const res = await fetchSafePublicUrl('https://8.8.8.8/a.glb', {}, { maxBytes: 4096 });
		expect((await res.arrayBuffer()).byteLength).toBe(2048);
	});

	it('leaves the response untouched when no cap is given', async () => {
		globalThis.fetch = async () => new Response(chunkedBody(10, 1024), { status: 200 });
		const res = await fetchSafePublicUrl('https://8.8.8.8/a.glb');
		expect((await res.arrayBuffer()).byteLength).toBe(10240);
	});
});
