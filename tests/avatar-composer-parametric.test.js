// Avatar Composer, parametric mode (api/_lib/avatar-composer/parametric.js).
//
// "Surprise me" used to mix parts inside one rest-pose group of the RPM bases,
// so every result had the same body build and nothing could wear a hat. The
// parametric mode instead draws a seeded appearance record for the Parametric
// base (public/avatars/parametric-base.glb: ~300 identity morphs, a skeleton
// proportions solver, a live garment catalog, bone accessories). These tests pin
// that the record is valid per the stored-appearance schema, deterministic per
// seed, varied across seeds, and that real records bake end to end.

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import gltfValidator from 'gltf-validator';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import {
	selectParametricAppearance,
	readMorphNames,
	deriveSliders,
	PARAMETRIC_BASE_ID,
} from '../api/_lib/avatar-composer/parametric.js';
import { selectRecipe } from '../api/_lib/avatar-composer/index.js';
import { pickDiversityProfile } from '../api/_lib/avaturn-seed.js';
import { avatarAppearance } from '../api/_lib/validate.js';
import { isBakeable, bakeAppearance } from '../api/_lib/bake.js';
import { PROPORTION_PARAM_BY_ID } from '../src/avatar-proportions.js';
import { GARMENT_CATALOG_URL, sanitizeCatalog } from '../src/garment-catalog.js';

const BASE_PATH = resolve(process.cwd(), 'public/avatars/parametric-base.glb');
const CACHE_DIR = resolve(process.cwd(), 'node_modules/.cache/three-ws');
const CACHE_FILE = resolve(CACHE_DIR, 'garment-catalog.json');

async function loadCatalog() {
	if (existsSync(CACHE_FILE)) return sanitizeCatalog(JSON.parse(readFileSync(CACHE_FILE, 'utf8'))).garments;
	const res = await fetch(GARMENT_CATALOG_URL);
	if (!res.ok) throw new Error(`garment catalog fetch failed: ${res.status}`);
	const raw = await res.json();
	mkdirSync(CACHE_DIR, { recursive: true });
	writeFileSync(CACHE_FILE, JSON.stringify(raw));
	return sanitizeCatalog(raw).garments;
}

let baseBytes;
let morphNames;
let catalog;
beforeAll(async () => {
	baseBytes = new Uint8Array(readFileSync(BASE_PATH));
	morphNames = readMorphNames(baseBytes);
	catalog = await loadCatalog();
}, 60_000);

const SEEDS = Array.from({ length: 200 }, (_, i) => `param-seed-${i}`);
const pick = (seed) => selectParametricAppearance(pickDiversityProfile(seed), seed, { morphNames, catalog });

describe('readMorphNames / deriveSliders', () => {
	it('reads the identity morph names from the base GLB', () => {
		expect(morphNames.length).toBeGreaterThan(250);
		expect(morphNames).toContain('headWider');
	});

	it('derives slider groups from the names, not a hand list', () => {
		const { groups } = deriveSliders(morphNames);
		expect(groups.size).toBeGreaterThan(8);
		expect(groups.get('head').length).toBeGreaterThan(5);
		expect(groups.get('nose').length).toBeGreaterThan(0);
	});
});

