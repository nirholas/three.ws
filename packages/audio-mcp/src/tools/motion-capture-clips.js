// `motion_capture_clips` — browse the stored motion-capture clip library.
// Read-only.
//
// Wraps GET /api/mocap/clips. Mocap clips are recorded client-side (FaceMocap /
// pose / hand / VMC) and stored as a per-frame track; this lists the catalog so
// an agent can discover clips to drive an avatar with. Anonymous callers see
// public clips only; set THREE_WS_API_KEY to also see your own clips (use
// include_public to widen that back to "mine + public"). Frames are NOT included
// here — fetch a single clip with motion_capture_clip to get the track.

import { z } from 'zod';

import { apiRequest } from '../lib/api.js';
import { THREE_WS_API_KEY } from '../config.js';

const KINDS = ['face', 'pose', 'hand', 'vmc'];

export const def = {
	name: 'motion_capture_clips',
	title: 'List motion-capture clips',
	annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: true },
	description:
		'List motion-capture clips from the three.ws library — recorded face/pose/hand/VMC tracks an avatar can play back. Returns clip ' +
		'metadata (id, slug, name, kind, format, duration_ms, frame_count, tags, visibility, play_count, price) but NOT the frames; fetch a ' +
		'clip by id with motion_capture_clip to get the animation track. Anonymous callers see only public clips; set THREE_WS_API_KEY to ' +
		'include your own. Cursor-paginated via next_cursor. Read-only live data. ' +
		'Use this first to find a recorded face, pose, hand, or VMC clip, then pass its id to motion_capture_clip for the frames.',
	inputSchema: {
		kind: z
			.enum(KINDS)
			.optional()
			.describe('Filter by capture kind: "face" (blendshapes), "pose" (body), "hand", or "vmc".'),
		include_public: z
			.boolean()
			.optional()
			.describe('When authenticated (THREE_WS_API_KEY set), return your clips AND public ones instead of just your own. Ignored anonymously (always public-only).'),
		limit: z
			.number()
			.int()
			.min(1)
			.max(100)
			.optional()
			.describe('How many clips to return (1–100, default 50).'),
		cursor: z
			.string()
			.optional()
			.describe('Pagination cursor from a previous response\'s next_cursor.'),
	},
	async handler(args) {
		const query = {
			kind: args?.kind,
			limit: args?.limit,
			cursor: args?.cursor,
			...(args?.include_public ? { include_public: 'true' } : {}),
		};

		const data = await apiRequest('/api/mocap/clips', { query });
		const items = Array.isArray(data?.items) ? data.items : [];

		return {
			ok: true,
			authenticated: Boolean(THREE_WS_API_KEY),
			count: items.length,
			next_cursor: data?.next_cursor ?? null,
			clips: items,
		};
	},
};
