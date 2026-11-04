// Share funnel beacon (client side of api/share-funnel.js).
//
// Reports that a browser-visible share event happened: the AR button pressed,
// a share-sheet action used, the "make your own" call to action clicked. The
// body carries a surface and a kind and nothing else, so there is nothing to
// identify anyone with. Fire-and-forget: it never throws and never delays the
// click that triggered it.

const URL_PATH = '/api/share-funnel';

/**
 * @param {'ar'|'creation_page'|'diorama_share'} surface
 * @param {'action'|'cta_click'} kind
 */
export function beaconShareEvent(surface, kind) {
	try {
		const body = JSON.stringify({ surface, kind });
		if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
			const sent = navigator.sendBeacon(URL_PATH, new Blob([body], { type: 'application/json' }));
			if (sent) return;
		}
		fetch(URL_PATH, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body,
			keepalive: true,
		}).catch(() => {});
	} catch {
		/* a counter must never break the click */
	}
}

/** True when the page was opened from a shared link's call to action. */
export function openedFromShare(search = typeof location !== 'undefined' ? location.search : '') {
	return new URLSearchParams(search).get('from') === 'share';
}
