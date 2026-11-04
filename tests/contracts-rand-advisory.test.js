// The Anchor programs pull rand through solana-program's host-only pin on
// libsecp256k1 =0.6.0, which upstream builds on rand 0.7 (unsound below 0.8.6,
// no 0.7.x fix). contracts/vendor/libsecp256k1 is upstream 0.6.0 on rand 0.8,
// wired in with [patch.crates-io]. These checks fail if a lock refresh or a
// dropped patch brings the registry copy and rand 0.7 back.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const PROGRAMS = ['agent-invocation', 'skill-license', 'knock-escrow', 'event-markets-stake'];

function lockPackages(program) {
	const text = readFileSync(new URL(`../contracts/${program}/Cargo.lock`, import.meta.url), 'utf8');
	return text
		.split('[[package]]')
		.slice(1)
		.map((block) => ({
			name: block.match(/^name = "(.+)"$/m)?.[1],
			version: block.match(/^version = "(.+)"$/m)?.[1],
			source: block.match(/^source = "(.+)"$/m)?.[1],
		}));
}

const below = (v, floor) => {
	const a = v.split('.').map(Number);
	const b = floor.split('.').map(Number);
	for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] < b[i];
	return false;
};

describe.each(PROGRAMS)('contracts/%s', (program) => {
	const pkgs = lockPackages(program);

	it('locks no rand below 0.8.6', () => {
		const rands = pkgs.filter((p) => p.name === 'rand');
		expect(rands.length).toBeGreaterThan(0);
		for (const r of rands) expect(below(r.version, '0.8.6'), `rand ${r.version}`).toBe(false);
	});

	it('resolves libsecp256k1 to the vendored path crate, not the registry', () => {
		const secp = pkgs.filter((p) => p.name === 'libsecp256k1');
		expect(secp).toHaveLength(1);
		expect(secp[0].source).toBeUndefined();
	});
});
