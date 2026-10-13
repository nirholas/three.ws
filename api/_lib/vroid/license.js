// License mapping for VRoid Hub character models.
//
// Field names and enum values below are the real `CharacterModelLicenseSerializer`
// shape documented at https://developer.vroid.com/en/api/list-character.html
// ("List/Detail character models, Account information"), which is what
// `CharacterModelSerializer.license` (returned by /api/account/character_models,
// /api/hearts, /api/character_models/{id}) actually contains. It is NOT the same
// shape as the hub.vroid.com/en/license consumer-facing query string (that page
// uses different field names and is not an API response), so this module only
// trusts the API shape.
//
// Every field's enum includes 'default', meaning "the creator left this at
// VRoid Hub's standard setting". VRoid Hub's own defaults are closed (no
// credit-free use, no modification, no redistribution, no commercial use), so
// 'default' normalizes to the same restrictive value as 'disallow' everywhere
// except `credit`, where ambiguity must resolve toward requiring credit, not
// away from it.
//
// Guidelines for displaying these conditions in a connected app:
// https://developer.vroid.com/en/guidelines/conditions_of_use.html

/** @typedef {{
 *   characterization_allowed_user: 'default'|'author'|'everyone',
 *   violent_expression: 'default'|'disallow'|'allow',
 *   sexual_expression: 'default'|'disallow'|'allow',
 *   corporate_commercial_use: 'default'|'disallow'|'allow',
 *   personal_commercial_use: 'default'|'disallow'|'profit'|'nonprofit',
 *   credit: 'default'|'necessary'|'unnecessary',
 *   modification: 'default'|'disallow'|'allow',
 *   redistribution: 'default'|'disallow'|'allow',
 * }} VroidLicense */

const DEFAULT_LICENSE = Object.freeze({
	characterization_allowed_user: 'default',
	violent_expression: 'default',
	sexual_expression: 'default',
	corporate_commercial_use: 'default',
	personal_commercial_use: 'default',
	credit: 'default',
	modification: 'default',
	redistribution: 'default',
});

/**
 * Coerce a raw license payload (CharacterModelSerializer.license from the Hub
 * API) into the normalized shape above. An unrecognized or missing field
 * falls back to 'default': a license we can't fully read must never be
 * treated as more permissive than it is.
 * @param {Partial<VroidLicense>|null|undefined} raw
 * @returns {VroidLicense}
 */
export function normalizeLicense(raw) {
	const r = raw || {};
	const pick = (key, allowed) => (allowed.includes(r[key]) ? r[key] : DEFAULT_LICENSE[key]);
	return {
		characterization_allowed_user: pick('characterization_allowed_user', ['default', 'author', 'everyone']),
		violent_expression: pick('violent_expression', ['default', 'disallow', 'allow']),
		sexual_expression: pick('sexual_expression', ['default', 'disallow', 'allow']),
		corporate_commercial_use: pick('corporate_commercial_use', ['default', 'disallow', 'allow']),
		personal_commercial_use: pick('personal_commercial_use', ['default', 'disallow', 'profit', 'nonprofit']),
		credit: pick('credit', ['default', 'necessary', 'unnecessary']),
		modification: pick('modification', ['default', 'disallow', 'allow']),
		redistribution: pick('redistribution', ['default', 'disallow', 'allow']),
	};
}

/**
 * Evaluate which three.ws actions a license permits. Every action defaults
 * closed: a field we don't recognize, or a license we couldn't fetch, grants
 * nothing rather than falling open.
 * @param {Partial<VroidLicense>|null|undefined} raw
 */
export function evaluateLicense(raw) {
	const license = normalizeLicense(raw);

	// Public agent: the avatar walks, talks and chats as a visible three.ws
	// agent, which is "becoming" the character, a thing VRoid Hub gates with
	// characterization_allowed_user. Only 'everyone' is open to a third-party
	// app; 'author' means only the creator's own account may do this.
	const publicAgent = license.characterization_allowed_user === 'everyone';

	// Export: taking the GLB/VRM back out of three.ws, or showing it on a
	// surface that isn't under the creator's license terms, is redistribution.
	const exportModel = license.redistribution === 'allow';

	// Modify: running the avatar through anything that alters the mesh beyond
	// our own bone-canonicalization (remesh, restylize, re-rig, edit textures).
	const modify = license.modification === 'allow';

	// Monetize: selling merch, ticketed appearances, or paid chat sessions
	// that use this avatar. personal_commercial_use covers an individual
	// creator: only the profit value clears full commercial use, nonprofit
	// explicitly excludes it. corporate_commercial_use is tracked separately
	// because three.ws itself profiting from hosting the avatar, through
	// platform fees or a marketplace listing, falls under the corporate flag.
	const monetizePersonal = license.personal_commercial_use === 'profit';
	const monetizeCorporate = license.corporate_commercial_use === 'allow';

	const creditRequired = license.credit !== 'unnecessary';

	return {
		license,
		creditRequired,
		actions: {
			public_agent: publicAgent,
			export: exportModel,
			modify,
			monetize_personal: monetizePersonal,
			monetize_corporate: monetizeCorporate,
		},
		// Plain-English lines for the picker UI, in the order the order's task 2 asks for.
		summary: [
			publicAgent
				? 'Can be a public agent on three.ws'
				: 'Cannot be a public agent (creator restricted this character to their own account)',
			exportModel ? 'Can be exported off three.ws' : 'Cannot be exported (creator disallows redistribution)',
			modify ? 'Can be remeshed, restyled or re-rigged' : 'Cannot be modified (creator disallows alteration)',
			monetizePersonal || monetizeCorporate
				? 'Can be used in a monetized agent or listing'
				: 'Cannot be monetized (creator disallows commercial use)',
			creditRequired ? 'Creator credit is required wherever this avatar appears' : 'Creator credit is optional',
		],
		licenseUrl: licenseDisplayUrl(),
	};
}

/** Where to point a user who wants to understand what these conditions mean. */
export function licenseDisplayUrl() {
	return 'https://developer.vroid.com/en/guidelines/conditions_of_use.html';
}

/** Credit line to render on every surface the avatar appears on, when required. */
export function creditLineFor({ creatorName, characterName }) {
	const who = creatorName ? `by ${creatorName}` : 'by its VRoid Hub creator';
	const what = characterName ? `"${characterName}"` : 'This avatar';
	return `${what} ${who}, imported from VRoid Hub.`;
}
