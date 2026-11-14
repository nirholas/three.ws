import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { unzipSync } from 'fflate';
import sharp from 'sharp';
import {
	BRIDGE_KEYS,
	validateBridge,
	buildArchive,
	sha256,
	listing,
	unityMetaTargets,
	renderStoreArtwork,
	ARTWORK,
	ROOT,
} from '../scripts/package-engine-bridges.mjs';

const zipNames = (key) => Object.keys(unzipSync(new Uint8Array(buildArchive(key, validateBridge(key)).buffer)));

describe('engine bridge store packaging', () => {
	it('covers all four engines', () => {
		expect(BRIDGE_KEYS).toEqual(['unity', 'godot', 'unreal', 'blender']);
	});

	for (const key of BRIDGE_KEYS) {
		it(`${key}: validates with no errors`, () => {
			const info = validateBridge(key);
			expect(info.v.result.errors).toEqual([]);
			expect(info.meta.version).toBe(listing(key).version);
		});

		it(`${key}: archive is byte-identical across builds`, () => {
			const a = buildArchive(key, validateBridge(key));
			const b = buildArchive(key, validateBridge(key));
			expect(sha256(a.buffer)).toBe(sha256(b.buffer));
		});
	}

	describe('unity', () => {
		it('every importable file and folder carries a .meta with a unique GUID', () => {
			const dir = join(ROOT, 'packages/unity-bridge');
			const guids = new Set();
			for (const rel of unityMetaTargets(dir)) {
				const meta = readFileSync(join(dir, `${rel}.meta`), 'utf8');
				expect(meta).toMatch(/^fileFormatVersion: 2\n/);
				const guid = meta.match(/^guid: ([0-9a-f]{32})$/m)?.[1];
				expect(guid, rel).toBeTruthy();
				expect(guids.has(guid), `duplicate guid on ${rel}`).toBe(false);
				guids.add(guid);
			}
			expect(guids.size).toBeGreaterThanOrEqual(10);
		});

		it('ships as a UPM tarball rooted at package/', () => {
			const { buffer, name } = buildArchive('unity', validateBridge('unity'));
			expect(name).toMatch(/\.tgz$/);
			expect(buffer.subarray(0, 2)).toEqual(Buffer.from([0x1f, 0x8b]));
		});
	});

	describe('godot', () => {
		it('zip carries only the addon folder, with its own license and readme inside', () => {
			const names = zipNames('godot');
			expect(names.every((n) => n.startsWith('addons/three_ws_bridge/'))).toBe(true);
			expect(names).toContain('addons/three_ws_bridge/LICENSE');
			expect(names).toContain('addons/three_ws_bridge/README.md');
			expect(names).toContain('addons/three_ws_bridge/plugin.cfg');
		});

		it('the in-addon license is the package license verbatim', () => {
			const base = join(ROOT, 'packages/godot-bridge');
			expect(readFileSync(join(base, 'addons/three_ws_bridge/LICENSE'), 'utf8')).toBe(readFileSync(join(base, 'LICENSE'), 'utf8'));
		});
	});

	describe('unreal', () => {
		it('zip is the plugin folder with config filter and icon, no build output', () => {
			const names = zipNames('unreal');
			expect(names.every((n) => n.startsWith('ThreeWsBridge/'))).toBe(true);
			expect(names).toContain('ThreeWsBridge/ThreeWsBridge.uplugin');
			expect(names).toContain('ThreeWsBridge/Config/FilterPlugin.ini');
			expect(names).toContain('ThreeWsBridge/Resources/Icon128.png');
			expect(names.some((n) => /\/(Binaries|Intermediate|Saved)\//.test(n))).toBe(false);
		});

		it('every source file opens with the publisher copyright notice', () => {
			const info = validateBridge('unreal');
			const sources = info.files.filter((f) => /\.(h|cpp|cs)$/.test(f));
			expect(sources.length).toBeGreaterThanOrEqual(13);
			for (const rel of sources) {
				expect(readFileSync(join(info.dir, rel), 'utf8').split('\n')[0], rel).toMatch(/^\/\/ Copyright 2026 nirholas\./);
			}
		});

		it('declares engine version, platforms and the Interchange dependency', () => {
			const u = JSON.parse(readFileSync(join(ROOT, 'packages/unreal-bridge/ThreeWsBridge.uplugin'), 'utf8'));
			expect(u.EngineVersion).toMatch(/^5\.\d+\.0$/);
			for (const m of u.Modules) expect(m.PlatformAllowList).toEqual(expect.arrayContaining(['Win64', 'Mac', 'Linux']));
			expect(u.Plugins).toEqual(expect.arrayContaining([expect.objectContaining({ Name: 'Interchange', Enabled: true })]));
			expect('MarketplaceURL' in u).toBe(false);
		});
	});

	describe('blender', () => {
		it('zip holds the manifest at its root and nothing Blender would exclude', () => {
			const names = zipNames('blender');
			expect(names).toContain('blender_manifest.toml');
			expect(names).toContain('__init__.py');
			expect(names).toContain('LICENSE');
			expect(names.some((n) => n.includes('__pycache__') || n.endsWith('.zip'))).toBe(false);
		});
	});

	describe('store artwork', () => {
		for (const key of BRIDGE_KEYS) {
			it(`${key}: every key image renders at the exact store size with no alpha`, async () => {
				const images = await renderStoreArtwork(key);
				expect(images.map((i) => i.file).sort()).toEqual(ARTWORK[key].map((a) => `${a.name}.png`).sort());
				for (const img of images) {
					const m = await sharp(img.buffer).metadata();
					const spec = ARTWORK[key].find((a) => `${a.name}.png` === img.file);
					expect([m.width, m.height], img.file).toEqual([spec.w, spec.h]);
					expect(m.hasAlpha, img.file).toBe(false);
				}
			});
		}

		it('committed icons that stores hotlink match the renderer size', async () => {
			for (const rel of ['packages/godot-bridge/media/icon.png', 'packages/unreal-bridge/Resources/Icon128.png']) {
				const m = await sharp(readFileSync(join(ROOT, rel))).metadata();
				expect(m.width).toBe(m.height);
				expect(m.width).toBeGreaterThanOrEqual(128);
			}
		});
	});

	it('every listing respects the store limits', () => {
		for (const key of BRIDGE_KEYS) {
			const l = listing(key);
			expect(l.tagline.length).toBeLessThanOrEqual(key === 'blender' ? 64 : 80);
			expect(l.description.length).toBeGreaterThanOrEqual(200);
			expect(l.price).toBe('Free');
		}
	});
});
