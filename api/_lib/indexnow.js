// IndexNow client — push fresh URLs to Bing / Yandex / Seznam / Naver the
// moment they exist so they're indexed in minutes instead of waiting for the
// next crawl. Free, no auth beyond the key file at /<key>.txt.
//
// Google does NOT participate in IndexNow (use Search Console's Indexing API
// for that — separate workflow), but Bing's share + Yandex coverage is real
// enough that this is worth the ~free API call.
//
// This is the transport only. Application code does not call it directly:
// write paths enqueue through api/_lib/indexnow-queue.js, which dedupes,
// rate-limits, logs every request, and drains on a cron
// (api/cron/indexnow-reconcile.js). Runbook: docs/ops/bing-and-indexnow.md.

const KEY = '1a34d91143f6e085eedef0f9669c93be';
const HOST = 'three.ws';
const KEY_LOCATION = `https://${HOST}/${KEY}.txt`;

/** The only origin IndexNow will accept URLs for under this key. */
export const INDEXNOW_ORIGIN = `https://${HOST}`;
/** The key; public/<key>.txt serves it so the engines can verify ownership. */
export const INDEXNOW_KEY = KEY;
export const INDEXNOW_KEY_LOCATION = KEY_LOCATION;
/** IndexNow accepts up to 10,000 URLs per request. */
export const INDEXNOW_BATCH_MAX = 10_000;

/**
 * Notify IndexNow of one or more URL changes.
 *
 * Documented responses (indexnow.org/documentation): 200 accepted, 202
 * accepted with the key still being validated, 400 bad request, 403 key not
 * valid, 422 URLs not on the host, 429 too many requests.
 *
 * @param {string|string[]} urls
 * @param {{timeoutMs?: number}} [opts]
 * @returns {Promise<{ok: boolean, status?: number, error?: string}>}
 */
export async function pingIndexNow(urls, { timeoutMs } = {}) {
	const list = Array.isArray(urls) ? urls : [urls];
	const filtered = list
		.filter(Boolean)
		.map((u) => String(u).trim())
		.filter((u) => u.startsWith(`https://${HOST}/`))
		.slice(0, INDEXNOW_BATCH_MAX);

	if (filtered.length === 0) return { ok: false, error: 'no eligible urls' };

	try {
		const r = await fetch('https://api.indexnow.org/IndexNow', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({
				host: HOST,
				key: KEY,
				keyLocation: KEY_LOCATION,
				urlList: filtered,
			}),
			// A one-URL ping should never hang a caller; a 10,000-URL batch from
			// the drain gets more room to upload.
			signal: AbortSignal.timeout(timeoutMs ?? 5_000 + filtered.length * 2),
		});
		if (r.status === 200 || r.status === 202) return { ok: true, status: r.status };
		const detail = (await r.text().catch(() => '')).replace(/\s+/g, ' ').trim().slice(0, 200);
		return { ok: false, status: r.status, error: `HTTP ${r.status}${detail ? `: ${detail}` : ''}` };
	} catch (err) {
		return { ok: false, error: err?.message || 'indexnow failed' };
	}
}
