// Tier classification for tools that come from an external MCP server.
//
// Every external tool lands in one of the three tiers the platform's own tools
// use (packages/mcp-policy/src/groups.js):
//   read       changes nothing. Enabled on a new catalog connection.
//   write      changes something in the other system, reversibly. Off until
//              the agent owner enables that tool.
//   financial  moves money or cannot be undone (payments, refunds, deletes).
//              Off until the owner enables it AND acknowledges what it does.
//
// Precedence, first match wins:
//   1. the owner's per-tool override on the connection
//   2. the catalog entry's own rules (`tiers.financial|write|read` globs)
//   3. the default name rules below
//   4. the server's MCP annotations, but only to move a tool DOWN to write
//      when it says destructive: an external server can never talk its way into
//      the read tier, because annotations are the server's own claim about
//      itself and the whole point of the tier is not to trust that claim.
//   5. write, the conservative fallback: anything unrecognised starts off.
//
// Pure module: no I/O, so the catalog validator, the CLI and tests share it.

export const TIERS = Object.freeze(['read', 'write', 'financial']);

/** Default name rules, applied to the tool name split on `_`, `-`, `.` and camelCase. */
export const DEFAULT_RULES = Object.freeze({
	financial: [
		'pay', 'payment', 'payout', 'charge', 'refund', 'transfer', 'withdraw', 'purchase', 'buy', 'sell',
		'capture', 'checkout', 'swap', 'send_money', 'delete', 'remove', 'destroy', 'drop', 'purge',
		'erase', 'wipe', 'terminate', 'revoke', 'cancel_subscription', 'void', 'finalize_invoice',
	],
	read: [
		'get', 'list', 'search', 'read', 'fetch', 'find', 'query', 'describe', 'lookup', 'view', 'show',
		'retrieve', 'count', 'check', 'inspect', 'resolve', 'explain', 'summarize', 'ask', 'browse',
		'download', 'preview', 'status', 'whoami', 'validate', 'analyze', 'compare', 'diff', 'export',
		'docs', 'documentation', 'help', 'info', 'stats', 'history', 'logs',
	],
});

function words(name) {
	return String(name)
		.replace(/([a-z0-9])([A-Z])/g, '$1_$2')
		.toLowerCase()
		.split(/[^a-z0-9]+/)
		.filter(Boolean);
}

/** Glob match for catalog rules: `*` matches any run of characters, case-insensitive. */
export function globMatch(pattern, name) {
	const re = new RegExp(`^${String(pattern).split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`, 'i');
	return re.test(name);
}

function matchesAny(patterns, name) {
	return Array.isArray(patterns) && patterns.some((p) => globMatch(p, name));
}

/** Rule-word match: a single word must equal a tool-name word; a compound word must appear as a run. */
function hitsWord(ruleWords, toolWords) {
	const joined = `_${toolWords.join('_')}_`;
	return ruleWords.some((w) => (w.includes('_') ? joined.includes(`_${w}_`) : toolWords.includes(w)));
}

/**
 * Classify one tool.
 * @param {{ name: string, annotations?: object }} tool
 * @param {{ rules?: { read?: string[], write?: string[], financial?: string[] }, overrides?: Record<string,string> }} [opts]
 * @returns {{ tier: 'read'|'write'|'financial', source: 'override'|'catalog'|'name'|'annotation'|'default' }}
 */
export function classifyTool(tool, { rules = null, overrides = null } = {}) {
	const name = tool.name;
	const override = overrides?.[name];
	if (override && TIERS.includes(override)) return { tier: override, source: 'override' };

	if (rules) {
		if (matchesAny(rules.financial, name)) return { tier: 'financial', source: 'catalog' };
		if (matchesAny(rules.write, name)) return { tier: 'write', source: 'catalog' };
		if (matchesAny(rules.read, name)) return { tier: 'read', source: 'catalog' };
	}

	const w = words(name);
	if (hitsWord(DEFAULT_RULES.financial, w)) return { tier: 'financial', source: 'name' };
	const verb = w[0];
	const readVerb = DEFAULT_RULES.read.includes(verb) || (w.length === 1 && DEFAULT_RULES.read.includes(w[0]));
	if (readVerb) {
		if (tool.annotations?.destructiveHint === true) return { tier: 'write', source: 'annotation' };
		return { tier: 'read', source: 'name' };
	}
	return { tier: 'write', source: 'default' };
}

/**
 * Classify a whole tool list.
 * @returns {Array<{ name: string, description: string, inputSchema: object, annotations: object|null, tier: string, tierSource: string }>}
 */
export function classifyTools(tools, opts = {}) {
	return (tools || []).map((t) => {
		const { tier, source } = classifyTool(t, opts);
		return {
			name: t.name,
			title: t.title || t.annotations?.title || null,
			description: String(t.description || '').slice(0, 2000),
			inputSchema: t.inputSchema && typeof t.inputSchema === 'object' ? t.inputSchema : { type: 'object', properties: {} },
			annotations: t.annotations || null,
			tier,
			tierSource: source,
		};
	});
}

/** The tools a brand-new connection starts with enabled: read tier only, and none at all for a custom server. */
export function defaultEnabledTools(classified, { custom = false } = {}) {
	if (custom) return [];
	return classified.filter((t) => t.tier === 'read').map((t) => t.name);
}
