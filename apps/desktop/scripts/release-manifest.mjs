#!/usr/bin/env node
// Describe the built artifacts of one three.ws Desktop version as release.json,
// the file /desktop reads to list every download with its size and SHA-256.
//
//   node apps/desktop/scripts/release-manifest.mjs [--dist dist] [--base-url URL]
//        [--merge path/to/current-release.json] [--out dist/release.json]
//
// Builds happen in two places (Cloud Build for Linux and Windows, a Mac for
// macOS), so each run merges with the manifest already published: files for
// the platforms this run did not build are kept when the version matches, and
// dropped when the published manifest is for an older version.
//
// Signing state comes from the environment the release scripts set:
// THREE_WS_SIGNED_MAC=1 / THREE_WS_SIGNED_WIN=1 mark that platform's files
// signed; anything else marks them unsigned, which /desktop turns into the
// "Open Anyway" / "Run anyway" instructions.

import { createHash } from 'node:crypto';
import { createReadStream, existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = resolve(HERE, '..');

export const DEFAULT_BASE_URL = 'https://three.ws/releases/desktop';

// What each platform needs, shown on /desktop. Electron 33 is Chromium 130:
// macOS 11 and Windows 10 are its floors, and its Linux floor is Chrome's.
export const MINIMUM_OS = {
	mac: 'macOS 11 Big Sur or later (Apple silicon and Intel)',
	win: 'Windows 10 or 11, 64-bit',
	linux: '64-bit Ubuntu 18.04+, Debian 10+, Fedora 39+ or another distribution with glibc 2.28+',
};

// Filename patterns electron-builder.config.cjs produces, most specific first.
const KINDS = [
	{ re: /-mac-universal\.dmg$/, platform: 'mac', arch: 'universal', kind: 'dmg', label: 'Disk image (.dmg)', primary: true },
	{ re: /-mac-universal\.zip$/, platform: 'mac', arch: 'universal', kind: 'zip', label: 'Zip archive (.zip)' },
	{ re: /-win-(x64|arm64)-setup\.exe$/, platform: 'win', kind: 'nsis', label: 'Installer (.exe)', primary: true },
	{ re: /-win-(x64|arm64)-portable\.exe$/, platform: 'win', kind: 'portable', label: 'Portable (.exe, no install)' },
	{ re: /-linux-(x86_64|x64|arm64|aarch64)\.AppImage$/, platform: 'linux', kind: 'appimage', label: 'AppImage', primary: true },
	{ re: /-linux-(amd64|x64|arm64)\.deb$/, platform: 'linux', kind: 'deb', label: 'Debian / Ubuntu (.deb)' },
];

const ARCH = { x86_64: 'x64', amd64: 'x64', x64: 'x64', arm64: 'arm64', aarch64: 'arm64', universal: 'universal' };

export function classify(name) {
	for (const k of KINDS) {
		const m = k.re.exec(name);
		if (!m) continue;
		const arch = ARCH[k.arch || m[1]] || m[1];
		return { platform: k.platform, arch, kind: k.kind, label: k.label, primary: Boolean(k.primary) };
	}
	return null;
}

export function sha256File(path) {
	return new Promise((resolvePromise, reject) => {
		const hash = createHash('sha256');
		createReadStream(path)
			.on('data', (chunk) => hash.update(chunk))
			.on('error', reject)
			.on('end', () => resolvePromise(hash.digest('hex')));
	});
}

export async function describeArtifacts(dist, { baseUrl = DEFAULT_BASE_URL, signed = {} } = {}) {
	const files = [];
	for (const name of readdirSync(dist).sort()) {
		const path = join(dist, name);
		if (!statSync(path).isFile()) continue;
		const c = classify(name);
		if (!c) continue;
		files.push({
			...c,
			name,
			url: `${baseUrl.replace(/\/$/, '')}/${encodeURIComponent(name)}`,
			size: statSync(path).size,
			sha256: await sha256File(path),
			signed: Boolean(signed[c.platform]),
		});
	}
	return files;
}

// Keep the other platforms' files from the published manifest when it is the
// same version; this run's platforms always replace what was there.
export function mergeManifest({ version, date, notes, files }, previous) {
	const built = new Set(files.map((f) => f.platform));
	const carried = previous && previous.version === version ? (previous.files || []).filter((f) => !built.has(f.platform)) : [];
	const order = { mac: 0, win: 1, linux: 2 };
	const all = [...files, ...carried].sort((a, b) => order[a.platform] - order[b.platform] || Number(b.primary) - Number(a.primary) || a.name.localeCompare(b.name));
	return {
		schema: 1,
		product: 'three.ws Desktop',
		version,
		date: previous && previous.version === version && previous.date ? previous.date : date,
		notes,
		minimumOS: MINIMUM_OS,
		platforms: [...new Set(all.map((f) => f.platform))],
		files: all,
	};
}

function parseArgs(argv) {
	const out = { dist: join(APP, 'dist'), baseUrl: process.env.THREE_WS_RELEASE_FEED || DEFAULT_BASE_URL, merge: null, out: null };
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (a === '--dist') out.dist = resolve(argv[++i]);
		else if (a === '--base-url') out.baseUrl = argv[++i];
		else if (a === '--merge') out.merge = resolve(argv[++i]);
		else if (a === '--out') out.out = resolve(argv[++i]);
		else throw new Error(`Unknown argument: ${a}`);
	}
	out.out ||= join(out.dist, 'release.json');
	return out;
}

async function main() {
	const args = parseArgs(process.argv.slice(2));
	const pkg = JSON.parse(readFileSync(join(APP, 'package.json'), 'utf8'));
	const history = JSON.parse(readFileSync(join(APP, 'releases.json'), 'utf8'));
	const release = history.releases.find((r) => r.version === pkg.version);
	if (!release) throw new Error(`${pkg.version} has no entry in releases.json. Cut the version with scripts/bump-version.mjs first.`);
	if (!existsSync(args.dist)) throw new Error(`${args.dist} does not exist. Build first (npm run dist:<platform>).`);
	const files = await describeArtifacts(args.dist, {
		baseUrl: args.baseUrl,
		signed: { mac: process.env.THREE_WS_SIGNED_MAC === '1', win: process.env.THREE_WS_SIGNED_WIN === '1', linux: false },
	});
	if (!files.length) throw new Error(`No release artifacts found in ${args.dist}.`);
	let previous = null;
	if (args.merge && existsSync(args.merge)) {
		try {
			previous = JSON.parse(readFileSync(args.merge, 'utf8'));
		} catch {
			throw new Error(`${args.merge} is not valid JSON`);
		}
	}
	const manifest = mergeManifest({ version: pkg.version, date: release.date, notes: release.notes, files }, previous);
	writeFileSync(args.out, `${JSON.stringify(manifest, null, '\t')}\n`);
	console.log(`[release-manifest] ${manifest.product} ${manifest.version}: ${manifest.files.length} file(s) -> ${args.out}`);
	for (const f of manifest.files) console.log(`  ${f.platform.padEnd(5)} ${f.kind.padEnd(8)} ${String(f.size).padStart(11)}  ${f.sha256}  ${f.name}${f.signed ? '' : '  (unsigned)'}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
	main().catch((err) => {
		console.error(`[release-manifest] ${err.message}`);
		process.exit(1);
	});
}
