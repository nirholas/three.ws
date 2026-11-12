// Sign vocabulary packs: one file per sign language, one shared engine.
//
// The solver (src/sign-rig.js) and the timeline (src/sign-clip.js) know nothing
// about any particular language: they move hands to body-relative places. A
// pack is the language part, a table of signs written in that vocabulary plus
// the aliases that map everyday words onto them and the manual alphabet (if
// any) the pack fingerspells with.
//
// The rule that governs every pack but ASL: a sign is served only once enough
// fluent signers approved its exact content (src/sign-packs/review.js). Signs
// that are not approved are not served, and a pack with no approved sign is not
// offered at all, so the platform never ships or implies a sign language that no
// fluent signer has checked. The committed ledger beside each pack
// (src/sign-packs/reviews/<id>.js, written by scripts/export-sign-reviews.mjs
// from the review workspace) is what decides what is live.
//
// _template.js is the starting point for a new pack and is deliberately not in
// the registry below.

import ASL from './asl.js';
import { packReview } from './review.js';

/**
 * @typedef {{
 *   id: string,
 *   name: string,
 *   bcp47: string,
 *   signs: Record<string, { gloss: string, phases: object[] }>,
 *   aliases: Record<string, string>,
 *   alphabet: string|null,
 *   status: 'native'|'review',
 *   requiredApprovals: number,
 *   reviews: { sign: string, hash: string, reviewer: string, verdict: string }[],
 * }} SignPack
 */

export const DEFAULT_PACK_ID = 'ase';

/** Every pack the platform can serve. Add a pack here once its file exists. */
const PACKS = Object.freeze([ASL]);

/** @returns {readonly SignPack[]} */
export function listPacks() {
	return PACKS;
}

/**
 * Find a pack by its ISO 639-3 id or BCP 47 tag. Null for unknown ids; the
 * default pack for an empty id.
 * @param {string|null|undefined} id
 * @returns {SignPack|null}
 */
export function getPack(id) {
	const want = String(id ?? '').trim().toLowerCase();
	if (!want) return ASL;
	return PACKS.find((p) => p.id === want || p.bcp47.toLowerCase() === want) ?? null;
}

const servableCache = new WeakMap();
const servableViews = new WeakSet();

/**
 * The pack as it may be performed: only approved signs, and only the aliases
 * that point at one. For a native pack this is the pack itself.
 * @param {SignPack} pack
 * @returns {SignPack & { review: { approved: number, total: number, required: number } }}
 */
export function servablePack(pack) {
	if (servableViews.has(pack)) return pack;
	if (servableCache.has(pack)) return servableCache.get(pack);
	const review = packReview(pack);
	let view;
	if (pack.status === 'native') {
		view = Object.freeze({ ...pack, review: { approved: review.total, total: review.total, required: 0 } });
	} else {
		const allowed = new Set(review.approved);
		const signs = Object.freeze(Object.fromEntries(review.approved.map((k) => [k, pack.signs[k]])));
		const aliases = Object.freeze(
			Object.fromEntries(Object.entries(pack.aliases ?? {}).filter(([, target]) => allowed.has(target))),
		);
		view = Object.freeze({
			...pack,
			signs,
			aliases,
			review: { approved: review.approved.length, total: review.total, required: review.required },
		});
	}
	servableCache.set(pack, view);
	servableViews.add(view);
	return view;
}

/**
 * Packs with at least one servable sign, in registry order: what a language
 * picker or `GET /api/sign?lang=` may offer.
 */
export function servablePacks() {
	return PACKS.map(servablePack).filter((p) => p.review.approved > 0);
}

/**
 * Resolve the pack argument the dictionary functions accept: a pack object, a
 * pack id, or nothing (the default pack). Returns the servable view.
 * @param {SignPack|string|null|undefined} pack
 */
export function resolvePack(pack) {
	if (pack && typeof pack === 'object') return servablePack(pack);
	const found = getPack(pack);
	if (!found) throw new Error(`unknown sign language pack "${pack}"`);
	return servablePack(found);
}
