// Consolidated public Solana agent handlers.
// Reached via api/agents/solana/[action].js dispatcher.
// Named exports (taskHash, buildPayload, verifyPumpkitSignature) are kept
// for backward-compat with the test suite.

import crypto from 'node:crypto';
import { z } from 'zod';
import { PublicKey, Connection } from '@solana/web3.js';
import { sql } from '../../_lib/db.js';
import { cors, json, method, wrap, error, readJson } from '../../_lib/http.js';
import { limits, clientIp } from '../../_lib/rate-limit.js';
import { getSessionUser } from '../../_lib/auth.js';
import { parse } from '../../_lib/validate.js';
import { randomToken } from '../../_lib/crypto.js';
import { env } from '../../_lib/env.js';
import { KIND_MAP, crawlAgentAttestations } from '../../_lib/solana-attestations.js';
import {
	mintAttestation,
	loadAttesterKeypair,
	taskHash as _taskHash,
	buildPayload as _buildPayload,
} from '../../_lib/attest-event.js';

// ── Named exports preserved for tests ────────────────────────────────────────

export const taskHash = _taskHash;
export const buildPayload = _buildPayload;

const REPLAY_WINDOW_SECS = 5 * 60;
const MAX_BODY_BYTES = 64_000;

export function verifyPumpkitSignature({ secret, timestamp, signature, raw, nowSecs = Math.floor(Date.now() / 1000) }) {
	if (!secret || !timestamp || !signature) return { ok: false, reason: 'missing' };
	const ts = Number(timestamp);
	if (!Number.isFinite(ts)) return { ok: false, reason: 'bad_timestamp' };
	if (Math.abs(nowSecs - ts) > REPLAY_WINDOW_SECS) return { ok: false, reason: 'stale' };
	const expect = crypto.createHmac('sha256', secret).update(`${ts}.`).update(raw).digest();
	let got;
	try { got = Buffer.from(signature, 'hex'); } catch { return { ok: false, reason: 'bad_signature' }; }
	if (got.length !== expect.length) return { ok: false, reason: 'bad_signature' };
	return { ok: crypto.timingSafeEqual(got, expect), reason: 'ok' };
}

// ── solana-attestations ───────────────────────────────────────────────────────

export const handleAttestations = wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,OPTIONS', credentials: false })) return;
	if (!method(req, res, ['GET'])) return;

	const rl = await limits.authIp(clientIp(req));
	if (!rl.success) return error(res, 429, 'rate_limited', 'too many requests');

	const url     = new URL(req.url, `http://${req.headers.host}`);
	const asset   = url.searchParams.get('asset');
	const kindArg = url.searchParams.get('kind') || 'all';
	const network = url.searchParams.get('network') === 'mainnet' ? 'mainnet' : 'devnet';
	const limit   = Math.min(Number(url.searchParams.get('limit') || 100), 500);
	const includeRevoked = url.searchParams.get('include_revoked') === '1';

	if (!asset) return error(res, 400, 'validation_error', 'asset query param required');
	try { new PublicKey(asset); } catch { return error(res, 400, 'validation_error', 'invalid asset pubkey'); }

	const wantKind = kindArg === 'all' ? null : KIND_MAP[kindArg];
	if (kindArg !== 'all' && !wantKind) {
		return error(res, 400, 'validation_error', 'kind must be one of: feedback, validation, task, accept, revoke, dispute, all');
	}

	const [cursor] = await sql`select last_indexed_at from solana_attestations_cursor where agent_asset = ${asset} limit 1`;
	if (!cursor) {
		const [agent] = await sql`select wallet_address as owner from agent_identities where meta->>'sol_mint_address' = ${asset} and deleted_at is null limit 1`;
		try { await crawlAgentAttestations({ agentAsset: asset, network, ownerWallet: agent?.owner || null }); } catch {}
	}

	const rows = wantKind
		? await sql`select signature, slot, block_time, attester, kind, payload, verified, revoked, disputed from solana_attestations where agent_asset = ${asset} and network = ${network} and kind = ${wantKind} and (${includeRevoked} or revoked = false) order by slot desc limit ${limit}`
		: await sql`select signature, slot, block_time, attester, kind, payload, verified, revoked, disputed from solana_attestations where agent_asset = ${asset} and network = ${network} and (${includeRevoked} or revoked = false) order by slot desc limit ${limit}`;

	return json(res, 200, { data: rows, agent: asset, network, kind: kindArg, count: rows.length, last_indexed_at: cursor?.last_indexed_at || null });
});

