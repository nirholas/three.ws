// Off-main-thread OBJ, STL and PLY conversion for the Forge export menu.
//
// A 30k-triangle model converts in well under a second, but a dense rigged or
// scanned mesh takes long enough to freeze the page if it runs on the main
// thread. Here the parse, the bake and the write all happen in a worker; the
// page only sees phase messages and, at the end, the finished file, which is
// transferred rather than copied.
//
// Protocol:
//   page -> worker  { id, format, bytes: ArrayBuffer, dracoPath }
//   worker -> page  { type: 'ready' } once, on load
//                   { id, type: 'phase', phase, triangles? }
//                   { id, type: 'done', bytes: Uint8Array, triangles }
//                   { id, type: 'error', message, outOfMemory, triangles }

import { parseGlb, collectMeshes, writeGeometryFormat, isOutOfMemory } from './forge-export-core.js';
import { withoutTextures } from './forge-export-files.js';

self.addEventListener('message', async (e) => {
	const { id, format, bytes, dracoPath } = e.data || {};
	let triangles = 0;
	try {
		self.postMessage({ id, type: 'phase', phase: 'reading' });
		// Geometry formats carry no images, so the textures are never decoded:
		// a worker has no DOM image loader, and a 2K atlas is memory for nothing.
		const scene = await parseGlb(withoutTextures(bytes), { dracoPath });
		const baked = collectMeshes(scene);
		triangles = baked.triangles;
		if (baked.meshes.length === 0) throw new Error('the model has no triangle meshes to export');
		self.postMessage({ id, type: 'phase', phase: 'converting', triangles });
		const out = await writeGeometryFormat(format, baked.meshes);
		self.postMessage({ id, type: 'done', bytes: out, triangles }, [out.buffer]);
	} catch (err) {
		self.postMessage({
			id,
			type: 'error',
			message: String(err?.message || err),
			outOfMemory: isOutOfMemory(err),
			triangles,
		});
	}
});

self.postMessage({ type: 'ready' });
