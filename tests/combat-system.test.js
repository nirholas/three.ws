// The /play combat client (src/game/combat-system.js) pulls in the shared
// server world data (multiplayer/src/world-features.js, items.js), the HUD and
// its own stylesheet at module load. A broken import anywhere in that graph
// takes the whole Play world down on first paint, so this pins that the module
// loads and still exports the class coincommunities.js constructs.
import { describe, it, expect } from 'vitest';

describe('combat-system module', () => {
	it('loads its import graph and exports CombatSystem', async () => {
		const m = await import('../src/game/combat-system.js');
		expect(typeof m.CombatSystem).toBe('function');
	});
});
