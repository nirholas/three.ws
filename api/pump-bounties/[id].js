// GET /api/pump-bounties/:id — a single pump.fun GO bounty + its submissions.
//
// `id` is the off-chain task uuid. Fetches the bounty detail and (best-effort)
// its submissions in parallel from the public livestream-api, normalizes, and
// caches briefly. A submissions failure degrades to an empty list rather than
// failing the whole page — the bounty itself is the primary content.
//
// The bounty detail itself goes through cacheWrapLastGood (see
// api/pump-bounties.js): a 24h last-known-good copy answers (flagged with an
// x-pump-stale header) instead of a 502 when pump.fun's Cloudflare challenge
// blocks the live fetch. A stale bounty still tries for fresh submissions.

import { cors, json, error, wrap, method } from '../_lib/http.js';
import { cacheWrapLastGood } from '../_lib/cache.js';
import { isUuid } from '../_lib/validate.js';
import { getBounty, getSubmissions, PumpGoError } from '../_lib/pump-go.js';

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,OPTIONS' })) return;
	if (!method(req, res, ['GET'])) return;

	const id = req.query?.id || req.url?.split('/').pop()?.split('?')[0];
	if (!id || !isUuid(id)) return error(res, 400, 'bad_request', 'valid bounty taskId required');

	// Fired alongside the bounty fetch, not after it, so a cache miss on the
	// bounty does not add its own latency onto the submissions fetch too.
	const submissionsPromise = getSubmissions(id, { limit: 50 }).catch((e) => {
		// Degrading to an empty list is deliberate, but a silent degrade hides a
		// real pump.fun outage behind a page that just looks unpopular. Log it.
		console.warn(`[pump-bounties] submissions for ${id} unavailable: ${e.message}`);
		return { items: [], nextCursor: null };
	});

	let bounty, stale;
	try {
		({ value: bounty, stale } = await cacheWrapLastGood(`pumpgo:task:${id}`, 30, () => getBounty(id), { withMeta: true }));
	} catch (e) {
		if (e instanceof PumpGoError) return error(res, e.status, e.code, e.message);
		throw e;
	}
	if (!bounty) return error(res, 404, 'not_found', 'bounty not found');

	const submissions = await submissionsPromise;

	const payload = {
		bounty,
		submissions: submissions.items,
		submissionsCursor: submissions.nextCursor,
	};
	if (stale) res.setHeader('x-pump-stale', '1');
	res.setHeader('cache-control', 'public, s-maxage=30, stale-while-revalidate=120');
	return json(res, 200, payload);
});
