// First-party campaign attribution: one module shared by the browser (nav.js loads
// it on every page that carries a campaign tag), the touch endpoint and the tests.
//
// A tag is `utm_campaign=<id>` or the short form `c=<id>`, where <id> is a
// campaign id from marketing/growth/campaigns.csv (MKT-YYYY-MM-NAME, matched
// case-insensitively and stored lowercase). utm_source / utm_medium ride along.
// Nothing else from the URL is kept: no query string, no referrer, no IP.
//
// The first valid tag a browser sees is its first touch for 30 days. It is never
// overwritten, and it is only remembered locally once the server has recorded it.

export const CAMPAIGN_ID_RE = /^mkt-\d{4}-\d{2}-[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const LABEL_RE = /^[a-z0-9][a-z0-9._-]*$/;
export const CAMPAIGN_MAX_LEN = 64;
export const LABEL_MAX_LEN = 40;
export const PATH_MAX_LEN = 200;
export const FIRST_TOUCH_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const STORAGE_KEY = 'tws:first-touch';
export const CONVERSION_EVENTS = Object.freeze(['signup', 'agent_created', 'forge_generation', 'paid_call']);

/** A normalized campaign id, or null when the value is not a well-formed id. */
export function normalizeCampaign(value) {
	if (typeof value !== 'string') return null;
	const v = value.trim().toLowerCase();
	return v.length <= CAMPAIGN_MAX_LEN && CAMPAIGN_ID_RE.test(v) ? v : null;
}

/** A normalized source/medium label, or null (absent labels are not an error). */
export function normalizeLabel(value) {
	if (typeof value !== 'string') return null;
	const v = value.trim().toLowerCase();
	return v.length > 0 && v.length <= LABEL_MAX_LEN && LABEL_RE.test(v) ? v : null;
}

/** The pathname only: a query string, hash or non-path value never survives. */
export function normalizePath(value) {
	if (typeof value !== 'string') return null;
	const v = value.split(/[?#]/)[0];
	return v.startsWith('/') && v.length <= PATH_MAX_LEN && !/[\s\u0000-\u001f]/.test(v) ? v : null;
}

/**
 * Read a tag from a query string. Returns {campaign, source, medium} or null when
 * there is no valid campaign. utm_campaign wins over c=.
 */
export function parseCampaignTag(search) {
	let q;
	try {
		q = new URLSearchParams(search);
	} catch {
		return null;
	}
	const campaign = normalizeCampaign(q.get('utm_campaign')) || normalizeCampaign(q.get('c'));
	if (!campaign) return null;
	return {
		campaign,
		source: normalizeLabel(q.get('utm_source')),
		medium: normalizeLabel(q.get('utm_medium')),
	};
}

/**
 * Validate a touch body the endpoint received. Returns {ok:true, touch} or
 * {ok:false, error}. Any field outside the allowed shape is rejected, not trimmed
 * into something else.
 */
export function validateTouch(body) {
	if (!body || typeof body !== 'object') return { ok: false, error: 'body must be an object' };
	const anonId = typeof body.anon_id === 'string' ? body.anon_id.toLowerCase() : '';
	if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(anonId)) {
		return { ok: false, error: 'anon_id must be a uuid' };
	}
	const campaign = normalizeCampaign(body.campaign);
	if (!campaign) return { ok: false, error: 'campaign must be a campaign id such as mkt-2026-11-gcp-agent' };
	const landingPath = normalizePath(body.landing_path);
	if (!landingPath) return { ok: false, error: 'landing_path must be a pathname' };
	for (const k of ['source', 'medium']) {
		if (body[k] != null && body[k] !== '' && !normalizeLabel(body[k])) {
			return { ok: false, error: `${k} must be 1-${LABEL_MAX_LEN} lowercase letters, digits, dot, dash or underscore` };
		}
	}
	return {
		ok: true,
		touch: {
			anonId,
			campaign,
			source: normalizeLabel(body.source),
			medium: normalizeLabel(body.medium),
			landingPath,
		},
	};
}

/** Tracking is skipped when the browser signals Do Not Track or Global Privacy Control. */
export function trackingDisabled(nav) {
	if (!nav) return false;
	return nav.doNotTrack === '1' || nav.globalPrivacyControl === true;
}

function readStored(storage, now) {
	try {
		const raw = storage.getItem(STORAGE_KEY);
		if (!raw) return null;
		const t = JSON.parse(raw);
		if (t && typeof t.ts === 'number' && now - t.ts < FIRST_TOUCH_TTL_MS) return t;
	} catch {
		/* unreadable storage or corrupt value: treated as no first touch */
	}
	return null;
}

/**
 * Record this browser's first touch if the URL carries a valid tag and the
 * browser has no live first touch yet. Resolves to the stored touch, or null when
 * nothing was recorded. Never throws: attribution must not break a page.
 */
export async function captureFirstTouch({
	location: loc = globalThis.location,
	storage = globalThis.localStorage,
	nav = globalThis.navigator,
	fetchImpl = globalThis.fetch?.bind(globalThis),
	now = Date.now(),
	uuid = () => globalThis.crypto.randomUUID(),
} = {}) {
	try {
		if (trackingDisabled(nav)) return null;
		const tag = parseCampaignTag(loc.search);
		if (!tag) return null;
		const existing = readStored(storage, now);
		if (existing) return null;
		const touch = {
			anon_id: uuid(),
			campaign: tag.campaign,
			source: tag.source,
			medium: tag.medium,
			landing_path: normalizePath(loc.pathname) || '/',
		};
		const res = await fetchImpl('/api/growth/touch', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			credentials: 'same-origin',
			body: JSON.stringify(touch),
			keepalive: true,
		});
		if (!res.ok) return null;
		const stored = { ...touch, ts: now };
		storage.setItem(STORAGE_KEY, JSON.stringify(stored));
		return stored;
	} catch {
		return null;
	}
}
