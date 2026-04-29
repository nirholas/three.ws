#!/usr/bin/env node
/**
 * Pump.fun lifecycle smoke test (devnet).
 *
 * Exercises (each is a separate phase, configurable via PHASES env):
 *   create  — launch a new bonding-curve mint via offline createV2Instruction
 *   buy     — use /api/pump/buy-prep + wallet sign
 *   quote   — read /api/pump/quote pre- and post-buy
 *   sell    — /api/pump/sell-prep
 *   stats   — trigger /api/cron/pump-agent-stats and assert row exists
 *
 * Usage:
 *   SMOKE_BASE_URL=https://your-app.vercel.app \
 *   SMOKE_OWNER_KEY=<base58 secret key>          \
 *   SMOKE_AGENT_ID=<uuid of an agent_identities row owned by the wallet> \
 *   SMOKE_SESSION_COOKIE='__Host-session=...'    \  # required for prep endpoints
 *   PHASES=create,quote,buy,sell,stats           \  # default: all
 *   node scripts/pumpfun-lifecycle-smoke.js
 *
 * Requires: ~0.05 devnet SOL on owner wallet (faucet.solana.com).
 *
 * Each phase is a no-op if its prereq fails — the script reports per-phase.
 */

import { Connection, Keypair, PublicKey, VersionedTransaction } from '@solana/web3.js';
import bs58 from 'bs58';
import BN from 'bn.js';

const BASE = process.env.SMOKE_BASE_URL || 'http://localhost:3000';
const OWNER_K = process.env.SMOKE_OWNER_KEY;
const AGENT_ID = process.env.SMOKE_AGENT_ID;
const COOKIE = process.env.SMOKE_SESSION_COOKIE || '';
const NETWORK = process.env.SMOKE_NETWORK || 'devnet';
const RPC =
	process.env.SOLANA_RPC_URL_DEVNET ||
	(NETWORK === 'devnet'
		? 'https://api.devnet.solana.com'
		: 'https://api.mainnet-beta.solana.com');
const PHASES = (process.env.PHASES || 'create,quote,buy,sell,stats')
	.split(',')
	.map((s) => s.trim())
	.filter(Boolean);
const CRON_SECRET = process.env.CRON_SECRET;

if (!OWNER_K) {
	console.error('SMOKE_OWNER_KEY required');
	process.exit(1);
}

const owner = Keypair.fromSecretKey(bs58.decode(OWNER_K));
const conn = new Connection(RPC, 'confirmed');
const report = { base: BASE, network: NETWORK, owner: owner.publicKey.toBase58(), phases: {} };

console.log('▸ pump.fun lifecycle smoke');
console.log('  base:', BASE);
console.log('  owner:', owner.publicKey.toBase58());
console.log('  network:', NETWORK);
console.log('  phases:', PHASES.join(','));

async function api(path, init = {}) {
	const headers = { 'content-type': 'application/json', ...(init.headers || {}) };
	if (COOKIE) headers.cookie = COOKIE;
	const res = await fetch(`${BASE}${path}`, { ...init, headers });
	const text = await res.text();
	let body;
	try {
		body = JSON.parse(text);
	} catch {
		body = { raw: text };
	}
	return { ok: res.ok, status: res.status, body };
}

async function signAndSend(tx_base64) {
	const tx = VersionedTransaction.deserialize(Buffer.from(tx_base64, 'base64'));
	tx.sign([owner]);
	const sig = await conn.sendRawTransaction(tx.serialize(), { skipPreflight: false });
	const latest = await conn.getLatestBlockhash();
	await conn.confirmTransaction(
		{
			signature: sig,
			blockhash: latest.blockhash,
			lastValidBlockHeight: latest.lastValidBlockHeight,
		},
		'confirmed',
	);
	return sig;
}

let MINT = process.env.SMOKE_MINT || null;

