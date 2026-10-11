// `get_vision_status` — is image understanding live, and what does it accept?
// Read-only.
//
// Wraps GET /api/vision (the capability probe). Cheap and unauthenticated — call
// it before offering a describe/analyze affordance, or to confirm the deployment
// has a vision provider configured at all.

import { apiRequest } from '../lib/api.js';
import { ACCEPTED_IMAGE_TYPES } from '../lib/image.js';

export const def = {
	name: 'get_vision_status',
	title: 'Vision availability + accepted formats',
	annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: true },
	description:
		'Check whether the three.ws vision pipeline is live on the target deployment and which image formats it ' +
		'accepts. Returns `configured` (true when at least one VLM provider — a free NVIDIA NIM lane or the paid ' +
		'backstop — can serve a request) and `image_types` (the accepted MIME types). Use this before calling ' +
		'analyze_image / describe_image so the agent can decide whether to offer a "describe this image" action. ' +
		'No image, no key, no cost.',
	inputSchema: {},
	async handler() {
		const data = await apiRequest('/api/vision', { method: 'GET' });
		return {
			ok: true,
			configured: Boolean(data?.configured),
			image_types: Array.isArray(data?.imageTypes) ? data.imageTypes : ACCEPTED_IMAGE_TYPES,
			max_image_mb: 12,
		};
	},
};
