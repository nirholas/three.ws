// `list_avatars` — enumerate the curated default avatars + accessories +
// pose presets shipped by three.ws. Free, no signer needed.

import { z } from 'zod';

import { ACCESSORIES, DEFAULT_AVATARS, POSE_PRESETS } from '../lib/avatars.js';
import { accessoryEntry, upstreamObject } from '../lib/output-shapes.js';

// The catalog read cannot fail (pure in-process data), so every field is
// required — there is no soft-fail variant.
const outputSchema = {
	avatars: z.array(
		upstreamObject({
			id: z.string(),
			name: z.string(),
			description: z.string(),
			glb: z.string(),
			thumbnail: z.string().nullable(),
		}),
	),
	accessories: z.array(accessoryEntry),
	poses: z.array(z.string()),
	fetchedAt: z.string(),
};

export const def = {
	name: 'list_avatars',
	title: 'List three.ws default avatars + accessories',
	// MCP ToolAnnotations — safety hints surfaced to MCP clients.
	annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
	description:
		'Return the catalog of default 3D avatars (default, cz) and accessories (hats, glasses, earrings) hosted on the three.ws CDN. Each entry includes a public GLB URL ready to load in any glTF viewer or Three.js scene. Includes the supported pose preset names. Use this first to pick a preset or accessory id for spawn_avatar and dress_avatar.',
	inputSchema: {},
	async handler() {
		return {
			avatars: DEFAULT_AVATARS,
			accessories: ACCESSORIES,
			poses: POSE_PRESETS,
			fetchedAt: new Date().toISOString(),
		};
	},
};
