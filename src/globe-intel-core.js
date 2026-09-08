// globe-intel-core: the parts of /globe that are arithmetic, not WebGL.
//
// Layer identity, URL state, projection maths and event ranking live here with
// no DOM, no three.js and no fetch, so every rule the page depends on can be
// tested directly. src/globe-intel.js owns the scene and the panels and imports
// what it needs from this file.

// ── layers ───────────────────────────────────────────────────────────────────
//
// Order is the render order and the legend order, and it is deliberate: the
// slow-moving reference geography sits at the bottom of the list, the live
// human-driven feeds at the top, so the eye reads "what is happening" before
// "what is already there".
//
// Colours are picked to stay separable on a dark sphere and to survive being
// drawn at four pixels: two layers never share a hue family, and the three
// reference layers are deliberately cooler and dimmer than the live ones.

export const LAYERS = [
	{
		id: 'conflicts',
		label: 'Conflicts',
		color: '#ff453a',
		live: true,
		blurb: 'Armed clashes, assaults and mass violence, geolocated from the global news stream.',
	},
	{
		id: 'military',
		label: 'Force posture',
		color: '#ff9f0a',
		live: true,
		blurb: 'Mobilizations, alert-status changes and shows of force, before they become clashes.',
	},
	{
		id: 'sanctions',
		label: 'Sanctions',
		color: '#bf5af2',
		live: true,
		blurb: 'Embargoes, boycotts and administrative sanctions as they are imposed.',
	},
	{
		id: 'hotspots',
		label: 'Hotspots',
		color: '#ff375f',
		live: true,
		ring: true,
		blurb: 'Where coverage of force and coercion concentrates, weighted by press attention.',
	},
	{
		id: 'natural',
		label: 'Natural events',
		color: '#32d74b',
		live: true,
		blurb: 'Earthquakes, volcanoes, wildfires and landslides currently active.',
	},
	{
		id: 'weather',
		label: 'Severe weather',
		color: '#64d2ff',
		live: true,
		blurb: 'Tropical cyclones, floods, drought and severe storms on the GDACS alert scale.',
	},
	{
		id: 'outages',
		label: 'Internet outages',
		color: '#ffd60a',
		live: true,
		ring: true,
		blurb: 'Countries whose reachable network fell below its own baseline.',
	},
	{
		id: 'economic',
		label: 'Economic stress',
		color: '#5e5ce6',
		live: true,
		blurb: 'Real GDP growth by country. Contraction is drawn loudest.',
	},
	{
		id: 'bases',
		label: 'Military bases',
		color: '#98a2b3',
		live: false,
		blurb: 'Overseas basing and access agreements, as reference geography.',
	},
	{
		id: 'nuclear',
		label: 'Nuclear sites',
		color: '#2dd4bf',
		live: false,
		blurb: 'Power stations, fuel-cycle sites and weapons complexes.',
	},
	{
		id: 'waterways',
		label: 'Chokepoints',
		color: '#0a84ff',
		live: false,
		ring: true,
		blurb: 'Maritime passages, carrying the armed activity the live feed puts within reach of each.',
	},
];

export const LAYER_IDS = LAYERS.map((l) => l.id);
const LAYER_BY_ID = new Map(LAYERS.map((l) => [l.id, l]));
export const layerById = (id) => LAYER_BY_ID.get(id) || null;

export const RANGES = [
	{ id: '24h', label: '24h' },
	{ id: '7d', label: '7d' },
	{ id: '30d', label: '30d' },
];
const RANGE_IDS = new Set(RANGES.map((r) => r.id));

/** How many hours a range id means, so the panel can judge a layer's coverage. */
const RANGE_HOURS = { '24h': 24, '7d': 24 * 7, '30d': 24 * 30 };
export const hoursForRange = (id) => RANGE_HOURS[id] ?? RANGE_HOURS['7d'];

