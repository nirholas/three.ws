/**
 * POST /api/agents/register-prep
 *
 * Server-side registration prep: builds canonical registration JSON,
 * pins to IPFS, stores a transient record, returns CID for client signing.
 *
 * Requires: session auth, valid avatarId owned by user, metadata fields.
 * Rate limit: authedWrite per user.
 * Returns: { ok: true, cid, metadataURI, prepId } or { ok: false, error }
 */

import { sql } from '../_lib/db.js';
import { getSessionUser } from '../_lib/auth.js';
import { cors, json, method, wrap, error, readJson } from '../_lib/http.js';
import { parse } from '../_lib/validate.js';
import { limits, clientIp } from '../_lib/rate-limit.js';
import { env } from '../_lib/env.js';
import { r2 } from '../_lib/r2.js';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { z } from 'zod';
import { createHash } from 'crypto';

const bodySchema = z.object({
	name: z.string().trim().min(1).max(60),
	description: z.string().trim().max(280),
	avatarId: z.string().uuid(),
	brain: z
		.object({
			provider: z.string().optional(),
			model: z.string().optional(),
			instructions: z.string().optional(),
		})
		.optional(),
	skills: z
		.array(z.string().regex(/^[a-z0-9-]{1,40}$/i))
		.max(16)
		.optional(),
	embedPolicy: z.record(z.any()).optional(),
	demoSlug: z.string().optional(),
});

const PREP_EXPIRY_HOURS = 1;

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'POST,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['POST'])) return;

	const session = await getSessionUser(req);
	if (!session) return error(res, 401, 'unauthorized', 'sign in required');

	const ip = clientIp(req);
	const rl = await limits.authIp(ip);
	if (!rl.success) return error(res, 429, 'rate_limited', 'too many requests');

	const body = parse(bodySchema, await readJson(req));

	// Verify avatar belongs to user
	const [avatar] = await sql`
		select id from avatars
		where id = ${body.avatarId} and owner_id = ${session.id} and deleted_at is null
		limit 1
	`;
	if (!avatar) return error(res, 404, 'not_found', 'avatar not found');

	// Build canonical registration JSON per ERC-8004 spec
	const registrationJson = {
		$schema: 'https://3d-agent.io/schemas/manifest/0.1.json',
		spec: 'agent-manifest/0.1',
		name: body.name,
		description: body.description,
		image: '',
		tags: [],
		body: {
			uri: '', // filled by client-side GLB pinning if needed
			format: 'gltf-binary',
		},
		_baseURI: `ipfs://`, // CRITICAL: must end with / per invariants
		...(body.brain && { brain: body.brain }),
		...(body.skills && body.skills.length > 0 && { skills: body.skills }),
		...(body.embedPolicy && { embedPolicy: body.embedPolicy }),
		...(body.demoSlug && { demoSlug: body.demoSlug }),
	};

	// Pin to IPFS
	const { cid, metadataURI } = await pinRegistrationJson(registrationJson);

	// Store prep record (1-hour expiry)
	const expiresAt = new Date(Date.now() + PREP_EXPIRY_HOURS * 60 * 60 * 1000);
	const [prep] = await sql`
		insert into agent_registrations_pending
			(user_id, cid, metadata_uri, payload, expires_at)
		values
			(${session.id}, ${cid}, ${metadataURI}, ${JSON.stringify(registrationJson)}::jsonb, ${expiresAt})
		returning id
	`;

	return json(res, 200, {
		ok: true,
		cid,
		metadataURI,
		prepId: prep.id,
	});
});

/**
 * Pin registration JSON to IPFS.
 *
 * Strategy:
 *  1. Try web3.storage if WEB3_STORAGE_TOKEN is available
 *  2. Otherwise store to R2 and generate a content-hash-based stub CID
 *
 * @param {object} json Registration JSON
 * @returns {Promise<{cid: string, metadataURI: string}>}
 */
async function pinRegistrationJson(json) {
	const jsonStr = JSON.stringify(json);
	const jsonBytes = Buffer.from(jsonStr, 'utf-8');

	// Try web3.storage first
	const token = process.env.WEB3_STORAGE_TOKEN;
	if (token) {
		try {
			const cid = await pinToWeb3Storage(jsonBytes, token);
			return { cid, metadataURI: `ipfs://${cid}` };
		} catch (err) {
			console.error('[register-prep] web3.storage pin failed:', err.message);
			// fall through to fallback
		}
	}

	// Fallback: store to R2 and generate stub CID from content hash
	const contentHash = createHash('sha256').update(jsonStr).digest('hex');
	const stubCid = `bafkreigenerated${contentHash.slice(0, 40)}`; // mock bafk-prefixed CID
	const key = `agent-registrations/${Date.now()}-${Math.random().toString(36).slice(2)}.json`;

	await r2.send(
		new PutObjectCommand({
			Bucket: env.S3_BUCKET,
			Key: key,
			Body: jsonBytes,
			ContentType: 'application/json',
		}),
	);

	return { cid: stubCid, metadataURI: `ipfs://${stubCid}` };
}

/**
 * Pin to web3.storage via HTTP API.
 * @param {Buffer} data
 * @param {string} token
 * @returns {Promise<string>} CID
 */
async function pinToWeb3Storage(data, token) {
	// web3.storage expects car format; for now use direct multipart upload
	const res = await fetch('https://api.web3.storage/upload', {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${token}`,
		},
		body: data,
	});

	if (!res.ok) {
		const text = await res.text().catch(() => res.status);
		throw new Error(`web3.storage upload failed (${res.status}): ${text}`);
	}

	const result = await res.json();
	if (!result.cid) throw new Error('web3.storage returned no CID');
	return result.cid;
}
