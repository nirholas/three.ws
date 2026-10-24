import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';

// Live devnet round trip: register an agent in the open Solana agent registry,
// leave feedback from a second wallet and read the tier back. Spends only
// throwaway devnet SOL. Opt in with RUN_DEVNET_8004=1 (needs a working faucet).
describe.skipIf(process.env.RUN_DEVNET_8004 !== '1')('8004 registry on devnet', () => {
	it('registers, takes feedback and reads the tier back', () => {
		const out = execFileSync('node', ['scripts/prove-8004-registry.mjs'], { encoding: 'utf8', timeout: 170_000 });
		expect(out).toMatch(/registered asset : [1-9A-HJ-NP-Za-km-z]{32,44}/);
		expect(out).toMatch(/feedback tx/);
		expect(out.trim().endsWith('OK')).toBe(true);
	}, 180_000);
});
