/**
 * Which avatars and agents are worth asking a search engine to index.
 * ------------------------------------------------------------------
 * Onboarding creates an entity before its owner has said anything about it, and
 * a lot of owners stop there. Measured 2026-09-07: 1,163 of the 3,397 public
 * agents were still named "My First Agent" and 1,158 of those still carried the
 * starter description verbatim. Those pages are not thin, they are *identical*,
 * and no amount of server-side rendering can tell them apart.
 *
 * Submitting them costs twice. They cannot rank, and a duplicate cluster that
 * large drags the pages that could rank down with it (Search Console filed
 * 18,768 URLs under "Duplicate without user-selected canonical" before this).
 *
 * So the untouched ones stay out of the sitemap and their crawler page is served
 * `noindex, follow`. Nothing else changes: the page still renders, still unfurls
 * with the entity's own card, and still links onward. The moment an owner gives
 * it a name or a description it becomes indexable, with no migration and no
 * backfill. That is why the rule reads the row rather than storing a flag.
 *
 * Both the sitemap and the crawler pages import from here so the two can never
 * disagree about what is indexable.
 */

/** Fold case, collapse whitespace, and normalise dash glyphs for comparison. */
function normalize(s) {
	return String(s ?? '')
		.replace(/[\u2010-\u2015]/g, '-')
		.trim()
		.replace(/\s+/g, ' ')
		.toLowerCase();
}

// Names the product hands out when nobody has chosen one. An entity keeping its
// default name is evidence of an untouched row, not of a name someone picked.
const DEFAULT_AGENT_NAMES = new Set([
	'my first agent',
	'my agent',
	'agent',
	'new agent',
	'untitled',
	'untitled agent',
]);

const DEFAULT_AVATAR_NAMES = new Set([
	'my first agent',
	'my avatar',
	'avatar',
	'new avatar',
	'untitled',
	'untitled avatar',
]);

// The description onboarding writes into a brand-new agent. Matched on its
// opening words so a trailing edit, or the dash glyph in the stored copy, does
// not let an untouched row through.
const STARTER_AGENT_DESCRIPTION = 'a friendly starter agent';

/**
 * True when this agent has enough of its own identity to deserve its own entry
 * in a search index.
 *
 * @param {{name?: string|null, description?: string|null}} agent
 * @returns {boolean}
 */
export function isIndexableAgent(agent) {
	const name = normalize(agent?.name);
	if (!name) return false;
	const description = normalize(agent?.description);
	const untouchedName = DEFAULT_AGENT_NAMES.has(name);
	const untouchedDescription = !description || description.startsWith(STARTER_AGENT_DESCRIPTION);
	// Either half being the owner's own work is enough: a custom description
	// under a default name still describes something specific, and vice versa.
	return !(untouchedName && untouchedDescription);
}

/**
 * True when this avatar has enough of its own identity to deserve its own entry
 * in a search index. Avatars carry a generated description and a tag set even
 * when the owner writes nothing, so only a default name with no prose at all
 * counts as untouched.
 *
 * @param {{name?: string|null, description?: string|null, alt_text?: string|null}} avatar
 * @returns {boolean}
 */
export function isIndexableAvatar(avatar) {
	const name = normalize(avatar?.name);
	if (!name) return false;
	if (!DEFAULT_AVATAR_NAMES.has(name)) return true;
	return Boolean(normalize(avatar?.description) || normalize(avatar?.alt_text));
}
