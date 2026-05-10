// Private module: avatar action endpoints dispatched from [id].js.
// presign, public, regenerate, regenerate-status

import { getSessionUser, authenticateBearer, extractBearer, hasScope } from '../_lib/auth.js';
import { presignUpload, headObject, r2 } from '../_lib/r2.js';
import { storageKeyFor, enforceQuotas, searchPublicAvatars, stripOwnerFor } from '../_lib/avatars.js';
import { listAvatars, createAvatar } from '../_lib/avatars.js';
import { HeadObjectCommand } from '@aws-sdk/client-s3';
import { env } from '../_lib/env.js';
import { sql } from '../_lib/db.js';
import { cors, json, method, readJson, wrap, error } from '../_lib/http.js';
import { parse, presignUploadBody, slug as slugSchema, createAvatarBody } from '../_lib/validate.js';
import { recordEvent } from '../_lib/usage.js';
import { limits, clientIp } from '../_lib/rate-limit.js';
import { z } from 'zod';
import { randomUUID } from 'crypto';

// ── presign ───────────────────────────────────────────────────────────────────

async function resolvePresignUser(req, requiredScope) {
	const session = await getSessionUser(req);
	if (session) return session.id;
	const bearer = await authenticateBearer(extractBearer(req), { audience: undefined });
	if (!bearer || !hasScope(bearer.scope, requiredScope)) return null;
	return bearer.userId;
}

const handlePresign = wrap(async (req, res) => {
	if (cors(req, res, { methods: 'POST,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['POST'])) return;
	const userId = await resolvePresignUser(req, 'avatars:write');
	if (!userId) return error(res, 401, 'unauthorized', 'sign in or provide a valid bearer token');
	const rl = await limits.upload(userId);
	if (!rl.success) return error(res, 429, 'rate_limited', 'upload rate exceeded');
	const body = parse(presignUploadBody, await readJson(req));
	try { await enforceQuotas(userId, body.size_bytes); }
	catch (err) { return error(res, err.status || 402, err.code || 'plan_limit', err.message); }
	const bodyAny = body;
	const slug = bodyAny.slug ? slugSchema.parse(bodyAny.slug) : `draft-${Math.random().toString(36).slice(2, 8)}`;
	const key = storageKeyFor({ userId, slug });
	const url = await presignUpload({ key, contentType: body.content_type });
	return json(res, 200, { storage_key: key, upload_url: url, method: 'PUT', headers: { 'content-type': body.content_type }, expires_in: 300 });
});

// ── public ────────────────────────────────────────────────────────────────────

const handlePublic = wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,OPTIONS' })) return;
	if (!method(req, res, ['GET'])) return;
	const url = new URL(req.url, 'http://x');
	const result = await searchPublicAvatars({ q: url.searchParams.get('q') || undefined, tag: url.searchParams.get('tag') || undefined, limit: Number(url.searchParams.get('limit')) || 24, cursor: url.searchParams.get('cursor') || undefined });
	result.avatars = result.avatars.map((a) => stripOwnerFor(a, null));
	res.setHeader('cache-control', 'public, max-age=60, s-maxage=60');
	return json(res, 200, result);
});

// ── regenerate ────────────────────────────────────────────────────────────────

const regenerateSchema = z.object({
	sourceAvatarId: z.string().trim().min(1).max(100),
	mode: z.enum(['remesh', 'retex', 'rerig', 'restyle']),
	params: z.record(z.unknown()).optional(),
});

async function resolveRegenUser(req) {
	const session = await getSessionUser(req);
	const bearer = session ? null : await authenticateBearer(extractBearer(req));
	if (!session && !bearer) return null;
	if (bearer && !hasScope(bearer.scope, 'avatars:write')) return null;
	return session?.id ?? bearer?.userId;
}

const handleRegenerate = wrap(async (req, res) => {
	if (cors(req, res, { methods: 'POST,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['POST'])) return;
	const userId = await resolveRegenUser(req);
	if (!userId) return error(res, 401, 'unauthorized', 'sign in or provide a valid bearer token');
	const rl = await limits.upload(userId);
	if (!rl.success) return error(res, 429, 'rate_limited', 'too many requests');
	const body = parse(regenerateSchema, await readJson(req));
	const rows = await sql`select id, name, storage_key from avatars where id = ${body.sourceAvatarId} and owner_id = ${userId} and deleted_at is null limit 1`;
	if (!rows[0]) return error(res, 404, 'not_found', 'source avatar not found or not owned');
	const provider = (env.AVATAR_REGEN_PROVIDER || 'none').trim().toLowerCase();
	if (provider === 'none' || !provider) return error(res, 501, 'regen_unconfigured', 'Avatar regeneration is not yet wired to an ML backend. Set AVATAR_REGEN_PROVIDER env var.');
	if (provider === 'stub') {
		const jobId = `stub-${randomUUID()}`;
		await sql`insert into avatar_regen_jobs (job_id, user_id, source_avatar_id, mode, params, status, created_at) values (${jobId}, ${userId}, ${body.sourceAvatarId}, ${body.mode}, ${JSON.stringify(body.params ?? {})}, 'queued', now())`;
		return json(res, 202, { ok: true, jobId, status: 'queued', eta: null });
	}
	return error(res, 501, 'regen_provider_error', `Unknown provider: ${provider}`);
});

// ── regenerate-status ─────────────────────────────────────────────────────────

const handleRegenerateStatus = wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['GET'])) return;
	const session = await getSessionUser(req);
	const bearer = session ? null : await authenticateBearer(extractBearer(req));
	if (!session && !bearer) return error(res, 401, 'unauthorized', 'sign in or provide a valid bearer token');
	if (bearer && !hasScope(bearer.scope, 'avatars:read')) return error(res, 403, 'insufficient_scope', 'avatars:read scope required');
	const userId = session?.id ?? bearer?.userId;
	const url = new URL(req.url, 'http://x');
	const jobId = url.searchParams.get('jobId');
	if (!jobId) return error(res, 400, 'invalid_request', 'jobId required');
	const rows = await sql`select job_id, status, result_avatar_id, error, created_at from avatar_regen_jobs where job_id = ${jobId} and user_id = ${userId} limit 1`;
	if (!rows[0]) return error(res, 404, 'not_found', 'job not found');
	const job = rows[0];
	const response = { ok: true, jobId: job.job_id, status: job.status };
	if (job.result_avatar_id) response.resultAvatarId = job.result_avatar_id;
	if (job.error) response.error = job.error;
	return json(res, 200, response);
});

