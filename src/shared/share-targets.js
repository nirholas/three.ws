/**
 * Share targets for Microsoft surfaces: Teams and LinkedIn.
 *
 * One helper used by every share menu (src/shared/share.js, the avatar and
 * agent page action bar). It builds the documented share URLs, opens them in a
 * sized popup with a new-tab fallback, and counts the action through the
 * existing share funnel beacon.
 *
 *   Teams     https://teams.microsoft.com/share?href=&msgText=&preview=true
 *   LinkedIn  https://www.linkedin.com/sharing/share-offsite/?url=
 *
 * Neither network takes a pre-filled body for the other: LinkedIn ignores any
 * text parameter and unfurls the page's Open Graph tags, so the page head is
 * the source of truth (see docs/sharing.md and npm run audit:share-previews).
 */

import { beaconShareEvent } from './share-beacon.js';

const TEAMS_SHARE = 'https://teams.microsoft.com/share';
const LINKEDIN_SHARE = 'https://www.linkedin.com/sharing/share-offsite/';

/** Teams share launcher URL. `text` is the optional message that precedes the link preview. */
export function teamsShareUrl(url, text = '') {
	const q = new URLSearchParams({ href: url });
	if (text) q.set('msgText', text);
	q.set('preview', 'true');
	return `${TEAMS_SHARE}?${q}`;
}

/** LinkedIn share-offsite URL. */
export function linkedinShareUrl(url) {
	return `${LINKEDIN_SHARE}?${new URLSearchParams({ url })}`;
}

const POPUP_SIZES = {
	teams: { width: 700, height: 600 },
	linkedin: { width: 620, height: 640 },
};

/**
 * Open a share URL in a centred popup. Returns true when a window opened.
 * A blocked popup returns false so the caller lets the anchor's own
 * target=_blank navigation run as the new-tab fallback.
 */
export function openSharePopup(href, target) {
	const { width, height } = POPUP_SIZES[target] || POPUP_SIZES.linkedin;
	const left = Math.max(0, Math.round((window.screenX || 0) + ((window.outerWidth || width) - width) / 2));
	const top = Math.max(0, Math.round((window.screenY || 0) + ((window.outerHeight || height) - height) / 2));
	const win = window.open(
		href,
		`tws-share-${target}`,
		`popup=yes,noopener,noreferrer,width=${width},height=${height},left=${left},top=${top}`,
	);
	return !!win;
}

/**
 * Wire an anchor (already carrying the share href and target=_blank) so a
 * plain click opens the sized popup and records the action. Modified clicks
 * (ctrl/cmd/shift/middle) keep the browser's native new-tab behaviour, as does
 * a blocked popup. Keyboard activation fires click, so it is covered.
 */
export function wireShareAnchor(anchor, target) {
	anchor.addEventListener('click', (e) => {
		beaconShareEvent('creation_page', 'action');
		if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
		if (openSharePopup(anchor.href, target)) e.preventDefault();
	});
}
