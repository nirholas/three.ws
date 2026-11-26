// The Forge direction step: turn the user's text prompt into the brief the
// reference painter receives, and say truthfully what happened.
//
// Direction is an improvement, never a requirement. A known brand mark resolves
// deterministically; otherwise the art director (an LLM rewrite, see
// directPrompt in api/_mcp-studio/forge-client.js) gets one short budget, and
// any failure (every provider refusing, a stall, a refusal or off-topic reply)
// sends the user's own words forward unchanged. The returned `direction` record
// travels to the page on the submit response and the progress crumb, so the
// page never claims a prompt was enhanced when it was not.
//
// Shared by api/forge.js and its clone api/gpt-forge.js, which pass their own
// client's directPrompt.

import { meshDirectorFor, meshSubjectClass, resolveLogoPrompt } from './forge-director-prompts.js';

/**
 * @typedef {object} Direction
 * @property {'directed'|'known_mark'|'skipped'|'off'} status
 *   directed: the LLM rewrite is the brief. known_mark: a deterministic brand
 *   spec is the brief. skipped: the director could not help, the user's prompt
 *   is the brief. off: the caller turned direction off.
 * @property {string} [reason] why direction was skipped (see directPrompt)
 * @property {number} [ms] wall time of the step
 */

/**
 * @param {string} prompt the user's prompt
 * @param {{ enabled?: boolean, direct: Function, now?: () => number }} opts
 * @returns {Promise<{ prompt: string, direction: Direction }>}
 */
export async function directForReference(prompt, { enabled = true, direct, now = Date.now } = {}) {
	if (!enabled) return { prompt, direction: { status: 'off' } };

	// Known brand marks resolve before the LLM gets a say: no model reliably
	// knows a niche mark's geometry, and the lexicon spec is already a tight
	// single-subject description.
	const knownMark = resolveLogoPrompt(prompt);
	if (knownMark) return { prompt: knownMark.prompt, direction: { status: 'known_mark' } };

	const startedAt = now();
	let reason = null;
	let directed = null;
	try {
		// Subject-classified briefing (person/animal/vehicle/food/architecture/
		// object) so the director reaches for the cues that matter for THIS
		// subject's failure mode.
		directed = await direct(meshDirectorFor(meshSubjectClass(prompt)), prompt, {
			onFallback: (f) => {
				reason = f?.reason || 'no_reply';
			},
		});
	} catch {
		// directPrompt is fail-soft by contract; a throw here is still only a
		// missing nicety, never a failed generation.
		directed = null;
		reason = reason || 'director_error';
	}
	const ms = now() - startedAt;
	if (typeof directed === 'string' && directed.trim() && directed.trim() !== prompt) {
		return { prompt: directed.trim(), direction: { status: 'directed', ms } };
	}
	return { prompt, direction: { status: 'skipped', reason: reason || 'unchanged', ms } };
}
