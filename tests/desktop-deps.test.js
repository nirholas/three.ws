import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

// The desktop app runs on Electron's bundled Node, which cannot require() an
// ES-module-only package. @solana/web3.js pulls in rpc-websockets, which
// require()s uuid, and uuid 12 and up is ESM-only. With uuid 14 resolved the
// app dies at launch ("ERR_REQUIRE_ESM") before any window opens.
describe('desktop app dependency tree', () => {
	const lock = JSON.parse(readFileSync(new URL('../apps/desktop/package-lock.json', import.meta.url), 'utf8'));

	it('resolves a CommonJS-loadable uuid everywhere', () => {
		const uuids = Object.entries(lock.packages).filter(([key]) => key === 'node_modules/uuid' || key.endsWith('/node_modules/uuid'));
		expect(uuids.length).toBeGreaterThan(0);
		for (const [key, pkg] of uuids) {
			expect(Number(pkg.version.split('.')[0]), `${key}@${pkg.version}`).toBeLessThanOrEqual(11);
		}
	});
});
