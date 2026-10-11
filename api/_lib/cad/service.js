// CAD Forge service: the two operations every transport shares.
//
// api/cad.js (browser, REST) and the cad_* MCP tools (api/_mcp3d/tools/cad.js)
// both call these, so a design made by an agent and one made on /cad are the
// same record with the same files and the same permalink.

import { CadForgeError, buildProgram, cadWorkerConfigured, forgeDesign } from './forge.js';
import { cadStoreEnabled, getDesign, getVariant, newDesignId, saveDesign, saveVariant, uploadArtifacts } from './store.js';
import { MAX_PROMPT_LEN, applyParams, paramsKey } from '../../../src/cad/params.js';

const SITE = process.env.PUBLIC_BASE_URL || 'https://three.ws';
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function cadAvailable() {
	return cadWorkerConfigured() && cadStoreEnabled();
}

export function designUrl(id, key) {
	return `${SITE}/cad/${id}${key ? `?v=${key}` : ''}`;
}

export function publicDesign(design) {
	return { ...design, url: designUrl(design.id) };
}

function requireAvailable() {
	if (!cadAvailable()) throw new CadForgeError('cad_unavailable', 'CAD Forge is not configured on this deployment.', 503);
}

export function cleanPrompt(raw) {
	const prompt = String(raw ?? '').slice(0, MAX_PROMPT_LEN).trim();
	if (prompt.length < 3) throw new CadForgeError('prompt_required', 'Describe the part you need.', 400);
	return prompt;
}

/** Resolve a parent design for a refinement, or null. Throws on a bad id. */
export async function loadParent(parentId) {
	if (parentId == null || parentId === '') return null;
	if (!UUID_RE.test(String(parentId))) throw new CadForgeError('invalid_parent', 'Malformed parent design id.', 400);
	const parent = await getDesign(String(parentId));
	if (!parent) throw new CadForgeError('parent_not_found', 'The design you are refining no longer exists.', 404);
	return parent;
}

/**
 * Write, build, export and save a design (fresh, or refining `parent` at
 * `values`). Returns { design, attempts }.
 */
export async function createDesign({ prompt, parent = null, values = {}, user = null, onEvent = () => {} }) {
	requireAvailable();
	const baseCode = parent ? applyParams(parent.code, values || {}).code : null;
	const forged = await forgeDesign({ prompt, baseCode, track: { userId: user?.id ?? null }, onEvent });
	onEvent({ stage: 'saving' });
	const id = newDesignId();
	const files = await uploadArtifacts(`cad/${id}`, forged.build.artifacts);
	const saved = await saveDesign({
		id,
		parentId: parent?.id || null,
		title: forged.title,
		summary: forged.summary,
		prompt,
		code: forged.code,
		params: forged.params,
		metrics: forged.build.metrics,
		files,
		adjustments: forged.build.adjustments || [],
		model: forged.model,
		userId: user?.id ?? null,
	});
	if (!saved) throw new CadForgeError('save_failed', 'The part built but could not be saved. Try again.', 500);
	return {
		design: publicDesign({ ...saved, creatorUsername: user?.username || null }),
		attempts: forged.attempts.length,
	};
}

/**
 * Rebuild a saved design's own program at new values. Cached per value set.
 * Returns { variant, cached }. `beforeBuild` runs only on a cache miss (the
 * HTTP route rate-limits there).
 */
export async function rebuildVariant({ id, values, beforeBuild = async () => {} }) {
	if (!UUID_RE.test(String(id ?? ''))) throw new CadForgeError('invalid_id', 'Malformed design id.', 400);
	requireAvailable();
	const design = await getDesign(String(id));
	if (!design) throw new CadForgeError('not_found', 'No design with that id.', 404);

	const { code, applied } = applyParams(design.code, values || {});
	const key = paramsKey(applied);
	const cached = await getVariant(design.id, key);
	if (cached) return { variant: { ...cached, url: designUrl(design.id, key) }, cached: true, design };

	await beforeBuild();
	const build = await buildProgram(code);
	if (!build?.ok) {
		throw new CadForgeError('rebuild_failed', 'These values do not make a valid part. Try values closer to the original.', 422, build?.error || null);
	}
	const files = await uploadArtifacts(`cad/${design.id}/v/${key}`, build.artifacts);
	const variant = await saveVariant({ designId: design.id, key, values: applied, metrics: build.metrics, files, adjustments: build.adjustments || [] });
	if (!variant) throw new CadForgeError('save_failed', 'The part rebuilt but could not be saved. Try again.', 500);
	return { variant: { ...variant, url: designUrl(design.id, key) }, cached: false, design };
}