describe('selectParametricAppearance', () => {
	it('names the parametric base', () => {
		expect(pick('x').base).toBe(PARAMETRIC_BASE_ID);
	});

	it('is deterministic on the seed', () => {
		for (const seed of SEEDS.slice(0, 20)) expect(pick(seed)).toEqual(pick(seed));
	});

	it('produces valid, bakeable appearance records for 200 seeds', () => {
		for (const seed of SEEDS) {
			const a = pick(seed);
			const parsed = avatarAppearance.safeParse(a);
			expect(parsed.success, `${seed}: ${JSON.stringify(parsed.error?.issues)}`).toBe(true);
			expect(isBakeable(a)).toBe(true);
			for (const name of Object.keys(a.morphs)) expect(morphNames).toContain(name);
			for (const [id, v] of Object.entries(a.proportions)) {
				const p = PROPORTION_PARAM_BY_ID.get(id);
				expect(v).toBeGreaterThanOrEqual(p.min);
				expect(v).toBeLessThanOrEqual(p.max);
			}
			expect(a.accessories.length).toBeLessThanOrEqual(2);
			for (const g of a.garments) expect(catalog.some((c) => c.slot === g.slot && c.id === g.id)).toBe(true);
		}
	});

	it('covers a spread of builds, skin tones, garments and accessories', () => {
		const records = SEEDS.map(pick);
		const stdev = (xs) => {
			const m = xs.reduce((s, x) => s + x, 0) / xs.length;
			return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / xs.length);
		};
		const heights = records.map((r) => r.proportions.height ?? 1);
		expect(stdev(heights)).toBeGreaterThan(0.03);
		expect(Math.max(...heights) - Math.min(...heights)).toBeGreaterThan(0.15);
		const sig = new Set(records.map((r) => JSON.stringify(r.morphs)));
		expect(sig.size).toBeGreaterThan(190);
		expect(new Set(records.map((r) => r.colors.skin)).size).toBeGreaterThan(30);
		expect(new Set(records.flatMap((r) => r.garments.map((g) => g.id))).size).toBeGreaterThan(10);
		expect(records.filter((r) => r.accessories.length > 0).length).toBeGreaterThan(40);
		expect(records.filter((r) => r.garments.some((g) => g.slot === 'hair')).length).toBeGreaterThan(100);
	});

	it('never picks opposing sliders together', () => {
		for (const seed of SEEDS.slice(0, 50)) {
			const m = pick(seed).morphs;
			expect(!(m.headWider && m.headNarrower)).toBe(true);
			expect(!(m.bodyHeavier && m.bodyThinner)).toBe(true);
		}
	});

	it('follows the profile gender on the body macro', () => {
		const male = selectParametricAppearance({ gender: 'male', ethnicityKey: 'latino', ageKey: 'adult' }, 'g', { morphNames, catalog });
		const female = selectParametricAppearance({ gender: 'female', ethnicityKey: 'latino', ageKey: 'adult' }, 'g', { morphNames, catalog });
		expect(male.morphs.bodyMasculine).toBeGreaterThan(0.5);
		expect(female.morphs.bodyFeminine).toBeGreaterThan(0.5);
	});

	it('still works with an empty catalog (no garments, rest intact)', () => {
		const a = selectParametricAppearance(pickDiversityProfile('e'), 'e', { morphNames, catalog: [] });
		expect(a.garments).toEqual([]);
		expect(avatarAppearance.safeParse(a).success).toBe(true);
	});
});

describe('legacy RPM path stays reachable', () => {
	it('selectRecipe still returns an RPM recipe', () => {
		const r = selectRecipe({ gender: 'female' }, 'legacy');
		expect(r.identity).toBeTruthy();
		expect(r.base).toBeUndefined();
	});
});

describe('bakeAppearance on generated records', () => {
	it('bakes the skin tone onto the parametric body material', async () => {
		const out = await bakeAppearance(baseBytes, { colors: { skin: '#ffe9d6' } });
		const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
		const doc = await io.readBinary(out);
		const body = doc.getRoot().listMaterials().find((m) => m.getName() === 'Parametric_Body');
		expect(body.getBaseColorFactor()[0]).toBeGreaterThan(0.9);
	}, 60_000);

	it('a bone accessory bake is valid glTF with a single scene', async () => {
		const out = await bakeAppearance(baseBytes, { accessories: ['hat-beanie', 'glasses-round'] });
		const report = await gltfValidator.validateBytes(new Uint8Array(out));
		expect(report.issues.messages.filter((m) => m.severity === 0)).toEqual([]);
	}, 60_000);

	it('bakes 10 seeds without failing the file ceiling', async () => {
		for (const seed of SEEDS.slice(0, 10)) {
			const a = pick(seed);
			const out = await bakeAppearance(baseBytes, a);
			expect(out.byteLength).toBeGreaterThan(100_000);
			expect(out.byteLength).toBeLessThan(40 * 1024 * 1024);
		}
	}, 600_000);

	it('actually attaches the chosen garments (the bake grows when they are worn)', async () => {
		const a = pick(SEEDS.find((sd) => pick(sd).garments.length >= 3));
		const dressed = await bakeAppearance(baseBytes, a);
		const bare = await bakeAppearance(baseBytes, { ...a, garments: [] });
		expect(dressed.byteLength).toBeGreaterThan(bare.byteLength);
	}, 300_000);
});
