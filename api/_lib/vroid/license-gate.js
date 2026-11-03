// Enforcement of a VRoid Hub creator's license after import.
//
// api/vroid/import.js stores the creator's license on the avatar as
// `source_meta.vroid` (see buildVroidBlock). Every server surface that would
// exceed that license asks gateAvatarAction() first, and answers 403
// `license_restricted` with a plain-language reason when the answer is no.
//
// Design rules:
//   - The decision is always recomputed from the stored raw license with the
//     current evaluateLicense() mapping, never read from a stored boolean, so a
//     mapping fix applies to avatars that were imported earlier.
//   - Anything unreadable fails closed.
//   - An avatar with no `vroid` block is not governed by this module and is
//     always allowed, so ordinary avatars pay one cheap object lookup.
//   - The block travels with a fork (forkLicensePlan), so copying an avatar
//     cannot launder its license.
//
// The four gated actions and the surfaces that check them:
//   public_agent  agent create/update/attach (api/agents.js, MCP attach,
//                 onboarding link-avatar)
//   export        visibility public/unlisted, IPFS pin, sale price, tokenize
//   modify        outfit/sculpt bake, GLB replace, regenerate
//   monetize      sale price, tokenize

import { error } from '../http.js';
import { evaluateLicense, normalizeLicense, creditLineFor, licenseDisplayUrl } from './license.js';

export const VROID_META_KEY = 'vroid';
export const GATED_ACTIONS = Object.freeze(['public_agent', 'export', 'modify', 'monetize']);

const WHAT_IT_WITHHOLDS = {
	public_agent: 'be used as a public agent',
	export: 'be made public, shared by link, pinned or exported',
	modify: 'be altered (outfits, sculpting, regeneration or edits to the model)',
	monetize: 'be sold, minted or used in a paid listing',
};

/** The stored VRoid block, or null for an avatar that did not come from VRoid Hub. */
export function vroidBlockOf(sourceMeta) {
	const block = sourceMeta?.[VROID_META_KEY];
	return block && typeof block === 'object' && !Array.isArray(block) ? block : null;
}

/**
 * The provenance and license block stored at `source_meta.vroid` on import.
 * @param {object} p
 * @param {string} p.characterModelId
 * @param {string|null} [p.characterId]  Hub character id, for the credit link
 * @param {string|null} [p.creatorName]
 * @param {string|null} [p.characterName]
 * @param {object|null} [p.license]  CharacterModelLicenseSerializer payload
 * @param {boolean} [p.isAuthor]  the importing account is the creator
 * @param {string} p.importedAt
 */
export function buildVroidBlock({
	characterModelId,
	characterId = null,
	creatorName = null,
	characterName = null,
	license = null,
	isAuthor = false,
	importedAt,
}) {
	return {
		character_model_id: String(characterModelId),
		character_id: characterId == null ? null : String(characterId),
		creator_name: creatorName || null,
		character_name: characterName || null,
		license: normalizeLicense(license),
		is_author: isAuthor === true,
		credit_line: creditLineFor({ creatorName, characterName }),
		hub_url:
			characterId == null
				? null
				: `https://hub.vroid.com/en/characters/${encodeURIComponent(characterId)}/models/${encodeURIComponent(characterModelId)}`,
		license_url: licenseDisplayUrl(),
		imported_at: importedAt,
	};
}

function evaluateBlock(block) {
	return evaluateLicense(block.license, { isAuthor: block.is_author === true });
}

function actionAllowed(evaluated, action) {
	const { actions } = evaluated;
	return action === 'monetize'
		? actions.monetize_personal === true || actions.monetize_corporate === true
		: actions[action] === true;
}

/**
 * May this avatar do `action` under its creator's license?
 * @param {object|null|undefined} sourceMeta  the avatar row's source_meta
 * @param {'public_agent'|'export'|'modify'|'monetize'} action
 * @returns {{ allowed: true } | { allowed: false, code: string, action: string, message: string, creator_name: string|null, license_url: string }}
 */
export function gateAvatarAction(sourceMeta, action) {
	if (!GATED_ACTIONS.includes(action)) {
		throw new TypeError(`unknown license action: ${action}`);
	}
	const block = vroidBlockOf(sourceMeta);
	if (!block) return { allowed: true };

	const evaluated = evaluateBlock(block);
	if (actionAllowed(evaluated, action)) return { allowed: true };

	const whose = block.creator_name ? `${block.creator_name}'s` : "The creator's";
	return {
		allowed: false,
		code: 'license_restricted',
		action,
		message: `${whose} VRoid Hub license does not allow this character to ${WHAT_IT_WITHHOLDS[action]}.`,
		creator_name: block.creator_name || null,
		license_url: licenseDisplayUrl(),
	};
}

/** Send the 403 for a refused verdict. Returns true when the request was refused. */
export function refuseIfRestricted(res, sourceMeta, action) {
	const verdict = gateAvatarAction(sourceMeta, action);
	if (verdict.allowed) return false;
	error(res, 403, verdict.code, verdict.message, {
		action: verdict.action,
		creator_name: verdict.creator_name,
		license_url: verdict.license_url,
	});
	return true;
}

/**
 * What a fork of this avatar inherits. The license always travels with the
 * copy. The creator's own authorship does not travel to a different user.
 * A fork the license would not let be shared starts private, and does not get
 * an agent.
 * @returns {{ meta: object, visibility: 'unlisted'|'private', agentAllowed: boolean }}
 */
export function forkLicensePlan({ srcMeta, srcOwnerId, forkerId }) {
	const block = vroidBlockOf(srcMeta);
	if (!block) return { meta: {}, visibility: 'unlisted', agentAllowed: true };

	const meta = { [VROID_META_KEY]: { ...block, is_author: block.is_author === true && srcOwnerId === forkerId } };
	return {
		meta,
		visibility: gateAvatarAction(meta, 'export').allowed ? 'unlisted' : 'private',
		agentAllowed: gateAvatarAction(meta, 'public_agent').allowed,
	};
}

/**
 * The credit every surface renders for a VRoid avatar, in the shape
 * src/avatar-page.js already reads from `avatar.attribution`. Null for an
 * avatar that is not from VRoid Hub, and for the creator's own avatar.
 */
export function attributionFor(sourceMeta) {
	const block = vroidBlockOf(sourceMeta);
	if (!block || block.is_author === true) return null;
	const evaluated = evaluateBlock(block);
	const name = block.creator_name || 'VRoid Hub creator';
	return {
		handle: name,
		displayName: name,
		url: block.hub_url || null,
		license: evaluated.creditRequired ? 'VRoid Hub license · credit required' : 'VRoid Hub license',
	};
}

/** What the UI needs to show locked actions and the credit line. Null when not a VRoid avatar. */
export function describeVroidLicense(sourceMeta) {
	const block = vroidBlockOf(sourceMeta);
	if (!block) return null;
	const evaluated = evaluateBlock(block);
	return {
		author: evaluated.author,
		actions: Object.fromEntries(GATED_ACTIONS.map((action) => [action, actionAllowed(evaluated, action)])),
		credit_required: evaluated.creditRequired,
		credit_line: block.credit_line || creditLineFor({ creatorName: block.creator_name, characterName: block.character_name }),
		summary: evaluated.summary,
		license_url: licenseDisplayUrl(),
	};
}
