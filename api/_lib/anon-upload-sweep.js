// Enforces the declared size ceiling on anonymous presigned PUT uploads.
//
// A presigned PUT does not bind Content-Length, so a caller can declare 1 MB at
// presign time and PUT far more. This walks each anonymous prefix, confirms any
// object over its ceiling with a HEAD, and deletes it.
//
// Presigned URLs live 300s, so an object can only appear within minutes of its
// presign; the sweep therefore only needs to look at recently modified keys
// (LOOKBACK_MS), which keeps a very large prefix cheap to judge.

import { ANON_UPLOAD_LIMITS } from './anon-upload-limits.js';

export const LOOKBACK_MS = 26 * 60 * 60 * 1000;
export const MAX_PAGES_PER_PREFIX = 100;

/**
 * @param {{ listObjectsPage: Function, headObject: Function, deleteObject: Function }} storage
 * @param {{ now?: number, limits?: Record<string, number>, lookbackMs?: number, maxPages?: number }} [opts]
 */
export async function sweepAnonUploads(storage, opts = {}) {
	const now = opts.now ?? Date.now();
	const limits = opts.limits ?? ANON_UPLOAD_LIMITS;
	const lookbackMs = opts.lookbackMs ?? LOOKBACK_MS;
	const maxPages = opts.maxPages ?? MAX_PAGES_PER_PREFIX;
	const summary = { scanned: 0, oversized: 0, deleted: 0, errors: 0, truncated: [], prefixes: {} };

	for (const [prefix, max] of Object.entries(limits)) {
		const stat = { scanned: 0, deleted: 0 };
		summary.prefixes[prefix] = stat;
		let token;
		let pages = 0;
		do {
			let page;
			try {
				page = await storage.listObjectsPage({ prefix, continuationToken: token });
			} catch (err) {
				summary.errors += 1;
				console.warn('[anon-upload-sweep] list failed', { prefix, error: err?.message });
				break;
			}
			pages += 1;
			for (const obj of page.objects) {
				stat.scanned += 1;
				summary.scanned += 1;
				const modified = obj.lastModified ? new Date(obj.lastModified).getTime() : now;
				if (now - modified > lookbackMs) continue;
				if (!(obj.size > max)) continue;
				try {
					const head = await storage.headObject(obj.key);
					const size = Number(head?.ContentLength);
					if (!head || !(size > max)) continue;
					summary.oversized += 1;
					await storage.deleteObject(obj.key);
					stat.deleted += 1;
					summary.deleted += 1;
					console.warn('[anon-upload-sweep] deleted oversized upload', { key: obj.key, size, max });
				} catch (err) {
					summary.errors += 1;
					console.warn('[anon-upload-sweep] check failed', { key: obj.key, error: err?.message });
				}
			}
			token = page.nextToken || undefined;
			if (token && pages >= maxPages) {
				summary.truncated.push(prefix);
				break;
			}
		} while (token);
	}
	return summary;
}
