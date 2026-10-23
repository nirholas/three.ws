#!/usr/bin/env node
/**
 * Clear npm security advisories from every committed package-lock.json.
 *
 * GitHub raises one Dependabot alert per advisory per lockfile, and this repo
 * commits ~80 lockfiles, so one vulnerable transitive package shared by forty
 * of them is forty alerts. `npm audit fix` only moves a package when a parent
 * already allows the patched version, which leaves most of them in place.
 *
 * For each lockfile this script:
 *   1. audits it in an isolated sibling copy (a root workspace member would
 *      otherwise resolve against, and rewrite, the root lockfile),
 *   2. finds the newest published version on the same release line (same
 *      major, or same minor for 0.x) that no advisory covers, or failing that
 *      the vetted CROSS_MAJOR target,
 *   3. pins it: a direct dependency gets its spec bumped, a transitive one gets
 *      a major-scoped override (`"pkg@^2": "^2.5.6"`) so other majors of the
 *      same package in the tree are untouched,
 *   4. re-resolves the lockfile and writes back only if the count went down.
 *
 * It only crosses a major for the lines in CROSS_MAJOR, each checked against
 * every consumer in the tree. Anything else that needs one is printed as
 * residue with the lowest clean version, to be upgraded by hand with that
 * package's tests.
 *
 *   node scripts/security/fix-lockfile-advisories.mjs              # every lockfile
 *   node scripts/security/fix-lockfile-advisories.mjs apps/hq chat # just these
 *   node scripts/security/fix-lockfile-advisories.mjs --dry-run --json report.json
 *   node scripts/security/fix-lockfile-advisories.mjs --npm 11.9.0 .   # root, Dockerfile npm
 */

import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import semver from 'semver';

const ROOT = resolve(import.meta.dirname, '../..');
const DEP_FIELDS = ['dependencies', 'devDependencies', 'optionalDependencies'];
const PASSES = 3;

// Cross-major moves that were checked against every consumer in the committed lockfiles
// (2026-10-23). Only these lines are ever moved across a major; anything else is residue.
const CROSS_MAJOR = {
	// @solana/web3.js v1 only imports jayson/lib/client/browser, identical in 5.x apart from
	// request-id generation. 5.x drops stream-json and uuid, which clears both from every Solana tree.
	'jayson@^4': '^5.0.0',
	// @coral-xyz/anchor only calls toml.parse(); 5.x keeps the CommonJS entry and that signature.
	'toml@^3': '^5.0.1',
	// Every 8.x/9.x consumer (hardhat, jayson, jest-junit, @metamask/*, request-oauth) requires the
	// bare 'uuid' entry and calls v4(); 11.x still ships CommonJS with the same named exports.
	'uuid@^8': '^11.1.1',
	'uuid@^9': '^11.1.1',
	// The remaining lines mirror the root package.json overrides already shipped for hardhat 2,
	// solc, @sentry/node and mocha.
	'undici@^5': '^6.29.0',
	'tmp@~0.0': '^0.2.7',
	'cookie@~0.4': '^0.7.2',
	'serialize-javascript@^6': '^7.0.5',
	// hardhat's compiler downloader only does new AdmZip(path).extractAllTo(dir), unchanged in 0.6.
	'adm-zip@~0.4': '~0.6.1',
	'adm-zip@~0.5': '~0.6.1',
	// mocha only calls diff.createPatch(); 8.x keeps a CommonJS build with that export.
	'diff@^7': '^8.0.3',
};

const argv = process.argv.slice(2);
const dryRun = argv.includes('--dry-run');
const flag = (name) => {
	const i = argv.indexOf(name);
	if (i === -1) return null;
	const [value] = argv.splice(i, 2).slice(1);
	return value;
};
const npmVersion = flag('--npm');
const jsonOut = flag('--json');
const dirs = argv.filter((a) => !a.startsWith('--'));

const npm = (args, cwd) => {
	const [cmd, pre] = npmVersion ? ['npx', ['-y', `npm@${npmVersion}`]] : ['npm', []];
	return execFileSync(cmd, [...pre, ...args], { cwd, encoding: 'utf8', maxBuffer: 256 << 20, stdio: ['ignore', 'pipe', 'pipe'] });
};

function audit(cwd) {
	let out;
	try {
		out = npm(['audit', '--json', '--package-lock-only'], cwd);
	} catch (err) {
		// npm audit exits 1 whenever it finds anything; the report is still on stdout.
		out = err.stdout;
	}
	const report = JSON.parse(out);
	if (!report.metadata) throw new Error(report.error?.summary || 'npm audit returned no metadata');
	return report;
}

