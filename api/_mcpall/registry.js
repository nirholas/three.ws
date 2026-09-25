// The unified MCP registry: every tool from every hosted three.ws MCP server,
// mounted once under a group-namespaced name, for https://three.ws/mcp.
//
// Built from api/_mcpall/sources.js (each source reads its own server's
// catalog, handlers, pricing and access rules) and the @three-ws/mcp-policy
// table (each tool's group and tier). Nothing is copied: a tool added to any
// legacy server appears here on the next boot with the same schema, handler
// and price, which is what keeps the seven legacy endpoints thin views of one
// registry.
//
// Naming: a tool is published as `<group>_<name>` (`assets_inspect_model`,
// `x402_find_services`), or under its own name when that already starts with
// its group (`wallet_status`, `x402_preflight`). The legacy name stays
// callable as an alias whenever it names exactly one unified tool.
//
// Collision detection: two servers that publish the same unified name with
// different handlers are a boot failure, unless the pair is declared in
// SHADOWED below with the source that wins and why. Two servers sharing one
// handler module (the model tools on /api/mcp and /api/mcp-3d) are one tool.
// `npm run check:mcp-tools` runs the same build and also fails on a tool with
// no group or tier and on a name MCP clients reject.

import { POLICY, GROUPS } from '@three-ws/mcp-policy';

import { SOURCES } from './sources.js';

/** The unified server's id in the policy runtime and the resource registry. */
export const UNIFIED_SERVER = 'threews-unified';
export const UNIFIED_RESOURCE_SERVER = 'mcp-all';
export const UNIFIED_ENDPOINT = 'https://three.ws/mcp';
export const UNIFIED_ROUTE = '/api/mcp/all';

// Tool names every major MCP client accepts (the Anthropic and OpenAI tool
// name grammar is the strictest of them).
export const TOOL_NAME_RE = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * Declared duplicates: the same tool defined twice by two servers with
 * separate handlers. The unified server mounts the `by` source's copy. Each
 * entry must still describe a real duplicate, or the check fails, so this list
 * cannot rot into a blanket exemption.
 */
export const SHADOWED = Object.freeze([
	{
		source: 'mcp-3d',
		by: 'mcp-studio',
		tools: ['create_agent_persona', 'get_agent_persona', 'persona_say'],
		reason:
			'The paid 3D studio and the free studio each ship the persona tools over the same persona store. ' +
			'The free copy is keyless and IP rate-limited, so it serves signed-in and anonymous callers alike.',
	},
]);

/** Tools the unified server serves itself instead of mounting a source's copy. */
export const OWN_TOOL_NAMES = Object.freeze(['utility_getting_started', 'utility_read_resource']);

