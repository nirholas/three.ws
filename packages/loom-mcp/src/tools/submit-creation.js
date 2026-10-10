// `submit_creation` — contribute a forged GLB to the public Loom gallery. Write.
//
// Wraps POST /api/loom { prompt, glbUrl, previewImageUrl?, author?, tier?, backend? }
//   → { creation } (201 new, or 200 with the existing record on dedup).
//
// Auth model (verified against api/loom.js): there is NO account, key, or signer.
// The endpoint is public and gated server-side ONLY by an IP rate limit (~20/hr)
// and strict input sanitization. `author` is free-text attribution, not identity.
// The GLB URL must be https on an allowlisted host — we validate that here too so
// a bad URL fails immediately with a clear message instead of a round-trip 400.

import { z } from 'zod';

import { apiRequest } from '../lib/api.js';
import { decorateCreation, validateGlbUrl, ALLOWED_GLB_HOST_SUFFIXES } from '../lib/viewer.js';

const PROMPT_MAX = 1000;
const AUTHOR_MAX = 40;

export const def = {
	name: 'submit_creation',
	title: 'Submit a creation to the Loom gallery',
	// Write: appends to a WORLD-READABLE public feed. Not destructive/irreversible
	// in the funds sense, and not reliably idempotent (each accepted POST is a new
	// public record; only an identical glbUrl re-posted within the newest few dedupes).
	annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
	description:
		'Contribute a forged 3D creation to Loom, the PUBLIC, world-readable community gallery. ⚠️ Anything you ' +
		'submit becomes visible to everyone on the platform, so only post models you intend to share. Requires ' +
		'`prompt` (the text that forged it, ≤1000 chars) and `glbUrl` (an https URL to the GLB, hosted on an ' +
		'allowed domain: ' + ALLOWED_GLB_HOST_SUFFIXES.join(', ') + '). Optional: `author` attribution (free ' +
		'text, ≤40 chars — NOT an authenticated identity; defaults to "anon"), `previewImageUrl`, `tier`, and ' +
		'`backend`. No key or account is needed; the endpoint is rate-limited to ~20 submissions per hour per ' +
		'IP. Re-submitting the exact same glbUrl returns the existing creation instead of duplicating it. ' +
		'Returns the stored creation with its id and a ready-to-use viewer_url + iframe_snippet. The only coin ' +
		'this platform references is $THREE; never put any other token in a prompt. ' +
		'Use this after the user has asked to share a specific model publicly, and only then.',
	inputSchema: {
		prompt: z
			.string()
			.min(1)
			.max(PROMPT_MAX)
			.describe('The prompt that forged the model. Required, 1–1000 chars. Shown publicly under the creation.'),
		glbUrl: z
			.string()
			.min(1)
			.describe(`https URL to the GLB. Must be hosted on an allowed domain: ${ALLOWED_GLB_HOST_SUFFIXES.join(', ')}.`),
		author: z
			.string()
			.max(AUTHOR_MAX)
			.optional()
			.describe('Attribution shown on the creation (free text, ≤40 chars). Not an authenticated identity. Defaults to "anon".'),
		previewImageUrl: z
			.string()
			.optional()
			.describe('Optional URL of a preview/thumbnail image for the feed.'),
		tier: z.string().optional().describe('Optional forge tier/quality label (e.g. the model preset used).'),
		backend: z.string().optional().describe('Optional name of the forge backend that produced the GLB.'),
	},
	async handler(args) {
		const prompt = String(args?.prompt ?? '').trim();
		if (!prompt) throw Object.assign(new Error('prompt is required.'), { code: 'invalid_input', status: 400 });

		// Validate the GLB URL against the same allowlist the server enforces, so a
		// bad host fails fast with an actionable message rather than an opaque 400.
		const glbUrl = validateGlbUrl(args?.glbUrl);
		if (!glbUrl) {
			throw Object.assign(
				new Error(
					`glbUrl must be an https URL hosted on an allowed domain (${ALLOWED_GLB_HOST_SUFFIXES.join(', ')}).`,
				),
				{ code: 'invalid_glb_url', status: 400 },
			);
		}

		const body = { prompt, glbUrl };
		if (args?.author != null) body.author = String(args.author);
		if (args?.previewImageUrl != null) body.previewImageUrl = String(args.previewImageUrl);
		if (args?.tier != null) body.tier = String(args.tier);
		if (args?.backend != null) body.backend = String(args.backend);

		const data = await apiRequest('/api/loom', { method: 'POST', body });
		const creation = decorateCreation(data?.creation);
		return { ok: true, creation };
	},
};
