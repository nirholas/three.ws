// `motion_capture_clip` — fetch one motion-capture clip including its frames.
// Read-only.
//
// Wraps GET /api/mocap/clips/:id. Returns the full clip: metadata plus the
// per-frame track an avatar plays back. Each frame is { t, shapes, mat? } —
// t = seconds from clip start, shapes = a name→weight map (ARKit blendshapes for
// face clips; bone/joint channels for pose/hand/vmc), mat = an optional 16-float
// transform. Public/unlisted clips are readable anonymously; a private clip
// returns not_found unless THREE_WS_API_KEY identifies its owner.

import { z } from 'zod';

import { apiRequest } from '../lib/api.js';

export const def = {
	name: 'motion_capture_clip',
	title: 'Get a motion-capture clip',
	annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: true },
	description:
		'Fetch a single motion-capture clip by id, including its full per-frame animation track. Returns { clip } with metadata plus ' +
		'`frames`: each frame is { t, shapes, mat? } — t in seconds, shapes a name→weight map (ARKit blendshapes for face clips; joint ' +
		'channels for pose/hand/vmc), and an optional 16-float transform matrix. Use this to drive an avatar from a clip discovered via ' +
		'motion_capture_clips. Public and unlisted clips are readable anonymously; a private clip needs THREE_WS_API_KEY for its owner. Read-only.',
	inputSchema: {
		id: z
			.string()
			.min(8)
			.describe('The clip id (UUID) returned by motion_capture_clips.'),
	},
	async handler(args) {
		const id = String(args?.id ?? '').trim();
		const data = await apiRequest(`/api/mocap/clips/${encodeURIComponent(id)}`);
		return {
			ok: true,
			clip: data?.clip ?? null,
		};
	},
};
