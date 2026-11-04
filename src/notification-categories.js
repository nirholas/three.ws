// Category resolution for the /notifications page (src/notifications-page.js).
//
// The authoritative type to category map and the category list live in
// api/_lib/notify-prefs.js and are served by GET /api/notifications/preferences
// (`type_categories`, `categories`). The page fetches them once at boot and
// passes them in here, so it never keeps its own copy that can drift.
//
// Pure functions only: no DOM, no network, so the rules are unit-testable
// (tests/notifications-page-categories.test.js).

// `account` is the server's fallback category for any type it does not map,
// and the only tab the page can offer when the preferences fetch fails.
export const FALLBACK_CATEGORY = 'account';

export const FALLBACK_CATEGORIES = [
	{
		key: FALLBACK_CATEGORY,
		label: 'Account & security',
		description: 'Withdrawals, payment issues, and security-sensitive events.',
	},
];

// The category a notification type belongs to under `map` (the server's
// type_categories). Unknown types, and every type when the map is missing,
// resolve to the fallback category, matching categoryForType() on the server.
export function categoryOf(type, map) {
	if (!map || typeof type !== 'string') return FALLBACK_CATEGORY;
	if (!Object.prototype.hasOwnProperty.call(map, type)) return FALLBACK_CATEGORY;
	const category = map[type];
	return typeof category === 'string' && category ? category : FALLBACK_CATEGORY;
}

// The category tabs to show, in the server's order: every category that has
// at least one loaded row, plus the active one (so a selection never vanishes
// when its last row is deleted), plus any key in `always`. "All" is not part
// of this list; the page always renders it first.
export function visibleTabs(categories, rows, active, map, { always = [] } = {}) {
	const present = new Set(always);
	if (active) present.add(active);
	for (const row of rows || []) present.add(categoryOf(row?.type, map));
	return (categories || [])
		.filter((c) => c && typeof c.key === 'string' && present.has(c.key))
		.map((c) => ({ key: c.key, label: c.label || c.key, description: c.description || '' }));
}
