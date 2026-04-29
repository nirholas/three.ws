/**
 * GET /api/agents/pumpfun-metadata?id=<agent_id>
 *
 * Returns Metaplex-compatible token metadata JSON for a three.ws agent so it
 * can be used as the `uri` field for a pump.fun token mint. The agent's GLB
 * + name + bio become the token's identity.
 *
 * Public, cacheable, read-only.
 */

import { sql } from '../_lib/db.js';
import { cors, json, method, wrap, error } from '../_lib/http.js';
import { env } from '../_lib/env.js';

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,OPTIONS', origins: '*' })) return;
	if (!method(req, res, ['GET'])) return;

	const url = new URL(req.url, `http://${req.headers.host}`);
	const id = url.searchParams.get('id');
	if (!id) return error(res, 400, 'validation_error', 'id required');

	const [a] = await sql`
		select id, name, description, avatar_id, meta, wallet_address
		from agent_identities
		where id = ${id} and deleted_at is null limit 1
	`;
	if (!a) return error(res, 404, 'not_found', 'agent not found');

	const origin = env.APP_ORIGIN;
	const image = a.meta?.image_url || `${origin}/api/agents/${a.id}/og`;
	const animation = a.avatar_id ? `${origin}/api/avatars/${a.avatar_id}/glb` : null;

	const metadata = {
		name: a.name,
		symbol: deriveSymbol(a.name),
		description:
			a.description ||
			`${a.name} is a 3D AI agent on three.ws with onchain identity and signed action history.`,
		image,
		animation_url: animation,
		external_url: `${origin}/agent/${a.id}`,
		attributes: [
			{ trait_type: 'platform', value: 'three.ws' },
			{ trait_type: 'agent_id', value: a.id },
			...(a.wallet_address ? [{ trait_type: 'owner', value: a.wallet_address }] : []),
		],
		properties: {
			category: 'video',
			files: [
				...(animation
					? [{ uri: animation, type: 'model/gltf-binary' }]
					: []),
				{ uri: image, type: 'image/png' },
			],
		},
	};

	return json(res, 200, metadata, {
		'cache-control': 'public, max-age=300',
		'access-control-allow-origin': '*',
	});
});

function deriveSymbol(name) {
	const cleaned = String(name || 'AGENT')
		.toUpperCase()
		.replace(/[^A-Z0-9]/g, '');
	return cleaned.slice(0, 10) || 'AGENT';
}