// ── solana-attest-event ───────────────────────────────────────────────────────

async function readBuffered(req) {
	const chunks = [];
	let total = 0;
	for await (const c of req) {
		chunks.push(c);
		total += c.length;
		if (total > MAX_BODY_BYTES) throw Object.assign(new Error('payload too large'), { status: 413 });
	}
	return Buffer.concat(chunks);
}

const attestEventSchema = z.object({
	event_id:    z.string().min(1).max(128),
	event_type:  z.enum(['graduation', 'fee_claim', 'whale_trade', 'cto_detected']),
	agent_asset: z.string().min(32).max(44),
	network:     z.enum(['mainnet', 'devnet']),
	token_mint:  z.string().min(32).max(44),
	task_id:     z.string().min(1).max(128),
	detail:      z.record(z.unknown()).optional(),
});

export const handleAttestEvent = wrap(async (req, res) => {
	if (cors(req, res, { methods: 'POST,OPTIONS' })) return;
	if (!method(req, res, ['POST'])) return;

	const startedAt = Date.now();
	const rl = await limits.authIp(clientIp(req));
	if (!rl.success) return error(res, 429, 'rate_limited', 'too many requests');

	const secret = process.env.PUMPKIT_WEBHOOK_SECRET;
	if (!secret) return error(res, 500, 'internal', 'webhook secret not configured');

	const raw = await readBuffered(req);
	const verdict = verifyPumpkitSignature({
		secret,
		timestamp: req.headers['x-pumpkit-timestamp'],
		signature: req.headers['x-pumpkit-signature'],
		raw,
	});
	if (!verdict.ok) return error(res, 401, 'unauthorized', `invalid webhook signature (${verdict.reason})`);

	let parsed;
	try { parsed = JSON.parse(raw.toString('utf8')); } catch { return error(res, 400, 'validation_error', 'invalid JSON'); }
	const body = parse(attestEventSchema, parsed);

	const [agent] = await sql`select id, user_id from agent_identities where meta->'onchain'->>'sol_asset' = ${body.agent_asset} or meta->>'sol_mint_address' = ${body.agent_asset} limit 1`;
	if (!agent) return error(res, 404, 'not_found', 'agent_asset not registered');

	const result = await mintAttestation({
		event_id:    body.event_id,
		event_type:  body.event_type,
		source:      `pumpkit.${body.event_type === 'cto_detected' ? 'cto' : body.event_type === 'whale_trade' ? 'whale' : body.event_type}`,
		agent_asset: body.agent_asset,
		network:     body.network,
		token_mint:  body.token_mint,
		task_id:     body.task_id,
		detail:      body.detail,
		attester:    loadAttesterKeypair(),
	});

	const baseLog = { userId: agent.user_id, agentId: agent.id, kind: 'attest_event', tool: `pumpkit.${body.event_type}`, latencyMs: Date.now() - startedAt, meta: { network: body.network, event_id: body.event_id, signature: result.signature } };
	const { recordEvent } = await import('../../_lib/usage.js');

	if (result.status === 'minted') {
		recordEvent({ ...baseLog, status: 'ok', meta: { ...baseLog.meta, kind: result.kind } });
		return json(res, 201, { data: { signature: result.signature, kind: result.kind, deduped: false } });
	}
	if (result.status === 'deduped') {
		recordEvent({ ...baseLog, status: 'deduped' });
		return json(res, 200, { data: { signature: result.signature, deduped: true } });
	}
	recordEvent({ ...baseLog, status: 'in_progress' });
	return json(res, 202, { data: { deduped: true, status: 'in_progress' } });
});

// ── solana-card ───────────────────────────────────────────────────────────────