/** `<group>_<name>`, or the name itself when it already leads with its group. */
export function unifiedName(group, name) {
	if (!group) return name;
	return name === group || name.startsWith(`${group}_`) ? name : `${group}_${name}`;
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * A function that rewrites legacy tool names inside prose to their unified
 * names. Only names with an underscore are rewritten, so a plain word such as
 * "remember" in a sentence is never touched.
 * @param {Map<string,string>} map legacy -> unified
 */
export function makeRenamer(map) {
	const names = [...map.keys()].filter((n) => n.includes('_') && map.get(n) !== n).sort((a, b) => b.length - a.length);
	if (!names.length) return (text) => text;
	const re = new RegExp(`(?<![A-Za-z0-9_])(${names.map(escapeRe).join('|')})(?![A-Za-z0-9_])`, 'g');
	return (text) => (typeof text === 'string' ? text.replace(re, (m) => map.get(m) || m) : text);
}

/** Apply a renamer to the text blocks of a tool result. */
export function renameResult(result, rename) {
	if (!result || typeof result !== 'object' || !Array.isArray(result.content)) return result;
	return {
		...result,
		content: result.content.map((block) =>
			block && block.type === 'text' && typeof block.text === 'string' ? { ...block, text: rename(block.text) } : block,
		),
	};
}

/**
 * Build the registry. Pure over its inputs, so tests can feed synthetic
 * sources to prove a collision fails.
 *
 * @param {{ sources?: object[], policy?: object, shadowed?: object[], ownTools?: object[] }} [opts]
 *   ownTools: [{ name, group, tier, def, run }] served by the unified server.
 * @returns {{
 *   tools: object[], byName: Map<string, object>, aliases: Map<string, string[]>,
 *   policyTable: Record<string, object>, groupScopes: Map<string, Set<string>>,
 *   problems: { kind: string, message: string }[]
 * }}
 */
export function buildRegistry({ sources = SOURCES, policy = POLICY, shadowed = SHADOWED, ownTools = [] } = {}) {
	const problems = [];
	const shadowIndex = new Map();
	for (const s of shadowed) for (const t of s.tools) shadowIndex.set(`${s.source}:${t}`, s);
	const shadowUsed = new Set();

	const candidates = [];
	for (const source of sources) {
		const rows = policy[source.policyServer];
		if (!rows) {
			problems.push({ kind: 'no_policy_server', message: `${source.id}: no policy table for server "${source.policyServer}"` });
			continue;
		}
		for (const tool of source.tools()) {
			const legacy = tool.def?.name;
			const row = Object.hasOwn(rows, legacy) ? rows[legacy] : null;
			if (!row || !row.group || !['read', 'write', 'financial'].includes(row.tier || 'read')) {
				problems.push({
					kind: 'missing_policy',
					message: `${source.id}: tool "${legacy}" has no group and tier in packages/mcp-policy/src/table.js (server "${source.policyServer}")`,
				});
				continue;
			}
			candidates.push({ source, tool, legacy, row, name: unifiedName(row.group, legacy) });
		}
	}

	// Resolve duplicates by unified name.
	const kept = new Map();
	for (const c of candidates) {
		const prev = kept.get(c.name);
		if (!prev) {
			kept.set(c.name, { ...c, alsoOn: [] });
			continue;
		}
		if (prev.tool.impl && prev.tool.impl === c.tool.impl) {
			prev.alsoOn.push(c.source.id);
			continue;
		}
		const prevShadow = shadowIndex.get(`${prev.source.id}:${prev.legacy}`);
		const curShadow = shadowIndex.get(`${c.source.id}:${c.legacy}`);
		if (prevShadow && prevShadow.by === c.source.id) {
			shadowUsed.add(`${prev.source.id}:${prev.legacy}`);
			kept.set(c.name, { ...c, alsoOn: [...prev.alsoOn, prev.source.id] });
			continue;
		}
		if (curShadow && curShadow.by === prev.source.id) {
			shadowUsed.add(`${c.source.id}:${c.legacy}`);
			prev.alsoOn.push(c.source.id);
			continue;
		}
		problems.push({
			kind: 'collision',
			message:
				`duplicate tool "${c.name}": ${prev.source.id} (${prev.source.endpoint}) and ${c.source.id} (${c.source.endpoint}) ` +
				`both define "${c.legacy}" with separate handlers. Rename one, share one handler module, or declare the pair in SHADOWED (api/_mcpall/registry.js).`,
		});
	}
	for (const key of shadowIndex.keys()) {
		if (!shadowUsed.has(key)) {
			problems.push({ kind: 'stale_shadow', message: `SHADOWED names ${key}, which no longer duplicates another server's tool. Remove it from the list.` });
		}
	}

	// Legacy -> unified maps: one global (unambiguous names only), one per source.
	const aliases = new Map();
	const perSource = new Map();
	for (const k of kept.values()) {
		const list = aliases.get(k.legacy) || [];
		if (!list.includes(k.name)) list.push(k.name);
		aliases.set(k.legacy, list);
		for (const sid of [k.source.id, ...k.alsoOn]) {
			if (!perSource.has(sid)) perSource.set(sid, new Map());
			perSource.get(sid).set(k.legacy, k.name);
		}
	}
	for (const own of ownTools) {
		const legacy = own.legacyName;
		if (legacy) aliases.set(legacy, [own.name]);
	}
	const globalMap = new Map([...aliases].filter(([, v]) => v.length === 1).map(([k, v]) => [k, v[0]]));
	const renamers = new Map();
	const renamerFor = (sourceId) => {
		if (!renamers.has(sourceId)) renamers.set(sourceId, makeRenamer(new Map([...globalMap, ...(perSource.get(sourceId) || [])])));
		return renamers.get(sourceId);
	};

	const tools = [];
	const policyTable = {};
	const groupScopes = new Map(GROUPS.map((g) => [g.id, new Set()]));

	for (const own of ownTools) {
		if (kept.has(own.name)) problems.push({ kind: 'collision', message: `duplicate tool "${own.name}": the unified server's own tool and ${kept.get(own.name).source.id}` });
		policyTable[own.name] = { group: own.group, tier: own.tier };
		tools.push({ ...own, legacyName: own.legacyName || null, source: 'unified', sourceTitle: 'three.ws', endpoint: UNIFIED_ROUTE, scope: null, alsoOn: [], isPublic: true, price: () => null, before: null, requiresPrincipal: false });
	}

	for (const k of kept.values()) {
		const rename = renamerFor(k.source.id);
		const srcMap = perSource.get(k.source.id);
		const row = { ...k.row };
		if (row.previewTool) {
			const previewRow = policy[k.source.policyServer]?.[row.previewTool];
			row.previewTool = srcMap?.get(row.previewTool) || unifiedName(previewRow?.group || row.group, row.previewTool);
		}
		policyTable[k.name] = row;
		if (k.tool.scope) groupScopes.get(row.group)?.add(k.tool.scope);
		const def = k.tool.def;
		tools.push({
			name: k.name,
			legacyName: k.legacy,
			group: row.group,
			tier: row.tier || 'read',
			scope: k.tool.scope || null,
			source: k.source.id,
			sourceTitle: k.source.title,
			endpoint: k.source.endpoint,
			alsoOn: k.alsoOn,
			def: {
				...def,
				name: k.name,
				...(def.description ? { description: rename(def.description) } : {}),
				_meta: { ...(def._meta || {}), 'three.ws/source': { server: k.source.id, endpoint: k.source.endpoint, name: k.legacy } },
			},
			rename,
			run: k.tool.run,
			impl: k.tool.impl,
			isPublic: Boolean(k.source.isPublic(k.legacy)),
			price: (args) => k.source.x402Amount(k.legacy, args) || null,
			before: k.source.before ? (ctx) => k.source.before(k.legacy, ctx) : null,
			requiresPrincipal: Boolean(k.source.requiresPrincipal?.(k.legacy)),
		});
	}

	for (const t of tools) {
		if (!TOOL_NAME_RE.test(t.name)) {
			problems.push({ kind: 'invalid_name', message: `tool "${t.name}" (${t.source}) is not a valid MCP tool name for every client: ${TOOL_NAME_RE}` });
		}
	}

	tools.sort((a, b) => a.group.localeCompare(b.group) || a.name.localeCompare(b.name));
	return { tools, byName: new Map(tools.map((t) => [t.name, t])), aliases, policyTable, groupScopes, problems };
}

/** A registry problem that must stop the server from booting. */
export function bootProblems(problems) {
	return problems.filter((p) => p.kind === 'collision' || p.kind === 'invalid_name');
}

/**
 * The public summary of a registry: what /mcp prints, what docs/mcp.md
 * embeds, and what the consent screen reads. Deterministic, so a committed
 * copy can be checked for staleness.
 */
export function summarize(registry) {
	const tierCounts = (list) => ({
		read: list.filter((t) => t.tier === 'read').length,
		write: list.filter((t) => t.tier === 'write').length,
		financial: list.filter((t) => t.tier === 'financial').length,
	});
	const bySource = new Map();
	for (const t of registry.tools) bySource.set(t.source, (bySource.get(t.source) || 0) + 1);
	const groups = GROUPS.map((g) => {
		const list = registry.tools.filter((t) => t.group === g.id);
		return {
			id: g.id,
			label: g.label,
			summary: g.summary,
			tools: list.length,
			tiers: tierCounts(list),
			scopes: [...(registry.groupScopes.get(g.id) || [])].sort(),
		};
	}).filter((g) => g.tools > 0);
	const tiers = tierCounts(registry.tools);
	return {
		$comment: 'Generated by `npm run build:mcp-unified` from api/_mcpall/registry.js. Do not edit by hand; `npm run check:mcp-tools` fails when it is stale.',
		endpoint: UNIFIED_ENDPOINT,
		route: UNIFIED_ROUTE,
		tool_count: registry.tools.length,
		default_tool_count: tiers.read + tiers.write,
		tiers,
		groups,
		sources: SOURCES.map((s) => ({ id: s.id, title: s.title, endpoint: s.endpoint, tools: bySource.get(s.id) || 0 })),
		tools: registry.tools.map((t) => ({
			name: t.name,
			legacy: t.legacyName,
			group: t.group,
			tier: t.tier,
			source: t.source,
			scope: t.scope,
			public: t.isPublic,
			title: t.def?.title || t.def?.annotations?.title || null,
		})),
	};
}
