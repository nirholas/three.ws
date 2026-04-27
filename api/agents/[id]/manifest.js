/**
 * GET /api/agents/:id/manifest
 *
 * Public, canonical agent manifest JSON. Served as the off-chain `agentURI`
 * on ERC-8004 registries when the user opts for `https://` over `ipfs://`.
 * Stable URL shape so on-chain tokens don't break when the underlying
 * record is edited.
 *
 * No auth — intentionally public so any consumer (block explorer, Lobehub
 * plugin, third-party renderer) can resolve the manifest.
 */

import { sql } from '../../_lib/db.js';
import { resolveAvatarUrl } from '../../_lib/avatars.js';
import { cors, json, method, wrap, error } from '../../_lib/http.js';

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,OPTIONS', credentials: false })) return;
	if (!method(req, res, ['GET'])) return;

	const id = req.query?.id || new URL(req.url, 'http://x').pathname.split('/').slice(-2, -1)[0];
	if (!id || !/^[0-9a-f-]{36}$/i.test(id)) {
		return error(res, 400, 'invalid_request', 'agent id required');
	}

	const [row] = await sql`
		select
			a.id, a.name, a.description, a.avatar_id, a.skills, a.meta,
			a.chain_id, a.erc8004_agent_id, a.erc8004_registry, a.registration_cid,
			a.created_at,
			av.id as avatar_db_id, av.storage_key, av.content_type
		from agent_identities a
		left join avatars av on av.id = a.avatar_id and av.deleted_at is null
		where a.id = ${id} and a.deleted_at is null
		limit 1
	`;

	if (!row) return error(res, 404, 'not_found', 'agent not found');

	let bodyUri = '';
	if (row.avatar_db_id) {
		try {
			const urlInfo = await resolveAvatarUrl({
				storage_key: row.storage_key,
				visibility: 'public',
			});
			bodyUri = urlInfo?.url || '';
		} catch {
			/* fall through with empty body uri */
		}
	}

	const origin = _origin(req);

	const manifest = {
		$schema: 'https://3d-agent.io/schemas/manifest/0.1.json',
		spec: 'agent-manifest/0.1',
		id: row.id,
		name: row.name || 'Agent',
		description: row.description || '',
		image: '',
		tags: Array.isArray(row.meta?.tags) ? row.meta.tags : [],
		body: bodyUri ? { uri: bodyUri, format: row.content_type || 'gltf-binary' } : undefined,
		skills: Array.isArray(row.skills) ? row.skills : [],
		homeUrl: `${origin}/agent/${row.id}`,
		// Surface registrations array so consumers can find every chain this
		// agent lives on. For now we only have a single canonical record on
		// agent_identities; a junction table is the next step.
		registrations:
			row.chain_id && row.erc8004_agent_id
				? [
						{
							agentRegistry: `eip155:${row.chain_id}:${row.erc8004_registry}`,
							agentId: row.erc8004_agent_id,
						},
					]
				: [],
		createdAt: row.created_at,
	};

	// Cache moderately — manifest changes when the user edits name/desc, but
	// it's safe to serve stale for a few minutes. The headers arg here wins
	// over the helper's default `cache-control: no-store`.
	return json(res, 200, manifest, {
		'cache-control': 'public, max-age=60, s-maxage=300, stale-while-revalidate=86400',
		'access-control-allow-origin': '*',
	});
});

function _origin(req) {
	const env = process.env.PUBLIC_APP_ORIGIN;
	if (env) return env.replace(/\/$/, '');
	const proto = req.headers['x-forwarded-proto'] || 'https';
	const host = req.headers['x-forwarded-host'] || req.headers.host || '3dagent.vercel.app';
	return `${proto}://${host}`;
}
