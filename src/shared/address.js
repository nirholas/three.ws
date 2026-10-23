/**
 * The one address formatter (W3AG 1.1.1, 1.1.3).
 *
 * A wallet address or mint is 32 to 44 characters of base58 (or 42 of hex).
 * Sighted users read a shortened form, `7xKX…gAsU`. Screen-reader users get the
 * whole value, spoken in groups of four so it can be followed and checked
 * instead of being read out as one unbroken string.
 *
 *  - `shortAddress`    plain-text shortening, for textContent and attributes.
 *  - `spokenAddress`   the full value in groups of four, for an accessible name.
 *  - `addressHtml`     markup: short form shown, chunked full form announced.
 *  - `addressElement`  the same as a DOM node.
 *
 * Every address-shortening helper in `src/` routes through `shortAddress`, so a
 * change to how addresses read lands everywhere at once.
 */

/**
 * Shorten an address, mint, hash or id: head + ellipsis + tail. A value that is
 * already short enough is returned whole.
 *
 * @param {unknown} value
 * @param {number} [head]
 * @param {number} [tail]
 * @param {{ empty?: string, sep?: string }} [opts]  `empty` is returned for a
 *   missing value; `sep` is the glyph between head and tail.
 * @returns {string}
 */
export function shortAddress(value, head = 4, tail = 4, { empty = '', sep = '…' } = {}) {
	if (value == null || value === '') return empty;
	const s = String(value);
	if (s.length <= head + tail + 1) return s;
	return `${s.slice(0, head)}${sep}${s.slice(-tail)}`;
}

/**
 * The full value in groups of `size` characters separated by spaces. A leading
 * `0x` stays its own group: `0x 742d 35Cc 6634 ...`.
 *
 * @param {unknown} value
 * @param {number} [size]
 * @returns {string}
 */
export function spokenAddress(value, size = 4) {
	const s = String(value ?? '').trim();
	if (!s) return '';
	const prefixed = /^0x/i.test(s);
	const body = prefixed ? s.slice(2) : s;
	const groups = body.match(new RegExp(`.{1,${size}}`, 'g')) || [];
	return (prefixed ? [s.slice(0, 2), ...groups] : groups).join(' ');
}

function escapeHtml(v) {
	return String(v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

const VISUALLY_HIDDEN =
	'position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0';

/**
 * Markup for one address: the shortened form is what is drawn, the chunked full
 * value is what assistive tech reads, and the full value is on hover as the
 * title. Safe to drop into a template string.
 *
 * @param {unknown} value
 * @param {{ head?: number, tail?: number, label?: string, className?: string, empty?: string }} [opts]
 *   `label` prefixes the spoken form ("Your wallet address", "Recipient").
 * @returns {string}
 */
export function addressHtml(value, { head = 4, tail = 4, label = '', className = '', empty = '' } = {}) {
	if (value == null || value === '') return escapeHtml(empty);
	const full = String(value);
	const spoken = spokenAddress(full);
	const prefix = label ? `${escapeHtml(label)}: ` : '';
	const cls = ['w3-addr', className].filter(Boolean).join(' ');
	return (
		`<span class="${escapeHtml(cls)}" title="${escapeHtml(full)}" translate="no">` +
		`<span aria-hidden="true">${escapeHtml(shortAddress(full, head, tail))}</span>` +
		`<span style="${VISUALLY_HIDDEN}">${prefix}${escapeHtml(spoken)}</span>` +
		`</span>`
	);
}

/**
 * DOM form of `addressHtml`.
 *
 * @param {unknown} value
 * @param {Parameters<typeof addressHtml>[1]} [opts]
 * @returns {HTMLElement}
 */
export function addressElement(value, opts = {}) {
	const tpl = document.createElement('template');
	tpl.innerHTML = addressHtml(value, opts);
	return /** @type {HTMLElement} */ (tpl.content.firstElementChild || document.createElement('span'));
}
