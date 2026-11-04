// POST /api/share-funnel: client beacon for the share funnel.
//
// Counts the events only a browser can see: the share sheet's copy/X/embed
// actions, the AR button, and the "make your own" call to action on a shared
// creation page. Server-side surfaces (oEmbed unfurls, creation page head) are
// counted where they are served and are NOT beaconable from here.
//
// Body: { "surface": "diorama_share" | "creation_page" | "ar", "kind": "action" | "cta_click" }
// Aggregate only: no identifier is read from the body or the request. Always
// answers 204 for a valid event, whether or not the counter write succeeded,
// so a counter outage is invisible to the visitor.

import { cors, error, method, readJson, rateLimited, wrap } from './_lib/http.js';
import { limits, clientIp } from './_lib/rate-limit.js';
import { isShareEvent, recordShareEvent } from './_lib/share-funnel.js';

const BEACON_SURFACES = new Set(['ar', 'creation_page', 'diorama_share']);
const BEACON_KINDS = new Set(['action', 'cta_click']);

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'POST,OPTIONS', payments: false })) return;
	if (!method(req, res, ['POST'])) return;

	const rl = await limits.publicIp(clientIp(req));
	if (!rl.success) return rateLimited(res, rl);

	let body;
	try {
		body = await readJson(req, 512);
	} catch (err) {
		return error(res, err.status || 400, 'invalid_request', 'body must be small JSON');
	}
	const surface = body?.surface;
	const kind = body?.kind;
	if (!BEACON_SURFACES.has(surface) || !BEACON_KINDS.has(kind) || !isShareEvent(surface, kind)) {
		return error(res, 400, 'invalid_event', 'surface or kind is not an allowed beacon event');
	}

	await recordShareEvent(surface, kind);
	res.statusCode = 204;
	res.end();
});
