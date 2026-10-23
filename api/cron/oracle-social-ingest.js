// GET/POST /api/cron/oracle-social-ingest - feed tracked X timelines into the
// Oracle social endpoint.
//
// Reads the latest posts of every tracked handle (admin-attached KOL handles plus
// the endpoint's own KOL accounts) through the keyless guest reader
// (api/_lib/x-guest), keeps the ones that mention a $CASHTAG, and POSTs them to
// /api/oracle/social, which maps tickers to known mints and lifts oracle_narrative
// virality. The endpoint is idempotent (virality only ever rises to the max seen,
// never overwrites an LLM score), so a re-sent tweet is harmless.
//
// Reads only; nothing is posted to X.

import { json, method, wrapCron } from '../_lib/http.js';
import { requireCron } from '../_lib/cron-auth.js';
import { collectSocialBatch, uniqueHandles } from '../_lib/oracle/social-feed.js';
import { KOL_ACCOUNTS } from '../oracle/social.js';

const POST_TIMEOUT_MS = 20_000;

export default wrapCron(async (req, res) => {
	if (!method(req, res, ['GET', 'POST'])) return;
	if (!requireCron(req, res)) return;
	const started = Date.now();

	// The endpoint is this same deployment; derive its origin like quality-bench.
	const host = req.headers.host || 'three.ws';
	const proto = req.headers['x-forwarded-proto'] || (/^localhost|127\.0\.0\.1/.test(host) ? 'http' : 'https');
	const origin = `${proto}://${host}`;

	const { loadWallets } = await import('../../src/kol/wallet-store.js');
	const curated = await loadWallets().catch(() => []);
	const handles = uniqueHandles([
		curated.map((w) => w?.xHandle).filter(Boolean),
		KOL_ACCOUNTS,
	]);
	if (!handles.length) return json(res, 200, { ok: true, handles: 0, tweets: 0, note: 'no tracked handles' });

	const batch = await collectSocialBatch(handles);
	const failed = Object.keys(batch.failures).length;
	if (failed) console.warn('[oracle-social-ingest] timeline reads failed', batch.failures);

	let ingest = null;
	if (batch.tweets.length) {
		const r = await fetch(`${origin}/api/oracle/social`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ tweets: batch.tweets }),
			signal: AbortSignal.timeout(POST_TIMEOUT_MS),
		});
		const body = await r.json().catch(() => null);
		if (!r.ok) {
			return json(res, 502, {
				ok: false,
				error: 'ingest_failed',
				status: r.status,
				detail: body?.error_description || body?.error || null,
				handles: handles.length,
				read: batch.read,
				tweets: batch.tweets.length,
			});
		}
		ingest = { mints_updated: body?.mints_updated ?? 0, symbols_found: body?.symbols_found ?? 0 };
	}

	return json(res, 200, {
		ok: batch.read > 0,
		handles: handles.length,
		read: batch.read,
		tweets: batch.tweets.length,
		...(ingest ? { ingest } : {}),
		...(failed ? { failures: batch.failures } : {}),
		...(batch.skipped.length ? { skipped: batch.skipped } : {}),
		ms: Date.now() - started,
	});
});