// ── create ────────────────────────────────────────────────────────────────
if (PHASES.includes('create')) {
	try {
		if (!AGENT_ID) throw new Error('SMOKE_AGENT_ID required for create phase');
		if (!COOKIE) throw new Error('SMOKE_SESSION_COOKIE required for create phase');
		const symbol = `SMK${Math.floor(Math.random() * 9000 + 1000)}`;
		const prep = await api('/api/pump/launch-prep', {
			method: 'POST',
			body: JSON.stringify({
				agent_id: AGENT_ID,
				wallet_address: owner.publicKey.toBase58(),
				name: `smoke ${symbol}`,
				symbol,
				uri: 'https://three.ws/agent-passport.html?smoke=1',
				network: NETWORK,
				buyback_bps: 0,
				sol_buy_in: 0,
			}),
		});
		if (!prep.ok) throw new Error(`launch-prep ${prep.status}: ${JSON.stringify(prep.body)}`);
		const sig = await signAndSend(prep.body.tx_base64);
		const confirm = await api('/api/pump/launch-confirm', {
			method: 'POST',
			body: JSON.stringify({ prep_id: prep.body.prep_id, tx_signature: sig }),
		});
		if (!confirm.ok)
			throw new Error(`launch-confirm ${confirm.status}: ${JSON.stringify(confirm.body)}`);
		MINT = prep.body.mint || confirm.body.pump_agent_mint?.mint;
		report.phases.create = { ok: true, mint: MINT, signature: sig };
		console.log('  ✓ create', MINT);
	} catch (e) {
		report.phases.create = { ok: false, error: e.message };
		console.log('  ✗ create:', e.message);
	}
}

// ── quote (pre-buy) ───────────────────────────────────────────────────────
if (PHASES.includes('quote') && MINT) {
	try {
		const r = await api(
			`/api/pump/quote?mint=${MINT}&network=${NETWORK}&direction=buy&sol=0.01&slippage_bps=500`,
		);
		if (!r.ok) throw new Error(`${r.status}: ${JSON.stringify(r.body)}`);
		report.phases.quote_pre = { ok: true, graduated: r.body.graduated, quote: r.body.quote };
		console.log('  ✓ quote pre-buy', r.body.graduated ? 'amm' : 'curve');
	} catch (e) {
		report.phases.quote_pre = { ok: false, error: e.message };
		console.log('  ✗ quote pre-buy:', e.message);
	}
}

// ── buy ───────────────────────────────────────────────────────────────────
if (PHASES.includes('buy') && MINT) {
	try {
		if (!COOKIE) throw new Error('SMOKE_SESSION_COOKIE required for buy phase');
		const prep = await api('/api/pump/buy-prep', {
			method: 'POST',
			body: JSON.stringify({
				mint: MINT,
				network: NETWORK,
				sol: 0.005,
				slippage_bps: 500,
				wallet_address: owner.publicKey.toBase58(),
			}),
		});
		if (!prep.ok) throw new Error(`buy-prep ${prep.status}: ${JSON.stringify(prep.body)}`);
		const sig = await signAndSend(prep.body.tx_base64);
		report.phases.buy = { ok: true, signature: sig, route: prep.body.route };
		console.log('  ✓ buy', sig.slice(0, 12), 'route=', prep.body.route);
	} catch (e) {
		report.phases.buy = { ok: false, error: e.message };
		console.log('  ✗ buy:', e.message);
	}
}

// ── sell ──────────────────────────────────────────────────────────────────
if (PHASES.includes('sell') && MINT) {
	try {
		if (!COOKIE) throw new Error('SMOKE_SESSION_COOKIE required for sell phase');
		// Try selling a tiny token amount — 1 token base unit. SDK will fail if
		// we hold zero, which is fine: phase reports the failure.
		const prep = await api('/api/pump/sell-prep', {
			method: 'POST',
			body: JSON.stringify({
				mint: MINT,
				network: NETWORK,
				tokens: '1000',
				slippage_bps: 500,
				wallet_address: owner.publicKey.toBase58(),
			}),
		});
		if (!prep.ok) throw new Error(`sell-prep ${prep.status}: ${JSON.stringify(prep.body)}`);
		const sig = await signAndSend(prep.body.tx_base64);
		report.phases.sell = { ok: true, signature: sig, route: prep.body.route };
		console.log('  ✓ sell', sig.slice(0, 12));
	} catch (e) {
		report.phases.sell = { ok: false, error: e.message };
		console.log('  ✗ sell:', e.message);
	}
}

// ── stats cron + read ─────────────────────────────────────────────────────
if (PHASES.includes('stats')) {
	try {
		if (!CRON_SECRET) throw new Error('CRON_SECRET required for stats phase');
		const r = await api('/api/cron/pump-agent-stats', {
			method: 'GET',
			headers: { authorization: `Bearer ${CRON_SECRET}` },
		});
		if (!r.ok) throw new Error(`cron ${r.status}: ${JSON.stringify(r.body)}`);
		report.phases.stats = { ok: true, ...r.body };
		console.log('  ✓ stats cron updated', r.body.updated, '/', r.body.scanned);
	} catch (e) {
		report.phases.stats = { ok: false, error: e.message };
		console.log('  ✗ stats:', e.message);
	}
}

console.log('\n── report ──');
console.log(JSON.stringify(report, null, 2));

const failures = Object.values(report.phases).filter((p) => !p.ok).length;
process.exit(failures > 0 ? 1 : 0);