export const handleCard = wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,OPTIONS', origins: '*' })) return;
	if (!method(req, res, ['GET'])) return;

	const url = new URL(req.url, `http://${req.headers.host}`);
	const asset = url.searchParams.get('asset');
	if (!asset) return error(res, 400, 'validation_error', 'asset required');
	try { new PublicKey(asset); } catch { return error(res, 400, 'validation_error', 'invalid asset pubkey'); }

	const [a] = await sql`select id, name, description, skills, wallet_address as owner, meta, avatar_id from agent_identities where meta->>'sol_mint_address' = ${asset} and deleted_at is null limit 1`;
	if (!a) return error(res, 404, 'not_found', 'agent not found');

	const network = a.meta?.network || 'mainnet';
	const origin = env.APP_ORIGIN;

	let pumpfun = null;
	try {
		const rows = await sql`select kind, count(*)::int as n, max(seen_at) as last_seen from pumpfun_signals where agent_asset = ${asset} group by kind`;
		if (rows.length > 0) {
			const byKind = {};
			let total = 0, last = null;
			for (const r of rows) {
				byKind[r.kind] = { count: r.n, last_seen: r.last_seen };
				total += r.n;
				if (!last || (r.last_seen && r.last_seen > last)) last = r.last_seen;
			}
			pumpfun = { signal_count: total, by_kind: byKind, last_seen: last, feed_url: `${origin}/api/agents/pumpfun-feed` };
		}
	} catch {}

	let token_stats = null;
	try {
		const [s] = await sql`select s.graduated, s.bonding_curve, s.amm, s.last_signature, s.last_signature_at, s.recent_tx_count, s.refreshed_at, m.mint, m.network from pump_agent_stats s join pump_agent_mints m on m.id = s.mint_id where m.mint = ${asset} limit 1`;
		if (s) token_stats = { mint: s.mint, network: s.network, graduated: s.graduated, bonding_curve: s.bonding_curve, amm: s.amm, last_signature: s.last_signature, last_signature_at: s.last_signature_at, recent_tx_count: s.recent_tx_count, refreshed_at: s.refreshed_at };
	} catch {}

	return json(res, 200, {
		schema_version: '1.0',
		name: a.name,
		description: a.description,
		identity: {
			chain: 'solana', network, asset_pubkey: asset, owner: a.owner,
			passport_url: `${origin}/agent-passport.html?asset=${asset}&network=${network}`,
			...(a.meta?.vanity_prefix ? { vanity_prefix: a.meta.vanity_prefix } : {}),
			...(a.meta?.solana_address ? { operator_wallet: { address: a.meta.solana_address, ...(a.meta.solana_vanity_prefix ? { vanity_prefix: a.meta.solana_vanity_prefix } : {}), ...(a.meta.solana_wallet_source ? { source: a.meta.solana_wallet_source } : {}) } } : {}),
		},
		skills: a.skills || [],
		endpoints: {
			chat: `${origin}/api/agents/${a.id}/chat`,
			attestations: `${origin}/api/agents/solana-attestations?asset=${asset}&network=${network}`,
			reputation: `${origin}/api/agents/solana-reputation?asset=${asset}&network=${network}`,
			...(token_stats ? { quote: `${origin}/api/pump/quote?mint=${asset}&network=${network}`, price_history: `${origin}/api/agents/solana-price-history?asset=${asset}&network=${network}` } : {}),
		},
		attestation: {
			schemas_url: `${origin}/.well-known/agent-attestation-schemas`,
			transport: 'spl-memo',
			memo_program: 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr',
			usage: 'Sign an SPL Memo tx with one of the published schemas as JSON, including this asset_pubkey as a non-signer key.',
		},
		...(pumpfun ? { pumpfun } : {}),
		...(token_stats ? { token_stats } : {}),
	}, { 'cache-control': 'public, max-age=120', 'access-control-allow-origin': '*' });
});

// ── solana-price-history ──────────────────────────────────────────────────────

