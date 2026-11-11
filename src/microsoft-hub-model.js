/**
 * Pure data shaping for the /microsoft partner hub (src/microsoft-hub.js).
 * No DOM, no fetch: everything here is unit-tested in tests/microsoft-hub.test.js.
 */

/** The only statuses data/microsoft-surfaces.json may use. */
export const SURFACE_STATUSES = Object.freeze(['live', 'pending review', 'built, awaiting publish']);

/**
 * Forge engine lanes that run a Microsoft Research model, newest first. The
 * strip asks the community feed for each lane and labels every card with the
 * model that actually made it.
 */
export const MICROSOFT_LANES = Object.freeze([
	{ backend: 'trellis2', label: 'TRELLIS.2', repo: 'https://github.com/microsoft/TRELLIS.2' },
	{ backend: 'trellis_selfhost', label: 'TRELLIS', repo: 'https://github.com/microsoft/TRELLIS' },
]);

const LANE_BY_BACKEND = new Map(MICROSOFT_LANES.map((l) => [l.backend, l]));

/** The Microsoft model behind a Forge backend id, or null for any other lane. */
export function laneFor(backend) {
	return LANE_BY_BACKEND.get(String(backend || '')) || null;
}

function isHttpsUrl(value) {
	try {
		return new URL(value).protocol === 'https:';
	} catch {
		return false;
	}
}

/**
 * Feed rows a strip card can show: from a Microsoft lane, with a preview image
 * and a model to open. Rows come back in lane order (TRELLIS.2 first), each
 * lane keeping the feed's own order, with duplicates dropped.
 *
 * The lane check is done here as well as by the feed's ?backend= filter, so a
 * deployment whose feed ignores the parameter can never put a non-Microsoft
 * model under a Microsoft label.
 */
export function stripCreations(feeds, limit = 12) {
	const seen = new Set();
	const out = [];
	for (const lane of MICROSOFT_LANES) {
		for (const row of feeds?.[lane.backend] || []) {
			if (!row || row.backend !== lane.backend || seen.has(row.id)) continue;
			if (!isHttpsUrl(row.preview_image_url) || !(row.web_glb_url || row.glb_url)) continue;
			seen.add(row.id);
			out.push(row);
		}
	}
	return out.slice(0, limit);
}

/** The rows a lane filter chip shows: every Microsoft lane, or one of them. */
export function filterByLane(rows, backend) {
	if (!backend || backend === 'all') return rows;
	return rows.filter((r) => r.backend === backend);
}

/**
 * The lane the "Try it" button should deep-link to: TRELLIS.2 when the live
 * health check says it is up, else the newest Microsoft lane that is, else
 * TRELLIS.2 anyway (the Forge then keeps its own default and says why).
 */
export function tryItLane(health) {
	const backends = health?.backends || {};
	const up = MICROSOFT_LANES.find((l) => backends[l.backend]?.status === 'ok');
	return up || MICROSOFT_LANES[0];
}

/** /forge deep link for an image-to-3D run on a given lane. */
export function forgeLink(backend) {
	return `/forge?mode=image&engine=${encodeURIComponent(backend)}`;
}

/** Viewer page for one community creation. */
export function viewerLink(id) {
	return `/m/${encodeURIComponent(id)}`;
}

/**
 * One honest line for the Marketplace card from /api/microsoft-marketplace/status.
 * `ready` means the subscription webhook and fulfilment API can run.
 */
export function marketplaceLine(status) {
	if (!status || typeof status.ready !== 'boolean') return { tone: 'unknown', text: 'Purchase status could not be read right now.' };
	if (status.ready && status.sso) return { tone: 'ok', text: 'In-Marketplace purchase and Microsoft sign-in are switched on.' };
	if (status.ready) return { tone: 'ok', text: 'In-Marketplace purchase is switched on. Microsoft sign-in is not yet.' };
	return { tone: 'pending', text: 'In-Marketplace purchase is built and not switched on yet.' };
}

/**
 * Problems with data/microsoft-surfaces.json, as readable strings. Empty means
 * the file is safe to render: known statuses, real links, every field filled.
 */
export function validateSurfaces(data) {
	const errors = [];
	const list = data?.surfaces;
	if (!Array.isArray(list) || list.length === 0) return ['surfaces must be a non-empty array'];
	const ids = new Set();
	const link = (v) => typeof v === 'string' && (v.startsWith('/') || isHttpsUrl(v));
	for (const [i, s] of list.entries()) {
		const at = `surfaces[${i}]${s?.id ? ` (${s.id})` : ''}`;
		for (const key of ['id', 'name', 'kind', 'today', 'built']) {
			if (typeof s?.[key] !== 'string' || !s[key].trim()) errors.push(`${at}: ${key} is required`);
		}
		if (ids.has(s?.id)) errors.push(`${at}: duplicate id`);
		ids.add(s?.id);
		if (!SURFACE_STATUSES.includes(s?.status)) errors.push(`${at}: status "${s?.status}" is not one of ${SURFACE_STATUSES.join(' | ')}`);
		for (const key of ['action', 'evidence']) {
			if (!s?.[key]?.label || !link(s[key].url)) errors.push(`${at}: ${key} needs a label and a / or https:// url`);
		}
		if (s?.copy !== undefined && !isHttpsUrl(s.copy)) errors.push(`${at}: copy must be an https:// url`);
		if (s?.probe !== undefined && !['marketplace', 'mcp'].includes(s.probe)) errors.push(`${at}: unknown probe "${s.probe}"`);
	}
	return errors;
}

/** Short relative age for a creation card ("3h ago"). */
export function ageLabel(iso, now = Date.now()) {
	const t = Date.parse(iso);
	if (!Number.isFinite(t)) return '';
	const s = Math.max(0, Math.round((now - t) / 1000));
	if (s < 60) return 'just now';
	if (s < 3600) return `${Math.floor(s / 60)}m ago`;
	if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
	return `${Math.floor(s / 86400)}d ago`;
}
