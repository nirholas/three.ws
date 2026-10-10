// The MCP census: how many tools, resources, resource templates and prompts
// every hosted three.ws MCP endpoint serves, computed from the same modules the
// endpoints answer tools/list, resources/list and prompts/list from.
//
// Nothing here is a hand-kept number. The build (scripts/build-mcp-catalog.mjs)
// runs this to bake the totals into public/mcp-catalog.json and public/tools.json,
// and GET /api/mcp-census runs it again at request time, so a reader can see the
// build-time totals and the live ones side by side.
//
// How each number is calculated (published verbatim as CENSUS_METHOD):
//   tools      the endpoint's full tools/list catalog: every tool it can serve.
//              A financial-tier tool is still counted even though the policy
//              hides it until the session enables it (`defaultOn` counts the
//              tools a fresh session sees without changing any setting).
//   resources  static resources/list entries (a fixed URI).
//   templates  resources/templates/list entries (a URI with a {placeholder}).
//   prompts    prompts/list entries, rendered against the endpoint's own catalog.
//   unique     distinct tool names across every endpoint: /api/mcp-chatgpt and
//              /api/mcp-grok serve subsets of /api/mcp-studio, so the per-server
//              figures overlap and the unique figure is the honest headline.
//
// The stdio npm packages are not importable from the API runtime, so their
// figures come from scripts/lib/mcp-enumerate.mjs at build time, which loads
// each package's server in-process and asks it over an in-memory MCP transport.

import { TOOL_CATALOG as MAIN_CATALOG } from '../_mcp/catalog.js';
import { TOOL_CATALOG as AGENT_CATALOG } from '../_mcpagent/catalog.js';
import { TOOL_CATALOG as STUDIO_PAID_CATALOG } from '../_mcp3d/catalog.js';
import { TOOL_CATALOG as BAZAAR_CATALOG } from '../_mcpbazaar/catalog.js';
import { TOOL_CATALOG as IBM_CATALOG } from '../_mcpibm/catalog.js';
import { VIEWER_TOOLS } from './viewer-mcp-tools.js';
import { resourcesFor } from '../_mcp/resources.js';
import { promptsFor } from '../_mcp/prompts.js';
import { POLICY } from '../../packages/mcp-policy/src/table.js';
import { DEFAULT_TIERS } from '../../packages/mcp-policy/src/groups.js';

const ORIGIN = 'https://three.ws';

/**
 * The when-to-use line every tool description must carry: a sentence that
 * opens with "Use this when / to / for / before / after / instead ...", "Use
 * when ...", or "Call this first / when / before ...". Agents pick tools from
 * descriptions alone, so the sentence that says when this tool is the right
 * one is required, not optional. tests/mcp-tool-quality.test.js enforces it on
 * every tool of every server, and the per-tool pages on /mcp-tools lift it out
 * as the tool's summary.
 */
export const WHEN_TO_USE_RE =
	/(?:^|[.!?:;)]\s+|\n)((?:Use (?:this tool |this |it )?(?:when|to|for|before|after|instead|first|if|once|whenever)|Call (?:this tool |this |it )?(?:when|first|before|after|once|whenever))\b[^\n]*?(?:[.!?](?=\s|$)|$))/;

/** The when-to-use sentence of a description, or null when it has none. */
export function whenToUse(description) {
	const m = WHEN_TO_USE_RE.exec(String(description || ''));
	return m ? m[1].trim() : null;
}

export const CENSUS_METHOD = [
	'Computed, never typed: each hosted endpoint is counted by importing the exact catalog, resource table and prompt set it serves, and each stdio package by loading its server in-process and calling tools/list, resources/list and prompts/list over an in-memory MCP transport.',
	'tools: every tool an endpoint can serve, including financial-tier tools the policy hides until a session enables them (defaultOn is what a fresh session sees).',
	'resources: fixed-URI resources/list entries. templates: resources/templates/list entries. prompts: prompts/list entries rendered against that endpoint\'s own catalog.',
	'unique: distinct tool names across all servers. /api/mcp-chatgpt and /api/mcp-grok serve subsets of /api/mcp-studio, so per-server figures overlap and unique is the headline total.',
	'Recomputed on every build (public/mcp-catalog.json, public/tools.json) and on every request to /api/mcp-census; npm run check:mcp-counts fails the gate when a doc quotes a number that no longer matches.',
].join(' ');

/**
 * The hosted endpoints, in the order they are published. `policy` is the
 * @three-ws/mcp-policy server id whose tiers decide defaultOn; `resourceServer`
 * and `promptServer` are the ids api/_mcp/resources.js and prompts.js key on.
 */
export const HOSTED_ENDPOINTS = Object.freeze([
	{ id: 'mcp', title: 'three.ws', endpoint: '/api/mcp', policy: 'three.ws', resourceServer: 'mcp', promptServer: 'mcp' },
	{ id: 'mcp-agent', title: 'Agent Wallet', endpoint: '/api/mcp-agent', policy: 'threews-agent', resourceServer: 'mcp-agent', promptServer: 'mcp-agent' },
	{ id: 'mcp-3d', title: '3D Studio', endpoint: '/api/mcp-3d', policy: 'threews-3d-studio', resourceServer: 'mcp-3d', promptServer: 'mcp-3d' },
	{ id: 'mcp-bazaar', title: 'x402 Bazaar', endpoint: '/api/mcp-bazaar', policy: 'threews-x402-bazaar', resourceServer: 'mcp-bazaar', promptServer: 'mcp-bazaar' },
	{ id: 'ibm-mcp', title: 'IBM Granite', endpoint: '/api/ibm-mcp', policy: 'ibm-x402-mcp-remote' },
	{ id: 'mcp-studio', title: '3D Studio (free)', endpoint: '/api/mcp-studio', policy: 'threews-3d-studio-free', surface: 'full', promptServer: 'mcp-studio' },
	{ id: 'mcp-chatgpt', title: '3D Studio for ChatGPT', endpoint: '/api/mcp-chatgpt', policy: 'threews-3d-studio-free', surface: 'chatgpt' },
	{ id: 'mcp-grok', title: '3D Studio for Grok', endpoint: '/api/mcp-grok', policy: 'threews-3d-studio-free', surface: 'grok', promptServer: 'mcp-grok' },
	{ id: 'pump-fun-mcp', title: 'pump.fun data', endpoint: '/api/pump-fun-mcp', policy: 'threews-pumpfun' },
	{ id: 'chat-mcp', title: 'Viewer Control', endpoint: '/api/chat/mcp' },
]);

