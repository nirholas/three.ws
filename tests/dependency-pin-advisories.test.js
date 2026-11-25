// Guards the 2026-10-24 dependency sweep's two claimed-but-unverified fixes
// (prompt 429): the zod memory-exhaustion advisory (GHSA-mrhx-c7xc-m3w5) and
// the toml DoS/prototype-pollution advisories reaching @coral-xyz/anchor.
// Reads package-lock.json directly: offline, deterministic, no `npm audit`.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const LOCKFILE = resolve(HERE, '../package-lock.json');

const lock = JSON.parse(readFileSync(LOCKFILE, 'utf8'));

// Manual tuple compare: semver is not already a dependency, and the only
// versions in play here (3.25.76 vs 4.6.6/4.6.7, 3.0.0 vs 5.0.1) are plain
// dotted integers with no prerelease tags.
function gte(version, minimum) {
	const a = version.split('.').map(Number);
	const b = minimum.split('.').map(Number);
	for (let i = 0; i < Math.max(a.length, b.length); i++) {
		const x = a[i] || 0;
		const y = b[i] || 0;
		if (x !== y) return x > y;
	}
	return true;
}

describe('dependency-pin advisories (prompt 429)', () => {
	it('root node_modules/zod resolves to a version >= 4.6.6 (GHSA-mrhx-c7xc-m3w5)', () => {
		const pkg = lock.packages['node_modules/zod'];
		expect(pkg).toBeTruthy();
		expect(gte(pkg.version, '4.6.6')).toBe(true);
	});

	it('the toml instance @coral-xyz/anchor@0.32.1 actually resolves to a version >= 5.0.1', () => {
		// `npm ls toml` shows the root @coral-xyz/anchor@0.32.1 dependency
		// resolving the hoisted top-level node_modules/toml entry (no nested
		// override needed for that instance).
		const pkg = lock.packages['node_modules/toml'];
		expect(pkg).toBeTruthy();
		expect(gte(pkg.version, '5.0.1')).toBe(true);
	});
});

describe('dependency-pin advisories (prompt 444)', () => {
	it('every fast-xml-parser copy in the lockfile resolves to a version >= 5.7.0 (GHSA-gh4j-gqv2-49f6)', () => {
		const paths = Object.keys(lock.packages).filter(
			(p) => p === 'node_modules/fast-xml-parser' || p.endsWith('/node_modules/fast-xml-parser'),
		);
		expect(paths.length).toBeGreaterThan(0);
		const vulnerable = paths
			.filter((p) => !gte(lock.packages[p].version, '5.7.0'))
			.map((p) => `${p}@${lock.packages[p].version}`);
		expect(vulnerable).toEqual([]);
	});
});

// 2026-11-25 sweep: every lockfile Dependabot or OSV flagged. Each check reads
// the lockfile as committed, so a regenerated lock that drops an override or
// pulls an old copy back in fails here before the alert reopens.
function lockPackages(rel) {
	return JSON.parse(readFileSync(resolve(HERE, '..', rel), 'utf8')).packages;
}

function copiesOf(packages, name) {
	return Object.keys(packages).filter(
		(p) => p === `node_modules/${name}` || p.endsWith(`/node_modules/${name}`),
	);
}

function below(packages, name, minimum, floor = '0.0.0') {
	return copiesOf(packages, name)
		.map((p) => `${p}@${packages[p].version}`)
		.filter((entry) => {
			const v = entry.slice(entry.lastIndexOf('@') + 1);
			return gte(v, floor) && !gte(v, minimum);
		});
}

function cargoVersions(rel, name) {
	const text = readFileSync(resolve(HERE, '..', rel), 'utf8');
	const re = new RegExp(`name = "${name}"\\nversion = "([^"]+)"`, 'g');
	return [...text.matchAll(re)].map((m) => m[1]);
}

