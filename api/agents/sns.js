// /api/agents/:id/sns
//
// GET    — list .sol domains the agent's Solana wallet owns (via Bonfida
//          sns-api.bonfida.com), plus the wallet's favorite/primary domain
//          and the currently-attached SNS id (meta.sns_domain).
// POST   — body { domain } — verify the agent's wallet owns `domain`, then
//          save it as the agent's SNS id (meta.sns_domain).
// DELETE — clear meta.sns_domain.
//
// Registration is done off-platform at https://www.sns.id — the UI links out.

import { getSessionUser, authenticateBearer, extractBearer } from '../_lib/auth.js';
import { sql } from '../_lib/db.js';
import { cors, json, method, error, readJson } from '../_lib/http.js';
import { limits, clientIp } from '../_lib/rate-limit.js';

const SNS_API = 'https://sns-api.bonfida.com';
const DOMAIN_RE = /^[a-z0-9-]{1,63}(\.sol)?$/i;

function normalizeDomain(input) {
	if (typeof input !== 'string') return null;
	const trimmed = input.trim().toLowerCase().replace(/\.sol$/, '');
	if (!trimmed || !/^[a-z0-9-]{1,63}$/.test(trimmed)) return null;
	return trimmed;
}

async function snsFetch(path) {
	const r = await fetch(`${SNS_API}${path}`, { headers: { accept: 'application/json' } });
	if (!r.ok) throw new Error(`sns api ${r.status}`);
	return r.json();
}

async function fetchOwnedDomains(address) {
	const body = await snsFetch(`/v2/user/domains/${address}`);
	const list = body?.[address] || body?.data?.[address] || [];
	return Array.isArray(list) ? list : [];
}

async function fetchFavoriteDomain(address) {
	try {
		const body = await snsFetch(`/v2/user/fav-domains/${address}`);
		return body?.[address] || null;
	} catch {
		return null;
	}
}

async function resolveAuth(req) {
	const session = await getSessionUser(req);
	if (session) return { userId: session.id };
	const bearer = await authenticateBearer(extractBearer(req));
	if (bearer) return { userId: bearer.userId };
	return null;
}

export default async function handler(req, res, id) {
	if (cors(req, res, { methods: 'GET,POST,DELETE,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['GET', 'POST', 'DELETE'])) return;

	const auth = await resolveAuth(req);
	if (!auth) return error(res, 401, 'unauthorized', 'sign in required');

	const rl = await limits.authIp(clientIp(req));
	if (!rl.success) return error(res, 429, 'rate_limited', 'too many requests');

	const [row] = await sql`
		SELECT id, user_id, meta FROM agent_identities
		WHERE id = ${id} AND deleted_at IS NULL
	`;
	if (!row) return error(res, 404, 'not_found', 'agent not found');
	if (row.user_id !== auth.userId) return error(res, 403, 'forbidden', 'not your agent');

	let meta = { ...(row.meta || {}) };
	const address = meta.solana_address;
	if (!address) {
		return error(res, 409, 'conflict', 'agent has no solana wallet — provision one first via POST /api/agents/:id/solana');
	}

	if (req.method === 'DELETE') {
		delete meta.sns_domain;
		await sql`UPDATE agent_identities SET meta = ${JSON.stringify(meta)}::jsonb WHERE id = ${id}`;
		return json(res, 200, { data: { ok: true, address, sns_domain: null } });
	}

	if (req.method === 'POST') {
		const body = await readJson(req).catch(() => ({}));
		if (!DOMAIN_RE.test(String(body?.domain || ''))) {
			return error(res, 400, 'validation_error', 'domain must be a .sol name');
		}
		const domain = normalizeDomain(body.domain);
		if (!domain) return error(res, 400, 'validation_error', 'invalid .sol domain');

		let owned;
		try {
			owned = await fetchOwnedDomains(address);
		} catch (err) {
			return error(res, 502, 'upstream_error', 'sns lookup failed');
		}
		if (!owned.includes(domain)) {
			return error(res, 403, 'forbidden', `wallet ${address} does not own ${domain}.sol`);
		}

		meta = { ...meta, sns_domain: domain };
		await sql`UPDATE agent_identities SET meta = ${JSON.stringify(meta)}::jsonb WHERE id = ${id}`;
		return json(res, 200, { data: { ok: true, address, sns_domain: domain } });
	}

	// GET
	let domains = [];
	let favorite = null;
	let upstreamOk = true;
	try {
		[domains, favorite] = await Promise.all([fetchOwnedDomains(address), fetchFavoriteDomain(address)]);
	} catch {
		upstreamOk = false;
	}
	return json(res, 200, {
		data: {
			address,
			sns_domain: meta.sns_domain || null,
			domains,
			favorite,
			upstream_ok: upstreamOk,
			register_url: `https://www.sns.id/?search=`,
		},
	});
}
