// /api/agents/:id/sns
//
// GET     — list .sol domains the agent's Solana wallet owns (via Bonfida
//           sns-api.bonfida.com), plus the wallet's favorite/primary domain,
//           the currently-attached SNS id (meta.sns_domain), and whether the
//           subdomain registrar is configured (so the UI can show /register).
// POST    — body { domain } — verify the agent's wallet owns `domain`, then
//           save it as the agent's SNS id (meta.sns_domain).
// DELETE  — clear meta.sns_domain.
//
// /api/agents/:id/sns/register
// POST    — body { label } — mint {label}.{SNS_PARENT_DOMAIN}.sol as a
//           subdomain owned by the agent's wallet. Platform pays gas+rent.
//           On success, sets meta.sns_domain = "{label}.{SNS_PARENT_DOMAIN}".

import { getSessionUser, authenticateBearer, extractBearer } from '../_lib/auth.js';
import { sql } from '../_lib/db.js';
import { cors, json, method, error, readJson } from '../_lib/http.js';
import { limits, clientIp } from '../_lib/rate-limit.js';
import { env } from '../_lib/env.js';

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

function registrarConfigured() {
	return Boolean(env.SNS_PARENT_DOMAIN && env.SNS_PARENT_OWNER_SECRET);
}

async function registerSubdomain(label, agentAddress) {
	const { Connection, Keypair, PublicKey, Transaction } = await import('@solana/web3.js');
	const sns = await import('@bonfida/spl-name-service');

	const parentLabel = String(env.SNS_PARENT_DOMAIN).trim().toLowerCase().replace(/\.sol$/, '');
	const secretBuf = Buffer.from(env.SNS_PARENT_OWNER_SECRET, 'base64');
	if (secretBuf.length !== 64) throw new Error('SNS_PARENT_OWNER_SECRET must be base64 of a 64-byte secret key');
	const parentOwner = Keypair.fromSecretKey(Uint8Array.from(secretBuf));
	const fullSub = `${label}.${parentLabel}`;
	const newOwner = new PublicKey(agentAddress);
	const conn = new Connection(env.SOLANA_RPC_URL, 'confirmed');

	// Fail fast if the subdomain already exists (createNameRegistry would error mid-tx).
	try {
		const { pubkey } = sns.getDomainKeySync(fullSub);
		const info = await conn.getAccountInfo(pubkey);
		if (info?.data) throw new Error(`${fullSub}.sol is already registered`);
	} catch (e) {
		if (e?.message?.includes('already registered')) throw e;
	}

	const createIxs = await sns.createSubdomain(conn, fullSub, parentOwner.publicKey, 2000, parentOwner.publicKey);
	const transferIx = await sns.transferSubdomain(conn, fullSub, newOwner, true);
	const tx = new Transaction().add(...createIxs, transferIx);
	tx.feePayer = parentOwner.publicKey;
	const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash('confirmed');
	tx.recentBlockhash = blockhash;
	tx.sign(parentOwner);
	const sig = await conn.sendRawTransaction(tx.serialize(), { skipPreflight: false });
	await conn.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, 'confirmed');
	return { signature: sig, domain: fullSub };
}

async function handleRegister(req, res, id, auth) {
	if (!method(req, res, ['POST'])) return;
	if (!registrarConfigured()) {
		return error(res, 503, 'not_configured', 'subdomain registrar is not set up on this deployment');
	}

	const [row] = await sql`
		SELECT id, user_id, meta FROM agent_identities
		WHERE id = ${id} AND deleted_at IS NULL
	`;
	if (!row) return error(res, 404, 'not_found', 'agent not found');
	if (row.user_id !== auth.userId) return error(res, 403, 'forbidden', 'not your agent');
	let meta = { ...(row.meta || {}) };
	if (!meta.solana_address) {
		return error(res, 409, 'conflict', 'agent has no solana wallet — provision one first');
	}

	const body = await readJson(req).catch(() => ({}));
	const label = normalizeDomain(body?.label);
	if (!label) return error(res, 400, 'validation_error', 'label must be a valid subdomain (a–z, 0–9, hyphen; max 63 chars)');

	let result;
	try {
		result = await registerSubdomain(label, meta.solana_address);
	} catch (err) {
		console.error('[agents/sns/register] failed', err);
		const msg = err?.message || 'registration failed';
		const status = /already registered/i.test(msg) ? 409 : 502;
		return error(res, status, status === 409 ? 'conflict' : 'upstream_error', msg);
	}

	meta = { ...meta, sns_domain: result.domain };
	await sql`UPDATE agent_identities SET meta = ${JSON.stringify(meta)}::jsonb WHERE id = ${id}`;
	return json(res, 201, {
		data: {
			ok: true,
			address: meta.solana_address,
			sns_domain: result.domain,
			signature: result.signature,
		},
	});
}

async function resolveAuth(req) {
	const session = await getSessionUser(req);
	if (session) return { userId: session.id };
	const bearer = await authenticateBearer(extractBearer(req));
	if (bearer) return { userId: bearer.userId };
	return null;
}

export default async function handler(req, res, id, action) {
	if (cors(req, res, { methods: 'GET,POST,DELETE,OPTIONS', credentials: true })) return;

	const auth = await resolveAuth(req);
	if (!auth) return error(res, 401, 'unauthorized', 'sign in required');

	const rl = await limits.authIp(clientIp(req));
	if (!rl.success) return error(res, 429, 'rate_limited', 'too many requests');

	if (action === 'register') return handleRegister(req, res, id, auth);

	if (!method(req, res, ['GET', 'POST', 'DELETE'])) return;

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
			registrar: registrarConfigured()
				? { enabled: true, parent: String(env.SNS_PARENT_DOMAIN).replace(/\.sol$/, '') }
				: { enabled: false },
		},
	});
}
