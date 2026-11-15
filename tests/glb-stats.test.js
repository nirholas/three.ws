// fetchGlbStats reads a GLB's vertex/triangle/material counts for the agent
// profile's stats row without downloading the model. Measured on a Pixel 5 /
// slow 4G profile against production on 2026-11-15, it spent a HEAD round trip
// and a 256 KB range request to read a 1,324-byte JSON chunk, and that 256 KB
// raced <model-viewer>'s own download of the same file on a 1.6 Mbps link,
// pushing the visible avatar back by over a second.
//
// These tests serve a real GLB byte layout through a range-honouring fetch and
// pin the byte budget: a small JSON chunk costs one small request, a large one
// costs exactly the missing bytes, and a server that ignores ranges still works.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchGlbStats } from '../src/lib/glb-stats.js';

function buildGlb(gltf, binBytes = 4096) {
	const enc = new TextEncoder();
	let json = enc.encode(JSON.stringify(gltf));
	const pad = (4 - (json.length % 4)) % 4;
	if (pad) {
		const padded = new Uint8Array(json.length + pad).fill(0x20);
		padded.set(json);
		json = padded;
	}
	const total = 12 + 8 + json.length + 8 + binBytes;
	const buf = new ArrayBuffer(total);
	const view = new DataView(buf);
	view.setUint32(0, 0x46546c67, true);
	view.setUint32(4, 2, true);
	view.setUint32(8, total, true);
	view.setUint32(12, json.length, true);
	view.setUint32(16, 0x4e4f534a, true);
	new Uint8Array(buf, 20, json.length).set(json);
	view.setUint32(20 + json.length, binBytes, true);
	view.setUint32(24 + json.length, 0x004e4942, true);
	return buf;
}

function sampleGltf({ extraNodes = 0 } = {}) {
	return {
		asset: { version: '2.0' },
		accessors: [
			{ count: 300, type: 'VEC3', componentType: 5126 },
			{ count: 900, type: 'SCALAR', componentType: 5123 },
		],
		meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1 }] }],
		materials: [{ name: 'skin' }, { name: 'cloth' }],
		animations: [{ name: 'Wave', channels: [], samplers: [] }],
		nodes: Array.from({ length: 1 + extraNodes }, (_, i) => ({ name: `bone_${i}_${'x'.repeat(40)}` })),
	};
}

// A same-origin static host: honours single byte ranges with 206 and a
// Content-Range header, like the /cdn proxy and the bucket behind it.
function serve(glb, { ranges = true } = {}) {
	const calls = [];
	const fetchImpl = vi.fn(async (_url, init = {}) => {
		const method = init.method || 'GET';
		const range = init.headers?.Range;
		if (method === 'HEAD') {
			calls.push({ method, bytes: 0 });
			return new Response(null, { status: 200, headers: { 'content-length': String(glb.byteLength) } });
		}
		if (ranges && range) {
			const [, s, e] = /bytes=(\d+)-(\d+)/.exec(range);
			const start = Number(s);
			const end = Math.min(Number(e), glb.byteLength - 1);
			const body = glb.slice(start, end + 1);
			calls.push({ method, range, bytes: body.byteLength });
			return new Response(body, {
				status: 206,
				headers: { 'content-range': `bytes ${start}-${end}/${glb.byteLength}` },
			});
		}
		calls.push({ method, range: range || null, bytes: glb.byteLength });
		return new Response(glb.slice(0), { status: 200 });
	});
	return { fetchImpl, calls };
}

afterEach(() => vi.unstubAllGlobals());

describe('fetchGlbStats', () => {
	it('reads a small JSON chunk in one small request with no HEAD round trip', async () => {
		const glb = buildGlb(sampleGltf(), 1_500_000);
		const { fetchImpl, calls } = serve(glb);
		vi.stubGlobal('fetch', fetchImpl);

		const stats = await fetchGlbStats('/cdn/forge/model.glb');

		expect(stats).toMatchObject({
			sizeBytes: glb.byteLength,
			vertices: 300,
			triangles: 300,
			materials: 2,
			animationNames: ['Wave'],
		});
		expect(calls.map((c) => c.method)).toEqual(['GET']);
		const transferred = calls.reduce((n, c) => n + c.bytes, 0);
		expect(transferred).toBeLessThanOrEqual(16 * 1024);
	});

	it('widens to exactly the missing bytes when the JSON chunk outgrows the first window', async () => {
		const gltf = sampleGltf({ extraNodes: 2000 });
		const glb = buildGlb(gltf, 2_000_000);
		const jsonLength = new DataView(glb).getUint32(12, true);
		expect(jsonLength).toBeGreaterThan(64 * 1024);
		const { fetchImpl, calls } = serve(glb);
		vi.stubGlobal('fetch', fetchImpl);

		const stats = await fetchGlbStats('/cdn/forge/rigged.glb');

		expect(stats.nodes).toBe(2001);
		expect(stats.sizeBytes).toBe(glb.byteLength);
		expect(calls.length).toBe(2);
		const transferred = calls.reduce((n, c) => n + c.bytes, 0);
		// Header plus JSON chunk, never a byte re-downloaded.
		expect(transferred).toBe(20 + jsonLength);
	});

	it('still works against a server that ignores Range and returns the whole file', async () => {
		const glb = buildGlb(sampleGltf(), 50_000);
		const { fetchImpl, calls } = serve(glb, { ranges: false });
		vi.stubGlobal('fetch', fetchImpl);

		const stats = await fetchGlbStats('/models/plain.glb');

		expect(stats).toMatchObject({ sizeBytes: glb.byteLength, vertices: 300, materials: 2 });
		expect(calls.length).toBe(1);
	});

	it('rejects a file that is not a GLB', async () => {
		const notGlb = new TextEncoder().encode('<!doctype html><title>404</title>'.padEnd(64, ' ')).buffer;
		const { fetchImpl } = serve(notGlb);
		vi.stubGlobal('fetch', fetchImpl);

		await expect(fetchGlbStats('/missing.glb')).rejects.toThrow('Not a GLB');
	});
});
