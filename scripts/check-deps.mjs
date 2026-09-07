#!/usr/bin/env node
/**
 * check-deps: scan the Python workers' pinned dependencies for known
 * vulnerabilities, against the OSV database (https://osv.dev).
 *
 * Why this exists. `npm audit` covers the JavaScript tree, and nothing covered
 * the other half of the platform: 20 requirements files across `workers/`,
 * `services/` and `packages/` pin the runtime of every GPU and CPU worker, and
 * a pinned version is a version that never gets a security bump unless someone
 * goes looking. The `overrides` block in package.json is the record of that work
 * being done by hand on the JS side, one advisory at a time. This is the same
 * job for PyPI, done by a query rather than by remembering.
 *
 * Why not `osv-scanner`. It is the reference tool and it is the right answer on
 * a machine that has it: it is a Go binary, so it cannot be a repo dependency,
 * and a check nobody can run is not a check. This queries the same OSV database
 * over its public API, so the data is identical and the install cost is zero.
 * If you have osv-scanner, run it too; it understands lockfile ecosystems this
 * does not.
 *
 * What it can and cannot see:
 *   - `pkg==1.2.3` is scannable, and most of the tree is pinned this way.
 *   - `pkg>=1.2`, `pkg~=1.2`, and a bare `pkg` are NOT scannable: the installed
 *     version is whatever the build resolved that day. Those are reported
 *     separately, because an unpinnable dependency is its own reproducibility
 *     problem in a worker whose image is built months after its Dockerfile.
 *   - A local version segment (`1.6.3+pt21cu121`, the CUDA-built wheels) is
 *     queried on its public part; OSV indexes upstream releases, not rebuilds.
 *
 * Usage:
 *   npm run audit:deps               # exit 1 if anything vulnerable is found
 *   node scripts/check-deps.mjs --advisory   # always exit 0
 *   node scripts/check-deps.mjs --unpinned   # also list what cannot be scanned
 *
 * Needs network. Deliberately NOT wired into `npm run gate` or the deploy path:
 * a build must not fail because api.osv.dev is having a bad afternoon.
 */
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { resolve, dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const ADVISORY = args.includes('--advisory');
const SHOW_UNPINNED = args.includes('--unpinned');

const SEARCH_DIRS = ['workers', 'services', 'packages'];
const OSV_BATCH = 'https://api.osv.dev/v1/querybatch';
const OSV_VULN = 'https://api.osv.dev/v1/vulns/';

// ── Collecting requirements ──────────────────────────────────────────────────

function requirementFiles() {
	const found = [];
	for (const dir of SEARCH_DIRS) {
		const base = join(root, dir);
		if (!existsSync(base)) continue;
		for (const entry of readdirSync(base)) {
			const child = join(base, entry);
			if (!statSync(child).isDirectory()) continue;
			for (const name of readdirSync(child)) {
				if (/^requirements.*\.txt$/.test(name)) found.push(join(child, name));
			}
		}
	}
	return found.sort();
}

/**
 * Parse one requirements file into { pinned, unpinned }.
 *
 * Requirement lines carry more than a name and a version: extras (`uvicorn[standard]`),
 * environment markers (`; python_version < "3.11"`), inline comments, pip flags
 * (`-f`, `--extra-index-url`), and direct URLs. Everything that is not a plain
 * `name==version` is either unpinnable or not a PyPI release at all.
 */
export function parseRequirements(text) {
	const pinned = [];
	const unpinned = [];
	for (const rawLine of text.split('\n')) {
		let line = rawLine.trim();
		if (!line || line.startsWith('#')) continue;
		if (line.startsWith('-') ) continue; // pip flags: -r, -f, --extra-index-url
		line = line.split(' #')[0].trim(); // trailing comment
		line = line.split(';')[0].trim(); // environment marker
		if (!line) continue;
		if (/^[a-z+]+:\/\//i.test(line) || line.includes('@')) continue; // direct URL or VCS ref
		const match = line.match(/^([A-Za-z0-9][A-Za-z0-9._-]*)\s*(\[[^\]]*\])?\s*(.*)$/);
		if (!match) continue;
		const name = match[1];
		const spec = (match[3] || '').trim();
		const exact = spec.match(/^==\s*([^,\s]+)$/);
		if (exact) pinned.push({ name, version: exact[1] });
		else unpinned.push({ name, spec: spec || '(any version)' });
	}
	return { pinned, unpinned };
}

// OSV indexes upstream releases. A locally built wheel carries a PEP 440 local
// version segment after "+", which is our build, not an upstream release, so
// query the public part and let the caller know that is what happened.
export function publicVersion(version) {
	return version.split('+')[0];
}

// ── OSV queries ──────────────────────────────────────────────────────────────

async function postJson(url, body) {
	const res = await fetch(url, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify(body),
	});
	if (!res.ok) throw new Error(`${url} answered HTTP ${res.status}`);
	return res.json();
}

async function getJson(url) {
	const res = await fetch(url);
	if (!res.ok) throw new Error(`${url} answered HTTP ${res.status}`);
	return res.json();
}

