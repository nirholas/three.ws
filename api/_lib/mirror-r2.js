/**
 * Copy a finished worker artifact into our R2 bucket so the URL is first-party
 * and durable. Shared by the Game-Ready export and the in-world forge simplify
 * pass. Falls back to the worker URL (reported as `durable: false`) if R2 is
 * unconfigured or the copy fails: a real, working result either way, never a
 * faked one, and the caller can tell the two apart.
 */

import { putObject, publicUrl } from './r2.js';
import { fetchUpstream } from './upstream-fetch.js';

const CONTENT_TYPE = {
	glb: 'model/gltf-binary',
	fbx: 'application/octet-stream',
};

/**
 * @param {string} sourceUrl  the worker's artifact URL
 * @param {string} key        destination object key
 * @param {string} format     'glb' | 'fbx' (picks the content type)
 * @returns {Promise<{url: string, bytes: number|null, durable: boolean}>}
 */
export async function mirrorToR2(sourceUrl, key, format) {
	try {
		// Bounded, with one retry: the artifact is a fresh worker upload, so a
		// transient read failure is worth retrying, and a stalled one must not hold
		// the poll open. Any failure falls through to the worker URL below.
		const resp = await fetchUpstream(sourceUrl, {}, {
			name: 'worker:gameready-artifact',
			timeoutMs: 30_000,
			attempts: 2,
		});
		const buf = Buffer.from(await resp.arrayBuffer());
		await putObject({
			key,
			body: buf,
			contentType: CONTENT_TYPE[format] || 'application/octet-stream',
			metadata: { source: 'forge-gameready' },
		});
		return { url: publicUrl(key), bytes: buf.length, durable: true };
	} catch {
		return { url: sourceUrl, bytes: null, durable: false };
	}
}