// ── presign-thumbnail ─────────────────────────────────────────────────────────
// Called by the browser after rendering a GLB preview via <model-viewer>.
// The client captures toBlob() and uploads the PNG here, then PATCHes the
// avatar record with the resulting thumbnail_key.

const thumbnailPresignSchema = z.object({
	avatar_id: z.string().uuid(),
	size_bytes: z.number().int().min(1).max(2 * 1024 * 1024), // 2 MB max for a PNG thumb
});

const handlePresignThumbnail = wrap(async (req, res) => {
	if (cors(req, res, { methods: 'POST,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['POST'])) return;
	const userId = await resolvePresignUser(req, 'avatars:write');
	if (!userId) return error(res, 401, 'unauthorized', 'sign in or provide a valid bearer token');

	const body = parse(thumbnailPresignSchema, await readJson(req));

	// Verify caller owns the avatar they're thumbnailing.
	const rows = await (await import('../_lib/db.js')).sql`
		select id, storage_key from avatars
		where id = ${body.avatar_id} and owner_id = ${userId} and deleted_at is null
		limit 1
	`;
	if (!rows[0]) return error(res, 404, 'not_found', 'avatar not found or not yours');

	// Thumbnail key: same prefix as the GLB, different suffix.
	const thumbKey = rows[0].storage_key.replace(/\.glb$/i, '') + '_thumb.jpg';
	const uploadUrl = await presignUpload({ key: thumbKey, contentType: 'image/jpeg' });

	return json(res, 200, {
		thumb_key: thumbKey,
		upload_url: uploadUrl,
		method: 'PUT',
		headers: { 'content-type': 'image/jpeg' },
		expires_in: 300,
	});
});

// ── auto-tag ──────────────────────────────────────────────────────────────────
// Called after thumbnail upload; sends the poster to Claude vision for
// auto-generated tags and a one-line description. Non-blocking — a failure
// here must never fail the upload flow.

const autoTagSchema = z.object({
	avatar_id: z.string().uuid(),
	thumb_key: z.string().min(1).max(512),
});

const AVATAR_TAG_PROMPT = `You are a 3D avatar classification assistant.
Given a screenshot of a 3D avatar, respond with ONLY a JSON object:
{
  "tags": [3-6 tags from: humanoid, robot, animal, vehicle, stylized, realistic, anime, creature, character, abstract, military, fantasy, sci-fi, casual, formal],
  "description": "One sentence describing this 3D avatar (20-60 words)."
}
Respond with nothing else — no markdown, no explanation.`;

const handleAutoTag = wrap(async (req, res) => {
	if (cors(req, res, { methods: 'POST,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['POST'])) return;
	const userId = await resolvePresignUser(req, 'avatars:write');
	if (!userId) return error(res, 401, 'unauthorized', 'sign in or provide a valid bearer token');

	const body = parse(autoTagSchema, await readJson(req));

	// Verify ownership.
	const { sql } = await import('../_lib/db.js');
	const rows = await sql`
		select id, name, tags, description, thumbnail_key
		from avatars where id = ${body.avatar_id} and owner_id = ${userId} and deleted_at is null
		limit 1
	`;
	if (!rows[0]) return error(res, 404, 'not_found', 'avatar not found');

	// Fetch the thumbnail from R2 for vision.
	const { publicUrl } = await import('../_lib/r2.js');
	const { env } = await import('../_lib/env.js');
	const thumbUrl = publicUrl(body.thumb_key);

	// Call Claude Haiku — cheapest, sufficient for image classification.
	const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
		method: 'POST',
		headers: {
			'content-type': 'application/json',
			'x-api-key': env.ANTHROPIC_API_KEY,
			'anthropic-version': '2023-06-01',
		},
		body: JSON.stringify({
			model: 'claude-haiku-4-5-20251001',
			max_tokens: 256,
			messages: [
				{
					role: 'user',
					content: [
						{ type: 'image', source: { type: 'url', url: thumbUrl } },
						{ type: 'text', text: AVATAR_TAG_PROMPT },
					],
				},
			],
		}),
	});

	if (!anthropicRes.ok) {
		console.error('[auto-tag] anthropic error', await anthropicRes.text());
		return json(res, 200, { ok: false, reason: 'vision_api_error' });
	}

	const result = await anthropicRes.json();
	let parsed;
	try {
		const raw = result.content?.[0]?.text || '{}';
		parsed = JSON.parse(raw.trim());
	} catch {
		return json(res, 200, { ok: false, reason: 'parse_error' });
	}

	const newTags = Array.isArray(parsed.tags) ? parsed.tags.slice(0, 6) : [];
	const desc = typeof parsed.description === 'string' ? parsed.description.slice(0, 500) : '';

	// Only write if the avatar still has no tags/description (don't overwrite manual ones).
	const currentTags = rows[0].tags || [];
	const currentDesc = rows[0].description || '';

	const patch = {};
	if (!currentTags.length && newTags.length) patch.tags = newTags;
	if (!currentDesc && desc) patch.description = desc;
	// Always write thumbnail_key if not set yet.
	if (!rows[0].thumbnail_key) patch.thumbnail_key = body.thumb_key;

	if (Object.keys(patch).length) {
		await sql`
			update avatars set
				tags        = coalesce(${patch.tags ?? null}::text[], tags),
				description = coalesce(${patch.description ?? null}, description),
				thumbnail_key = coalesce(${patch.thumbnail_key ?? null}, thumbnail_key),
				updated_at  = now()
			where id = ${body.avatar_id} and owner_id = ${userId}
		`;
	}

	return json(res, 200, { ok: true, tags: newTags, description: desc });
});

// ── dispatcher ────────────────────────────────────────────────────────────────

const DISPATCH = {
	presign:             handlePresign,
	'presign-thumbnail': handlePresignThumbnail,
	'auto-tag':          handleAutoTag,
	public:              handlePublic,
	regenerate:          handleRegenerate,
	'regenerate-status': handleRegenerateStatus,
};

export function dispatch(action, req, res) {
	const fn = DISPATCH[action];
	if (!fn) return error(res, 404, 'not_found', `unknown avatar action: ${action}`);
	return fn(req, res);
}
