#!/usr/bin/env node
// Write the winget manifests for a released three-ws-agent version.
//
//   node distributions/winget/scripts/generate-manifests.mjs [--version <v>]
//       From data/agent-cli-releases.json (default: the newest release), into
//       distributions/winget/manifests/t/ThreeWs/Agent/<v>/. That folder is
//       exactly what goes into a microsoft/winget-pkgs pull request.
//
//   node distributions/winget/scripts/generate-manifests.mjs \
//       --release-json packages/agent-cli/dist/windows/release.json \
//       --base-url https://example.test/agent-cli/0.2.0 --out <dir>
//       From a local build and wherever its zips are staged, for verifying a
//       build on Windows before it is archived.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { manifestDir, manifestFileNames, renderManifest, wingetManifests } from './manifests.mjs';

const wingetDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const root = resolve(wingetDir, '..', '..');

export function compareSemver(a, b) {
	const pa = a.split(/[.-]/).map((x) => (/^\d+$/.test(x) ? Number(x) : x));
	const pb = b.split(/[.-]/).map((x) => (/^\d+$/.test(x) ? Number(x) : x));
	for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
		if (pa[i] === pb[i]) continue;
		if (pa[i] === undefined) return -1;
		if (pb[i] === undefined) return 1;
		return pa[i] > pb[i] ? 1 : -1;
	}
	return 0;
}

/** Installer inputs for a ledger release: public archive URL and sha256 per arch. */
export function installersFromLedger(ledger, version) {
	const rel = ledger.releases[version];
	if (!rel) throw new Error(`version ${version} is not in data/agent-cli-releases.json; release it first`);
	const installers = {};
	for (const [arch, a] of Object.entries(rel.artifacts)) installers[arch] = { url: `${ledger.archive}/${version}/${a.file}`, sha256: a.sha256 };
	return { version, releaseDate: rel.releaseDate, installers };
}

export function writeManifests(outDir, input) {
	mkdirSync(outDir, { recursive: true });
	const data = wingetManifests(input);
	const names = manifestFileNames();
	const written = [];
	for (const kind of Object.keys(names)) {
		const file = join(outDir, names[kind]);
		writeFileSync(file, renderManifest(kind, data[kind]));
		written.push(file);
	}
	return written;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	const { values } = parseArgs({
		options: {
			version: { type: 'string' },
			'release-json': { type: 'string' },
			'base-url': { type: 'string' },
			out: { type: 'string' },
		},
	});
	let input;
	let outDir;
	if (values['release-json']) {
		if (!values['base-url'] || !values.out) throw new Error('--release-json needs --base-url and --out');
		const rel = JSON.parse(readFileSync(resolve(values['release-json']), 'utf8'));
		const base = values['base-url'].replace(/\/+$/, '');
		input = {
			version: rel.version,
			releaseDate: rel.releaseDate,
			installers: Object.fromEntries(Object.entries(rel.artifacts).map(([arch, a]) => [arch, { url: `${base}/${a.file}`, sha256: a.sha256 }])),
		};
		outDir = resolve(values.out);
	} else {
		const ledger = JSON.parse(readFileSync(join(root, 'data', 'agent-cli-releases.json'), 'utf8'));
		const version = values.version || Object.keys(ledger.releases).sort(compareSemver).at(-1);
		if (!version) throw new Error('data/agent-cli-releases.json has no releases yet');
		input = installersFromLedger(ledger, version);
		outDir = values.out ? resolve(values.out) : join(wingetDir, manifestDir(version));
	}
	for (const f of writeManifests(outDir, input)) console.log(`[winget] wrote ${f}`);
}
