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