const versionCache = new Map();
function publishedVersions(name) {
	if (!versionCache.has(name)) {
		const list = JSON.parse(npm(['view', name, 'versions', '--json'], ROOT));
		versionCache.set(name, (Array.isArray(list) ? list : [list]).filter((v) => !semver.prerelease(v)));
	}
	return versionCache.get(name);
}

// Release line a version can move within without a breaking change.
const lineOf = (v) => (semver.major(v) > 0 ? `^${semver.major(v)}` : `~0.${semver.minor(v)}`);
const pinFor = (line, target) => `${line.startsWith('^') ? '^' : '~'}${target}`;

// name -> Set of installed versions, skipping bundled copies (overrides cannot reach them).
function installedVersions(lock) {
	const out = new Map();
	for (const [path, entry] of Object.entries(lock.packages || {})) {
		const at = path.lastIndexOf('node_modules/');
		if (at === -1 || entry.link || entry.inBundle || !entry.version) continue;
		const name = path.slice(at + 'node_modules/'.length);
		if (!out.has(name)) out.set(name, new Set());
		out.get(name).add(entry.version);
	}
	return out;
}

// What GitHub raises an alert for: each distinct advisory hitting a package in the lockfile.
// npm's metadata total also counts every parent of a vulnerable package, which GitHub does not.
const alertCount = (report) =>
	new Set(Object.values(report.vulnerabilities || {}).flatMap((v) => v.via.filter((x) => typeof x === 'object').map((x) => `${x.name} ${x.url}`))).size;

function advisoryRanges(report) {
	const out = new Map();
	for (const [name, vuln] of Object.entries(report.vulnerabilities || {})) {
		const ranges = vuln.via.filter((v) => typeof v === 'object').map((v) => ({ range: v.range, url: v.url, title: v.title, severity: v.severity }));
		if (ranges.length) out.set(name, ranges);
	}
	return out;
}

function plan(report, lock) {
	const installed = installedVersions(lock);
	const pins = [];
	const residue = [];
	for (const [name, advisories] of advisoryRanges(report)) {
		const affected = (v) => advisories.some((a) => semver.satisfies(v, a.range, { includePrerelease: true }));
		const clean = publishedVersions(name).filter((v) => !affected(v));
		for (const version of installed.get(name) || []) {
			if (!affected(version)) continue;
			const line = lineOf(version);
			const target = semver.maxSatisfying(clean.filter((v) => semver.gte(v, version)), line);
			const crossMajor = CROSS_MAJOR[`${name}@${line}`];
			if (target) pins.push({ name, line, target });
			else if (crossMajor && clean.some((v) => semver.satisfies(v, crossMajor))) pins.push({ name, line, spec: crossMajor });
			else residue.push({ name, version, lowestFix: semver.minSatisfying(clean, `>${version}`), advisories });
		}
	}
	// The same line can be installed at several versions; one pin covers them.
	const unique = new Map(pins.map((p) => [`${p.name}@${p.line}`, p]));
	return { pins: [...unique.values()], residue };
}

function applyPins(manifest, pins) {
	const applied = [];
	const skipped = [];
	for (const { name, line, target, spec: crossMajor } of pins) {
		const value = crossMajor ?? pinFor(line, target);
		const field = DEP_FIELDS.find((f) => manifest[f]?.[name]);
		if (field && crossMajor) {
			// Moving a direct dependency across a major is the package owner's call, not this script's.
			const floor = semver.validRange(manifest[field][name]) && semver.minVersion(manifest[field][name]);
			if (floor && semver.satisfies(floor.version, line)) {
				skipped.push(`${name}: direct ${field} on ${line}, upgrade to ${crossMajor} by hand`);
				continue;
			}
		} else if (field) {
			const spec = manifest[field][name];
			const floor = semver.validRange(spec) && semver.minVersion(spec);
			if (floor && semver.satisfies(floor.version, line) && spec !== value) {
				manifest[field][name] = value;
				applied.push(`${field}.${name} ${spec} -> ${manifest[field][name]}`);
			}
			// Nested copies on the same line ignore the root spec, so they still get the
			// override below; npm accepts it because the value matches the root edge exactly.
		}
		manifest.overrides ??= {};
		if (typeof manifest.overrides[name] === 'string') {
			skipped.push(`${name}: already overridden to ${manifest.overrides[name]}, left alone`);
			continue;
		}
		const key = `${name}@${line}`;
		if (manifest.overrides[key] === value) continue;
		manifest.overrides[key] = value;
		applied.push(`overrides["${key}"] = ${manifest.overrides[key]}`);
	}
	return { applied, skipped };
}

