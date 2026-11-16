#!/usr/bin/env node
// Build the standalone Windows three-ws-agent.exe (x64 and arm64): one file,
// Node.js built in, nothing to install first. This is what winget installs.
//
//   node packages/agent-cli/scripts/build-windows.mjs [--arch x64,arm64] [--out <dir>] [--host]
//
// Steps, all verified:
//   1. Bundle bin/three-ws-agent.js and everything it imports into one ES
//      module with esbuild (src/http.js gets the version as a literal, since a
//      single executable has no package.json beside it).
//   2. Download the pinned Node.js release's official win-<arch>/node.exe and
//      a host build of the same version from nodejs.org, each checked against
//      that release's SHASUMS256.txt.
//   3. `node --build-sea` (Node's built-in SEA builder, run by the pinned host
//      Node so blob and runtime versions match) injects the bundle into each
//      node.exe. The now-invalid OpenJS signature is stripped.
//   4. Zip each exe with LICENSE and a README into a reproducible archive, and
//      write SHA256SUMS plus release.json next to the zips.
//
// --host also builds a single executable for the build machine itself from the
// same bundle and smoke-runs it, so a broken bundle fails here, not on Windows.
//
// Output (default packages/agent-cli/dist/windows/, git-ignored):
//   three-ws-agent-<version>-win-x64.zip, three-ws-agent-<version>-win-arm64.zip,
//   SHA256SUMS, release.json, and the unzipped exes under win-<arch>/.

import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import {
	ARCHES,
	EXE_NAME,
	NODE_VERSION,
	assertShasum,
	deterministicZip,
	hasAuthenticode,
	hostNodeArchive,
	nodeDistUrl,
	parseShasums,
	peMachine,
	sha256,
	stripAuthenticode,
	windowsNodeExePath,
	zipName,
	zipReadme,
} from './lib/windows-release.mjs';
import { buildSea, bundleCli, seaAssets } from './lib/sea-bundle.mjs';

const pkgDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8'));
const log = (msg) => console.log(`[build-windows] ${msg}`);

const { values } = parseArgs({
	options: {
		arch: { type: 'string', default: ARCHES.map((a) => a.node).join(',') },
		out: { type: 'string', default: join(pkgDir, 'dist', 'windows') },
		host: { type: 'boolean', default: false },
	},
});
const arches = values.arch.split(',').map((s) => s.trim()).filter(Boolean);
for (const a of arches) {
	if (!ARCHES.some((x) => x.node === a)) throw new Error(`--arch ${a}: supported are ${ARCHES.map((x) => x.node).join(', ')}`);
}
const outDir = resolve(values.out);
const cacheDir = join(process.env.XDG_CACHE_HOME || join(homedir(), '.cache'), 'three-ws', 'node-dist', `v${NODE_VERSION}`);

async function download(url) {
	for (let attempt = 1; ; attempt++) {
		try {
			const res = await fetch(url, { signal: AbortSignal.timeout(600_000) });
			if (!res.ok) throw new Error(`${url} answered ${res.status}`);
			return Buffer.from(await res.arrayBuffer());
		} catch (err) {
			if (attempt >= 3) throw err;
			log(`retrying ${url} after: ${err.message}`);
			await new Promise((r) => setTimeout(r, 2000 * attempt));
		}
	}
}

/** Fetch a file from the pinned Node release, cached on disk, always hash-checked. */
async function nodeDistFile(sums, file) {
	const cached = join(cacheDir, file);
	if (existsSync(cached)) {
		const bytes = readFileSync(cached);
		try {
			assertShasum(sums, file, bytes);
			return bytes;
		} catch {
			log(`cached ${file} failed its checksum; downloading again`);
		}
	}
	log(`downloading ${nodeDistUrl(NODE_VERSION, file)}`);
	const bytes = await download(nodeDistUrl(NODE_VERSION, file));
	assertShasum(sums, file, bytes);
	mkdirSync(dirname(cached), { recursive: true });
	writeFileSync(cached, bytes);
	return bytes;
}

/** A node binary of exactly NODE_VERSION for this machine, to run --build-sea. */
async function hostNode(sums) {
	if (process.versions.node === NODE_VERSION) return process.execPath;
	const archive = hostNodeArchive(NODE_VERSION);
	const bin = join(cacheDir, 'host', process.platform === 'win32' ? 'node.exe' : 'node');
	if (existsSync(bin)) return bin;
	const bytes = await nodeDistFile(sums, archive);
	const dir = join(cacheDir, 'host');
	mkdirSync(dir, { recursive: true });
	const archivePath = join(cacheDir, archive);
	const top = archive.replace(/\.(tar\.xz|tar\.gz|zip)$/, '');
	if (archive.endsWith('.zip')) {
		const { unzipSync } = await import('fflate');
		writeFileSync(bin, unzipSync(bytes, { filter: (f) => f.name === `${top}/node.exe` })[`${top}/node.exe`]);
	} else {
		execFileSync('tar', ['-xf', archivePath, '-C', dir, '--strip-components=2', `${top}/bin/node`], { stdio: 'inherit' });
		chmodSync(bin, 0o755);
	}
	const v = execFileSync(bin, ['--version'], { encoding: 'utf8' }).trim();
	if (v !== `v${NODE_VERSION}`) throw new Error(`host node reports ${v}, expected v${NODE_VERSION}`);
	return bin;
}

