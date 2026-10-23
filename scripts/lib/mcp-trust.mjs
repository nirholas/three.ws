// Trust grade for every server in the MCP catalog.
//
// A visitor to /mcp-tools cannot tell a polished, published, tested server from
// a stub, so each server gets a 0-100 score built from facts this repo can check
// mechanically, and a letter grade from that score. Every fact carries a fixed
// weight (FACTS below, documented in docs/mcp.md), and the catalog stores the
// whole breakdown so the page can show exactly why a server earned its grade.
//
// Everything here reads the working tree and the catalog payload only, so the
// build stays offline-safe and byte-reproducible. Facts that need the network
// (is the npm version live, does the registry list it, does the hosted endpoint
// answer) belong to the registry sentinel, which stores its own results; this
// rubric scores the local evidence that a server is ready to be published.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { ROOT } from './mcp-tool-sources.mjs';

/** Fact id, weight, and the one-line reading shown in the tooltip. Weights sum to 100. */
export const FACTS = [
	{ id: 'tools', weight: 15, label: 'Declares at least one tool' },
	{ id: 'toolDocs', weight: 5, label: 'Every tool has a description' },
	{ id: 'safety', weight: 15, label: 'Every tool carries read-only and destructive safety annotations' },
	{ id: 'distribution', weight: 15, label: 'Installable: npm package ready to publish, or hosted endpoint mounted' },
	{ id: 'registry', weight: 10, label: 'Has a server.json for the official MCP registry' },
	{ id: 'readme', weight: 10, label: 'Documented: README or a guide in docs/' },
	{ id: 'license', weight: 10, label: 'License file present' },
	{ id: 'tests', weight: 5, label: 'Has tests' },
	{ id: 'prompts', weight: 5, label: 'Declares prompts' },
	{ id: 'resources', weight: 5, label: 'Declares resources or resource templates' },
	{ id: 'glama', weight: 5, label: 'Glama maintainer claim present' },
];

/** Lowest score for each grade, best first. */
export const GRADES = [
	['A', 85],
	['B', 70],
	['C', 50],
	['D', 30],
	['F', 0],
];

export const gradeFor = (score) => GRADES.find(([, min]) => score >= min)[0];

/** Hosted servers have no package directory, so their guides are named here. */
const REMOTE_DOCS = {
	mcp: 'docs/mcp.md',
	'mcp-agent': 'docs/mcp-agent.md',
	'mcp-3d': 'docs/mcp-3d-studio.md',
	'mcp-bazaar': 'docs/mcp-x402-bazaar.md',
	'ibm-mcp': 'docs/ibm-x402-mcp.md',
	'mcp-studio': 'docs/mcp-studio.md',
	'mcp-grok': 'docs/grok-bot.md',
	'pump-fun-mcp': 'docs/pump-fun-mcp-edge.md',
};

const has = (rel) => existsSync(join(ROOT, rel));
const readJson = (rel) => {
	try {
		return JSON.parse(readFileSync(join(ROOT, rel), 'utf8'));
	} catch {
		return null;
	}
};

/** Every server.json the repo publishes, outside agent worktrees and dependencies. */
function registryManifests() {
	const found = [];
	const walk = (dir, depth) => {
		if (depth > 3) return;
		for (const entry of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
			if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
			const rel = dir ? `${dir}/${entry.name}` : entry.name;
			if (entry.isDirectory()) walk(rel, depth + 1);
			else if (entry.name === 'server.json') {
				const doc = readJson(rel);
				if (doc) found.push(doc);
			}
		}
	};
	walk('', 0);
	return found;
}

function testSources() {
	const dir = join(ROOT, 'tests');
	if (!existsSync(dir)) return [];
	return readdirSync(dir)
		.filter((f) => /\.test\.[cm]?js$/.test(f))
		.map((f) => readFileSync(join(dir, f), 'utf8'));
}

function handlerFile(endpoint) {
	for (const rel of [`${endpoint.slice(1)}.js`, `${endpoint.slice(1)}/index.js`]) if (has(rel)) return rel;
	return null;
}

const dirHasTests = (dir) => {
	for (const sub of ['test', 'tests']) {
		if (has(`${dir}/${sub}`) && readdirSync(join(ROOT, dir, sub)).some((f) => /\.test\.[cm]?[jt]s$/.test(f))) return true;
	}
	return false;
};