function writeJson(path, value, original) {
	const indent = original.match(/^[ \t]+(?=")/m)?.[0] ?? '\t';
	writeFileSync(path, JSON.stringify(value, null, indent) + (original.endsWith('\n') ? '\n' : ''));
}

function trackedLockDirs() {
	return execFileSync('git', ['ls-files', '*package-lock.json'], { cwd: ROOT, encoding: 'utf8' })
		.split('\n')
		.filter((p) => p.endsWith('package-lock.json'))
		.map((p) => p.slice(0, -'package-lock.json'.length).replace(/\/$/, '') || '.');
}

function fixDir(dir) {
	const abs = resolve(ROOT, dir);
	// A sibling, not a tmpdir: `file:../x` specs must resolve exactly as they do from the
	// real directory, and a sibling is in no `workspaces` list so npm treats it as its own root.
	const iso = mkdtempSync(join(dirname(abs), `.lockfix-${basename(abs)}-`));
	try {
		for (const f of ['package.json', 'package-lock.json', '.npmrc']) {
			if (existsSync(join(abs, f))) copyFileSync(join(abs, f), join(iso, f));
		}
		const originalManifest = readFileSync(join(iso, 'package.json'), 'utf8');
		const manifest = JSON.parse(originalManifest);
		const before = alertCount(audit(iso));
		const changes = [];
		const notes = [];
		let report = audit(iso);
		let residue = [];
		for (let pass = 0; pass < PASSES; pass++) {
			const lock = JSON.parse(readFileSync(join(iso, 'package-lock.json'), 'utf8'));
			const p = plan(report, lock);
			residue = p.residue;
			const { applied, skipped } = applyPins(manifest, p.pins);
			notes.push(...skipped);
			if (!applied.length) break;
			changes.push(...applied);
			writeJson(join(iso, 'package.json'), manifest, originalManifest);
			const install = ['install', '--package-lock-only', '--ignore-scripts', '--no-audit', '--no-fund'];
			try {
				npm(install, iso);
			} catch (err) {
				// Some committed lockfiles were last written past a peer conflict; resolve them the same way.
				if (!String(err.stderr).includes('ERESOLVE')) throw err;
				npm([...install, '--legacy-peer-deps'], iso);
				notes.push('peer conflict in the existing tree: resolved with --legacy-peer-deps');
			}
			report = audit(iso);
		}
		const after = alertCount(report);
		const improved = after < before;
		if (improved && !dryRun) {
			copyFileSync(join(iso, 'package.json'), join(abs, 'package.json'));
			copyFileSync(join(iso, 'package-lock.json'), join(abs, 'package-lock.json'));
		}
		return { dir, before, after, written: improved && !dryRun, changes, notes: [...new Set(notes)], residue };
	} catch (err) {
		return { dir, error: String(err.stderr || err.message).trim().split('\n').slice(-3).join(' | ') };
	} finally {
		rmSync(iso, { recursive: true, force: true });
	}
}

const results = [];
for (const dir of dirs.length ? dirs : trackedLockDirs()) {
	const r = fixDir(dir);
	results.push(r);
	if (r.error) console.log(`ERR  ${dir}: ${r.error}`);
	else console.log(`${r.written ? 'FIX ' : 'SAME'} ${dir}: ${r.before} -> ${r.after}${r.changes.length ? ` (${r.changes.length} pins)` : ''}`);
}

const totals = results.reduce((t, r) => ({ before: t.before + (r.before || 0), after: t.after + (r.after || 0) }), { before: 0, after: 0 });
console.log(`\nadvisory alerts: ${totals.before} -> ${totals.after}${dryRun ? ' (dry run, nothing written)' : ''}`);

const residue = new Map();
for (const r of results) {
	for (const x of r.residue || []) {
		const k = `${x.name}@${x.version}`;
		if (!residue.has(k)) residue.set(k, { ...x, dirs: [] });
		residue.get(k).dirs.push(r.dir);
	}
}
if (residue.size) {
	console.log('\nneeds a major upgrade (or has no fixed release):');
	for (const [k, x] of [...residue].sort((a, b) => b[1].dirs.length - a[1].dirs.length)) {
		console.log(`  ${k.padEnd(40)} fix: ${(x.lowestFix || 'none').padEnd(10)} in ${x.dirs.length} lockfile(s)`);
	}
}
if (jsonOut) writeFileSync(jsonOut, JSON.stringify(results, null, '\t'));
