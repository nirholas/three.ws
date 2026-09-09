/**
 * The home lane's i18n bridge.
 *
 * Every page in this lane ships its static copy annotated with `data-i18n`, and
 * /i18n.js swaps it at runtime (src/i18n.js). That covers the shell and misses
 * the house: the rooms, the devices, the refusals, the confirmations and every
 * spoken announcement are assembled in JS from live data, so none of it was
 * reachable by the translation layer and all of it rendered in English in all
 * 84 locales.
 *
 * This is the same bridge /play already uses (src/game/i18n-play.js), kept as a
 * separate module rather than imported across surfaces because the two lanes
 * ship in different bundles and neither should pull the other's graph.
 *
 * ── The rule that matters here ──────────────────────────────────────────────
 *
 * A room name, an area name, a scene name and a device name are the USER's own
 * words. They are never translated, never extracted, and never concatenated
 * into a translatable string. They are passed as interpolated values:
 *
 *   t('home_scene.act_done', '{{name}}: {{action}}.', { name: object.name, ... })
 *
 * and never as
 *
 *   t('home_scene.act_done', `${object.name}: turned on.`)
 *
 * The second form would put somebody's "Nursery" into the source catalog, ship
 * it to a translation model, and hand back a machine-translated version of a
 * name they chose. The first cannot: the model only ever sees `{{name}}`, which
 * the masker in scripts/i18n-translate.mjs already protects byte for byte.
 *
 * `t()` never throws and never blocks. Before /i18n.js has loaded its catalog,
 * and on any surface that never boots the runtime at all, it returns the
 * English source the caller passed.
 */

/**
 * Translate a key, falling back to the English source string.
 * @param {string} key dot-path into the catalog, e.g. 'home_scene.cancelled'
 * @param {string} fallback the English source text, with {{vars}} placeholders
 * @param {Record<string, string|number>} [vars] interpolated values, including
 *   every piece of user data. Never bake user data into `fallback`.
 * @returns {string}
 */
export function t(key, fallback, vars) {
	const runtime = globalThis.threewsI18n;
	if (runtime?.t) {
		const hit = runtime.t(key, vars);
		// The runtime echoes the key back on a total miss (no translation in the
		// active locale and none in the English catalog either). That is a key we
		// have not shipped yet, so the caller's source string is used rather than
		// printing "home_scene.cancelled" at somebody standing in their kitchen.
		if (hit && hit !== key) return hit;
	}
	return interpolate(fallback, vars);
}

/**
 * Pick a form by count and translate it. English has two; the catalog carries
 * the same two keys for every locale, and a locale whose plural rules need more
 * than two forms says so in ITS translation of each key rather than in string
 * concatenation here.
 *
 * @param {string} key base key; `.one` and `.other` are appended
 * @param {number} count
 * @param {string} one English source for the singular
 * @param {string} other English source for the plural, with {{count}}
 * @param {Record<string, string|number>} [vars]
 */
export function plural(key, count, one, other, vars) {
	const merged = { count: formatNumber(count), ...vars };
	return count === 1 ? t(`${key}.one`, one, merged) : t(`${key}.other`, other, merged);
}

/**
 * A number in the reader's own locale: 1,024 in English, 1 024 in French,
 * ١٬٠٢٤ in Arabic. Never `String(n)`, which is English for every locale that
 * groups or digits differently.
 */
export function formatNumber(value) {
	const n = Number(value);
	if (!Number.isFinite(n)) return String(value);
	try {
		return new Intl.NumberFormat(locale()).format(n);
	} catch {
		return String(n);
	}
}

/** The locale the site is currently displayed in, or the document's own. */
export function locale() {
	try {
		return globalThis.threewsI18n?.getLocale?.() || document?.documentElement?.lang || 'en';
	} catch {
		return 'en';
	}
}

/**
 * "2 minutes ago", in the reader's language, through Intl.RelativeTimeFormat.
 *
 * Not three catalog keys with an English `s` suffix bolted on: that spelling of
 * a plural is wrong in most of the 84 locales this ships in, and several need
 * forms English has no word for. The platform already knows all of them, and
 * the browser ships the data.
 *
 * Lives here rather than in one surface because two of them need the same
 * sentence: the live scene says how old its last frame is, and the manage view
 * says when each house last answered. A second copy is a second set of plural
 * rules to get wrong.
 *
 * @param {number} ms milliseconds since the moment being described. Negative
 *   input is clamped to zero: a clock skew must never print a future tense for
 *   something that already happened.
 */
export function relativeAge(ms) {
	const s = Math.max(0, Math.round(ms / 1000));
	const [value, unit] = s < 60
		? [s, 'second']
		: s < 3600
			? [Math.round(s / 60), 'minute']
			: s < 86_400
				? [Math.round(s / 3600), 'hour']
				: [Math.round(s / 86_400), 'day'];
	try {
		return new Intl.RelativeTimeFormat(locale(), { numeric: 'always' }).format(-value, unit);
	} catch {
		// Intl.RelativeTimeFormat is absent only on browsers this product does
		// not otherwise run on, so English here is a last resort, not a lane.
		return `${value} ${unit}${value === 1 ? '' : 's'} ago`;
	}
}

/**
 * Run `fn` whenever the visitor changes language, so a panel holding
 * interpolated copy can re-render itself. Returns an unsubscribe function.
 * @param {() => void} fn
 * @returns {() => void}
 */
export function onLocaleChange(fn) {
	if (typeof fn !== 'function' || typeof window === 'undefined') return () => {};
	const handler = () => fn();
	window.addEventListener('i18n:change', handler);
	return () => window.removeEventListener('i18n:change', handler);
}

function interpolate(str, vars) {
	if (typeof str !== 'string' || !vars) return str;
	return str.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
}
