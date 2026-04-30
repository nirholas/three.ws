import { z } from 'zod';
import { sql } from '../../../_lib/db.js';
import { getSessionUser, authenticateBearer, extractBearer } from '../../../_lib/auth.js';
import { cors, json, method, readJson, wrap, error } from '../../../_lib/http.js';
import { limits, clientIp } from '../../../_lib/rate-limit.js';
import { parse } from '../../../_lib/validate.js';

const MAX_BYTES = 512 * 1024; // 512 KB per encrypted file

const bodySchema = z.object({
	filename: z
		.string()
		.trim()
		.min(1)
		.max(260)
		.regex(/^[A-Za-z0-9._-]+$/, 'invalid filename characters'),
	data: z.string().min(1), // base64-encoded bytes (encrypted or plaintext for MEMORY.md)
});

async function pinViaPinata(buf, filename) {
	const form = new FormData();
	form.append('file', new Blob([buf]), filename);
	const resp = await fetch('https://api.pinata.cloud/pinning/pinFileToIPFS', {
		method: 'POST',
		headers: { Authorization: `Bearer ${process.env.PINATA_JWT}` },
		body: form,
	});
	if (!resp.ok) {
		const detail = await resp.text().catch(() => '');
		throw Object.assign(new Error(`Pinata error ${resp.status}`), { status: 502, detail });
	}
	const data = await resp.json();
	return data.IpfsHash;
}

// POST /api/agents/:id/memory/pin
// Body: { filename, data } — data is base64-encoded bytes
// Returns: { cid }
export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'POST,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['POST'])) return;

	const url = new URL(req.url, 'http://x');
	const parts = url.pathname.split('/').filter(Boolean);
	const agentId = parts[2];

	const session = await getSessionUser(req);
	const bearer = session ? null : await authenticateBearer(extractBearer(req));
	const userId = session?.id ?? bearer?.userId;
	if (!userId) return error(res, 401, 'unauthorized', 'sign in required');

	const [agent] =
		await sql`SELECT id FROM agent_identities WHERE id = ${agentId} AND user_id = ${userId} AND deleted_at IS NULL`;
	if (!agent) return error(res, 404, 'not_found', 'agent not found');

	const rl = await limits.upload(userId);
	if (!rl.success) return error(res, 429, 'rate_limited', 'upload rate exceeded');

	const body = parse(bodySchema, await readJson(req));

	let buf;
	try {
		buf = Buffer.from(body.data, 'base64');
	} catch {
		return error(res, 400, 'validation_error', 'data must be valid base64');
	}
	if (buf.byteLength > MAX_BYTES) {
		return error(res, 413, 'payload_too_large', 'file exceeds 512 KB limit');
	}

	if (!process.env.PINATA_JWT) {
		return error(res, 503, 'pinning_unconfigured', 'no pinning provider configured');
	}

	const cid = await pinViaPinata(buf, body.filename);
	return json(res, 200, { cid });
});
