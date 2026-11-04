// Network failures at the remaining /play boundaries must show the translated
// netErrorMessage line, never the raw browser text ("Failed to fetch").

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');

describe('raw error text is replaced by netErrorMessage', () => {
	it('friends-panel', () => {
		const src = read('src/game/friends-panel.js');
		expect(src).toMatch(/import \{[^}]*netErrorMessage[^}]*\} from '\.\/net-error\.js'/);
		expect(src).not.toContain('err?.message ||');
	});
	it('npc-services', () => {
		const src = read('src/game/npc/npc-services.js');
		expect(src).toMatch(/import \{[^}]*netErrorMessage[^}]*\} from '\.\.\/net-error\.js'/);
		expect(src).toMatch(/\} else \{\s*showError\(netErrorMessage\(err, msg\)\);/);
	});
	it('coin-buy funding flow and sign-in', () => {
		const src = read('src/game/coin-buy.js');
		expect(src).toMatch(/import \{[^}]*netErrorMessage[^}]*\} from '\.\/net-error\.js'/);
		expect(src).toContain("netErrorMessage(err, 'Could not open the funding flow.')");
		expect(src).toContain("netErrorMessage(err, 'Sign-in failed.')");
	});
	// Each of these printed err.message straight into the panel, so a dropped
	// connection read "Failed to fetch" and a gateway hiccup "http 502".
	for (const [name, rel] of [
		['gacha machine pull and sell-back', 'src/game/gacha-ui.js'],
		['dance-off tip price', 'src/game/dance-off.js'],
		['signature wall signing', 'src/game/signature-wall.js'],
	]) {
		it(name, () => {
			const src = read(rel);
			expect(src).toMatch(/import \{[^}]*netErrorMessage[^}]*\} from '\.\/net-error\.js'/);
			expect(src).not.toMatch(/textContent = err\.message;/);
			expect(src).not.toMatch(/\$\{err\.message\}/);
			expect(src).not.toMatch(/\(err\.message \|\|/);
		});
	}
});
