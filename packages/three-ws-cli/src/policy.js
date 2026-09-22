// Which tools a server exposes through this CLI.
//
// Every three.ws tool carries MCP annotations that `npm run audit:mcp-safety`
// verifies against what the handler actually does, and the platform derives one
// safety class from them (scripts/build-mcp-catalog.mjs):
//   readOnlyHint: true        -> read       on by default
//   destructiveHint: true     -> financial  off by default (moves funds or cannot be undone)
//   anything else             -> write      on by default (changes state, reversible)
// The CLI classifies live tools/list results the same way, so a tool added to
// a server tomorrow lands in the right tier with no CLI release.
//
// A selection is { tiers, allow, deny }: whole tiers on, plus per-tool
// exceptions either way. It lives in the credential store under tools[slug].

export const TIERS = Object.freeze(['read', 'write', 'financial']);
export const DEFAULT_TIERS = Object.freeze(['read', 'write']);

export const TIER_LABELS = {
	read: 'Read-only',
	write: 'Changes state (reversible)',
	financial: 'Moves funds or irreversible',
};

export function tierOf(tool) {
	const a = tool?.annotations || {};
	if (a.readOnlyHint === true) return 'read';
	return a.destructiveHint === true ? 'financial' : 'write';
}

export function defaultSelection() {
	return { tiers: [...DEFAULT_TIERS], allow: [], deny: [] };
}

export function normalizeSelection(sel) {
	if (!sel || typeof sel !== 'object') return defaultSelection();
	return {
		tiers: Array.isArray(sel.tiers) ? sel.tiers.filter((t) => TIERS.includes(t)) : [...DEFAULT_TIERS],
		allow: Array.isArray(sel.allow) ? [...new Set(sel.allow.map(String))] : [],
		deny: Array.isArray(sel.deny) ? [...new Set(sel.deny.map(String))] : [],
	};
}

export function isEnabled(tool, selection) {
	const sel = normalizeSelection(selection);
	if (sel.deny.includes(tool.name)) return false;
	if (sel.allow.includes(tool.name)) return true;
	return sel.tiers.includes(tierOf(tool));
}

export function filterTools(tools, selection) {
	return (tools || []).filter((t) => isEnabled(t, selection));
}

export function isDefaultSelection(selection) {
	const sel = normalizeSelection(selection);
	return !sel.allow.length && !sel.deny.length && sel.tiers.length === DEFAULT_TIERS.length && DEFAULT_TIERS.every((t) => sel.tiers.includes(t));
}

/** Group a live tool list by tier, for the picker and `status`. */
export function groupByTier(tools) {
	const out = { read: [], write: [], financial: [] };
	for (const t of tools || []) out[tierOf(t)].push(t);
	return out;
}

// The `X-Three-Tools` request header (docs/cli.md) carries the enabled tool
// names for a direct HTTP entry, where no local proxy sits in between to filter.
export const TOOLS_HEADER = 'X-Three-Tools';

export function headerValue(tools, selection) {
	return filterTools(tools, selection).map((t) => t.name).sort().join(',');
}
