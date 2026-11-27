// restyle-instruction.js: the checks a free-text material restyle instruction
// goes through, shared by the Forge Materials panel (src/forge-materials.js)
// and the server (api/material-studio.js?action=restyle), so the browser and
// the API can never disagree about what is acceptable.
//
// The policy matches generation prompts (owner directive 2026-08-07): nothing
// screens WHAT a user may ask for. The only checks are shape: whitespace and
// control characters are cleaned, then the text must be 3 to 300 characters.
//
// shapeIntent() is guidance, not a gate. A material restyle only rewrites
// surface factors, so "make it taller" or "add wings" would come back as the
// same model with a new coat of paint. When the text reads as a geometry
// request, the panel points at the tool that can actually do it and still lets
// the user restyle the surface anyway.

export const INSTRUCTION_MIN = 3;
export const INSTRUCTION_MAX = 300;

// C0/C1 controls plus zero-width and bidi formatting characters: invisible,
// never meaningful in an instruction, and a way to make two strings that look
// the same compare different.
const INVISIBLE = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f​-‏‪-‮⁠-⁤﻿]/g;

/** Clean an instruction: drop invisible characters, collapse whitespace, trim. */
export function normalizeInstruction(value) {
	if (typeof value !== 'string') return '';
	return value.replace(INVISIBLE, '').replace(/\s+/g, ' ').trim();
}

/**
 * @param {unknown} value
 * @returns {{ ok: true, text: string } | { ok: false, code: string, message: string }}
 */
export function checkInstruction(value) {
	const text = normalizeInstruction(value);
	if (!text) {
		return { ok: false, code: 'missing_instruction', message: 'Describe the look you want, for example "polished white marble".' };
	}
	if (text.length < INSTRUCTION_MIN) {
		return {
			ok: false,
			code: 'instruction_too_short',
			message: `Use at least ${INSTRUCTION_MIN} characters to describe the look.`,
		};
	}
	if (text.length > INSTRUCTION_MAX) {
		return {
			ok: false,
			code: 'instruction_too_long',
			message: `Keep the description under ${INSTRUCTION_MAX} characters (it is ${text.length}).`,
		};
	}
	return { ok: true, text };
}

const PARTS =
	'wings?|horns?|tails?|hats?|helmets?|capes?|cloaks?|arms?|legs?|heads?|ears?|eyes?|noses?|mouths?|hands?|feet|foot|fingers?|toes?|' +
	'limbs?|tentacles?|fins?|spikes?|claws?|teeth|tusks?|manes?|beards?|hair|wheels?|handles?|antennas?|antennae|crowns?|swords?|' +
	'shields?|staffs?|weapons?|guns?|backpacks?|scarf|scarves|glasses|masks?|armou?r|torso|body';

const RULES = [
	{
		tool: 'stylize',
		label: 'Open Stylize',
		message: 'Blocky, faceted and low-poly looks rebuild the mesh itself. Stylize does that, with Voxel, Brick, Voronoi and Low poly.',
		test: /\b(voxel(s|ized|ised|ated)?|blocky|minecraft|lego|low[- ]?poly|faceted|voronoi|lattice|wire[- ]?frame|pixel(ated|ized|ised)|8[- ]?bit)\b/,
	},
	{
		tool: 'optimize',
		label: 'Open Optimize',
		message: 'Remeshing and quad topology rebuild the mesh. Optimize retopologizes the model for rigging and games.',
		test: /\b(re-?mesh(ed|ing)?|retopo(logy|logize|logise|logized)?|quad(-dominant)?\s+(topology|mesh)|quads|edge loops?)\b/,
	},
	{
		tool: 'refine',
		label: 'Open Refine',
		message: 'Polygon count, holes and seams are geometry. Refine fixes them on this device in a few seconds.',
		test: /\b(decimat(e|ed|ion)|subdivid(e|ed)|subdivision|weld(ed|ing)?|watertight|(non-)?manifold|(fewer|less|reduce|reducing|lower|cut)(\s+the)?\s+(poly(gon)?s?|triangles?|tris|faces|vertices|verts)|poly(gon)?\s*count|triangle\s+count|(fix|close|fill|patch)(\s+the)?\s+holes?)\b/,
	},
	{
		tool: 'iterate',
		label: 'Open Iterate',
		message: 'That changes the model’s shape, and a material restyle never moves a vertex. Iterate rebuilds the model from your description.',
		test: new RegExp(
			'\\b(taller|shorter|bigger|smaller|larger|wider|narrower|thinner|fatter|longer|slimmer|skinnier|chunkier)\\b' +
				'|\\b(reshape|re-shape|resize|rescale|stretch|squash|squish|pose|posed|posing|proportions)\\b' +
				'|\\b(add|adding|remove|removing|delete|attach|give it|take off|get rid of)\\s+' +
				'(?:(?:a|an|the|some|two|three|four|more|its|his|her|their)\\s+)?(?:[a-z-]+\\s+){0,2}?' +
				`(?:${PARTS})\\b`,
		),
	},
];

/**
 * Does this instruction ask for a change a material restyle cannot make?
 * @param {unknown} value
 * @returns {null | { tool: 'iterate'|'stylize'|'refine'|'optimize', label: string, message: string }}
 */
export function shapeIntent(value) {
	const text = normalizeInstruction(value).toLowerCase();
	if (!text) return null;
	for (const rule of RULES) {
		if (rule.test.test(text)) return { tool: rule.tool, label: rule.label, message: rule.message };
	}
	return null;
}
