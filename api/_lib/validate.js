// Reusable zod schemas for API inputs.

import { z } from 'zod';

export const email = z.string().trim().toLowerCase().email().max(254);
export const password = z.string().min(10).max(200);
export const displayName = z.string().trim().min(1).max(80);
export const slug = z
	.string()
	.trim()
	.min(1)
	.max(64)
	.regex(/^[a-z0-9][a-z0-9_-]*$/, 'slug must be lowercase alphanumeric with - or _');

export const avatarVisibility = z.enum(['private', 'unlisted', 'public']);

// Avatars are GLB/GLTF models. Lock the content-type allowlist here so both
// the presign URL and the stored object can only ever be model binaries —
// prevents an attacker uploading HTML/SVG to the public CDN for stored XSS.
export const avatarContentType = z.enum(['model/gltf-binary', 'model/gltf+json']);

export const username = z
	.string()
	.trim()
	.min(3)
	.max(30)
	.regex(/^[a-zA-Z0-9_-]+$/, 'username must be alphanumeric with _ or -');

export const registerBody = z.object({
	email,
	password,
	display_name: displayName.optional(),
});

export const usernameRegisterBody = z.object({
	username,
	password,
});

export const loginBody = z.object({
	email: z.string().trim().min(1).max(254), // accepts email address or username
	password: z.string().min(1).max(200),
});

export const createAvatarBody = z.object({
	name: z.string().trim().min(1).max(120),
	slug: slug.optional(),
	description: z.string().trim().max(2000).optional(),
	visibility: avatarVisibility.default('private'),
	tags: z.array(z.string().trim().min(1).max(40)).max(20).default([]),
	source: z.enum(['upload', 'avaturn', 'import', 'direct-upload']).default('upload'),
	parent_avatar_id: z.string().uuid().optional(),
	source_meta: z.record(z.any()).default({}),
	content_type: avatarContentType.default('model/gltf-binary'),
	size_bytes: z
		.number()
		.int()
		.positive()
		.max(500 * 1024 * 1024),
	checksum_sha256: z
		.string()
		.regex(/^[a-f0-9]{64}$/)
		.optional(),
});

export const presignUploadBody = z.object({
	size_bytes: z
		.number()
		.int()
		.positive()
		.max(500 * 1024 * 1024),
	content_type: avatarContentType.default('model/gltf-binary'),
	checksum_sha256: z
		.string()
		.regex(/^[a-f0-9]{64}$/)
		.optional(),
});

export function isValidSolanaAddress(address) {
	return typeof address === 'string' && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address);
}

export function isValidEvmAddress(address) {
	return typeof address === 'string' && /^0x[a-fA-F0-9]{40}$/.test(address);
}

export function parse(schema, input) {
	const res = schema.safeParse(input);
	if (!res.success) {
		const err = new Error(
			res.error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; '),
		);
		err.status = 400;
		err.code = 'validation_error';
		err.issues = res.error.issues.map((i) => ({
			path: i.path,
			code: i.code,
			message: i.message,
		}));
		throw err;
	}
	return res.data;
}

// Read JSON body and zod-parse in one call. Returns the parsed payload, or
// throws a structured 400 with `issues` for the API error envelope to surface.
//
// Pair with the `wrap()` helper in http.js to get consistent error responses.
export async function validateBody(req, schema, opts = {}) {
	const { readJson } = await import('./http.js');
	const raw = await readJson(req, opts.limit);
	return parse(schema, raw);
}

// Same idea for query strings — useful for GET endpoints that take typed filters.
export function validateQuery(req, schema) {
	const url = new URL(req.url, 'http://x');
	const obj = Object.fromEntries(url.searchParams.entries());
	return parse(schema, obj);
}
