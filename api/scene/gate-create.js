import { z } from 'zod';
import { sql } from '../../_lib/db.js';
import { getSessionUser, authenticateBearer, extractBearer } from '../../_lib/auth.js';
import { cors, json, method, readJson, wrap, error } from '../../_lib/http.js';
import { limits, clientIp } from '../../_lib/rate-limit.js';
import { env } from '../../_lib/env.js';
import { parse } from '../../_lib/validate.js';
import { randomToken } from '../../_lib/crypto.js';

const bodySchema = z.object({
	sceneRef: z.string().trim().min(1).max(8000),
	gate: z.object({
		chain: z.enum(['solana', 'evm']),
		kind: z.enum(['spl', 'collection', 'erc20', 'erc721']),
		address: z.string().trim().min(1).max(128),
		minBalance: z.number().positive().default(1),
	}),
});

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'POST,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['POST'])) return;

	const session = await getSessionUser(req);
	const bearer = session ? null : await authenticateBearer(extractBearer(req));
	if (!session && !bearer) return error(res, 401, 'unauthorized', 'sign in required');
	const userId = session?.id ?? bearer.userId;

	const rl = await limits.authIp(clientIp(req));
	if (!rl.success) return error(res, 429, 'rate_limited', 'too many requests');

	const body = parse(bodySchema, await readJson(req));

	let gateId = '';
	while (gateId.length < 12) {
		gateId += randomToken(16).replace(/[^A-Za-z0-9]/g, '');
	}
	gateId = gateId.slice(0, 12);

	await sql`
		insert into scene_gates (id, user_id, scene_ref, chain, kind, address, min_balance)
		values (${gateId}, ${userId}, ${body.sceneRef}, ${body.gate.chain}, ${body.gate.kind}, ${body.gate.address}, ${body.gate.minBalance})
	`;

	// Short refs (sync.three.ws shortIds) are ≤40 alphanumeric chars; blobs are much longer
	const isShortRef = body.sceneRef.length <= 40 && /^[A-Za-z0-9_-]+$/.test(body.sceneRef);
	const shareUrl = isShortRef
		? `${env.APP_ORIGIN}/chat?sl=${body.sceneRef}&gate=${gateId}`
		: `${env.APP_ORIGIN}/chat?s=${encodeURIComponent(body.sceneRef)}&gate=${gateId}`;

	return json(res, 201, { shareUrl, gateId });
});
