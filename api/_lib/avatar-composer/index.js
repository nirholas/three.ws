// @ts-check
// Avatar Composer: public entry point.
//
// One call turns a diversity profile + seed into a rigged, expression-ready GLB
// assembled from modular parts (see README.md). The caller supplies a `loadBase`
// function so this module stays I/O-free and runs the same in a test (read from
// disk), the seed cron (fetch from the site origin), or a worker.

import { composeAvatar } from './compose.js';
import { selectRecipe, basesNeeded } from './select.js';
import { BASES } from './parts.js';
import {
	selectParametricAppearance,
	readMorphNames,
	PARAMETRIC_BASE_FILE,
} from './parametric.js';
import { bakeAppearance } from '../bake.js';

export { composeAvatar } from './compose.js';
export { selectRecipe, basesNeeded } from './select.js';
export { BASES, BASE_BY_ID } from './parts.js';
export {
	selectParametricAppearance,
	readMorphNames,
	deriveSliders,
	PARAMETRIC_BASE_ID,
	PARAMETRIC_BASE_FILE,
} from './parametric.js';

/**
 * Compose one studio avatar end-to-end.
 *
 * @param {Object} opts
 * @param {{ gender?: 'male'|'female', ethnicityKey?: string, ageKey?: string, grayBias?: number, build?: string }} opts.profile
 * @param {string} opts.seed
 * @param {(baseId: string) => Promise<Uint8Array>} opts.loadBase  loads a base GLB's bytes by id
 * @returns {Promise<{ bytes: Uint8Array, recipe: object, descriptor: object, meshes: string[], recolored: string[] }>}
 */
export async function composeStudioAvatar({ profile, seed, loadBase }) {
	const recipe = selectRecipe(profile, seed);
	const ids = basesNeeded(recipe);
	/** @type {Record<string, Uint8Array>} */
	const bytesByBase = {};
	await Promise.all(
		ids.map(async (id) => {
			bytesByBase[id] = await loadBase(id);
		}),
	);
	const { bytes, meshes, recolored } = await composeAvatar(recipe, bytesByBase);
	const { descriptor, ...recipeCore } = recipe;
	return { bytes, recipe: recipeCore, descriptor, meshes, recolored };
}

/**
 * Compose one studio avatar in parametric mode: choose a seeded appearance record
 * for the Parametric base and bake it into the base GLB.
 *
 * @param {Object} opts
 * @param {object} opts.profile  diversity profile (see composeStudioAvatar)
 * @param {string} opts.seed
 * @param {(baseId: string) => Promise<Uint8Array>} opts.loadBase  loads a base GLB by file id
 * @param {() => Promise<Array<{slot:string,id:string}>>} [opts.loadCatalog]  garment catalog
 *        source; a rejection degrades to "no garments" so a catalog outage never fails a compose
 * @param {boolean} [opts.bake]  false returns the record without baking (cheap, for sharing)
 * @returns {Promise<{ bytes: Uint8Array|null, appearance: object, descriptor: object }>}
 */
export async function composeParametricAvatar({ profile, seed, loadBase, loadCatalog, bake = true }) {
	const baseBytes = await loadBase(PARAMETRIC_BASE_FILE);
	let catalog = [];
	if (loadCatalog) {
		try {
			catalog = await loadCatalog();
		} catch (err) {
			console.warn(`[avatar-composer] garment catalog unavailable, composing without garments: ${err.message}`);
		}
	}
	const appearance = selectParametricAppearance(profile, seed, {
		morphNames: readMorphNames(baseBytes),
		catalog,
	});
	const bytes = bake ? await bakeAppearance(baseBytes, appearance, { fold: true }) : null;
	const descriptor = {
		base: appearance.base,
		gender: profile?.gender === 'male' ? 'male' : 'female',
		garments: appearance.garments.map((g) => g.id),
		accessories: appearance.accessories,
		height: appearance.proportions.height ?? 1,
	};
	return { bytes, appearance, descriptor };
}

/**
 * Rough count of distinct part-mesh combinations the catalog can produce, before
 * colorway/scale. Each identity draws swappable parts only from its own rest-pose
 * group, so the count sums over identities. Illustrative (docs/tests), not a hard
 * guarantee: the colorway (per-part tints across ~10 skin tones, 10 hair tints,
 * 10 outfit tints each) multiplies this into the tens of thousands.
 * @returns {number}
 */
export function combinationCount() {
	let total = 0;
	for (const id of BASES) {
		let n = 1;
		for (const slot of ['hair', 'top', 'bottom', 'footwear']) {
			const providers = BASES.filter((b) => b.provides.includes(slot) && b.restGroup === id.restGroup);
			n *= Math.max(1, providers.length);
		}
		const glasses = BASES.filter((b) => b.provides.includes('glasses') && b.restGroup === id.restGroup);
		n *= glasses.length + 1; // +none
		total += n;
	}
	return total;
}
