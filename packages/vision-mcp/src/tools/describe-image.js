// `describe_image` — get a natural-language description of an image. Read-only.
//
// Wraps POST /api/vision with a describe-oriented prompt the caller can steer
// with `detail` and `focus`. The convenience twin of analyze_image: when you
// don't have a specific question and just want to know what an image shows
// (alt text, a caption, a content summary), this returns prose, not a Q&A.

import { z } from 'zod';

import { apiRequest } from '../lib/api.js';
import { buildVisionBody, ACCEPTED_IMAGE_TYPES } from '../lib/image.js';

const DETAIL_PROMPTS = {
	brief: 'Describe this image in one concise sentence. Be concrete; name the main subject and style.',
	standard:
		'Describe this image in two to three sentences: the subject, the style, and the most notable details. Be concrete and concise.',
	detailed:
		'Describe this image thoroughly: the main subject, composition, colors, style, setting, and any notable details or text. Write a few clear sentences.',
};

function buildDescribePrompt(detail, focus) {
	const base = DETAIL_PROMPTS[detail] || DETAIL_PROMPTS.standard;
	const lens = typeof focus === 'string' && focus.trim() ? ` Pay particular attention to: ${focus.trim().slice(0, 400)}.` : '';
	return `${base}${lens}`;
}

export const def = {
	name: 'describe_image',
	title: 'Describe an image in natural language',
	annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: true },
	description:
		'Get a plain-language description of an image — ideal for alt text, captions, or a quick "what is this?" ' +
		'read when you have no specific question. Supply the image as `imageUrl` (a public https URL) OR `image` ' +
		'(raw base64 / data: URI). Use `detail` to pick brief / standard / detailed, and `focus` to steer the ' +
		'description toward something specific (e.g. "the clothing", "any visible text"). Returns the prose as ' +
		'`description`, plus the `provider` and `model` that served it (free NVIDIA NIM first, automatic paid ' +
		'backstop otherwise, so the caller never pays). Read-only; accepts JPEG, PNG, WebP, or GIF up to 12 MB. ' +
		'Use this for alt text or a caption when you have no particular question; to ask something specific about the image, call analyze_image instead.',
	inputSchema: {
		imageUrl: z
			.string()
			.url()
			.optional()
			.describe('Public https URL of the image to describe. Provide this OR `image`, not both.'),
		image: z
			.string()
			.optional()
			.describe('The image as raw base64 or a `data:image/...;base64,...` URI. Provide this OR `imageUrl`, not both.'),
		imageType: z
			.enum(ACCEPTED_IMAGE_TYPES)
			.optional()
			.describe('MIME type of a raw base64 `image` (ignored for data URIs / `imageUrl`). Defaults to image/jpeg.'),
		detail: z
			.enum(['brief', 'standard', 'detailed'])
			.default('standard')
			.describe('How much description to return: brief (one sentence), standard (2–3 sentences), or detailed (a full paragraph).'),
		focus: z
			.string()
			.max(400)
			.optional()
			.describe('Optional aspect to emphasize in the description (e.g. "any visible text", "the background", "the pose").'),
	},
	async handler(args) {
		const detail = ['brief', 'standard', 'detailed'].includes(args?.detail) ? args.detail : 'standard';
		const prompt = buildDescribePrompt(detail, args?.focus);
		// brief → fewer tokens, detailed → more headroom.
		const maxTokens = detail === 'brief' ? 128 : detail === 'detailed' ? 768 : 384;
		const { body, source } = buildVisionBody({
			imageUrl: args?.imageUrl,
			image: args?.image,
			imageType: args?.imageType,
			prompt,
			maxTokens,
		});
		const data = await apiRequest('/api/vision', { method: 'POST', body });
		return {
			ok: true,
			description: typeof data?.text === 'string' ? data.text : '',
			detail,
			provider: data?.provider ?? null,
			model: data?.model ?? null,
			image_source: source,
		};
	},
};
