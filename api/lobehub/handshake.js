import { sql } from '../_lib/db.js';
import { json, error, method, readJson, wrap, cors } from '../_lib/http.js';
import { limits, clientIp } from '../_lib/rate-limit.js';

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'POST,OPTIONS' })) return;
	if (!method(req, res, ['POST'])) return;

	// Use widgetRead as the closest public-read preset (600 req/min per IP).
	const rl = await limits.widgetRead(clientIp(req));
	if (!rl.success) return error(res, 429, 'rate_limited', 'too many requests');

	const body = await readJson(req);
	const agentId = body?.agentId;
	const hostOrigin = body?.hostOrigin || null;

	if (!agentId || typeof agentId !== 'string') {
		return error(res, 400, 'validation_error', 'agentId is required');
	}

	const [agent] = await sql`
		SELECT id, name FROM agent_identities
		WHERE id = ${agentId} AND deleted_at IS NULL
	`;

	if (!agent) return error(res, 404, 'not_found', 'agent not found');

	// Build allowlist: known LobeHub hosts + caller's host if provided.
	const allowedHosts = ['chat.lobehub.com', 'lobechat.ai'];
	if (hostOrigin) {
		try {
			allowedHosts.push(new URL(hostOrigin).hostname);
		} catch {}
	}

	return json(res, 200, {
		ok: true,
		iframeUrl: `https://3dagent.vercel.app/lobehub/iframe/?agent=${encodeURIComponent(agent.id)}`,
		embedPolicy: {
			origins: { mode: 'allowlist', hosts: allowedHosts },
		},
	});
});
