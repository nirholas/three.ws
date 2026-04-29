import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { sql } from '../_lib/db.js';
import { cors, error, json, method, readJson, wrap } from '../_lib/http.js';
import { clientIp, limits } from '../_lib/rate-limit.js';

let pluginManifest;
try {
	pluginManifest = JSON.parse(
		readFileSync(join(process.cwd(), 'public/lobehub/plugin.json'), 'utf8'),
	);
} catch (err) {
	console.error('[lobehub/manifest] failed to load plugin.json', err);
}

let configManifest;
try {
	configManifest = JSON.parse(
		readFileSync(join(process.cwd(), 'public/.well-known/lobehub-plugin.json'), 'utf8'),
	);
} catch (err) {
	console.error('[lobehub/config] failed to load lobehub-plugin.json', err);
}

export default wrap(async (req, res) => {
	const action = req.query?.action;

	if (action === 'manifest') {
		if (cors(req, res, { methods: 'GET,OPTIONS' })) return;
		if (!method(req, res, ['GET'])) return;
		if (!pluginManifest) return error(res, 500, 'internal_error', 'manifest unavailable');
		return json(res, 200, pluginManifest, { 'cache-control': 'public, max-age=300' });
	}

	if (action === 'config') {
		res.setHeader('access-control-allow-origin', '*');
		res.setHeader('access-control-allow-methods', 'GET,OPTIONS');
		if (req.method === 'OPTIONS') {
			res.statusCode = 204;
			res.end();
			return;
		}
		if (!method(req, res, ['GET'])) return;
		if (!configManifest) return error(res, 500, 'internal_error', 'manifest unavailable');
		return json(res, 200, configManifest, { 'cache-control': 'public, max-age=300' });
	}

	if (action === 'handshake') {
		if (cors(req, res, { methods: 'POST,OPTIONS' })) return;
		if (!method(req, res, ['POST'])) return;

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

		const allowedHosts = ['chat.lobehub.com', 'lobechat.ai'];
		if (hostOrigin) {
			try {
				allowedHosts.push(new URL(hostOrigin).hostname);
			} catch {}
		}

		return json(res, 200, {
			ok: true,
			iframeUrl: `https://three.ws/lobehub/iframe/?agent=${encodeURIComponent(agent.id)}`,
			embedPolicy: {
				origins: { mode: 'allowlist', hosts: allowedHosts },
			},
		});
	}

	return error(res, 404, 'not_found', 'unknown lobehub action');
});