export const VIEWS = [
	{ id: 'global', label: 'Globe' },
	{ id: 'flat', label: 'Flat' },
];
const VIEW_IDS = new Set(VIEWS.map((v) => v.id));

export const MIN_ZOOM = 0.6;
export const MAX_ZOOM = 6;

export const DEFAULT_STATE = Object.freeze({
	lat: 20,
	lon: 0,
	zoom: 1,
	view: 'global',
	timeRange: '7d',
	layers: ['conflicts', 'hotspots', 'natural', 'weather', 'outages'],
});

const clamp = (n, lo, hi) => (n < lo ? lo : n > hi ? hi : n);

/**
 * Longitude into [-180, 180], so a wrapped camera still produces a clean URL.
 *
 * The in-range short circuit matters more than it looks: the modulo is correct
 * but not exact in binary floating point (2.35 comes back as 2.3500000000000227),
 * and this runs on every camera write, so without it a stationary globe would
 * churn its own URL with lengthening decimals.
 */
export function normalizeLon(lon) {
	const n = Number(lon);
	if (!Number.isFinite(n)) return 0;
	let l = n > 180 || n < -180 ? (((n + 180) % 360) + 360) % 360 - 180 : n;
	if (l === -180) l = 180; // the same meridian; pick one spelling and keep it
	return Object.is(l, -0) ? 0 : l;
}

function readNumber(params, key, fallback) {
	const raw = params.get(key);
	if (raw === null || raw.trim() === '') return fallback;
	const n = Number(raw);
	return Number.isFinite(n) ? n : fallback;
}

/**
 * Read the page's whole state out of a query string.
 *
 * Every value is clamped or dropped rather than trusted: this URL is meant to be
 * shared, so it arrives from strangers, from old bookmarks and from links typed
 * by hand. An unknown layer name is skipped instead of failing the parse, and a
 * layer list that ends up empty falls back to the default set rather than
 * rendering a bare sphere that looks broken.
 */
export function parseGlobeState(search, defaults = DEFAULT_STATE) {
	const params = new URLSearchParams(String(search || '').replace(/^\?/, ''));

	const rawLayers = params.get('layers');
	let layers = defaults.layers;
	if (rawLayers !== null) {
		const picked = rawLayers
			.split(',')
			.map((s) => s.trim())
			.filter((s) => LAYER_BY_ID.has(s));
		layers = picked.length ? [...new Set(picked)] : defaults.layers;
	}

	const view = params.get('view');
	const timeRange = params.get('timeRange');

	return {
		lat: clamp(readNumber(params, 'lat', defaults.lat), -85, 85),
		lon: normalizeLon(readNumber(params, 'lon', defaults.lon)),
		zoom: clamp(readNumber(params, 'zoom', defaults.zoom), MIN_ZOOM, MAX_ZOOM),
		view: VIEW_IDS.has(view) ? view : defaults.view,
		timeRange: RANGE_IDS.has(timeRange) ? timeRange : defaults.timeRange,
		layers: layers.filter((id) => LAYER_BY_ID.has(id)),
	};
}

/**
 * The inverse, in the same parameter order every time so the URL in the address
 * bar stays stable while the camera moves and diffs cleanly in a shared link.
 */
export function serializeGlobeState(state) {
	const params = new URLSearchParams();
	params.set('lat', Number(state.lat).toFixed(4));
	params.set('lon', normalizeLon(Number(state.lon)).toFixed(4));
	params.set('zoom', Number(state.zoom).toFixed(2));
	params.set('view', state.view);
	params.set('timeRange', state.timeRange);
	params.set('layers', state.layers.join(','));
	return `?${params.toString()}`;
}

// ── projection ───────────────────────────────────────────────────────────────
//
// Two projections of the same coordinate, held side by side so the page can
// morph between them: a unit sphere for the globe, and a 2:1 equirectangular
// plane for the flat view. Both are pure functions of lat/lon, which is what
// makes the morph a lerp rather than a rebuild.

