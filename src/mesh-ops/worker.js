// Module worker for the in-browser mesh tools. Keeps GLB parsing, the mesh
// algorithms and serialisation off the main thread so the viewer keeps
// rendering while a 300k-triangle model is repaired. Protocol:
//
//   in   { id, kind: 'inspect' | 'run', bytes: ArrayBuffer, op?, params? }
//   out  { id, phase }                              a real stage just started
//        { id, ok: true, bytes?, stats?, triangles } done (bytes transferred)
//        { id, ok: false, error }                    failed

import { inspectGlb, runMeshOp } from './runner.js';

self.addEventListener('message', async (event) => {
	const { id, kind, bytes, op, params } = event.data || {};
	try {
		const input = new Uint8Array(bytes);
		if (kind === 'inspect') {
			const result = await inspectGlb(input);
			self.postMessage({ id, ok: true, triangles: result.triangles });
			return;
		}
		const result = await runMeshOp(input, op, params, (phase) => self.postMessage({ id, phase }));
		const out = result.bytes.buffer.slice(result.bytes.byteOffset, result.bytes.byteOffset + result.bytes.byteLength);
		self.postMessage({ id, ok: true, bytes: out, stats: result.stats, triangles: result.triangles }, [out]);
	} catch (err) {
		self.postMessage({ id, ok: false, error: err?.message || String(err) });
	}
});
