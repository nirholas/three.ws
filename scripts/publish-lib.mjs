#!/usr/bin/env node
// Lays out the <agent-3d> CDN under dist/agent-3d/ and writes versions.json.
//
//   dist/agent-3d/<version>/       every released version, byte for byte as
//                                  archived (data/agent-3d-releases.json),
//                                  served `immutable` and pinned with SRI
//   dist/agent-3d/<major>.<minor>/ the current build (dist-lib/), moving
//   dist/agent-3d/<major>/         the current build, moving
//   dist/agent-3d/latest/          the current build, moving
//
// An immutable version directory is NEVER written from dist-lib/. It used to
// be, which rebuilt /agent-3d/1.5.2/agent-3d.js on every deploy while the
// version string stayed put, so the bytes behind an immutable URL changed and
// every SRI pin of it broke. Released bytes now come from the archive, each
// file verified against the ledger's hash before it is written. To publish new
// code under a pinned URL, bump package.json and run `npm run release:lib`.
//
// Run after the lib build (`npm run build:lib:full`) and after the frontend
// `vite build`, which empties dist/: see the build:gcp chain.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	LEDGER_REL,
	RELEASE_FILES,
	fetchReleaseFile,
	parseVersion,
	readLedger,
	releasedVersions,
	sri,
} from './lib/agent-3d-releases.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');

const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
const version = pkg.version;
const parsed = parseVersion(version);
if (!parsed) {
	console.error(`[publish-lib] package.json version "${version}" is not semver`);
	process.exit(1);
}
const { major, minor } = parsed;

const ledger = readLedger(root);
if (!ledger.releases[version]) {
	console.error(
		`[publish-lib] package.json is at ${version}, which has never been released, so there are no archived bytes to` +
			` serve at /agent-3d/${version}/. Run \`npm run release:lib\` to release the current build as ${version},` +
			` or set package.json back to a released version (${releasedVersions(ledger).join(', ') || 'none yet'}).`,
	);
	process.exit(1);
}

const srcDir = resolve(root, 'dist-lib');
const destRoot = resolve(root, 'dist', 'agent-3d');
// node_modules/.cache survives between builds and is hardlinked into deploy
// worktrees, so a rebuild verifies cached release bytes instead of refetching.
const cacheDir = resolve(root, 'node_modules', '.cache', 'agent-3d-releases');

// The ES module is required. The UMD build only exists after build:lib:full
// (LIB_FORMATS=es,umd), which is what build:gcp runs; an ES-only lib build
// still lays out the moving channels, and check-dist fails a deploy without it.
const build = {};
for (const name of RELEASE_FILES) {
	const p = resolve(srcDir, name);
	if (existsSync(p)) build[name] = readFileSync(p);
	else if (name === 'agent-3d.js') {
		console.error(`[publish-lib] missing ${p}; run \`npm run build:lib:full\` first`);
		process.exit(1);
	} else console.warn(`[publish-lib] no ${name} in dist-lib/ (ES-only lib build); moving channels ship without it`);
}
const built = Object.keys(build);

mkdirSync(destRoot, { recursive: true });

// Moving channels: the current build.
const moving = [`${major}.${minor}`, String(major), 'latest'];
for (const channel of moving) {
	const outDir = resolve(destRoot, channel);
	mkdirSync(outDir, { recursive: true });
	for (const name of built) writeFileSync(resolve(outDir, name), build[name]);
}

// Immutable versions: the archived release bytes, verified.
const releases = releasedVersions(ledger);
for (const v of releases) {
	const outDir = resolve(destRoot, v);
	mkdirSync(outDir, { recursive: true });
	for (const name of RELEASE_FILES) {
		writeFileSync(resolve(outDir, name), await fetchReleaseFile(ledger, v, name, { cacheDir }));
	}
	writeFileSync(
		resolve(outDir, 'integrity.json'),
		JSON.stringify({ version: v, integrity: ledger.releases[v].integrity }, null, '\t') + '\n',
	);
}

const channels = {};
for (const v of releases) {
	channels[v] = { integrity: ledger.releases[v].integrity, immutable: true, releasedAt: ledger.releases[v].publishedAt };
}
channels[`${major}.${minor}`] = { tracks: `>=${major}.${minor}.0 <${major}.${minor + 1}.0`, build: 'current' };
channels[String(major)] = { tracks: `>=${major}.0.0 <${major + 1}.0.0`, build: 'current' };
channels.latest = { tracks: '*', build: 'current' };

const versions = {
	latest: version,
	channels,
	// The moving channels serve the build deployed at this time; the
	// immutable versions above never change.
	currentBuild: Object.fromEntries(built.map((name) => [name, sri(build[name])])),
	publishedAt: new Date().toISOString(),
};
writeFileSync(resolve(destRoot, 'versions.json'), JSON.stringify(versions, null, '\t') + '\n');

const distLibMirror = resolve(root, 'dist', 'dist-lib');
mkdirSync(distLibMirror, { recursive: true });
for (const name of built) writeFileSync(resolve(distLibMirror, name), build[name]);
console.log('[publish-lib] mirrored dist-lib → dist/dist-lib/');

const sizes = built.map((n) => `${n}: ${(build[n].byteLength / 1024).toFixed(1)} KiB`).join(', ');
console.log(`[publish-lib] current build → dist/agent-3d/{${moving.join(',')}}/  (${sizes})`);
console.log(`[publish-lib] released, from the archive in ${LEDGER_REL}: ${releases.join(', ')}`);
for (const [name, hash] of Object.entries(ledger.releases[version].integrity)) {
	console.log(`[publish-lib]   ${version} ${name}  ${hash}`);
}