export const handlePriceHistory = wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,OPTIONS', origins: '*' })) return;
	if (!method(req, res, ['GET'])) return;

	const url = new URL(req.url, `http://${req.headers.host}`);
	const asset = url.searchParams.get('asset');
	const network = url.searchParams.get('network') === 'devnet' ? 'devnet' : 'mainnet';
	const hours = Math.max(1, Math.min(720, Number(url.searchParams.get('hours') || 24)));
	if (!asset) return error(res, 400, 'validation_error', 'asset required');

	const [mintRow] = await sql`select id from pump_agent_mints where mint=${asset} and network=${network} limit 1`;
	if (!mintRow) return error(res, 404, 'not_found', 'mint not tracked');

	const points = await sql`select ts, sol_per_token, market_cap_lamports, source from pump_agent_price_points where mint_id=${mintRow.id} and ts > now() - (${hours} || ' hours')::interval order by ts asc`;

	return json(res, 200, {
		mint: asset, network, hours, point_count: points.length,
		points: points.map((p) => ({ ts: p.ts, sol_per_token: p.sol_per_token, market_cap_lamports: p.market_cap_lamports?.toString?.() ?? p.market_cap_lamports, source: p.source })),
	}, { 'cache-control': 'public, max-age=60', 'access-control-allow-origin': '*' });
});

// ── solana-register-prep ──────────────────────────────────────────────────────

import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import { mplCore, createV1 } from '@metaplex-foundation/mpl-core';
import { generateSigner, publicKey as umiPublicKey, signerIdentity, createNoopSigner } from '@metaplex-foundation/umi';
import { limits as _limits } from '../../_lib/rate-limit.js';

const BASE58_RE = /^[1-9A-HJ-NP-Za-km-z]+$/;
const VANITY_FREE_THRESHOLD = 5;

const registerPrepSchema = z.object({
	name:           z.string().trim().min(1).max(60),
	description:    z.string().trim().max(280).default(''),
	avatar_id:      z.string().uuid().optional(),
	wallet_address: z.string().min(32).max(44),
	metadata_uri:   z.string().url().optional(),
	network:        z.enum(['mainnet', 'devnet']).default('mainnet'),
	asset_pubkey:   z.string().min(32).max(44).optional(),
	vanity_prefix:  z.string().min(1).max(6).optional(),
});