/**
 * Grade every server.
 * @param {Array} servers   allServers() output: id, transport, dir, endpoint, url, tools, resources, templates, prompts.
 * @returns {Map<string, {score:number, grade:string, facts:Array}>}
 */
export function gradeServers(servers) {
	const manifests = registryManifests();
	const tests = testSources();
	const glama = readJson('glama.json');
	const glamaClaimed = Array.isArray(glama?.maintainers) && glama.maintainers.length > 0;
	const rootPkg = readJson('package.json');
	const out = new Map();

	for (const s of servers) {
		const remote = s.transport === 'remote';
		const dir = remote ? null : s.dir;
		const pkg = dir ? readJson(`${dir}/package.json`) : null;
		const tools = s.tools || [];
		const detail = {};
		const pass = {};

		pass.tools = tools.length > 0;
		detail.tools = `${tools.length} tools`;

		const undocumented = tools.filter((t) => !String(t.description || '').trim()).length;
		pass.toolDocs = tools.length > 0 && undocumented === 0;
		detail.toolDocs = undocumented ? `${undocumented} without a description` : 'all described';

		const unannotated = tools.filter((t) => {
			const a = t.annotations || {};
			return typeof a.readOnlyHint !== 'boolean' || (a.readOnlyHint === false && typeof a.destructiveHint !== 'boolean');
		}).length;
		pass.safety = tools.length > 0 && unannotated === 0;
		detail.safety = unannotated ? `${unannotated} tools missing hints` : 'all annotated';

		if (remote) {
			const file = handlerFile(s.endpoint);
			pass.distribution = Boolean(file);
			detail.distribution = file ? `handler ${file}` : 'no handler file found';
		} else {
			const ready = Boolean(pkg && pkg.name && pkg.version && !pkg.private && pkg.publishConfig?.access === 'public');
			pass.distribution = ready;
			detail.distribution = ready ? `${pkg.name}@${pkg.version}` : 'package.json is private or lacks publishConfig.access=public';
		}

		if (remote) {
			pass.registry = manifests.some((m) => (m.remotes || []).some((r) => r.url === s.url));
			detail.registry = pass.registry ? 'listed as a remote in a server.json' : 'no server.json lists this URL';
		} else {
			const manifest = readJson(`${dir}/server.json`);
			const pkgEntry = (manifest?.packages || []).find((p) => p.identifier === pkg?.name);
			pass.registry = Boolean(manifest?.name && pkgEntry && pkgEntry.version === pkg?.version);
			detail.registry = pass.registry ? manifest.name : manifest ? 'server.json does not match package.json' : 'no server.json';
		}

		const doc = remote ? REMOTE_DOCS[s.id] : `${dir}/README.md`;
		pass.readme = Boolean(doc && has(doc));
		detail.readme = pass.readme ? doc : 'no README or guide';

		const license = remote ? 'LICENSE' : `${dir}/LICENSE`;
		pass.license = has(license) || Boolean(pkg?.license && has('LICENSE')) || (remote && Boolean(rootPkg?.license) && has('LICENSE'));
		detail.license = pass.license ? 'present' : 'missing';

		if (remote) {
			const base = s.endpoint.slice(1);
			const ref = new RegExp(`${base.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}(?![-\\w/])`);
			pass.tests = tests.some((t) => ref.test(t));
		} else {
			pass.tests = dirHasTests(dir);
		}
		detail.tests = pass.tests ? 'covered' : 'none found';

		pass.prompts = (s.prompts || []).length > 0;
		detail.prompts = `${(s.prompts || []).length} prompts`;
		pass.resources = (s.resources || []).length + (s.templates || []).length > 0;
		detail.resources = `${(s.resources || []).length} resources, ${(s.templates || []).length} templates`;
		pass.glama = glamaClaimed;
		detail.glama = glamaClaimed ? 'repository claimed' : 'no glama.json maintainers';

		const facts = FACTS.map((f) => ({
			id: f.id,
			label: f.label,
			weight: f.weight,
			earned: pass[f.id] ? f.weight : 0,
			detail: detail[f.id],
		}));
		const score = facts.reduce((sum, f) => sum + f.earned, 0);
		out.set(s.id, { score, grade: gradeFor(score), facts });
	}
	return out;
}
