// 3D asset pipeline listing metadata: the single source of truth for what
// POST /api/x402/pipeline accepts. The live 402 challenge (api/x402/pipeline.js),
// the service-catalog descriptor (service-catalog/services/pipeline.js, which
// feeds /.well-known/x402.json, the OKX projection, and the pay registry
// listing) and the stage engine (api/_lib/pipeline.js, which normalizes each
// stage's options) all read from here, so the advertised options, ranges and
// defaults are the ones the engine applies.
//
// Pure data: imports only the dependency-free tier, aspect-ratio and stylize
// tables, never a provider module, so discovery routes stay cheap to load.

import { TIER_IDS, DEFAULT_TIER } from './forge-tiers.js';
import { FORGE_ASPECT_RATIOS } from './forge-listing.js';
import { STYLE_IDS, DEFAULT_STYLE, styleRangesText } from './stylize-bounds.js';

// Canonical stage order. A requested chain must be a SUBSEQUENCE of this list.
export const CANONICAL_ORDER = Object.freeze(['generate', 'rig', 'remesh', 'gameready', 'stylize']);

export const DEFAULT_ASPECT_RATIO = '1:1';

// Per-stage options. tier and aspect_ratio sit at the top level of `options`
// (the generate stage reads them there); every other stage reads its own nested
// object. Each leaf carries the enum or range the engine clamps to and the
// default it falls back to.
export const PIPELINE_OPTIONS_SCHEMA = Object.freeze({
	type: 'object',
	description:
		'Optional stage settings. tier and aspect_ratio sit directly in options and apply to ' +
		'the generate stage; the other stages each read their own nested object.',
	properties: {
		tier: {
			type: 'string',
			enum: [...TIER_IDS],
			default: DEFAULT_TIER,
			description: 'Generate stage quality tier.',
		},
		aspect_ratio: {
			type: 'string',
			enum: [...FORGE_ASPECT_RATIOS],
			default: DEFAULT_ASPECT_RATIO,
			description: 'Generate stage reference view aspect ratio.',
		},
		rig: {
			type: 'object',
			description: 'Rig stage settings.',
			properties: {
				rig_type: {
					type: 'string',
					enum: ['biped', 'quadruped'],
					default: 'biped',
					description: 'Skeleton to infer.',
				},
			},
		},
		remesh: {
			type: 'object',
			description: 'Remesh stage settings.',
			properties: {
				remesh_mode: {
					type: 'string',
					enum: ['triangle', 'quad', 'lowpoly'],
					default: 'triangle',
					description: 'Output topology.',
				},
				operation: {
					type: 'string',
					enum: ['full', 'simplify', 'repair', 'convert'],
					default: 'full',
					description: 'full remeshes and re-bakes; the others run one step only.',
				},
				target_faces: {
					type: 'integer',
					minimum: 1000,
					maximum: 500000,
					default: 50000,
					description: 'Target face count.',
				},
				texture_size: {
					type: 'integer',
					enum: [512, 1024, 2048],
					default: 1024,
					description: 'Re-baked texture edge length in pixels.',
				},
			},
		},
		gameready: {
			type: 'object',
			description: 'Gameready stage settings.',
			properties: {
				topology: {
					type: 'string',
					enum: ['quad', 'tri'],
					default: 'quad',
					description: 'Output topology.',
				},
				poly_budget: {
					type: 'integer',
					minimum: 1000,
					maximum: 500000,
					default: 15000,
					description: 'Maximum polygon count.',
				},
				texture_size: {
					type: 'integer',
					enum: [1024, 2048],
					default: 2048,
					description: 'Re-baked PBR texture edge length in pixels.',
				},
			},
		},
		stylize: {
			type: 'object',
			description: 'Stylize stage settings.',
			properties: {
				style: {
					type: 'string',
					enum: [...STYLE_IDS],
					default: DEFAULT_STYLE,
					description: 'Geometric style.',
				},
				// No minimum/maximum: the stage forwards the number and the stylize
				// worker clamps it to the chosen style's own range.
				resolution: {
					type: 'integer',
					description: `Style density, clamped to the range of the chosen style (${styleRangesText()}).`,
				},
			},
		},
	},
});

export const PIPELINE_INPUT_EXAMPLE = Object.freeze({
	stages: ['generate', 'rig'],
	prompt: 'a brass steampunk owl, full body',
	options: { tier: 'draft', rig: { rig_type: 'biped' } },
});

// A chain containing generate needs a prompt (generate is always first);
// any other chain starts from glb_url.
export const PIPELINE_INPUT_SCHEMA = Object.freeze({
	$schema: 'https://json-schema.org/draft/2020-12/schema',
	type: 'object',
	required: ['stages'],
	if: { properties: { stages: { contains: { const: 'generate' } } } },
	then: { required: ['prompt'] },
	else: { required: ['glb_url'] },
	properties: {
		stages: {
			type: 'array',
			minItems: 1,
			maxItems: CANONICAL_ORDER.length,
			items: { type: 'string', enum: [...CANONICAL_ORDER] },
			description:
				'Ordered subsequence of ' + JSON.stringify(CANONICAL_ORDER) +
				'. generate must be first and requires prompt; without generate, glb_url is required.',
		},
		prompt: {
			type: 'string',
			minLength: 3,
			maxLength: 1000,
			description: 'Subject for the generate stage. Required when stages starts with generate.',
		},
		glb_url: {
			type: 'string',
			format: 'uri',
			description: 'Public https GLB to feed the first stage when the chain does not start with generate.',
		},
		options: PIPELINE_OPTIONS_SCHEMA,
	},
});

// Normalize one option value against its schema leaf: an enum leaf keeps a
// listed value and otherwise falls back to the default; a ranged integer leaf
// rounds and clamps, falling back to the default when it is not a number.
export function optionValue(leaf, raw) {
	if (Array.isArray(leaf.enum)) return leaf.enum.includes(raw) ? raw : leaf.default;
	const v = Number(raw);
	if (!Number.isFinite(v)) return leaf.default;
	return Math.max(leaf.minimum, Math.min(leaf.maximum, Math.round(v)));
}
