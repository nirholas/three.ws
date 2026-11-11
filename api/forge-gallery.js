/**
 * Forge gallery — durable text→3D creations.
 *
 *   GET /api/forge-gallery                    → { creations: [...], enabled }
 *   GET /api/forge-gallery?scope=community    → { creations: [...], enabled }
 *   GET /api/forge-gallery?scope=community&backend=trellis2
 *                                             → the same feed narrowed to one engine
 *                                               lane (the /microsoft TRELLIS.2 strip)
 *
 * Default scope reads the persisted models for the browser identified by the
 * x-forge-client header, newest first — the "Your creations" strip on /forge,
 * so generated meshes are reusable instead of lost the moment the tab closes.
 *
 * scope=community reads the newest finished models across all clients (no
 * client header required, nothing identifying returned) — the public "Fresh
 * from the Forge" showcase. Community responses are CDN-cached briefly: the
 * feed only changes when someone finishes a generation.
 *
 * When persistence isn't configured on the deployment both scopes return
 * { enabled: false, creations: [] } so the page can hide the strips cleanly
 * rather than show a broken state.
 */

import { cors, json, method, wrap, rateLimited, varyOn } from './_lib/http.js';
import { limits, clientIp } from './_lib/rate-limit.js';
import { hashClient, listCreations, listShowcase, countShowcase, forgeStoreEnabled } from './_lib/forge-store.js';
import { currentDayWindow, getEvent, isValidSlug } from './_lib/forge-off-events.js';

export default wrap(async (req, res) => {
	// Open CORS: this is a public, keyless, read-only feed of models people chose
	// to publish, and it is the catalogue the standalone AR studio
	// (npm: 3d-ar-studio) offers as its Community tab from whatever origin a
	// developer embedded it on. Rate limiting below is the real control here.
	if (cors(req, res, { origins: '*', methods: 'GET,OPTIONS' })) return;
	if (!method(req, res, ['GET'])) return;

	const rl = await limits.publicIp(clientIp(req));
	if (!rl.success) {
		return rateLimited(res, rl);
	}

	if (!forgeStoreEnabled()) {
		return json(res, 200, { enabled: false, creations: [] });
	}

	const url = new URL(req.url, 'http://localhost');
	const limit = Math.min(Math.max(Number(url.searchParams.get('limit')) || 24, 1), 50);

	if ((url.searchParams.get('scope') || '').trim() === 'community') {
		// Fresh (newest, visual-first) vs Top (Forge-Off board, most-voted). The
		// `window=week` narrows Top to the current Forge-Off week.
		const sort = (url.searchParams.get('sort') || '').trim() === 'top' ? 'top' : 'fresh';
		const windowParam = (url.searchParams.get('window') || '').trim();
		let window = windowParam === 'week' || windowParam === 'day' ? windowParam : 'all';
		// Explicit [from, to) bounds for window=day (the current UTC day) and for
		// an event board (event=<slug>, optionally &day=<n>). Absent for all/week
		// so those outputs stay exactly as before.
		let bounds = {};
		const eventSlug = (url.searchParams.get('event') || '').trim();
		if (eventSlug) {
			if (!isValidSlug(eventSlug)) {
				return json(res, 400, { error: 'invalid_event', message: 'event must be a lowercase slug.' });
			}
			const event = getEvent(eventSlug);
			if (!event) return json(res, 404, { error: 'unknown_event', message: 'No such Forge-Off event.' });
			const dayParam = url.searchParams.get('day');
			if (dayParam !== null && dayParam !== '') {
				const n = /^\d{1,2}$/.test(dayParam) ? Number(dayParam) : NaN;
				const day = event.days.find((d) => d.index === n);
				if (!day) {
					return json(res, 400, { error: 'invalid_day', message: `day must be 1 to ${event.days.length}.` });
				}
				bounds = { from: day.start, to: day.end };
				window = 'event-day';
			} else {
				bounds = { from: event.start, to: event.end };
				window = 'event';
			}
		} else if (window === 'day') {
			bounds = currentDayWindow();
		}
		// Optional engine-lane filter. Lane ids are lowercase snake_case
		// (api/_lib/forge-tiers.js); anything else is a malformed request.
		const backendParam = (url.searchParams.get('backend') || '').trim();
		if (backendParam && !/^[a-z0-9_]{1,40}$/.test(backendParam)) {
			return json(res, 400, { error: 'invalid_backend', message: 'backend must be a forge lane id such as trellis2.' });
		}
		const backend = backendParam || null;
		// Resolve the caller's own voted-state per card when they send their
		// forge id — the community feed carries no other identifying data, and a
		// missing header just yields voted=false everywhere (anonymous read).
		const rawClient = req.headers['x-forge-client'];
		const hasClient = Array.isArray(rawClient) ? rawClient[0] : rawClient;
		const voterKey = hasClient ? hashClient(hasClient) : null;
		// `total` is the full community-model count (social proof), independent of
		// the paginated slice. Cheap enough to run alongside the feed read.
		const [creations, total] = await Promise.all([
			listShowcase({ limit, sort, window, voterKey, ...bounds, ...(backend ? { backend } : {}) }),
			countShowcase(),
		]);
		// Per-voter reads can't be shared across browsers, so only the anonymous
		// (no client id) read is CDN-cacheable. A voted-state read is private.
		//
		// The body changes with x-forge-client, so the edge MUST key on it. Without
		// this Vary the anonymous copy (cacheable for 60s + 300s stale) was served
		// to browsers that DID send the header, so every card came back voted=false
		// for a voter who had already liked it and the like button rendered the
		// wrong state (confirmed live against three.ws before this fix). varyOn
		// merges rather than replaces, so cors()'s `vary: origin` survives.
		varyOn(res, 'x-forge-client');
		const headers = voterKey
			? { 'cache-control': 'private, no-store' }
			: { 'cache-control': 'public, s-maxage=60, stale-while-revalidate=300' };
		return json(res, 200, { enabled: true, creations, total, sort, window, ...(backend ? { backend } : {}) }, headers);
	}

	const rawClient = req.headers['x-forge-client'];
	const clientKey = hashClient(Array.isArray(rawClient) ? rawClient[0] : rawClient);
	const creations = await listCreations({ clientKey, limit });
	return json(res, 200, { enabled: true, creations });
});
