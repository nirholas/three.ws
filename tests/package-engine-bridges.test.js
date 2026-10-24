import { describe, it, expect } from 'vitest';
import { unzipSync } from 'fflate';
import { validateBridge, buildZip, sha256, listing } from '../scripts/package-engine-bridges.mjs';

const KEYS = ['unity', 'godot', 'unreal'];

describe('engine bridge store packaging', () => {
	for (const key of KEYS) {
		it(`${key}: validates with no errors`, () => {
			const info = validateBridge(key);
			expect(info.v.result.errors).toEqual([]);
			expect(info.meta.version).toBe(listing(key).version);
		});

		it(`${key}: zip is byte-identical across builds and holds the required files`, () => {
			const info = validateBridge(key);
			const a = buildZip(key, info);
			const b = buildZip(key, validateBridge(key));
			expect(sha256(a)).toBe(sha256(b));
			const names = Object.keys(unzipSync(new Uint8Array(a)));
			expect(names).toContain('LICENSE');
			expect(names).toEqual([...names].sort());
		});
	}

	it('godot zip carries only the addon, license and readme', () => {
		const names = Object.keys(unzipSync(new Uint8Array(buildZip('godot', validateBridge('godot')))));
		expect(names.every((n) => n.startsWith('addons/') || n === 'LICENSE' || n === 'README.md')).toBe(true);
	});

	it('every listing field respects the store limits', () => {
		for (const key of KEYS) {
			const l = listing(key);
			expect(l.tagline.length).toBeLessThanOrEqual(80);
			expect(l.description.length).toBeGreaterThanOrEqual(200);
			expect(l.price).toBe('Free');
		}
	});
});
