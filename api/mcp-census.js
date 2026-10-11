// GET /api/mcp-census: how many tools, resources, resource templates and
// prompts every three.ws MCP server serves, computed by the running server.
//
// The hosted endpoints are counted here, at request time, from the same
// modules each endpoint answers tools/list, resources/list and prompts/list
// from (api/_lib/mcp-census.js), so the figure is what this deployment
// actually serves. The stdio npm packages cannot be loaded inside the API
// runtime, so their figures come from public/tools.json, which the build
// computes by loading each package's server and asking it over an in-memory
// MCP transport. `matchesBuild` says whether the live hosted figures equal the
// ones baked into tools.json for this image: false means the build ran on
// different code than is serving.
//
// The code a process serves cannot change while it runs, so the census is
// computed once per process and reused.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cors, json, method, wrap, error, rateLimited } from './_lib/http.js';
import { limits, clientIp } from './_lib/rate-limit.js';
import { hostedServers, countServer, totalsFor, CENSUS_METHOD } from './_lib/mcp-census.js';

const ROOT = process.cwd();
const COMPARED = ['tools', 'resources', 'templates', 'prompts'];
let _census = null;

function readBuild() {
	try {
		return JSON.parse(readFileSync(join(ROOT, 'public/tools.json'), 'utf8'));
	} catch {
		// An image built without the catalog step still answers with the live
		// hosted half; the stdio half is reported as unknown rather than zero.
		return null;
	}
}

/** Per-server differences between the live hosted rows and the build's rows. */
function driftFrom(liveRows, build) {
	if (!build) return null;
	const built = new Map(build.servers.map((s) => [s.id, s]));
	const drift = [];
	for (const row of liveRows) {
		const b = built.get(row.id);
		if (!b) {
			drift.push({ id: row.id, field: 'server', live: true, build: false });
			continue;
		}
		for (const field of COMPARED) if (row[field] !== b[field]) drift.push({ id: row.id, field, live: row[field], build: b[field] });
	}
	return drift;
}

async function compute() {
	const live = await hostedServers();
	const hostedRows = live.map(countServer);
	const build = readBuild();
	const stdioRows = build ? build.servers.filter((s) => s.transport === 'stdio') : [];

	// Unique totals need names. Live hosted names come from the servers; stdio
	// names from the tool index in tools.json (resource and prompt names for the
	// packages are only counted there, so the stdio totals are taken as built).
	const stdioNames = build ? build.tools.filter((t) => stdioRows.some((s) => s.id === t.server)).map((t) => t.name) : [];
	const hostedTotals = totalsFor(live, hostedRows);
	const stdioTotals = build?.totals?.stdio ?? null;
	const sum = (k) => hostedTotals[k] + (stdioTotals?.[k] ?? 0);
	const all = stdioTotals
		? {
				servers: sum('servers'),
				tools: sum('tools'),
				uniqueTools: new Set([...live.flatMap((s) => s.tools.map((t) => t.name)), ...stdioNames]).size,
				resources: sum('resources'),
				templates: sum('templates'),
				prompts: sum('prompts'),
			}
		: null;
	const drift = driftFrom(hostedRows, build);

	return {
		computedAt: new Date().toISOString(),
		method: CENSUS_METHOD,
		totals: { all, hosted: hostedTotals, stdio: stdioTotals },
		servers: [...hostedRows.map((r) => ({ ...r, source: 'live' })), ...stdioRows.map((r) => ({ ...r, source: 'build' }))],
		matchesBuild: drift ? drift.length === 0 : null,
		drift: drift ?? [],
		catalog: 'https://three.ws/mcp-catalog.json',
		index: 'https://three.ws/tools.json',
		page: 'https://three.ws/mcp-tools',
	};
}

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,OPTIONS', origins: '*' })) return;
	if (!method(req, res, ['GET'])) return;

	const rl = await limits.publicIp(clientIp(req));
	if (!rl.success) return rateLimited(res, rl);

	try {
		_census ||= await compute();
	} catch (err) {
		_census = null;
		return error(res, 503, 'census_unavailable', `the MCP census could not be computed: ${err?.message || err}`);
	}

	return json(res, 200, _census, {
		'cache-control': 'public, max-age=60, s-maxage=300, stale-while-revalidate=600',
	});
});
