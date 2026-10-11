// Load every MCP server in this repo and ask it what it serves.
//
// Hosted endpoints come from api/_lib/mcp-census.js (the same modules each
// endpoint answers from). Stdio servers (the mcp-server flagship and every
// packages/*-mcp package) are built in-process with the package's own
// buildServer(), connected to an MCP client over the SDK's in-memory transport,
// and asked tools/list, resources/list, resources/templates/list and
// prompts/list. That is the real wire payload a client sees, so the annotation
// test, the published counts and the catalog all describe the same thing.
//
// A few packages cannot be built that way without a credential or a live
// backend; each has an explicit loader below that reads the same definitions
// the package's server registers, with the reason beside it.

import { readdirSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ROOT } from './mcp-tool-sources.mjs';
import { hostedServers } from '../../api/_lib/mcp-census.js';

// Packages under packages/*-mcp that are not MCP servers at all.
// spatial-mcp is the SpatialMCP artifact library (builders and validators for
// a payload other servers return); it registers no tools and has no bin.
const NOT_A_SERVER = new Set(['spatial-mcp']);

const importFile = (rel) => import(pathToFileURL(join(ROOT, rel)).href);

// Ask a built server what it serves, over an in-memory MCP transport.
async function listOverTransport(server) {
	const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
	const client = new Client({ name: 'three-ws-mcp-census', version: '1.0.0' });
	await server.connect(serverSide);
	await client.connect(clientSide);
	const caps = client.getServerCapabilities() || {};
	const safe = async (enabled, fn, key) => {
		if (!enabled) return [];
		try {
			return (await fn())[key] || [];
		} catch (err) {
			if (err?.code === -32601) return [];
			throw err;
		}
	};
	try {
		return {
			tools: await safe(caps.tools, () => client.listTools(), 'tools'),
			resources: await safe(caps.resources, () => client.listResources(), 'resources'),
			templates: await safe(caps.resources, () => client.listResourceTemplates(), 'resourceTemplates'),
			prompts: await safe(caps.prompts, () => client.listPrompts(), 'prompts'),
		};
	} finally {
		await client.close();
		await server.close();
	}
}

const SPECIAL_LOADERS = {
	// Its buildServer() asks the hosted /api/pump-fun-mcp backend for the live
	// tool list (falling back to the bundled list offline), so a build would
	// depend on the network. The bundled list plus the native composers is what
	// the server registers when that backend is the one in this repo.
	async 'pumpfun-mcp'() {
		const { FALLBACK_TOOLS, TOOL_ANNOTATIONS } = await importFile('packages/pumpfun-mcp/src/tools.js');
		const { buildNativeRegistry } = await importFile('packages/pumpfun-mcp/src/native.js');
		const withLocal = (t) => {
			const local = TOOL_ANNOTATIONS[t?.name];
			return local ? { ...t, title: t.title ?? local.title, annotations: t.annotations ?? local } : t;
		};
		const native = buildNativeRegistry('https://three.ws', async () => null);
		return { tools: [...FALLBACK_TOOLS.map(withLocal), ...native.defs], resources: [], templates: [], prompts: [] };
	},
	// buildServer() reads DASHSCOPE_API_KEY first. The tool definitions take the
	// client only to call it, so they register on a server here unchanged.
	async 'alibaba-cloud-mcp'() {
		const { buildTools } = await importFile('packages/alibaba-cloud-mcp/src/tools.js');
		const server = new McpServer({ name: 'alibaba-cloud-mcp', version: '0.0.0' }, { capabilities: { tools: {} } });
		for (const t of buildTools(null)) {
			server.registerTool(t.name, { title: t.title, description: t.description, inputSchema: t.inputSchema, annotations: t.annotations }, t.handler);
		}
		return listOverTransport(server);
	},
	// The entry point runs main() on import (it exits without WATSONX_API_KEY),
	// so the low-level definitions it serves verbatim are read from tools.js.
	async 'ibm-watsonx-mcp'() {
		const { buildTools } = await importFile('packages/ibm-watsonx-mcp/src/tools.js');
		return { tools: buildTools(null).map((t) => t.definition), resources: [], templates: [], prompts: [] };
	},
	// Same shape: main() connects stdio on import. tools.js, prompts.js and the
	// one MCP Apps UI resource are exactly what its handlers return.
	async 'threews-avatar-mcp'() {
		const { buildTools } = await importFile('packages/threews-avatar-mcp/src/tools.js');
		const { buildPrompts } = await importFile('packages/threews-avatar-mcp/src/prompts.js');
		const { UI_RESOURCE_URI } = await importFile('packages/threews-avatar-mcp/src/ui.js');
		return {
			tools: buildTools().map((t) => t.definition),
			resources: [{ uri: UI_RESOURCE_URI, name: 'three.ws avatar viewer' }],
			templates: [],
			prompts: buildPrompts().map((p) => p.definition),
		};
	},
	// ibm-x402-mcp's buildServer(client) takes the watsonx client as an argument
	// and never calls it while registering.
	async 'ibm-x402-mcp'() {
		const { buildServer } = await importFile('packages/ibm-x402-mcp/src/index.js');
		return listOverTransport(await buildServer(null));
	},
};

