// `get_scene`: fetch a saved diorama by id. Read-only.
//
// Wraps GET /api/diorama?id=<uuid>.

import { z } from 'zod';

import { apiRequest } from '../lib/api.js';

export const def = {
	name: 'get_scene',
	title: 'Fetch a saved diorama by id',
	annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: true },
	description:
		'Fetch one saved diorama (a fully-forged 3D world) by its id, including its title, mood, palette, ground, and the placed objects with their GLB URLs. Returns the orbitable viewer URL. Read-only. Use this when you already have a diorama id (from list_scenes or build_world) and need its objects, for example before passing them to export_scene.',
	inputSchema: {
		id: z.string().min(1).describe('The diorama id returned when the world was saved.'),
	},
	async handler(args) {
		const id = String(args?.id ?? '').trim();
		const data = await apiRequest('/api/diorama', { query: { id } });
		const diorama = data?.diorama;
		if (!diorama) {
			throw Object.assign(new Error(`No diorama found with id "${id}".`), { code: 'not_found', status: 404 });
		}
		return {
			ok: true,
			diorama,
			viewer_url: `https://three.ws/diorama?id=${encodeURIComponent(id)}`,
		};
	},
};
