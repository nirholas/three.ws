#!/usr/bin/env node
// Generate public/mcp-catalog.json and public/tools.json: the machine-readable
// catalog of every MCP tool three.ws publishes, and the census of how many
// tools, resources, resource templates and prompts each server serves.
//
// Why generate it. The tool list, its prices, and its safety annotations were
// documented by hand, which meant several copies of the truth drifting apart
// quietly (READMEs said 15 and 16 while the servers mounted hundreds). This
// asks every server what it serves, so the catalog cannot be wrong about a
// tool that exists, and `npm run audit:mcp-catalog` fails the build when the
// committed files no longer match what the servers say.
//
// Where each field comes from:
//   - The server list, tool names, descriptions, annotations and input schemas
//     are the live tools/list payload: scripts/lib/mcp-enumerate.mjs imports
//     each hosted endpoint's catalog module and builds each stdio package's
//     server in-process, asking it over an in-memory MCP transport. Those
//     modules connect to nothing at import (their DB and RPC clients are lazy),
//     and the payload is byte-identical with and without .env.local loaded, so
//     a docs build does not depend on production.
//   - Prices are read statically from each server's TOOL_PRICING map, scoped to
//     the endpoint that charges them (PRICED_BY below).
//   - `source` and `inputSchemaIsPartial` come from the static read in
//     scripts/lib/mcp-schema.mjs: a bound that only exists in the deployed env
//     is flagged rather than reported as the empty-env default.
//   - The census (counts per server and totals) is api/_lib/mcp-census.js, the
//     same code GET /api/mcp-census runs at request time.
//
// The output serves two readers at once: the /mcp-tools page renders it, and an
// agent can fetch https://three.ws/mcp-catalog.json (everything, with schemas)
// or https://three.ws/tools.json (the census and a one-line index) to discover
// the whole surface in one request.
//
// Run: node scripts/build-mcp-catalog.mjs            (write both files)
//      node scripts/build-mcp-catalog.mjs --check     (exit 1 if either is out of date)

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'acorn';

import { ROOT, mcpToolSources } from './lib/mcp-tool-sources.mjs';
import { extractTools } from './lib/mcp-safety-check.mjs';
import { extractInputSchemas } from './lib/mcp-schema.mjs';
import { allServers } from './lib/mcp-enumerate.mjs';
import { countServer, totalsFor, whenToUse, CENSUS_METHOD } from '../api/_lib/mcp-census.js';
import { POLICY } from '../packages/mcp-policy/src/table.js';
import { GROUPS } from '../packages/mcp-policy/src/groups.js';

const OUT = join(ROOT, 'public', 'mcp-catalog.json');
const TOOLS_OUT = join(ROOT, 'public', 'tools.json');
const ORIGIN = 'https://three.ws';

// ---------------------------------------------------------------------------
// Which endpoint a static tool-definition file belongs to
// ---------------------------------------------------------------------------
// Only used to attach a tool's source file and partial-schema flag to the right
// server when two servers publish a tool of the same name.

const STATIC_ENDPOINTS = [
	[(f) => f.startsWith('api/_mcp/tools/') || f.startsWith('api/_lib/home/'), '/api/mcp'],
	[(f) => f.startsWith('api/_mcp3d/tools/'), '/api/mcp-3d'],
	[(f) => f.startsWith('api/_mcp-studio/'), '/api/mcp-studio'],
	[(f) => f.startsWith('api/_mcpagent/'), '/api/mcp-agent'],
	[(f) => f.startsWith('api/_mcpbazaar/'), '/api/mcp-bazaar'],
	[(f) => f.startsWith('api/_mcpibm/'), '/api/ibm-mcp'],
	[(f) => f === 'src/pump/mcp-tools.js', '/api/pump-fun-mcp'],
	[(f) => f.startsWith('mcp-server/'), 'mcp-server'],
];

