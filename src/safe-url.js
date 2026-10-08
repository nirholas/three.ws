/**
 * Returns `url` only if it is a same-origin relative path or an http(s) URL.
 * Anything else — `javascript:`, `data:`, `vbscript:`, blank, or non-string —
 * collapses to a safe placeholder, neutralising script-scheme injection in
 * `href`, `src`, and CSS `url(...)` sinks.
 *
 * Allowed: site-relative paths (`/` but not protocol-relative `//`, and with
 * no backslash or control character that a browser would normalize into one), `./`,
 * `../`, in-page anchors (`#`), or http(s) URLs (`^https?:`, case-insensitive,
 * after trimming surrounding whitespace).
 *
 * @param {unknown} url - candidate URL, typically user- or remote-controlled.
 * @param {string} [fallback='#'] - returned when `url` is rejected.
 * @returns {string} the original url if safe, otherwise `fallback`.
 */
export function safeUrl(url, fallback = '#') {
	if (typeof url !== 'string') return fallback;
	const trimmed = url.trim();
	if (!trimmed) return fallback;
	if (/^(?:\/(?!\/)|\.\/|\.\.\/|#)/.test(trimmed)) {
		// A backslash or a tab/newline inside a "relative" path is how one turns
		// protocol-relative: browsers read `/\evil.example` as `//evil.example`
		// and drop tab/CR/LF entirely, so `/\t/evil.example` lands off-site too.
		// eslint-disable-next-line no-control-regex
		if (/[\\\u0000-\u001f]/.test(trimmed)) return fallback;
		return url;
	}
	if (/^https?:/i.test(trimmed)) return url;
	return fallback;
}