export const GLOBE_RADIUS = 1;
export const PLANE_WIDTH = 4;
export const PLANE_HEIGHT = 2;

const DEG = Math.PI / 180;

/**
 * Geographic coordinates to a point on the sphere.
 *
 * Longitude 0 faces +Z so the camera's default position looks at the prime
 * meridian, which is what a `lon=0` URL is expected to show.
 */
export function latLonToSphere(lat, lon, radius = GLOBE_RADIUS, out = { x: 0, y: 0, z: 0 }) {
	const phi = (90 - lat) * DEG;
	const theta = (lon + 180) * DEG;
	const sinPhi = Math.sin(phi);
	out.x = -radius * sinPhi * Math.cos(theta);
	out.y = radius * Math.cos(phi);
	out.z = radius * sinPhi * Math.sin(theta);
	return out;
}

/** The same coordinate on the flat map, in the same object shape. */
export function latLonToPlane(lat, lon, altitude = 0, out = { x: 0, y: 0, z: 0 }) {
	out.x = (lon / 180) * (PLANE_WIDTH / 2);
	out.y = (lat / 90) * (PLANE_HEIGHT / 2);
	out.z = altitude;
	return out;
}

/** Linear blend between the two projections. `t` of 0 is the globe, 1 is flat. */
export function blendProjection(sphere, plane, t) {
	return {
		x: sphere.x + (plane.x - sphere.x) * t,
		y: sphere.y + (plane.y - sphere.y) * t,
		z: sphere.z + (plane.z - sphere.z) * t,
	};
}

// Camera distance at zoom 1, per view. Both are set so the whole subject is in
// frame on a normal landscape stage at the page's 38 degree field of view: the
// globe (2 units across) with a little air around it, and the flat map (4 units
// across) whole, rather than cropped at the antimeridian. The flat number is the
// larger one because the map is twice as wide as the globe.
const BASE_DISTANCE = { global: 3.2, flat: 4.6 };

/**
 * Camera distance for a zoom level. Reciprocal rather than linear so a doubling
 * of zoom halves the distance, which is what a scroll wheel feels like it should
 * do, and floored so the near plane is never crossed.
 */
export function cameraDistance(zoom, view = 'global') {
	const base = BASE_DISTANCE[view] ?? BASE_DISTANCE.global;
	return clamp(base / clamp(zoom, MIN_ZOOM, MAX_ZOOM), 0.62, 9);
}

/** Zoom back out of a camera distance, so a dragged camera writes a true URL. */
export function zoomFromDistance(distance, view = 'global') {
	const base = BASE_DISTANCE[view] ?? BASE_DISTANCE.global;
	return clamp(base / Math.max(0.0001, distance), MIN_ZOOM, MAX_ZOOM);
}

// ── event presentation ───────────────────────────────────────────────────────

/**
 * Marker radius in world units.
 *
 * Severity drives it on a square-root curve rather than linearly: a linear ramp
 * spends most of its range on points nobody looks at, and makes the difference
 * between a 0.8 and a 0.95 invisible, which is exactly the difference that
 * matters on this page.
 */
export function markerSize(severity, { min = 0.008, max = 0.024 } = {}) {
	const s = clamp(Number(severity) || 0, 0, 1);
	return min + (max - min) * Math.sqrt(s);
}

/**
 * Marker opacity: never fully transparent, never flat.
 *
 * The ceiling is deliberately under 1. Markers blend additively, so a dense
 * region stacks toward white and stops carrying its layer's colour; holding the
 * top of the range back keeps Europe legible as red rather than as a hole.
 */