const STATIC_CATALOGS = {
	mcp: MAIN_CATALOG,
	'mcp-agent': AGENT_CATALOG,
	'mcp-3d': STUDIO_PAID_CATALOG,
	'mcp-bazaar': BAZAAR_CATALOG,
	'ibm-mcp': IBM_CATALOG,
	'chat-mcp': VIEWER_TOOLS,
};

// The studio surfaces and pump.fun server pull heavier graphs (widget HTML,
// the pump.fun handler table), so they load on first census, not at import.
async function loadDynamicCatalogs() {
	const [studio, pump] = await Promise.all([import('../_mcp-studio/dispatch.js'), import('../pump-fun-mcp.js')]);
	return { studio, pump };
}

function isDefaultOn(policyRows, name) {
	const row = policyRows?.[name];
	return !row || DEFAULT_TIERS.includes(row.tier);
}

/**
 * Every hosted endpoint with its live tool, resource, template and prompt
 * lists. Tools are the wire descriptors exactly as tools/list returns them.
 * @returns {Promise<Array<{id,title,endpoint,url,policy,tools,resources,templates,prompts,indexerTools?}>>}
 */
export async function hostedServers() {
	const { studio, pump } = await loadDynamicCatalogs();
	return HOSTED_ENDPOINTS.map((ep) => {
		let tools;
		let resources = [];
		let templates = [];
		let indexerTools = null;
		if (ep.surface) {
			tools = studio.toolCatalogFor(ep.surface);
			resources = studio.resourcesForSurface(ep.surface);
		} else if (ep.id === 'pump-fun-mcp') {
			const all = pump.listAllPumpFunTools();
			tools = all.map((t) => t.tool);
			indexerTools = all.filter((t) => t.indexer).map((t) => t.tool.name);
		} else {
			tools = STATIC_CATALOGS[ep.id];
		}
		if (ep.resourceServer) {
			const defs = resourcesFor(ep.resourceServer);
			resources = defs.filter((d) => d.uri).map((d) => ({ uri: d.uri, name: d.name, title: d.title }));
			templates = defs.filter((d) => d.uriTemplate).map((d) => ({ uriTemplate: d.uriTemplate, name: d.name, title: d.title }));
		}
		const prompts = ep.promptServer && (!ep.surface || studio.surfaceServesPrompts(ep.surface))
			? promptsFor(ep.promptServer, tools).map((p) => ({ name: p.name, title: p.title }))
			: [];
		return {
			...ep,
			url: `${ORIGIN}${ep.endpoint}`,
			tools,
			resources,
			templates,
			prompts,
			...(indexerTools ? { indexerTools } : {}),
		};
	});
}

/** Collapse one server's lists into its published counts. */
export function countServer(server) {
	const rows = POLICY[server.policy] || {};
	const tools = server.tools || [];
	return {
		id: server.id,
		title: server.title,
		endpoint: server.endpoint,
		transport: server.transport || 'remote',
		tools: tools.length,
		defaultOn: tools.filter((t) => isDefaultOn(rows, t.name)).length,
		readOnly: tools.filter((t) => t.annotations?.readOnlyHint === true).length,
		destructive: tools.filter((t) => t.annotations?.destructiveHint === true).length,
		resources: (server.resources || []).length,
		templates: (server.templates || []).length,
		prompts: (server.prompts || []).length,
		...(server.indexerTools ? { indexerTools: server.indexerTools.length } : {}),
	};
}

/**
 * Totals over a list of counted servers. `unique` deduplicates tool, resource
 * and prompt names across servers (several endpoints share a name on purpose).
 */
export function totalsFor(servers, countedRows) {
	const sum = (k) => countedRows.reduce((n, r) => n + (r[k] || 0), 0);
	const uniq = (pick) => new Set(servers.flatMap(pick)).size;
	return {
		servers: countedRows.length,
		tools: sum('tools'),
		uniqueTools: uniq((s) => (s.tools || []).map((t) => t.name)),
		resources: sum('resources'),
		uniqueResources: uniq((s) => (s.resources || []).map((r) => r.uri)),
		templates: sum('templates'),
		uniqueTemplates: uniq((s) => (s.templates || []).map((r) => r.uriTemplate)),
		prompts: sum('prompts'),
		uniquePrompts: uniq((s) => (s.prompts || []).map((p) => p.name)),
	};
}

/**
 * The hosted half of the census: per-endpoint counts and totals.
 * @returns {Promise<{ servers: object[], totals: object }>}
 */
export async function hostedCensus() {
	const servers = await hostedServers();
	const rows = servers.map(countServer);
	return { servers: rows, totals: totalsFor(servers, rows) };
}