export const handleRegisterPrep = wrap(async (req, res) => {
	if (cors(req, res, { methods: 'POST,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['POST'])) return;

	const user = await getSessionUser(req);
	if (!user) return error(res, 401, 'unauthorized', 'sign in required');

	const rl = await limits.authIp(clientIp(req));
	if (!rl.success) return error(res, 429, 'rate_limited', 'too many requests');

	const body = parse(registerPrepSchema, await readJson(req));
	const { name, description, avatar_id, wallet_address, network, asset_pubkey, vanity_prefix } = body;

	const [walletRow] = await sql`select id from user_wallets where user_id = ${user.id} and address = ${wallet_address} and chain_type = 'solana' limit 1`;
	if (!walletRow) return error(res, 403, 'forbidden', 'wallet not linked to your account');

	if (avatar_id) {
		const [av] = await sql`select id from avatars where id=${avatar_id} and owner_id=${user.id} and deleted_at is null limit 1`;
		if (!av) return error(res, 404, 'not_found', 'avatar not found');
	}

	if (vanity_prefix && !asset_pubkey) return error(res, 400, 'validation_error', 'vanity_prefix requires asset_pubkey');
	if (asset_pubkey) {
		if (!BASE58_RE.test(asset_pubkey)) return error(res, 400, 'validation_error', 'asset_pubkey is not valid base58');
		if (vanity_prefix) {
			if (!BASE58_RE.test(vanity_prefix)) return error(res, 400, 'validation_error', 'vanity_prefix is not valid base58');
			if (!asset_pubkey.startsWith(vanity_prefix)) return error(res, 400, 'validation_error', 'asset_pubkey does not start with vanity_prefix');
			if (vanity_prefix.length >= VANITY_FREE_THRESHOLD && (user.plan ?? 'free') === 'free') {
				return error(res, 402, 'payment_required', `vanity prefixes of ${VANITY_FREE_THRESHOLD}+ characters require a paid plan`);
			}
		}
	}

	const SOLANA_RPC = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
	const rpcEndpoint = network === 'devnet' ? (process.env.SOLANA_RPC_URL_DEVNET || 'https://api.devnet.solana.com') : SOLANA_RPC;

	const umi = createUmi(rpcEndpoint).use(mplCore());
	const ownerPubkey = umiPublicKey(wallet_address);
	const assetSigner = asset_pubkey ? createNoopSigner(umiPublicKey(asset_pubkey)) : generateSigner(umi);
	umi.use(signerIdentity(createNoopSigner(ownerPubkey)));

	const appOrigin = env.APP_ORIGIN;
	const metadataUri = body.metadata_uri || `${appOrigin}/api/agents/solana-metadata?name=${encodeURIComponent(name)}&desc=${encodeURIComponent(description)}`;

	const builder = createV1(umi, { asset: assetSigner, owner: ownerPubkey, name, uri: metadataUri });
	const tx = await builder.buildAndSign(umi);
	const txBytes = umi.transactions.serialize(tx);
	const txBase64 = Buffer.from(txBytes).toString('base64');

	const prepId = await randomToken(24);
	const expiresAt = new Date(Date.now() + 30 * 60 * 1000);

	await sql`insert into agent_registrations_pending (user_id, cid, metadata_uri, payload, expires_at) values (${user.id}, ${assetSigner.publicKey}, ${metadataUri}, ${JSON.stringify({ name, description, avatar_id, wallet_address, asset_pubkey: assetSigner.publicKey, network, prep_id: prepId, vanity_prefix: vanity_prefix || null })}::jsonb, ${expiresAt})`;

	return json(res, 201, {
		prep_id: prepId,
		asset_pubkey: assetSigner.publicKey,
		tx_base64: txBase64,
		network,
		metadata_uri: metadataUri,
		expires_at: expiresAt.toISOString(),
		instructions: 'Sign and submit the transaction with your Solana wallet, then call /api/agents/solana-register-confirm with the tx signature.',
	});
});

// ── solana-register-confirm ───────────────────────────────────────────────────

const registerConfirmSchema = z.object({
	tx_signature:   z.string().min(80).max(100),
	asset_pubkey:   z.string().min(32).max(44),
	wallet_address: z.string().min(32).max(44),
	network:        z.enum(['mainnet', 'devnet']).default('mainnet'),
	name:           z.string().trim().min(1).max(60).optional(),
	description:    z.string().trim().max(280).optional(),
	avatar_id:      z.string().uuid().optional(),
});

export const handleRegisterConfirm = wrap(async (req, res) => {
	if (cors(req, res, { methods: 'POST,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['POST'])) return;

	const user = await getSessionUser(req);
	if (!user) return error(res, 401, 'unauthorized', 'sign in required');

	const rl = await limits.authIp(clientIp(req));
	if (!rl.success) return error(res, 429, 'rate_limited', 'too many requests');

	const body = parse(registerConfirmSchema, await readJson(req));
	const { tx_signature, asset_pubkey, wallet_address, network } = body;

	const [walletRow] = await sql`select id from user_wallets where user_id=${user.id} and address=${wallet_address} and chain_type='solana' limit 1`;
	if (!walletRow) return error(res, 403, 'forbidden', 'wallet not linked to your account');

	const rpcEndpoint = network === 'devnet'
		? (process.env.SOLANA_RPC_URL_DEVNET || 'https://api.devnet.solana.com')
		: (process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com');

	const connection = new Connection(rpcEndpoint, 'confirmed');
	let tx;
	try { tx = await connection.getParsedTransaction(tx_signature, { maxSupportedTransactionVersion: 0, commitment: 'confirmed' }); }
	catch { return error(res, 422, 'tx_not_found', 'transaction not found — try again after a few seconds'); }
	if (!tx) return error(res, 422, 'tx_not_found', 'transaction not found');
	if (tx.meta?.err) return error(res, 422, 'tx_failed', 'transaction failed on-chain');

	const accountKeys = tx.transaction.message.accountKeys.map((k) => k.pubkey?.toString());
	if (!accountKeys.includes(asset_pubkey)) return error(res, 422, 'asset_not_in_tx', 'The asset pubkey was not found in the transaction accounts');

	const [existing] = await sql`select id from agent_identities where (meta->>'sol_mint_address') = ${asset_pubkey} and deleted_at is null limit 1`;
	if (existing) return error(res, 409, 'conflict', 'agent already registered for this mint');

	const [pending] = await sql`select payload from agent_registrations_pending where user_id=${user.id} and payload->>'asset_pubkey'=${asset_pubkey} and expires_at > now() order by created_at desc limit 1`;
	const payload = pending?.payload || {};
	const name = body.name || payload.name || `Agent ${asset_pubkey.slice(0, 6)}`;
	const description = body.description || payload.description || '';
	const avatar_id = body.avatar_id || payload.avatar_id || null;

	const [agent] = await sql`insert into agent_identities (user_id, name, description, avatar_id, wallet_address, meta) values (${user.id}, ${name}, ${description}, ${avatar_id}, ${wallet_address}, ${JSON.stringify({ chain_type: 'solana', network, sol_mint_address: asset_pubkey, tx_signature, ...(payload.vanity_prefix ? { vanity_prefix: payload.vanity_prefix } : {}) })}::jsonb) returning id, name, description, wallet_address, meta, created_at`;

	await sql`delete from agent_registrations_pending where user_id=${user.id} and payload->>'asset_pubkey'=${asset_pubkey}`;

	return json(res, 201, { ok: true, agent: { ...agent, home_url: `${env.APP_ORIGIN}/agent/${agent.id}` }, sol_mint_address: asset_pubkey, tx_signature, network });
});

// ── solana-reputation ─────────────────────────────────────────────────────────

export const handleReputation = wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,OPTIONS', credentials: false })) return;
	if (!method(req, res, ['GET'])) return;

	const rl = await limits.authIp(clientIp(req));
	if (!rl.success) return error(res, 429, 'rate_limited', 'too many requests');

	const url = new URL(req.url, `http://${req.headers.host}`);
	const asset = url.searchParams.get('asset');
	const network = url.searchParams.get('network') === 'mainnet' ? 'mainnet' : 'devnet';

	if (!asset) return error(res, 400, 'validation_error', 'asset query param required');
	try { new PublicKey(asset); } catch { return error(res, 400, 'validation_error', 'invalid asset pubkey'); }

	const [fb] = await sql`
		with feedback as (
			select f.signature, f.attester, f.disputed, f.revoked,
				(f.payload->>'score')::int as score, f.payload->>'task_id' as task_id,
				exists (select 1 from solana_attestations a where a.agent_asset = f.agent_asset and a.kind = 'threews.accept.v1' and a.payload->>'task_id' = f.payload->>'task_id' and a.verified = true and f.payload->>'task_id' is not null) as task_accepted,
				exists (select 1 from solana_credentials c where c.subject = f.attester and c.network = f.network and c.kind = 'threews.verified-client.v1' and c.closed = false and (c.expiry is null or c.expiry > now())) as credentialed,
				(f.payload->>'source' like 'pumpkit.%' or f.payload->>'source' like 'pumpfun.%') as event_attested
			from solana_attestations f where f.agent_asset = ${asset} and f.network = ${network} and f.kind = 'threews.feedback.v1' and f.revoked = false
		),
		per_attester as (select attester, avg(score)::float as score_avg, bool_or(task_accepted) as any_verified, bool_or(credentialed) as any_credentialed, bool_or(event_attested) as any_event_attested from feedback group by attester)
		select
			(select count(*)::int from feedback) as total,
			(select count(*) filter (where task_accepted)::int from feedback) as verified,
			(select count(*) filter (where credentialed)::int from feedback) as credentialed,
			(select count(*) filter (where event_attested)::int from feedback) as event_attested,
			(select count(*) filter (where disputed)::int from feedback) as disputed,
			(select coalesce(avg(score), 0)::float from feedback) as score_avg,
			(select coalesce(avg(score) filter (where task_accepted), 0)::float from feedback) as score_avg_verified,
			(select coalesce(avg(score) filter (where credentialed), 0)::float from feedback) as score_avg_credentialed,
			(select coalesce(avg(score) filter (where event_attested), 0)::float from feedback) as score_avg_event_attested,
			(select count(*)::int from per_attester) as unique_attesters,
			(select count(*) filter (where any_verified)::int from per_attester) as unique_verified_attesters,
			(select count(*) filter (where any_credentialed)::int from per_attester) as unique_credentialed_attesters,
			(select coalesce(avg(score_avg), 0)::float from per_attester) as score_avg_weighted,
			(select coalesce(avg(score_avg) filter (where any_verified), 0)::float from per_attester) as score_avg_weighted_verified,
			(select coalesce(avg(score_avg) filter (where any_credentialed), 0)::float from per_attester) as score_avg_weighted_credentialed
	`;

	const [val] = await sql`select count(*) filter (where (payload->>'passed')::bool)::int as passed, count(*) filter (where not (payload->>'passed')::bool)::int as failed, count(*) filter (where (payload->>'passed')::bool and (payload->>'source' like 'pumpkit.%' or payload->>'source' like 'pumpfun.%'))::int as event_passed, count(*) filter (where not (payload->>'passed')::bool and (payload->>'source' like 'pumpkit.%' or payload->>'source' like 'pumpfun.%'))::int as event_failed from solana_attestations where agent_asset = ${asset} and network = ${network} and kind = 'threews.validation.v1' and revoked = false`;

	const [auditedVal] = await sql`select count(*) filter (where (data->>'passed')::bool)::int as passed, count(*) filter (where not (data->>'passed')::bool)::int as failed from solana_credentials where subject = ${asset} and network = ${network} and kind = 'threews.audited-validation.v1' and closed = false and (expiry is null or expiry > now())`;

	const [counts] = await sql`select count(*) filter (where kind = 'threews.task.v1')::int as tasks_offered, count(*) filter (where kind = 'threews.accept.v1' and verified)::int as tasks_accepted, count(*) filter (where kind = 'threews.dispute.v1' and verified)::int as disputes_filed, count(*) filter (where revoked)::int as revoked_count from solana_attestations where agent_asset = ${asset} and network = ${network}`;

	const [cursor] = await sql`select last_indexed_at from solana_attestations_cursor where agent_asset = ${asset} limit 1`;

	const pumpfunRows = await sql`select kind, count(*)::int as n, coalesce(sum(weight), 0)::float as w from pumpfun_signals where agent_asset = ${asset} group by kind`;
	const pumpfunByKind = {};
	let pumpfunTotal = 0, pumpfunWeight = 0;
	for (const r of pumpfunRows) {
		pumpfunByKind[r.kind] = { count: r.n, weight: Number(r.w.toFixed(3)) };
		pumpfunTotal += r.n; pumpfunWeight += r.w;
	}

	const [actRow] = await sql`select s.graduated, s.recent_tx_count, (select count(*)::int from pump_agent_trades t where t.mint_id = m.id) as trade_count from pump_agent_stats s join pump_agent_mints m on m.id = s.mint_id where m.mint = ${asset} and m.network = ${network} limit 1`;
	const tokenActivity = actRow ? { graduated: !!actRow.graduated, recent_tx_count: actRow.recent_tx_count || 0, trade_count: actRow.trade_count || 0, weight: Number(((actRow.graduated ? 0.3 : 0) + Math.min(0.4, (actRow.recent_tx_count || 0) * 0.005) + Math.min(0.3, (actRow.trade_count || 0) * 0.01)).toFixed(3)) } : { graduated: false, recent_tx_count: 0, trade_count: 0, weight: 0 };

	const [payRow] = await sql`select count(*) filter (where p.status='confirmed')::int as confirmed_count, count(distinct p.payer_wallet) filter (where p.status='confirmed')::int as unique_payers, coalesce(sum(p.amount_atomics) filter (where p.status='confirmed'), 0)::text as total_atomics from pump_agent_payments p join pump_agent_mints m on m.id = p.mint_id join agent_identities a on a.id = m.agent_id where (a.meta->>'sol_mint_address') = ${asset} and m.network = ${network}`;

	return json(res, 200, {
		agent: asset, network,
		pump_payments: payRow || { confirmed_count: 0, unique_payers: 0, total_atomics: '0' },
		pumpfun_signals: { count: pumpfunTotal, weight: Number(pumpfunWeight.toFixed(3)), by_kind: pumpfunByKind },
		token_activity: tokenActivity,
		feedback: {
			total: fb.total, verified: fb.verified, credentialed: fb.credentialed, event_attested: fb.event_attested, disputed: fb.disputed,
			unique_attesters: fb.unique_attesters, unique_verified_attesters: fb.unique_verified_attesters, unique_credentialed_attesters: fb.unique_credentialed_attesters,
			score_avg: Number(fb.score_avg.toFixed(3)), score_avg_verified: Number(fb.score_avg_verified.toFixed(3)),
			score_avg_credentialed: Number(fb.score_avg_credentialed.toFixed(3)), score_avg_event_attested: Number(fb.score_avg_event_attested.toFixed(3)),
			score_avg_weighted: Number(fb.score_avg_weighted.toFixed(3)), score_avg_weighted_verified: Number(fb.score_avg_weighted_verified.toFixed(3)), score_avg_weighted_credentialed: Number(fb.score_avg_weighted_credentialed.toFixed(3)),
		},
		validation: { self_passed: val.passed, self_failed: val.failed, event_passed: val.event_passed, event_failed: val.event_failed, audited_passed: auditedVal.passed, audited_failed: auditedVal.failed },
		tasks: { offered: counts.tasks_offered, accepted: counts.tasks_accepted },
		disputes_filed: counts.disputes_filed, revoked_count: counts.revoked_count,
		last_indexed_at: cursor?.last_indexed_at || null,
	});
});

// ── solana-reputation-history ─────────────────────────────────────────────────

const MAX_DAYS = 90;

export const handleReputationHistory = wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,OPTIONS', credentials: false })) return;
	if (!method(req, res, ['GET'])) return;

	const rl = await limits.authIp(clientIp(req));
	if (!rl.success) return error(res, 429, 'rate_limited', 'too many requests');

	const url   = new URL(req.url, `http://${req.headers.host}`);
	const asset = url.searchParams.get('asset');
	const network = url.searchParams.get('network') === 'mainnet' ? 'mainnet' : 'devnet';
	const days  = Math.min(Math.max(Number(url.searchParams.get('days') || 30), 1), MAX_DAYS);

	if (!asset) return error(res, 400, 'validation_error', 'asset query param required');
	try { new PublicKey(asset); } catch { return error(res, 400, 'validation_error', 'invalid asset pubkey'); }

	const rows = await sql`
		with feedback as (
			select date_trunc('day', f.block_time) as day, f.attester, (f.payload->>'score')::int as score,
				exists (select 1 from solana_attestations a where a.agent_asset = f.agent_asset and a.kind = 'threews.accept.v1' and a.payload->>'task_id' = f.payload->>'task_id' and a.verified = true and f.payload->>'task_id' is not null) as task_accepted,
				exists (select 1 from solana_credentials c where c.subject = f.attester and c.network = f.network and c.kind = 'threews.verified-client.v1' and c.closed = false and (c.expiry is null or c.expiry > f.block_time)) as credentialed,
				(f.payload->>'source' like 'pumpkit.%') as event_attested
			from solana_attestations f where f.agent_asset = ${asset} and f.network = ${network} and f.kind = 'threews.feedback.v1' and f.revoked = false and f.block_time >= now() - (${days} || ' days')::interval
		)
		select day, count(*)::int as n,
			coalesce(avg(score) filter (where credentialed), 0)::float as score_credentialed,
			coalesce(avg(score) filter (where task_accepted), 0)::float as score_verified,
			coalesce(avg(score) filter (where event_attested), 0)::float as score_event,
			coalesce(avg(score), 0)::float as score_raw,
			count(*) filter (where credentialed)::int as n_credentialed,
			count(*) filter (where task_accepted)::int as n_verified,
			count(*) filter (where event_attested)::int as n_event
		from feedback group by day order by day asc
	`;

	const series = rows.map((r) => {
		const tier = r.n_credentialed > 0 ? { tier: 'credentialed', score: r.score_credentialed, n: r.n_credentialed } : r.n_verified > 0 ? { tier: 'verified', score: r.score_verified, n: r.n_verified } : r.n_event > 0 ? { tier: 'event', score: r.score_event, n: r.n_event } : { tier: 'community', score: r.score_raw, n: r.n };
		return { day: r.day instanceof Date ? r.day.toISOString().slice(0, 10) : String(r.day).slice(0, 10), tier: tier.tier, score: Number(tier.score.toFixed(3)), n: tier.n };
	});

	return json(res, 200, { agent: asset, network, days, series });
});