/** Query OSV for a list of {name, version}, in batches it will accept. */
async function queryOsv(packages) {
	const hits = new Map(); // "name@version" -> [vuln id]
	const BATCH = 100;
	for (let i = 0; i < packages.length; i += BATCH) {
		const slice = packages.slice(i, i + BATCH);
		const body = {
			queries: slice.map((p) => ({
				package: { name: p.name, ecosystem: 'PyPI' },
				version: publicVersion(p.version),
			})),
		};
		const out = await postJson(OSV_BATCH, body);
		(out.results || []).forEach((result, idx) => {
			const ids = (result.vulns || []).map((v) => v.id);
			if (ids.length) hits.set(`${slice[idx].name}@${slice[idx].version}`, ids);
		});
	}
	return hits;
}

/** The batch endpoint returns ids only; the detail endpoint has the useful part. */
async function describeVulns(ids) {
	const described = new Map();
	for (const id of ids) {
		try {
			const v = await getJson(OSV_VULN + encodeURIComponent(id));
			described.set(id, {
				id,
				summary: v.summary || v.details?.split('\n')[0] || '(no summary)',
				severity: highestSeverity(v),
				fixed: fixedVersions(v),
				withdrawn: Boolean(v.withdrawn),
			});
		} catch {
			described.set(id, { id, summary: '(details unavailable)', severity: '', fixed: [], withdrawn: false });
		}
	}
	return described;
}

function highestSeverity(vuln) {
	const labels = [];
	for (const s of vuln.severity || []) if (s.score) labels.push(s.score);
	const db = vuln.database_specific?.severity;
	if (db) labels.unshift(db);
	return labels[0] || '';
}

function fixedVersions(vuln) {
	const out = new Set();
	for (const affected of vuln.affected || []) {
		for (const range of affected.ranges || []) {
			for (const event of range.events || []) if (event.fixed) out.add(event.fixed);
		}
	}
	return [...out];
}

// ── Report ───────────────────────────────────────────────────────────────────

async function main() {
	const files = requirementFiles();
	if (!files.length) {
		console.log('check-deps: no requirements files found.');
		return 0;
	}

	const byPackage = new Map(); // "name@version" -> Set(file)
	const unpinnedByFile = new Map();
	for (const file of files) {
		const rel = relative(root, file);
		const { pinned, unpinned } = parseRequirements(readFileSync(file, 'utf8'));
		for (const p of pinned) {
			const key = `${p.name}@${p.version}`;
			if (!byPackage.has(key)) byPackage.set(key, new Set());
			byPackage.get(key).add(rel);
		}
		if (unpinned.length) unpinnedByFile.set(rel, unpinned);
	}

	const packages = [...byPackage.keys()].map((key) => {
		const at = key.lastIndexOf('@');
		return { name: key.slice(0, at), version: key.slice(at + 1) };
	});

	console.log(`check-deps: ${packages.length} pinned package(s) across ${files.length} requirements file(s), querying OSV…\n`);

	let hits;
	try {
		hits = await queryOsv(packages);
	} catch (err) {
		console.error(`check-deps: could not reach OSV (${err.message}).`);
		console.error('This check needs network. It is not part of the deploy gate for exactly that reason.');
		return ADVISORY ? 0 : 2;
	}

	const allIds = [...new Set([...hits.values()].flat())];
	const described = await describeVulns(allIds);

	let findings = 0;
	for (const [key, ids] of [...hits.entries()].sort()) {
		const live = ids.map((id) => described.get(id)).filter((v) => v && !v.withdrawn);
		if (!live.length) continue;
		findings += live.length;
		const where = [...byPackage.get(key)].join(', ');
		console.log(`${key}`);
		console.log(`  in: ${where}`);
		for (const v of live) {
			const sev = v.severity ? ` [${v.severity}]` : '';
			const fix = v.fixed.length ? `  fixed in ${v.fixed.join(', ')}` : '  no fixed version published';
			console.log(`  ${v.id}${sev}  ${v.summary}`);
			console.log(`   ${fix}`);
		}
		console.log('');
	}

	if (SHOW_UNPINNED) {
		const total = [...unpinnedByFile.values()].reduce((n, list) => n + list.length, 0);
		console.log(`Not scannable: ${total} requirement(s) with no exact version, in ${unpinnedByFile.size} file(s).`);
		console.log('An unpinned dependency resolves to whatever the build found that day, so neither');
		console.log('this check nor a rebuild months later can say what actually shipped.\n');
		for (const [file, list] of [...unpinnedByFile.entries()].sort()) {
			console.log(`  ${file}`);
			for (const u of list) console.log(`    ${u.name} ${u.spec}`);
		}
		console.log('');
	}

	if (!findings) {
		console.log(`check-deps: no known vulnerabilities in ${packages.length} pinned package(s).`);
		return 0;
	}
	console.log(`check-deps: ${findings} advisory/advisories across ${hits.size} package version(s).`);
	console.log('Bump the pin in the requirements file, then rebuild that worker image.');
	return ADVISORY ? 0 : 1;
}

// Importable for tests; only runs the report when invoked directly.
if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
	main().then((code) => { process.exitCode = code; });
}