/** "$0.20", "0.2" or 0.2 as a number of USD. */
function usdOf(price) {
	const n = Number(String(price).replace(/[$,\s]/g, '').replace(/USDC?$/i, ''));
	if (!Number.isFinite(n) || n <= 0) throw new Error(`unreadable tool price ${JSON.stringify(price)}`);
	return n;
}

/**
 * The per-tool prices a package's paid() wrapper recorded while its server
 * registered tools, for the tools that server lists. Only packages whose
 * src/payments.js exports PAID_TOOL_PRICES charge per call this way; the
 * rest are free or priced by the hosted endpoint they call.
 */
async function paidPrices(dir, tools) {
	if (!existsSync(join(ROOT, dir, 'src', 'payments.js'))) return null;
	const { PAID_TOOL_PRICES } = await importFile(`${dir}/src/payments.js`);
	if (!(PAID_TOOL_PRICES instanceof Map)) return null;
	const listed = new Set(tools.map((t) => t.name));
	const prices = {};
	for (const [name, price] of PAID_TOOL_PRICES) if (listed.has(name)) prices[name] = usdOf(price);
	return Object.keys(prices).length ? prices : null;
}

function packageMeta(dir) {
	try {
		const pkg = JSON.parse(readFileSync(join(ROOT, dir, 'package.json'), 'utf8'));
		return { name: pkg.name, version: pkg.version, description: pkg.description || '' };
	} catch {
		return { name: null, version: null, description: '' };
	}
}

/**
 * Every stdio MCP server in the repo: the mcp-server flagship plus each
 * packages/*-mcp package, with its live lists.
 * @returns {Promise<Array<{id,title,dir,package,transport:'stdio',tools,resources,templates,prompts}>>}
 */
export async function stdioServers() {
	const dirs = ['mcp-server', ...readdirSync(join(ROOT, 'packages'))
		.filter((d) => d.endsWith('-mcp') && !NOT_A_SERVER.has(d))
		.sort()
		.map((d) => `packages/${d}`)];
	const out = [];
	for (const dir of dirs) {
		const id = dir === 'mcp-server' ? 'three-ws-mcp-server' : dir.slice('packages/'.length);
		if (!existsSync(join(ROOT, dir, 'src', 'index.js'))) continue;
		const special = SPECIAL_LOADERS[id];
		let lists;
		if (special) {
			lists = await special();
		} else {
			const mod = await importFile(`${dir}/src/index.js`);
			if (typeof mod.buildServer !== 'function') {
				throw new Error(`${dir}: src/index.js exports no buildServer(); add a loader to scripts/lib/mcp-enumerate.mjs`);
			}
			lists = await listOverTransport(await mod.buildServer());
		}
		const meta = packageMeta(dir);
		const prices = await paidPrices(dir, lists.tools);
		out.push({
			id,
			title: meta.name || id,
			dir,
			package: meta.name,
			version: meta.version,
			endpoint: meta.name ? `npx -y ${meta.name}` : null,
			transport: 'stdio',
			...lists,
			...(prices ? { prices } : {}),
		});
	}
	return out;
}

/** Hosted endpoints and stdio servers together, hosted first. */
export async function allServers() {
	const hosted = (await hostedServers()).map((s) => ({ ...s, transport: 'remote' }));
	return [...hosted, ...(await stdioServers())];
}
