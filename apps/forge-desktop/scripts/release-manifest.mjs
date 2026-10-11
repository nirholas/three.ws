#!/usr/bin/env node
// Describe the built artifacts of one three.ws Forge version as release.json,
// the file https://three.ws/forge-desktop reads to list every download with its
// size and SHA-256.
//
//   node apps/forge-desktop/scripts/release-manifest.mjs [--dist dist] [--base-url URL]
//        [--merge path/to/current-release.json] [--out dist/release.json]
//
// Classification, hashing and the cross-platform merge are shared with
// three.ws Desktop (apps/desktop/scripts/release-manifest.mjs), so both apps
// publish the same release.json shape from the same bucket. Only the product,
// the feed URL, the OS floors and the release history differ.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describeArtifacts, mergeManifest } from '../../desktop/scripts/release-manifest.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = resolve(HERE, '..');

export const PRODUCT = 'three.ws Forge';
export const DEFAULT_BASE_URL = 'https://three.ws/releases/forge';

// Electron 42 supports macOS 12 and later and Windows 10 and later. The mac
// build is arm64 only because the bundled CPython is per-architecture. Local
// GPU generation additionally needs an NVIDIA GPU (CUDA), an AMD Radeon GPU
// (ROCm, Windows and Linux) or Apple silicon;
// cloud generation runs on any of these.
export const MINIMUM_OS = {
  mac: 'macOS 12 Monterey or later on Apple silicon',
  win: 'Windows 10 or 11, 64-bit',
  linux: '64-bit Ubuntu 20.04+, Debian 11+, Fedora 39+ or another current glibc distribution',
};

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
  if (!release) throw new Error(`${pkg.version} has no entry in apps/forge-desktop/releases.json. Add one (version, date, notes) before building.`);
  if (!existsSync(args.dist)) throw new Error(`${args.dist} does not exist. Build first (npm run package:<platform>).`);
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
  const manifest = mergeManifest({ version: pkg.version, date: release.date, notes: release.notes, files }, previous, { product: PRODUCT, minimumOS: MINIMUM_OS });
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
