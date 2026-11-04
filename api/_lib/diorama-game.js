// Diorama compose: the optional game block.
//
// The composer model never sees object ids (the server assigns them), so it
// names goal targets by their 0-based index in the objects array it returned.
// This module turns that into a validated `game` block on the normalized plan
// and gives both compose paths (the interactive route and the headless build)
// one shared prompt addendum and one shared finishing step.

import { normalizeDiorama, normalizeGame } from '../../src/diorama/schema.js';

export const GAME_PROMPT_RULES = `- Games: ONLY when the sentence implies a goal ("find the three lanterns", "get to the cabin before night", "survive the night among the wolves"), also return
  "game": { "goal": "collect" | "reach" | "survive", "targets": [indices into your objects array], "count": pickups needed (collect only), "timeLimitSec": seconds or null }
  collect: the targets are pickups. reach: targets[0] is the destination. survive: the targets are hazards the player must avoid until the timer ends (give timeLimitSec).
  Targets must be objects you listed. Omit "game" entirely when the sentence describes a place with no goal.`;

/**
 * Normalize a model-composed plan into a pending diorama, with the game block
 * resolved against the final object ids. A hallucinated target (an index with
 * no object) is dropped, never fatal; a game left with no targets is omitted.
 * @returns {{ok:boolean, diorama:object, errors:string[], warnings:string[]}}
 */
export function normalizePlanWithGame(plan) {
	const rawObjects = (Array.isArray(plan?.objects) ? plan.objects : []).map((o, i) =>
		o && typeof o === 'object' ? { ...o, id: `plan-${i}` } : o,
	);
	const rawGame = plan?.game && typeof plan.game === 'object' ? plan.game : null;
	const toIds = (targets) =>
		(Array.isArray(targets) ? targets : []).map((t) =>
			Number.isInteger(t) && t >= 0 && t < rawObjects.length ? `plan-${t}` : `unknown-${String(t).slice(0, 24)}`,
		);
	const first = normalizeDiorama({
		...plan,
		objects: rawObjects,
		game: rawGame ? { ...rawGame, targetIds: toIds(rawGame.targets) } : undefined,
	});
	const { ok, diorama, errors } = first;
	const rename = new Map(diorama.objects.map((o, i) => [o.id, `obj-${i}`]));
	diorama.objects = diorama.objects.map((o, i) => ({ ...o, id: `obj-${i}`, status: 'pending', glbUrl: null }));
	let game = null;
	const warnings = [...first.warnings];
	if (diorama.game) {
		const remapped = normalizeGame(
			{ ...diorama.game, targetIds: diorama.game.targetIds.map((id) => rename.get(id)) },
			diorama.objects,
		);
		game = remapped.game;
		warnings.push(...remapped.warnings);
	}
	diorama.game = game;
	return { ok, diorama, errors, warnings };
}