export function markerAlpha(severity) {
	return 0.34 + 0.44 * clamp(Number(severity) || 0, 0, 1);
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** "4m ago", "3h ago", "6d ago". Reference geography has no time and says so. */
export function relativeTime(iso, now = Date.now()) {
	if (!iso) return 'Reference';
	const t = Date.parse(iso);
	if (!Number.isFinite(t)) return 'Reference';
	const delta = now - t;
	if (delta < 0) return 'Just now';
	if (delta < MINUTE) return 'Just now';
	if (delta < HOUR) return `${Math.floor(delta / MINUTE)}m ago`;
	if (delta < DAY) return `${Math.floor(delta / HOUR)}h ago`;
	const days = Math.floor(delta / DAY);
	if (days < 45) return `${days}d ago`;
	return new Date(t).toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
}

/**
 * Order the feed.
 *
 * Severity leads, because the feed is a triage list and not a timeline, but a
 * recency bonus keeps a fresh moderate event above a week-old severe one. Ties
 * break on the newer event so the list never reshuffles at random between polls.
 */
export function rankEvents(events, now = Date.now()) {
	const score = (e) => {
		const sev = clamp(Number(e.severity) || 0, 0, 1);
		const t = Date.parse(e.at);
		if (!Number.isFinite(t)) return sev * 0.7; // reference geography, no recency
		const ageDays = Math.max(0, (now - t) / DAY);
		return sev + 0.35 * Math.exp(-ageDays / 2);
	};
	return [...events].sort((a, b) => {
		const d = score(b) - score(a);
		if (d !== 0) return d;
		return (Date.parse(b.at) || 0) - (Date.parse(a.at) || 0);
	});
}

/** Case-insensitive substring match across the fields a person would search. */
export function matchesQuery(event, query) {
	const q = String(query || '').trim().toLowerCase();
	if (!q) return true;
	return [event.title, event.detail, event.place, event.country]
		.filter(Boolean)
		.some((field) => String(field).toLowerCase().includes(q));
}

/** "1,204" without dragging in a formatting library. */
export const formatCount = (n) => Number(n || 0).toLocaleString('en-US');

/** "3h", "2d", "5w" from a span in hours. */
export function formatDuration(hours) {
	const h = Math.max(0, Math.round(Number(hours) || 0));
	if (h < 1) return 'under an hour';
	if (h < 48) return `${h}h`;
	const days = Math.round(h / 24);
	if (days < 21) return `${days}d`;
	return `${Math.round(days / 7)}w`;
}

/** How many hours a layer's reported window actually spans. */
export function coveredHours(window) {
	if (!window?.from || !window?.to) return null;
	const from = Date.parse(window.from);
	const to = Date.parse(window.to);
	if (!Number.isFinite(from) || !Number.isFinite(to)) return null;
	return Math.max(0, (to - from) / 3_600_000);
}

/**
 * One line describing what a layer actually delivered, for the panel.
 *
 * It never repeats the count (the row already shows that beside it). What it
 * says instead is the thing a reader cannot see from a number: whether the
 * upstream answered, whether the window really reaches back as far as the range
 * control claims, and whether they are looking at a cached copy. A layer whose
 * upstream could not be reached says so rather than reading as empty, which is
 * the difference between "nothing is happening" and "we cannot see".
 */
export function layerStatusLine(payload, requestedHours = null) {
	if (!payload) return 'Not loaded';
	if (payload.status === 'unavailable') return `Unavailable: ${payload.reason || 'upstream failed'}`;

	const parts = [];
	if (payload.coverage === 'static') {
		parts.push('Reference geography');
	} else if (payload.coverage === 'live') {
		parts.push('Live, last hour only');
	} else {
		const covered = coveredHours(payload.window);
		parts.push(
			covered !== null && requestedHours && covered < requestedHours * 0.8
				? `Covers ${formatDuration(covered)} so far`
				: 'Live',
		);
	}
	if (payload.truncated) parts.push(`top ${formatCount(payload.count)} of ${formatCount(payload.total)}`);
	if (payload.status === 'stale') parts.push('cached');
	return parts.join(' · ');
}