const sums = parseShasums((await download(nodeDistUrl(NODE_VERSION, 'SHASUMS256.txt'))).toString('utf8'));
const nodeBin = await hostNode(sums);
log(`node ${NODE_VERSION} for --build-sea: ${nodeBin}`);

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });
const bundleFile = join(outDir, 'bundle', 'three-ws-agent.mjs');
mkdirSync(dirname(bundleFile), { recursive: true });
const bundled = await bundleCli({
	pkgDir,
	entry: join(pkgDir, 'bin', 'three-ws-agent.js'),
	outfile: bundleFile,
	version: pkg.version,
	nodeMajor: NODE_VERSION.split('.')[0],
});
log(`bundled ${bundled.modules} modules into ${bundleFile} (${(bundled.bytes / 1024 / 1024).toFixed(2)} MiB)`);
const assets = seaAssets(pkgDir);

if (values.host) {
	const hostDir = join(outDir, 'host');
	mkdirSync(hostDir, { recursive: true });
	const hostExe = join(hostDir, process.platform === 'win32' ? EXE_NAME : 'three-ws-agent');
	buildSea(nodeBin, { main: bundleFile, executable: nodeBin, output: hostExe, assets });
	const v = execFileSync(hostExe, ['--version'], { encoding: 'utf8', env: { ...process.env, NODE_OPTIONS: '' } }).trim();
	if (v !== pkg.version) throw new Error(`host smoke run printed "${v}", expected ${pkg.version}`);
	log(`host executable ${hostExe} runs: --version = ${v}`);
}

const license = readFileSync(join(pkgDir, 'LICENSE'));
// Pinned to the release's own day so a rebuild of the same version reproduces the same zip bytes.
const mtime = new Date(`${process.env.THREE_WS_RELEASE_DATE || new Date().toISOString().slice(0, 10)}T00:00:00Z`);
const release = { name: pkg.name, version: pkg.version, nodeVersion: NODE_VERSION, releaseDate: mtime.toISOString().slice(0, 10), artifacts: {} };

for (const arch of arches) {
	const nodeExeBytes = await nodeDistFile(sums, windowsNodeExePath(arch));
	const archDir = join(outDir, `win-${arch}`);
	mkdirSync(archDir, { recursive: true });
	const stockExe = join(archDir, 'node.exe');
	writeFileSync(stockExe, nodeExeBytes);
	const exePath = join(archDir, EXE_NAME);
	buildSea(nodeBin, { main: bundleFile, executable: stockExe, output: exePath, assets });
	rmSync(stockExe);

	let exe = readFileSync(exePath);
	if (peMachine(exe) !== arch) throw new Error(`${exePath} is a ${peMachine(exe)} binary, expected ${arch}`);
	if (hasAuthenticode(exe)) {
		exe = stripAuthenticode(exe).bytes;
		writeFileSync(exePath, exe);
		log(`win-${arch}: stripped the invalidated node.exe signature`);
	}
	if (!exe.includes(Buffer.from('NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2:1'))) throw new Error(`${exePath}: SEA fuse not flipped`);

	const zip = deterministicZip(
		[
			[EXE_NAME, exe],
			['LICENSE', license],
			['README.txt', Buffer.from(zipReadme({ version: pkg.version, arch, nodeVersion: NODE_VERSION }))],
		],
		mtime,
	);
	const name = zipName(pkg.version, arch);
	writeFileSync(join(outDir, name), zip);
	release.artifacts[arch] = { file: name, sha256: sha256(zip), size: zip.length, exeSha256: sha256(exe), exeSize: exe.length };
	log(`${name}  sha256 ${release.artifacts[arch].sha256}  (${(zip.length / 1024 / 1024).toFixed(1)} MiB zip, ${(exe.length / 1024 / 1024).toFixed(1)} MiB exe)`);
}

writeFileSync(
	join(outDir, 'SHA256SUMS'),
	Object.values(release.artifacts)
		.map((a) => `${a.sha256}  ${a.file}\n`)
		.join(''),
);
writeFileSync(join(outDir, 'release.json'), `${JSON.stringify(release, null, '\t')}\n`);
log(`wrote ${join(outDir, 'SHA256SUMS')} and release.json`);
