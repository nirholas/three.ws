// `analyze_image` — ask a question about an image and get a grounded answer.
// Read-only.
//
// Wraps POST /api/vision with the caller's own prompt. The platform runs the
// request against its free-first VLM chain (NVIDIA NIM lanes, automatic paid
// backstop) and returns the model's text plus which provider/model served it.

import { z } from 'zod';

import { apiRequest } from '../lib/api.js';
import { buildVisionBody, ACCEPTED_IMAGE_TYPES } from '../lib/image.js';

export const def = {
	name: 'analyze_image',
	title: 'Analyze an image against a prompt',
	annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: true },
	description:
		'Let the agent SEE an image and answer a question about it. Supply the image as `imageUrl` (a public ' +
		'https URL the vision server fetches) OR `image` (raw base64 / a data: URI), and a `prompt` describing ' +
		'what to extract — e.g. "What objects are in this scene?", "Read the text in this screenshot", "Is this ' +
		'avatar render rigged correctly?". Returns the model\'s answer as `text`, plus the `provider` and `model` ' +
		'that served it (a free NVIDIA NIM lane when available, an automatic paid backstop otherwise — the caller ' +
		'never pays). Analysis only: it does not store or mutate anything. Accepts JPEG, PNG, WebP, or GIF up to ' +
		'12 MB; base64 inputs are size-checked before upload. Use this when you have a specific question about an ' +
		'image; for a general caption or alt text with no question, call describe_image instead.',
	inputSchema: {
		prompt: z
			.string()
			.min(1)
			.max(2000)
			.describe('The question or instruction about the image (what to extract, read, classify, or critique).'),
		imageUrl: z
			.string()
			.url()
			.optional()
			.describe('Public https URL of the image to analyze. Provide this OR `image`, not both.'),
		image: z
			.string()
			.optional()
			.describe('The image as raw base64 or a `data:image/...;base64,...` URI. Provide this OR `imageUrl`, not both.'),
		imageType: z
			.enum(ACCEPTED_IMAGE_TYPES)
			.optional()
			.describe('MIME type of a raw base64 `image` (ignored for data URIs / `imageUrl`). Defaults to image/jpeg.'),
		maxTokens: z
			.number()
			.int()
			.min(16)
			.max(2048)
			.optional()
			.describe('Maximum tokens in the answer (16–2048). Higher = longer, more detailed reads. Default 512.'),
	},
	async handler(args) {
		const { body, source } = buildVisionBody({
			imageUrl: args?.imageUrl,
			image: args?.image,
			imageType: args?.imageType,
			prompt: args?.prompt,
			maxTokens: args?.maxTokens,
		});
		const data = await apiRequest('/api/vision', { method: 'POST', body });
		return {
			ok: true,
			text: typeof data?.text === 'string' ? data.text : '',
			provider: data?.provider ?? null,
			model: data?.model ?? null,
			prompt: body.prompt ?? args?.prompt ?? '',
			image_source: source,
		};
	},
};
