/**
 * The paste-ready <trader-card> snippet, as a pure function.
 *
 * The profile page renders this into a field a leader copies, so it has to be
 * exactly what they should paste: no placeholder to fill in, no attribute that
 * is already the default, and the referral code carried through when the viewer
 * has one. Kept out of the page module so it can be tested without a DOM.
 */

const DEFAULT_ORIGIN = 'https://three.ws';
const DEFAULT_WINDOW = '30d';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const REF_RE = /^[A-Za-z0-9_-]{1,32}$/;
const WINDOWS = ['24h', '7d', '30d', 'all'];

/**
 * @returns {string|null} the snippet, or null when the agent id is not one.
 * A null is a caller error rather than a broken snippet someone might paste.
 */
export function embedSnippet({ agentId, window: win = DEFAULT_WINDOW, ref = null, origin = DEFAULT_ORIGIN } = {}) {
	if (!UUID_RE.test(String(agentId || ''))) return null;
	const attrs = [`agent="${agentId}"`];
	// Only non-default attributes are written: a snippet that spells out every
	// default is longer to read and no more correct.
	if (WINDOWS.includes(win) && win !== DEFAULT_WINDOW) attrs.push(`window="${win}"`);
	if (ref && REF_RE.test(ref)) attrs.push(`ref="${ref}"`);
	const src = `${String(origin || DEFAULT_ORIGIN).replace(/\/+$/, '')}/trader-card/element.js`;
	return `<script type="module" src="${src}"><\/script>\n<trader-card ${attrs.join(' ')}></trader-card>`;
}
