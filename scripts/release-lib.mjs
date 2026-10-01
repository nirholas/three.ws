#!/usr/bin/env node
// Cut an <agent-3d> CDN release: archive the bytes of package.json's version
// once, record their SRI hashes in data/agent-3d-releases.json, and rewrite any
// documented pin of that version to match. From then on every build serves
// exactly these bytes at /agent-3d/<version>/ (scripts/publish-lib.mjs), so the
// immutable URL and its integrity hash hold for as long as the release exists.
//
//   npm run release:lib
//       Build the lib (build:lib:full), then release the bytes in dist-lib/ as
//       package.json's version. Bump the version first: an already-released
//       version is never re-cut.
//
//   node scripts/release-lib.mjs --from https://three.ws
//       Adopt the bytes a live origin already serves for package.json's version
//       instead of dist-lib/. This is how 1.5.2 was frozen at the bytes
//       production was serving, so pins taken from it keep working.
//
//   --dry-run   compute and print the hashes, upload nothing, write nothing.
//
// The archive is a public-read GCS bucket. Uploads use an if-generation-match=0
// precondition, so an existing archived file is never overwritten: re-running
// a release whose bytes are already archived is a no-op, and a re-run with
// different bytes fails instead of altering a published version.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import './lib/gcloud-path.mjs';
import {
	LEDGER_REL,
	RELEASE_FILES,
	archiveUrl,
	checkPins,
	fetchReleaseFile,
	parseVersion,
	readLedger,
	sri,
	writeLedger,
} from './lib/agent-3d-releases.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const fromIdx = args.indexOf('--from');
const from = fromIdx >= 0 ? args[fromIdx + 1] : null;
if (fromIdx >= 0 && !from) {
	console.error('[release-lib] --from needs an origin, e.g. --from https://three.ws');
	process.exit(1);
}

const version = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')).version;
if (!parseVersion(version)) {
	console.error(`[release-lib] package.json version "${version}" is not semver`);
	process.exit(1);
}

const ledger = readLedger(root);
const archive = new URL(ledger.archive);
if (archive.hostname !== 'storage.googleapis.com') {
	console.error(`[release-lib] ${LEDGER_REL} archive must be a storage.googleapis.com URL, got ${ledger.archive}`);
	process.exit(1);
}
const [bucket, ...prefixParts] = archive.pathname.replace(/^\/+|\/+$/g, '').split('/');
const gsBase = `gs://${bucket}/${prefixParts.join('/')}`;

async function sourceBytes(file) {
	if (from) {
		const url = `${from.replace(/\/+$/, '')}/agent-3d/${version}/${file}`;
		const res = await fetch(url, { signal: AbortSignal.timeout(120_000) });
		if (!res.ok) throw new Error(`${url} answered ${res.status}`);
		return Buffer.from(await res.arrayBuffer());
	}
	const p = resolve(root, 'dist-lib', file);
	if (!existsSync(p)) throw new Error(`missing ${p}; run \`npm run build:lib:full\` first`);
	return readFileSync(p);
}

const files = {};
for (const file of RELEASE_FILES) {
	const bytes = await sourceBytes(file);
	files[file] = { bytes, integrity: sri(bytes) };
	console.log(`[release-lib] ${version} ${file}  ${files[file].integrity}  (${(bytes.length / 1024).toFixed(1)} KiB)`);
}

const existing = ledger.releases[version];
if (existing) {
	const same = RELEASE_FILES.every((f) => existing.integrity?.[f] === files[f].integrity);
	if (!same) {
		console.error(
			`[release-lib] ${version} is already released with different bytes. A released version never changes;` +
				' bump package.json to a new version and release that.',
		);
		process.exit(1);
	}
	console.log(`[release-lib] ${version} is already released with exactly these bytes; nothing to do.`);
	process.exit(0);
}

if (dryRun) {
	console.log('[release-lib] --dry-run: nothing uploaded, ledger unchanged.');
	process.exit(0);
}

const CONTENT_TYPE = { 'agent-3d.js': 'text/javascript; charset=utf-8', 'agent-3d.umd.cjs': 'text/javascript; charset=utf-8' };

function gcloud(argv) {
	return execFileSync('gcloud', argv, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

const work = mkdtempSync(join(tmpdir(), 'agent-3d-release-'));
try {
	for (const file of RELEASE_FILES) {
		const local = join(work, file);
		writeFileSync(local, files[file].bytes);
		const dest = `${gsBase}/${version}/${file}`;
		try {
			gcloud([
				'storage',
				'cp',
				local,
				dest,
				'--if-generation-match=0',
				`--content-type=${CONTENT_TYPE[file]}`,
				'--cache-control=public, max-age=31536000, immutable',
			]);
			console.log(`[release-lib] archived ${dest}`);
		} catch (err) {
			const stderr = String(err.stderr || err.message);
			if (!/precondition|412|already exists/i.test(stderr)) throw new Error(`upload of ${dest} failed: ${stderr.trim()}`);
			console.log(`[release-lib] ${dest} already archived; verifying it holds these bytes`);
		}
	}
} finally {
	rmSync(work, { recursive: true, force: true });
}

// Read every file back through the public URL the build fetches from, so a
// release is only recorded once the archive demonstrably serves its bytes.
const entry = {
	publishedAt: new Date().toISOString(),
	source: from ? `${from.replace(/\/+$/, '')}/agent-3d/${version}/` : 'dist-lib/',
	integrity: Object.fromEntries(RELEASE_FILES.map((f) => [f, files[f].integrity])),
};
const probe = { ...ledger, releases: { ...ledger.releases, [version]: entry } };
for (const file of RELEASE_FILES) {
	await fetchReleaseFile(probe, version, file);
	console.log(`[release-lib] verified ${archiveUrl(probe, version, file)}`);
}

writeLedger(root, probe);
console.log(`[release-lib] recorded ${version} in ${LEDGER_REL}`);

const pins = checkPins(root, probe, { fix: true });
console.log(`[release-lib] documented pins: ${pins.checked} checked, ${pins.fixed} rewritten to the released hash`);
for (const p of pins.problems) console.log(`[release-lib]   ${p.file}:${p.line} ${p.message}`);
console.log(`[release-lib] commit ${LEDGER_REL} and any rewritten docs; the next deploy serves ${version} from the archive.`);
