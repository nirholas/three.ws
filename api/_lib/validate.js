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

export const registerBody = z.object({
	email,
	password,
	display_name: displayName.optional(),
});

export const loginBody = z.object({
	email,
	password: z.string().min(1).max(200),
});

export const createAvatarBody = z.object({
	name: z.string().trim().min(1).max(120),
	slug: slug.optional(),
	description: z.string().trim().max(2000).optional(),
	visibility: avatarVisibility.default('private'),
	tags: z.array(z.string().trim().min(1).max(40)).max(20).default([]),
	source: z.enum(['upload', 'avaturn', 'import']).default('upload'),
	source_meta: z.record(z.any()).default({}),
	content_type: z.string().default('model/gltf-binary'),
	size_bytes: z.number().int().positive().max(500 * 1024 * 1024),
	checksum_sha256: z.string().regex(/^[a-f0-9]{64}$/).optional(),
});

export const presignUploadBody = z.object({
	size_bytes: z.number().int().positive().max(500 * 1024 * 1024),
	content_type: z.string().default('model/gltf-binary'),
	checksum_sha256: z.string().regex(/^[a-f0-9]{64}$/).optional(),
});

export function parse(schema, input) {
	const res = schema.safeParse(input);
	if (!res.success) {
		const err = new Error(res.error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; '));
		err.status = 400;
		err.code = 'validation_error';
		throw err;
	}
	return res.data;
}
