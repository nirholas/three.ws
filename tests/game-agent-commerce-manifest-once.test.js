import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../src/game/agent-commerce.js', import.meta.url), 'utf8');

describe('game agent exchange clip manifest', () => {
	it('reuses the shared avatar-rig manifest instead of downloading it a second time', () => {
		expect(src).not.toMatch(/fetch\(\s*MANIFEST_URL/);
	});

	it('resolves gesture clips from the shared loader cache', () => {
		expect(src).toMatch(/loadManifest\(\)\s*\.then/);
		expect(src).toMatch(/getAllEmoteDefs\(\)/);
	});
});
