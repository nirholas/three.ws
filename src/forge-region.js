// Region-restricted engines on /forge.
//
// Some engine licences exclude whole regions (api/_lib/forge-territory.js). The
// server refuses those lanes per request with 403 region_restricted and names
// the engines that can take the same request (retry_backends). It also answers
// GET /api/forge?territory with the lanes it will refuse for this visitor, so
// the picker can disable them before anyone clicks Generate.

/**
 * Map a 403 region_restricted body onto the composer's error kinds. With
 * alternatives named it is a `lane_failed` hop (the composer flips the picker
 * and retries once, visibly); without any it is a designed `region` error.
 * Returns null for any other body.
 */
export function regionRestrictedError(data) {
	if (!data || data.error !== 'region_restricted') return null;
	const retry = Array.isArray(data.retry_backends)
		? data.retry_backends.filter((id) => typeof id === 'string' && id)
		: [];
	const e = new Error(
		data.message ||
			'This engine is not available in your region because its model licence excludes it. Pick another engine.',
	);
	e.regionRestricted = true;
	e.backend = typeof data.backend === 'string' ? data.backend : null;
	if (retry.length) {
		e.kind = 'lane_failed';
		e.retryBackends = retry;
	} else {
		e.kind = 'region';
	}
	return e;
}

/** The set of backend ids a GET /api/forge?territory answer restricts. */
export function parseTerritory(body) {
	const list = Array.isArray(body?.restricted_backends) ? body.restricted_backends : [];
	return new Set(list.filter((id) => typeof id === 'string' && id));
}

/**
 * The restricted set plus whether the server resolved this visitor's country.
 * `resolved` is null when the answer did not say (an old server, or no answer),
 * and is treated like false: the visitor's region is never asserted.
 */
export function parseTerritoryState(body) {
	return {
		restricted: parseTerritory(body),
		resolved: typeof body?.country_resolved === 'boolean' ? body.country_resolved : null,
	};
}

/** Fetch this visitor's territory answer. An unreachable answer restricts nothing client side; the server still enforces. */
export async function fetchTerritory(headers) {
	try {
		const res = await fetch('/api/forge?territory=1', { headers, cache: 'no-store' });
		if (!res.ok) return parseTerritoryState(null);
		return parseTerritoryState(await res.json().catch(() => null));
	} catch {
		return parseTerritoryState(null);
	}
}

/** Fetch this visitor's restricted engines. */
export async function fetchRestrictedEngines(headers) {
	return (await fetchTerritory(headers)).restricted;
}

function joinLabels(labels) {
	if (labels.length < 2) return labels.join('');
	return `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`;
}

/**
 * The reason shown under the engine picker. Without a resolved country it says
 * so instead of naming a region, because the visitor may well be somewhere the
 * licence allows and the fault is ours (no location signal), not theirs.
 */
export function regionNoteText(labels, resolved) {
	const many = labels.length > 1;
	const list = joinLabels(labels);
	if (resolved === true) {
		return `${list} ${many ? 'are' : 'is'} not offered in your region: the model licence behind ${many ? 'them' : 'it'} excludes some regions. Every other engine works the same here.`;
	}
	return `${list} ${many ? 'are' : 'is'} off because we could not confirm your location, and the model licence behind ${many ? 'them' : 'it'} excludes some regions. The other engines are not affected.`;
}

/** The tooltip on a region-disabled engine button. */
export function regionButtonTitle(label, resolved) {
	return resolved === true
		? `${label}: not offered in your region because its model licence excludes it.`
		: `${label}: off because we could not confirm your location, and its model licence excludes some regions.`;
}

const NOTE_ID = 'engine-region-note';

/**
 * Paint the visible reason under the picker and point each restricted button at
 * it with aria-describedby. A disabled button has no hover on touch and is not
 * announced with its title, so the reason has to be page text.
 */
export function applyRegionNote({ note, picker, restricted, resolved, labelOf }) {
	if (!picker) return;
	const shown = [];
	for (const btn of picker.querySelectorAll('button[data-backend]')) {
		if (restricted.has(btn.dataset.backend)) {
			// The label printed on the button is what the visitor sees; two lanes
			// can share one (both Hunyuan engines), so each is listed once.
			const label =
				btn.querySelector('.eng-label')?.textContent.trim() || labelOf?.(btn.dataset.backend) || btn.dataset.backend;
			if (!shown.includes(label)) shown.push(label);
			btn.setAttribute('aria-describedby', NOTE_ID);
		} else if (btn.getAttribute('aria-describedby') === NOTE_ID) {
			btn.removeAttribute('aria-describedby');
		}
	}
	if (!note) return;
	note.textContent = shown.length ? regionNoteText(shown, resolved) : '';
	note.hidden = shown.length === 0;
}