function staticOwner(relPath) {
	const hit = STATIC_ENDPOINTS.find(([match]) => match(relPath));
	if (hit) return hit[1];
	return relPath.match(/^(packages\/[\w-]+-mcp)\//)?.[1] ?? null;
}

// The free studio's two sibling surfaces serve a subset of its catalog.
const SURFACE_PARENT = { '/api/mcp-chatgpt': '/api/mcp-studio', '/api/mcp-grok': '/api/mcp-studio' };

/** Who may call a server without setting anything up. */
const HOSTED_AUTH = {
	mcp: 'oauth-or-x402',
	'mcp-agent': 'oauth-or-x402',
	'mcp-3d': 'oauth-or-x402',
	// Shares the main server's OAuth/x402 gate (see api/mcp-bazaar.js): only
	// getting_started answers unauthenticated.
	'mcp-bazaar': 'oauth-or-x402',
	'ibm-mcp': 'x402',
	'mcp-studio': 'none',
	'mcp-chatgpt': 'none',
	'mcp-grok': 'none',
	'pump-fun-mcp': 'none',
	// Bearer-only (OAuth token or API key), the same issuer as /api/mcp.
	'chat-mcp': 'oauth',
};

// Stdio packages that run with no key at all; every other package reads a
// credential from its environment.
const STDIO_KEYLESS = new Set(['solana-memo-media-mcp']);

// ---------------------------------------------------------------------------
// Prices, read statically from the per-server price maps
// ---------------------------------------------------------------------------

// Each server keeps its per-tool price map in a const named TOOL_PRICING, and
// each map is charged by the endpoints that import it: api/mcp.js prices with
// pump-pricing, api/mcp-3d.js with the studio map, api/ibm-mcp.js and the
// ibm-x402-mcp package with the Granite map. A tool on any other server is free
// even when a priced tool elsewhere shares its name.
const PRICED_BY = {
	mcp: 'api/_lib/pump-pricing.js',
	'mcp-3d': 'api/_mcp3d/pricing.js',
	'ibm-mcp': 'api/_mcpibm/pricing.js',
	'ibm-x402-mcp': 'api/_mcpibm/pricing.js',
};

const TIER_SOURCE = 'api/_lib/forge-tiers.js';
const ATOMIC_PER_USD = 1_000_000;

/** Parse a module once. */
function parseFile(relPath) {
	const abs = join(ROOT, relPath);
	if (!existsSync(abs)) return null;
	return parse(readFileSync(abs, 'utf8'), { ecmaVersion: 'latest', sourceType: 'module' });
}

/** Find the object literal assigned to a named const. */
function findConstObject(ast, constName) {
	let found = null;
	walk(ast, (node) => {
		if (found) return;
		if (node.type === 'VariableDeclarator' && node.id?.name === constName) {
			found = unwrapFreeze(node.init);
		}
	});
	return found;
}

/**
 * The forge generation tiers, in price order. Two studio tools are priced per
 * tier rather than by a flat literal, so the catalog reads the real tier table
 * instead of reporting them free.
 * @returns {{id: string, usd: number}[]}
 */
function collectTiers() {
	const ast = parseFile(TIER_SOURCE);
	const tiers = ast && findConstObject(ast, 'TIERS');
	if (!tiers) return [];
	const out = [];
	for (const prop of tiers.properties) {
		if (prop.type !== 'Property' || prop.computed) continue;
		const entry = unwrapFreeze(prop.value);
		if (!entry) continue;
		for (const field of entry.properties) {
			if (field.type !== 'Property' || field.computed) continue;
			if ((field.key?.name ?? field.key?.value) !== 'priceUsdcAtomics') continue;
			if (field.value.type !== 'Literal') continue;
			out.push({
				id: prop.key?.name ?? prop.key?.value,
				usd: Number(field.value.value) / ATOMIC_PER_USD,
			});
		}
	}
	return out.sort((a, b) => a.usd - b.usd);
}

/**
 * Every priced tool, per price map. A tool absent from its server's map is
 * free, the convention the pricing modules themselves document. An entry whose
 * `amount_usdc` is computed rather than literal is tier-priced: it gets the
 * tier table and its default price, never a silent zero.
 * @returns {Map<string, Map<string, {usd: number, tiers?: {id: string, usd: number}[]}>>}
 */
function collectPrices() {
	const tiers = collectTiers();
	const defaultTier = tiers.find((t) => t.id === 'standard') ?? tiers[0] ?? null;
	const byFile = new Map();

	for (const file of new Set(Object.values(PRICED_BY))) {
		const prices = new Map();
		byFile.set(file, prices);
		const ast = parseFile(file);
		const mapNode = ast && findConstObject(ast, 'TOOL_PRICING');
		if (!mapNode) continue;

		for (const prop of mapNode.properties) {
			if (prop.type !== 'Property' || prop.computed) continue;
			const toolName = prop.key?.name ?? prop.key?.value;
			const entry = unwrapFreeze(prop.value);
			if (!entry || typeof toolName !== 'string') continue;

			const amount = entry.properties.find(
				(f) => f.type === 'Property' && !f.computed && (f.key?.name ?? f.key?.value) === 'amount_usdc',
			);
			if (!amount) continue;

			if (amount.value.type === 'Literal') {
				prices.set(toolName, { usd: Number(amount.value.value) });
			} else if (defaultTier) {
				prices.set(toolName, { usd: defaultTier.usd, tiers });
			} else {
				throw new Error(
					`${file}: ${toolName} has a computed amount_usdc and no tier table to resolve it against.`,
				);
			}
		}
	}
	return byFile;
}

function unwrapFreeze(node) {
	if (!node) return null;
	if (node.type === 'ObjectExpression') return node;
	if (
		node.type === 'CallExpression' &&
		node.callee.type === 'MemberExpression' &&
		node.callee.property?.name === 'freeze' &&
		node.arguments.length === 1
	) {
		return unwrapFreeze(node.arguments[0]);
	}
	return null;
}

function walk(node, visit) {
	if (!node || typeof node.type !== 'string') return;
	visit(node);
	for (const key of Object.keys(node)) {
		if (key === 'type' || key === 'start' || key === 'end') continue;
		const value = node[key];
		if (Array.isArray(value)) for (const child of value) walk(child, visit);
		else if (value && typeof value.type === 'string') walk(value, visit);
	}
}

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------

/**
 * How a caller should treat a tool, derived from its annotations. This is the
 * single label the UI sorts and filters on.
 * @returns {'read'|'write'|'irreversible'}
 */
function safetyClass({ readOnlyHint, destructiveHint }) {
	if (readOnlyHint === true) return 'read';
	return destructiveHint === true ? 'irreversible' : 'write';
}

/**
 * One canonical shape for every argument list: always an object schema with a
 * `properties` map, empty when the tool takes nothing. A tool whose schema could
 * not be read statically gets null, never an empty object that would read as
 * "confirmed: no arguments".
 * @param {object|null|undefined} schema
 */
function normalizeSchema(schema) {
	if (!schema) return null;
	if (schema.type && schema.type !== 'object') return schema;
	return { type: 'object', properties: {}, ...schema };
}

/**
 * The static read of every tool-definition file: for each tool name, where it
 * is declared and whether part of its schema only exists in the deployed env.
 * @returns {Map<string, {source: string, owner: string|null, partial: boolean}[]>}
 */
function staticIndex() {
	const index = new Map();
	for (const relPath of mcpToolSources()) {
		const { parseError, tools } = extractTools(relPath);
		if (parseError) throw new Error(`${relPath}: ${parseError}`);
		const schemas = extractInputSchemas(relPath);
		for (const tool of tools) {
			const read = schemas.get(tool.name);
			const entry = { source: relPath, owner: staticOwner(relPath), partial: Boolean(read?.dynamic?.length) };
			if (!index.has(tool.name)) index.set(tool.name, []);
			index.get(tool.name).push(entry);
		}
	}
	return index;
}

/** The static entry for a tool on a server, preferring the server's own files. */
function staticFor(index, server, name) {
	const found = index.get(name) || [];
	const owner = server.transport === 'stdio' ? (server.dir === 'mcp-server' ? 'mcp-server' : server.dir) : server.endpoint;
	return (
		found.find((e) => e.owner === owner) ||
		found.find((e) => e.owner === SURFACE_PARENT[server.endpoint]) ||
		(found.length === 1 ? found[0] : null)
	);
}

function serverRecord(server) {
	const remote = server.transport === 'remote';
	return {
		id: server.id,
		title: server.title,
		endpoint: server.endpoint,
		transport: server.transport,
		auth: remote ? HOSTED_AUTH[server.id] : STDIO_KEYLESS.has(server.id) ? 'none' : 'api-key',
	};
}

const policyId = (server) => server.policy || server.id;

async function build() {
	const prices = collectPrices();
	const index = staticIndex();
	const servers = await allServers();
	const usedGroups = new Set();
	const tools = [];

	for (const server of servers) {
		const record = serverRecord(server);
		const priceMap = prices.get(PRICED_BY[server.id]) || new Map();
		const policyRows = POLICY[policyId(server)] || {};
		const indexer = new Set(server.indexerTools || []);
		for (const tool of server.tools) {
			const hints = tool.annotations || {};
			// A stdio package that wraps tools in paid() reports the price it
			// quotes (scripts/lib/mcp-enumerate.mjs); the static maps cover the rest.
			const price = priceMap.get(tool.name) ?? (server.prices?.[tool.name] ? { usd: server.prices[tool.name] } : null);
			const read = staticFor(index, server, tool.name);
			const row = policyRows[tool.name];
			const category = row?.group || 'utility';
			usedGroups.add(category);
			const annotations = {
				readOnlyHint: hints.readOnlyHint ?? null,
				destructiveHint: hints.destructiveHint ?? null,
				idempotentHint: hints.idempotentHint ?? null,
				openWorldHint: hints.openWorldHint ?? null,
			};
			const safety = safetyClass(hints);
			tools.push({
				name: tool.name,
				title: tool.title ?? hints.title ?? null,
				description: tool.description ?? null,
				whenToUse: whenToUse(tool.description),
				server: record,
				category,
				tier: row?.tier ?? (safety === 'read' ? 'read' : safety === 'irreversible' ? 'financial' : 'write'),
				safety,
				annotations,
				price: {
					usd: price?.usd ?? 0,
					free: !price,
					...(price?.tiers ? { tiers: price.tiers } : {}),
				},
				// The arguments, as JSON Schema, normalized so "takes no arguments"
				// is one shape, which is what lets a consumer build a form without
				// special-casing each.
				inputSchema: normalizeSchema(tool.inputSchema) ?? { type: 'object', properties: {} },
				...(read?.partial ? { inputSchemaIsPartial: true } : {}),
				...(indexer.has(tool.name) ? { requiresIndexer: true } : {}),
				// A keyless hosted read that costs nothing: the /mcp-tools page offers
				// to run it in the browser against the live endpoint.
				...(record.transport === 'remote' && record.auth === 'none' && safety === 'read' && !price ? { tryIt: true } : {}),
				page: `/mcp-tools/${server.id}/${tool.name}`,
				source: read?.source ?? null,
			});
		}
	}

	const censusRows = servers.map((s) => ({ ...countServer({ ...s, policy: policyId(s) }), auth: serverRecord(s).auth }));
	const hosted = servers.filter((s) => s.transport === 'remote');
	const stdio = servers.filter((s) => s.transport === 'stdio');
	const rowsOf = (list) => censusRows.filter((r) => list.some((s) => s.id === r.id));

	const census = {
		method: CENSUS_METHOD,
		totals: {
			all: totalsFor(servers, censusRows),
			hosted: totalsFor(hosted, rowsOf(hosted)),
			stdio: totalsFor(stdio, rowsOf(stdio)),
		},
		servers: censusRows,
	};

	const counts = {
		tools: tools.length,
		uniqueTools: census.totals.all.uniqueTools,
		servers: servers.length,
		free: tools.filter((t) => t.price.free).length,
		paid: tools.filter((t) => !t.price.free).length,
		read: tools.filter((t) => t.safety === 'read').length,
		write: tools.filter((t) => t.safety === 'write').length,
		irreversible: tools.filter((t) => t.safety === 'irreversible').length,
		tryIt: tools.filter((t) => t.tryIt).length,
		// Schema coverage, so a drop is visible in the diff rather than only in
		// whichever tool page stopped rendering its arguments.
		withSchema: tools.filter((t) => t.inputSchema).length,
		withArguments: tools.filter((t) => Object.keys(t.inputSchema?.properties || {}).length).length,
	};

	const catalog = {
		$comment:
			'Generated by scripts/build-mcp-catalog.mjs from the tools/list payload of every three.ws MCP server and the price maps in this repo. Do not edit by hand: npm run build:mcp-catalog regenerates it and npm run audit:mcp-catalog fails the build when it is stale.',
		docs: `${ORIGIN}/docs/mcp-tools`,
		counts,
		census,
		categories: GROUPS.filter((g) => usedGroups.has(g.id)).map(({ id, label, summary }) => ({
			id,
			label,
			summary,
			tools: tools.filter((t) => t.category === id).length,
		})),
		servers: servers.map((s) => ({
			...serverRecord(s),
			...(s.transport === 'remote' ? { url: s.url, registryId: s.policy } : { package: s.package, version: s.version }),
			tools: s.tools.length,
			resources: (s.resources || []).length,
			templates: (s.templates || []).length,
			prompts: (s.prompts || []).length,
		})),
		tools,
	};

	// The light index: the census plus one line per tool, for an agent or a
	// README badge that needs the numbers without every schema.
	const index_ = {
		$comment:
			'Generated by scripts/build-mcp-catalog.mjs alongside /mcp-catalog.json (which adds every input schema). Live totals: GET /api/mcp-census.',
		catalog: `${ORIGIN}/mcp-catalog.json`,
		live: `${ORIGIN}/api/mcp-census`,
		method: CENSUS_METHOD,
		totals: census.totals,
		servers: census.servers,
		tools: tools.map((t) => ({
			name: t.name,
			server: t.server.id,
			title: t.title,
			category: t.category,
			safety: t.safety,
			price: t.price.usd,
			whenToUse: t.whenToUse,
			page: `${ORIGIN}${t.page}`,
		})),
	};

	return { catalog, toolsIndex: index_ };
}

const { catalog, toolsIndex } = await build();
// Tool descriptions are authored in many files; the published feeds must never carry the dashes
// the repo bans, so normalize at the single point where they are serialized.
const plain = (json) => json.replace(/\s?[\u2014\u2013]\s?/g, ' - ').replace(/[\u2018\u2019]/g, "'");
const outputs = [
	[OUT, plain(`${JSON.stringify(catalog, null, '\t')}\n`)],
	[TOOLS_OUT, plain(`${JSON.stringify(toolsIndex, null, '\t')}\n`)],
];

if (process.argv.includes('--check')) {
	const stale = outputs.filter(([file, body]) => (existsSync(file) ? readFileSync(file, 'utf8') : '') !== body);
	if (stale.length) {
		for (const [file] of stale) console.error(`[audit:mcp-catalog] ${file.slice(ROOT.length + 1)} is stale.`);
		console.error('  A tool, price, annotation, resource or prompt changed without regenerating the catalog.');
		console.error('  Fix: npm run build:mcp-catalog');
		process.exit(1);
	}
	const { tools, servers } = catalog.counts;
	console.log(`[audit:mcp-catalog] catalog and tools.json match the servers: ${tools} tools across ${servers} servers`);
} else {
	for (const [file, body] of outputs) writeFileSync(file, body);
	const { tools, uniqueTools, servers, free, paid } = catalog.counts;
	console.log(
		`[build:mcp-catalog] wrote public/mcp-catalog.json and public/tools.json: ${tools} tools (${uniqueTools} unique) on ${servers} servers (${free} free, ${paid} paid)`,
	);
}
process.exit(0);
