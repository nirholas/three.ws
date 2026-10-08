import { describe, it, expect } from 'vitest';

// Load-time probe for the Coin Wars combat module: it must import cleanly
// (stylesheet side effect included) and export its CombatSystem class. No other
// test imports src/game/combat-system.js, so this is what catches a load-time
// throw before the play page does. Resolved from this file, never from one
// machine's checkout path.
const COMBAT_SYSTEM = new URL('../src/game/combat-system.js', import.meta.url).href;

describe('import probe', () => {
	it('imports combat-system', async () => {
		const m = await import(COMBAT_SYSTEM);
		expect(typeof m.CombatSystem).toBe('function');
	});
});