describe('dependency-pin advisories (2026-11-25 sweep)', () => {
	const GLOB_LOCKS = [
		'package-lock.json',
		'apps/hq/package-lock.json',
		'contracts/agent-invocation/package-lock.json',
		'contracts/skill-license/package-lock.json',
		'contracts/lib/openzeppelin-contracts/package-lock.json',
		'solana-agent-sdk/package-lock.json',
		'integrations/microsoft/pnp-samples/sp-dev-fx-webparts/react-threews-3d-viewer/package-lock.json',
	];

	for (const rel of GLOB_LOCKS) {
		it(`${rel} has no glob copy in the 9.0.0 - 14.0.1 AbortSignal traversal range`, () => {
			expect(below(lockPackages(rel), 'glob', '14.0.2', '9.0.0')).toEqual([]);
		});
	}

	for (const rel of ['integrations/n8n/package-lock.json', 'integrations/webflow/package-lock.json']) {
		it(`${rel} resolves every zod copy to >= 4.6.6 (GHSA-mrhx-c7xc-m3w5)`, () => {
			const packages = lockPackages(rel);
			expect(copiesOf(packages, 'zod').length).toBeGreaterThan(0);
			expect(below(packages, 'zod', '4.6.6')).toEqual([]);
		});
	}

	it('infra aws-cdk-lib bundles minimatch >= 11.0.1', () => {
		const packages = lockPackages('infra/package-lock.json');
		expect(copiesOf(packages, 'minimatch').length).toBeGreaterThan(0);
		expect(below(packages, 'minimatch', '11.0.1')).toEqual([]);
	});

	it('image-blaster resolves the patched vite, vitest, esbuild and postcss chain', () => {
		const packages = lockPackages('third_party/image-blaster/app/package-lock.json');
		const floors = {
			vite: '7.3.7',
			vitest: '4.1.11',
			esbuild: '0.25.0',
			postcss: '8.5.23',
			nanoid: '3.3.18',
			'@babel/core': '7.29.6',
			browserslist: '4.28.7',
			colord: '2.9.4',
			'postcss-selector-parser': '6.1.5',
			'source-map-js': '1.2.2',
		};
		const stale = Object.entries(floors).flatMap(([name, min]) => below(packages, name, min));
		expect(stale).toEqual([]);
		expect(below(packages, 'fflate', '0.8.3', '0.8.0')).toEqual([]);
		expect(below(packages, 'fflate', '0.6.11', '0.6.0')).toEqual([]);
	});

	const CARGO_LOCKS = [
		'contracts/agent-invocation/Cargo.lock',
		'contracts/event-markets-stake/Cargo.lock',
		'contracts/knock-escrow/Cargo.lock',
		'contracts/program-tests/Cargo.lock',
		'contracts/skill-license/Cargo.lock',
		'integrations/zed/Cargo.lock',
	];
	const CRATE_FLOORS = { anyhow: '1.0.103', ctutils: '0.4.4', url: '2.5.9' };

	for (const rel of CARGO_LOCKS) {
		it(`${rel} pins anyhow, ctutils and url at or above their fixed versions`, () => {
			const stale = Object.entries(CRATE_FLOORS).flatMap(([name, min]) =>
				cargoVersions(rel, name)
					.filter((v) => !gte(v, min))
					.map((v) => `${name}@${v}`),
			);
			expect(stale).toEqual([]);
		});
	}

	it('the pano2splat and panodepth workers pin the patched Pillow and pytest', () => {
		const read = (rel) => readFileSync(resolve(HERE, '..', rel), 'utf8');
		expect(read('workers/model-pano2splat/requirements.d/pano_stitch.txt')).toMatch(/^Pillow==13\.\d+\.\d+$/m);
		const pytest = read('workers/model-panodepth/requirements.txt').match(/^pytest==([\d.]+)$/m);
		expect(pytest).toBeTruthy();
		expect(gte(pytest[1], '9.0.3')).toBe(true);
	});
});
