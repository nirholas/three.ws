// One tool registry over three sources:
//   local   files, shell, web fetch on this machine (tools/local.js)
//   remote  the three.ws MCP servers (mcp.js)
//   extra   tools the host adds for this session (subagents, Telegram delivery)
//
// Local and extra tools are always offered. Remote servers expose far more
// tools than a model should see at once, so each turn offers the top
// `maxTools` by relevance to the latest request (the runtime's
// ToolRelevanceScorer), plus every remote tool already used in the session.
// A remote tool with the same name as a local one is dropped in favor of the
// remote one when it is a platform gateway tool (web_fetch), otherwise local wins.

import { ToolRelevanceScorer } from '@three-ws/agent-runtime';

// Remote tools that supersede a local tool of the same name when mounted.
const REMOTE_PREFERRED = new Set(['web_fetch']);

function schemaOf(tool) {
	return {
		type: 'function',
		function: {
			name: tool.name,
			description: String(tool.description || '').slice(0, 1024),
			parameters: tool.parameters || { type: 'object', properties: {} },
		},
	};
}

/**
 * @param {{ local?: object[], remote?: { tools: Map, call: Function } | null, extra?: object[], maxTools?: number }} o
 */
export function createToolset({ local = [], remote = null, extra = [], maxTools = 24 }) {
	const entries = new Map();
	const add = (t) => entries.set(t.name, t);

	for (const t of local) {
		if (remote?.tools?.has(t.name) && REMOTE_PREFERRED.has(t.name)) continue;
		add({ ...t, source: 'local', run: (args, ctx) => t.handler(args, ctx) });
	}
	for (const t of extra) add({ ...t, source: 'extra', run: (args, ctx) => t.handler(args, ctx) });
	for (const [name, t] of remote?.tools || []) {
		if (entries.has(name)) continue;
		add({
			name,
			description: t.description,
			parameters: t.inputSchema,
			toolClass: t.toolClass,
			server: t.server,
			source: 'remote',
			run: (args, ctx) => remote.call(name, args, { signal: ctx?.signal }),
		});
	}

	const scorer = new ToolRelevanceScorer({ maxTools, minScore: 0.3 });

	function remoteEntries() {
		return [...entries.values()].filter((t) => t.source === 'remote');
	}

	return {
		get size() {
			return entries.size;
		},
		get(name) {
			return entries.get(name) || null;
		},
		all() {
			return [...entries.values()];
		},
		/**
		 * OpenAI tool schemas for one turn.
		 * @param {string} query   the latest user request
		 * @param {string[]} recent remote tool names already used in this session
		 */
		schemasFor(query, recent = []) {
			const always = [...entries.values()].filter((t) => t.source !== 'remote');
			const remotes = remoteEntries();
			const manifests = Object.fromEntries(remotes.map((t) => [t.name, { identifier: t.name, description: t.description }]));
			const picked = remotes.length ? scorer.scoreTools(String(query || ''), manifests, recent).slice(0, maxTools) : [];
			const names = new Set(picked.map((m) => m.identifier));
			for (const r of recent) if (entries.get(r)?.source === 'remote') names.add(r);
			return [...always, ...remotes.filter((t) => names.has(t.name))].map(schemaOf);
		},
	};
}
