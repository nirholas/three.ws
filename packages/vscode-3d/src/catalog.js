// Search the public three.ws asset catalog.
//
// search_catalog on /api/mcp-studio covers every ready-made asset three.ws
// publishes (CC0 props, rigged characters, motion clips) with no key and no
// account. Chat and agent mode both look here before generating anything, the
// same order the studio itself recommends.

import { rpc, textOf, toolCall } from './studio.js';

export const CATALOG_KINDS = Object.freeze(['object', 'character', 'animation']);

/**
 * @typedef {object} CatalogItem
 * @property {string} id         catalog id, `<kind>:<name>`
 * @property {string} kind       object | character | animation
 * @property {string} title
 * @property {string|null} license
 * @property {string[]} tags
 * @property {string|null} glbUrl  the asset file (a GLB for objects and characters)
 * @property {string|null} viewerUrl
 * @property {string|null} thumbUrl
 * @property {number|null} bytes
 */

/**
 * @param {string} origin
 * @param {{ query: string, kind?: string, limit?: number }} params
 * @param {{ signal?: AbortSignal }} [opts]
 * @returns {Promise<{ items: CatalogItem[], matched: number, total: number|null, relaxed: boolean, note: string }>}
 */
export async function searchCatalog(origin, { query, kind, limit = 8 }, { signal } = {}) {
	const args = { q: String(query || '').trim().slice(0, 200), limit: clampLimit(limit) };
	if (kind && CATALOG_KINDS.includes(kind)) args.kind = kind;
	const payload = await rpc(origin, toolCall('search_catalog', args), { signal, timeoutMs: 30_000 });
	return readCatalogResult(payload.result);
}

/** Pull the items out of a search_catalog result; a refusal becomes an error with the studio's words. */
export function readCatalogResult(result) {
	const structured = result?.structuredContent;
	if (result?.isError || !structured || !Array.isArray(structured.items)) {
		throw new Error(textOf(result) || 'the catalog search returned no results list');
	}
	return {
		items: structured.items.map(normalizeItem).filter((item) => item.id),
		matched: Number.isFinite(structured.matched) ? structured.matched : structured.items.length,
		total: Number.isFinite(structured.total) ? structured.total : null,
		relaxed: Boolean(structured.relaxed),
		note: textOf(result),
	};
}

/** @returns {CatalogItem} */
export function normalizeItem(row) {
	const http = (v) => (typeof v === 'string' && /^https?:\/\//.test(v) ? v : null);
	return {
		id: String(row?.id || ''),
		kind: String(row?.kind || ''),
		title: String(row?.title || row?.name || row?.id || ''),
		license: row?.license ? String(row.license) : null,
		tags: Array.isArray(row?.tags) ? row.tags.map(String).slice(0, 8) : [],
		glbUrl: http(row?.glb_url) || http(row?.url),
		viewerUrl: http(row?.viewer_url),
		thumbUrl: http(row?.thumb),
		bytes: Number.isFinite(row?.bytes) ? row.bytes : null,
	};
}

function clampLimit(n) {
	const v = Math.round(Number(n));
	if (!Number.isFinite(v)) return 8;
	return Math.min(20, Math.max(1, v));
}
