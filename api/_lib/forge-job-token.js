// Forge generation job-handle codec — shared by the /api/forge endpoint and the
// 3D Studio MCP server (/api/mcp-3d).
//
// Jobs from the geometry providers (Meshy / Tripo) and the self-hosted GCP
// backend are polled on a different upstream than the default Replicate path, so
// callers are handed an opaque token that records which provider + task-kind to
// poll. The legacy Replicate path keeps returning its bare prediction id (which
// matches JOB_ID_RE), so old links and existing job handles never break.
//
// Tokens are HMAC-SHA256 signed (`f1.<payload>.<sig>`) with the server
// JWT_SECRET — the same canonical signing secret auth.js and saml.js key from.
// Without the signature a caller could forge `f1.*` handles and poll arbitrary
// upstream task ids against the platform-key providers. decodeJobToken rejects
// missing/bad signatures by returning null, which callers already treat as the
// invalid-token path; pre-signing in-flight tokens fail the same way (jobs are
// short-lived, so that window is acceptable).
//
// A handle also expires. The payload carries a signed `x` (unix seconds), so a
// handle leaked into a log or a shared link stops polling the upstream task after
// JOB_TOKEN_TTL_SECONDS, and the lifetime cannot be extended without the secret.
// Handles minted before expiry existed carry no `x` and stay valid: a deploy must
// not strand a job that is mid-generation.

import { createHmac, timingSafeEqual } from 'node:crypto';

import { env } from './env.js';

// Longest a generation is polled for: far past the slowest lane, short enough
// that a leaked handle does not stay useful.
export const JOB_TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60;

function sign(payload) {
	return createHmac('sha256', env.JWT_SECRET).update(payload).digest('base64url');
}

export function encodeJobToken({ provider, kind, taskId }) {
	const payload = Buffer.from(
		JSON.stringify({
			p: provider,
			k: kind,
			t: taskId,
			x: Math.floor(Date.now() / 1000) + JOB_TOKEN_TTL_SECONDS,
		}),
		'utf8',
	).toString('base64url');
	return `f1.${payload}.${sign(payload)}`;
}

export function decodeJobToken(token) {
	if (typeof token !== 'string' || !token.startsWith('f1.')) return null;
	const parts = token.split('.');
	if (parts.length !== 3) return null;
	const [, payload, sig] = parts;
	if (!payload || !sig) return null;
	try {
		const expected = Buffer.from(sign(payload), 'utf8');
		const actual = Buffer.from(sig, 'utf8');
		if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
		const obj = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
		if (!obj?.p || !obj?.t) return null;
		if (obj.x !== undefined && !(Number.isFinite(obj.x) && obj.x > Date.now() / 1000)) return null;
		return { provider: obj.p, kind: obj.k || null, taskId: String(obj.t) };
	} catch {
		return null;
	}
}
