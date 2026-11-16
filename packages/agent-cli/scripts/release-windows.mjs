#!/usr/bin/env node
// Archive a standalone Windows build of three-ws-agent and record it.
//
//   node packages/agent-cli/scripts/build-windows.mjs
//   node packages/agent-cli/scripts/release-windows.mjs [--dry-run]
//
// Uploads the zips and SHA256SUMS from packages/agent-cli/dist/windows/ to the
// write-once public archive (gs://three-ws-lib-releases/agent-cli/<version>/),
// reads each file back through its public URL and checks its SHA256, then
// records the release in data/agent-cli-releases.json, which the winget
// manifests are generated from. Uploads use an if-generation-match=0
// precondition and the bucket has a retention policy: a published version's
// bytes never change. Re-running with identical bytes is a no-op; different
// bytes for a released version fail. Bump packages/agent-cli/package.json to
// release new bytes.

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { sha256 } from './lib/windows-release.mjs';

const pkgDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const root = resolve(pkgDir, '..', '..');
const LEDGER = join(root, 'data', 'agent-cli-releases.json');
const log = (m) => console.log(`[release-windows] ${m}`);

const { values } = parseArgs({ options: { 'dry-run': { type: 'boolean', default: false }, dist: { type: 'string', default: join(pkgDir, 'dist', 'windows') } } });
const dist = resolve(values.dist);
const releasePath = join(dist, 'release.json');
if (!existsSync(releasePath)) throw new Error(`missing ${releasePath}; run packages/agent-cli/scripts/build-windows.mjs first`);
const release = JSON.parse(readFileSync(releasePath, 'utf8'));
const pkgVersion = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8')).version;
if (release.version !== pkgVersion) throw new Error(`dist/windows holds ${release.version} but package.json is ${pkgVersion}; rebuild`);

const ledger = JSON.parse(readFileSync(LEDGER, 'utf8'));
const archive = new URL(ledger.archive);
if (archive.hostname !== 'storage.googleapis.com') throw new Error(`ledger archive must be a storage.googleapis.com URL, got ${ledger.archive}`);
const gsBase = `gs://${archive.pathname.replace(/^\/+|\/+$/g, '')}`;
const v = release.version;

const files = Object.values(release.artifacts).map((a) => {
	const bytes = readFileSync(join(dist, a.file));
	if (sha256(bytes) !== a.sha256) throw new Error(`${a.file} does not match release.json; rebuild`);
	return { file: a.file, bytes, sha256: a.sha256, type: 'application/zip' };
});
const sums = readFileSync(join(dist, 'SHA256SUMS'));
files.push({ file: 'SHA256SUMS', bytes: sums, sha256: sha256(sums), type: 'text/plain; charset=utf-8' });

const existing = ledger.releases[v];
if (existing) {
	const same = Object.entries(release.artifacts).every(([arch, a]) => existing.artifacts?.[arch]?.sha256 === a.sha256);
	if (!same) throw new Error(`${v} is already released with different bytes. A released version never changes; bump packages/agent-cli/package.json.`);
	log(`${v} is already released with exactly these bytes; nothing to do.`);
	process.exit(0);
}
for (const f of files) log(`${v}/${f.file}  sha256 ${f.sha256}  (${(f.bytes.length / 1024 / 1024).toFixed(1)} MiB)`);
if (values['dry-run']) {
	log('--dry-run: nothing uploaded, ledger unchanged.');
	process.exit(0);
}

for (const f of files) {
	const dest = `${gsBase}/${v}/${f.file}`;
	try {
		execFileSync(
			'gcloud',
			['storage', 'cp', join(dist, f.file), dest, '--if-generation-match=0', `--content-type=${f.type}`, '--cache-control=public, max-age=31536000, immutable'],
			{ encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
		);
		log(`archived ${dest}`);
	} catch (err) {
		const stderr = String(err.stderr || err.message);
		if (!/precondition|412|already exists/i.test(stderr)) throw new Error(`upload of ${dest} failed: ${stderr.trim()}`);
		log(`${dest} already archived; verifying it holds these bytes`);
	}
}

// Only record what the public archive demonstrably serves.
for (const f of files) {
	const url = `${ledger.archive}/${v}/${f.file}`;
	const res = await fetch(url, { signal: AbortSignal.timeout(300_000), cache: 'no-store' });
	if (!res.ok) throw new Error(`${url} answered ${res.status}`);
	const got = sha256(Buffer.from(await res.arrayBuffer()));
	if (got !== f.sha256) throw new Error(`${url} serves sha256 ${got}, expected ${f.sha256}`);
	log(`verified ${url}`);
}

ledger.releases[v] = {
	publishedAt: new Date().toISOString(),
	releaseDate: release.releaseDate,
	nodeVersion: release.nodeVersion,
	artifacts: Object.fromEntries(
		Object.entries(release.artifacts).map(([arch, a]) => [arch, { file: a.file, sha256: a.sha256, size: a.size, exeSha256: a.exeSha256, exeSize: a.exeSize }]),
	),
};
writeFileSync(LEDGER, `${JSON.stringify(ledger, null, '\t')}\n`);
log(`recorded ${v} in data/agent-cli-releases.json`);
log('next: node distributions/winget/scripts/generate-manifests.mjs');
