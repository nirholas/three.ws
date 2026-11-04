#!/usr/bin/env node
// Devnet proof for the capped burner wallet (docs/approvals.md, "Capped burner").
// An agent's own custodial Solana wallet spends alone up to its cap; anything
// larger waits for the owner, who confirms with a tap or, above the signature
// threshold, by signing with their own linked wallet.
//
// Runs the REAL production modules end to end: wallet-intents.js runIntentNow
// (the guarded spend path), agent-trade-guards.js setBurnerPolicy and
// enforceSpendLimit, approvals.js decideApproval with the registered
// wallet_intent executor, owner-sign.js, and agent-wallet.js custodial key
// generation. The database is the production schema (api/_lib/schema.sql plus
// every migration) in an in-process Postgres; every transfer is a real devnet
// transaction from a freshly generated custodial agent wallet.
//
//   1. auto         within the per-spend and daily caps, the agent signs alone
//   2. confirm      above the per-spend cap the spend waits; a tap runs it
//   3. daily total  two auto spends fill the daily cap; the next in-cap spend waits
//   4. owner_sign   above the signature threshold a tap and a stranger's signature
//                   are refused; a signature from the owner's linked wallet runs it
//   5. expiry       a request left past its window can never execute
//
// Devnet only, throwaway keys. No production database or secret is read: the
// script re-runs itself in a scrubbed environment with fresh per-run secrets.
// Path 5 waits out the real two-minute minimum approval window.
//
//   node scripts/burner-devnet-proof.mjs
//   node scripts/burner-devnet-proof.mjs --funder ~/.config/solana/devnet.json
//   SOLANA_RPC_URL_DEVNET=https://... node scripts/burner-devnet-proof.mjs

import { spawnSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

if (process.env.BURNER_PROOF_SCRUBBED !== '1') {
	const keep = ['PATH', 'HOME', 'TMPDIR', 'NODE_OPTIONS', 'SOLANA_RPC_URL_DEVNET'];
	const env = Object.fromEntries(keep.filter((k) => process.env[k]).map((k) => [k, process.env[k]]));
	Object.assign(env, {
		BURNER_PROOF_SCRUBBED: '1',
		NODE_ENV: 'development',
		JWT_SECRET: randomBytes(32).toString('hex'),
		WALLET_ENCRYPTION_KEY: randomBytes(32).toString('hex'),
	});
	const self = fileURLToPath(import.meta.url);
	const r = spawnSync(process.execPath, [...process.execArgv, self, ...process.argv.slice(2)], { stdio: 'inherit', env });
	process.exit(r.status ?? 1);
}

const args = process.argv.slice(2);
const flag = (n) => (args.includes(n) ? args[args.indexOf(n) + 1] : null);
const RPC = process.env.SOLANA_RPC_URL_DEVNET || 'https://api.devnet.solana.com';
process.env.SOLANA_RPC_URL_DEVNET = RPC;
const DEVNET_GENESIS = 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG';
const NETWORK = 'devnet';

const results = [];
let failed = 0;
function check(path, name, ok, detail = '') {
	results.push({ path, check: name, result: ok ? 'PASS' : 'FAIL', detail: String(detail).slice(0, 110) });
	if (!ok) failed += 1;
	console.log(`   [${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? `: ${detail}` : ''}`);
}
const heading = (t) => console.log(`\n== ${t}`);

// ── database: the production schema in-process, behind api/_lib/db.js ────────
heading('database');
const { createFullSchemaDb } = await import('../tests/_helpers/pglite-full-schema.js');
const { createPgliteSql } = await import('../tests/_helpers/pglite-sql.js');
const { installPgliteDb } = await import('./lib/pglite-db.mjs');
const { pg, cached, skipped } = await createFullSchemaDb();
console.log(`   production schema loaded (${cached ? 'cached build' : `fresh build, ${skipped.length} statements PGlite cannot run`})`);
const db = createPgliteSql({ pg });
installPgliteDb(db.sql);

const { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram, Transaction, sendAndConfirmTransaction } = await import('@solana/web3.js');
const { ed25519 } = await import('@noble/curves/ed25519.js');
const bs58 = (await import('bs58')).default;
const guards = await import('../api/_lib/agent-trade-guards.js');
const intents = await import('../api/_lib/wallet-intents.js');
const approvals = await import('../api/_lib/approvals.js');
const { getOrCreateAgentSolanaWallet } = await import('../api/_lib/agent-wallet.js');
const { solUsdPrice } = await import('../api/_lib/avatar-wallet.js');

const conn = new Connection(RPC, 'confirmed');
const genesis = await conn.getGenesisHash();
if (genesis !== DEVNET_GENESIS) {
	console.error(`refusing to run: ${RPC} has genesis ${genesis}, which is not devnet`);
	process.exit(2);
}

// ── the owner, their linked main wallet, and the agent ───────────────────────
heading('setup');
const ownerId = randomUUID();
const ownerWallet = Keypair.generate();
const stranger = Keypair.generate();
await db.query(`insert into users (id, email, display_name) values ($1, $2, 'Burner proof owner')`, [ownerId, `burner-proof-${ownerId.slice(0, 8)}@three.ws.invalid`]);
await db.query(`insert into user_wallets (user_id, address, chain_type, is_primary) values ($1, $2, 'solana', true)`, [ownerId, ownerWallet.publicKey.toBase58()]);
const [agent] = await db.query(`insert into agent_identities (user_id, name, meta) values ($1, 'Burner proof agent', '{}'::jsonb) returning id`, [ownerId]);
const agentId = agent.id;
const wallet = await getOrCreateAgentSolanaWallet(agentId);
console.log(`   owner ${ownerId}, linked wallet ${ownerWallet.publicKey.toBase58()}`);
console.log(`   agent ${agentId}, custodial devnet wallet ${wallet.address} (generated and encrypted by agent-wallet.js)`);

async function airdrop(to, sol) {
	for (let attempt = 0; attempt < 4; attempt++) {
		try {
			const sig = await conn.requestAirdrop(new PublicKey(to), Math.round(sol * LAMPORTS_PER_SOL));
			const bh = await conn.getLatestBlockhash();
			await conn.confirmTransaction({ signature: sig, ...bh }, 'confirmed');
			return sig;
		} catch (e) {
			if (attempt === 3) throw e;
			await new Promise((r) => setTimeout(r, 3000 * (attempt + 1)));
		}
	}
	return null;
}

const FUND_SOL = 0.15;
const funderPath = flag('--funder');
let fundSig;
if (funderPath) {
	const funder = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(funderPath.replace(/^~/, process.env.HOME || ''), 'utf8'))));
	const tx = new Transaction().add(SystemProgram.transfer({ fromPubkey: funder.publicKey, toPubkey: new PublicKey(wallet.address), lamports: Math.round(FUND_SOL * LAMPORTS_PER_SOL) }));
	fundSig = await sendAndConfirmTransaction(conn, tx, [funder], { commitment: 'confirmed' });
} else {
	try {
		fundSig = await airdrop(wallet.address, FUND_SOL);
	} catch (e) {
		console.error(`devnet airdrop failed (${e?.message}). Rerun with --funder <devnet keypair json> to fund from a devnet wallet instead.`);
		process.exit(3);
	}
}
console.log(`   funded ${FUND_SOL} SOL: ${fundSig}`);

// ── the policy, sized from the live SOL price ────────────────────────────────
const price = await solUsdPrice();
if (!(price > 0)) {
	console.error('could not read the SOL/USD price, so spends cannot be classified');
	process.exit(4);
}
const SMALL = 0.004;
const unit = SMALL * price;
const round2 = (n) => Math.round(n * 100) / 100;
const policy = await guards.setBurnerPolicy(agentId, ownerId, {
	autoMaxUsd: round2(unit * 1.5),
	dailyAutoMaxUsd: round2(unit * 2.5),
	confirmAboveUsd: round2(unit * 4),
	expiryMinutes: 2,
});
console.log(`   SOL/USD ${price.toFixed(2)}; one small spend (${SMALL} SOL) is $${unit.toFixed(2)}`);
console.log(`   burner policy: auto <= $${policy.autoMaxUsd}, daily auto <= $${policy.dailyAutoMaxUsd}, wallet signature above $${policy.confirmAboveUsd}, window ${policy.expiryMinutes} min`);

const recipient = Keypair.generate().publicKey.toBase58();
console.log(`   recipient (throwaway) ${recipient}`);

async function rule(amountSol, title) {
	const n = intents.normalizeIntent({
		title,
		trigger_type: 'on_schedule',
		trigger_config: { cadence: 'daily', hour: 0 },
		action_type: 'transfer',
		action_config: { amount_sol: amountSol, destination: recipient, destination_label: 'proof recipient' },
	});
	if (!n.ok) throw new Error(`intent rejected: ${n.message}`);
	return intents.createIntent(agentId, ownerId, n.intent, { network: NETWORK });
}
const small = await rule(SMALL, `Send ${SMALL} SOL`);
const mid = await rule(SMALL * 2, `Send ${SMALL * 2} SOL`);
const big = await rule(SMALL * 5, `Send ${SMALL * 5} SOL`);

async function fire(intent) {
	// Each manual run's discriminator is its timestamp; keep consecutive runs distinct.
	await new Promise((r) => setTimeout(r, 1100));
	const out = await intents.runIntentNow({ agentId, userId: ownerId, intentId: intent.id, network: NETWORK, dryRun: false });
	return out.results?.[0] || out;
}
const lamportsOf = async (addr) => conn.getBalance(new PublicKey(addr), 'confirmed');
async function landed(sig) {
	if (!sig) return false;
	const st = await conn.getSignatureStatus(sig, { searchTranscriptHistory: true });
	return Boolean(st?.value && !st.value.err && ['confirmed', 'finalized'].includes(st.value.confirmationStatus));
}
const getRow = (id) => approvals.getApproval(ownerId, id);

async function approvalView(id) {
	const v = await getRow(id);
	return v.request || v;
}

async function decide(id, extra = {}) {
	const view = await approvalView(id);
	try {
		const r = await approvals.decideApproval({ userId: ownerId, id, decision: 'approve', payloadHash: view.payload_hash, via: 'web', ...extra });
		return { ok: true, request: r.request };
	} catch (e) {
		return { ok: false, status: e.status, code: e.code, message: e.message };
	}
}

// ── 1. auto ───────────────────────────────────────────────────────────────────
heading(`1. auto: ${SMALL} SOL ($${unit.toFixed(2)}) is within the $${policy.autoMaxUsd} per-spend cap`);
const before1 = await lamportsOf(recipient);
const a1 = await fire(small);
check('1 auto', 'agent signs alone, no approval queued', a1.status === 'ok' && !a1.approval_id, `${a1.status} ${a1.signature || a1.note || ''}`);
check('1 auto', 'transfer confirmed on devnet', await landed(a1.signature), a1.signature);
check('1 auto', 'recipient balance grew by the amount', (await lamportsOf(recipient)) - before1 === Math.round(SMALL * LAMPORTS_PER_SOL));

// ── 3. daily total crossing the cap ─────────────────────────────────────────
heading(`3. daily total: a second auto spend, then a third in-cap spend passes the $${policy.dailyAutoMaxUsd} daily cap`);
const a2 = await fire(small);
check('3 daily', 'second in-cap spend still runs alone', a2.status === 'ok', `${a2.status} ${a2.signature || a2.note || ''}`);
const autoSpent = await guards.getAutoSpendUsd(agentId, NETWORK);
check('3 daily', 'agent auto total for the day is two small spends', Math.abs(autoSpent - 2 * unit) < unit * 0.25, `$${autoSpent.toFixed(2)}`);
const a3 = await fire(small);
check('3 daily', 'third in-cap spend becomes a pending approval, not a failure', a3.status === 'awaiting_approval' && Boolean(a3.approval_id), `${a3.status}: ${a3.note || ''}`);
const v3 = a3.approval_id ? await approvalView(a3.approval_id) : null;
check('3 daily', 'gate reason names the daily limit', /daily limit/.test(v3?.gate_reason || ''), v3?.gate_reason);
const before3 = await lamportsOf(recipient);
const d3 = a3.approval_id ? await decide(a3.approval_id) : { ok: false };
check('3 daily', 'owner tap approves and the exact spend executes', d3.ok && d3.request?.status === 'executed', d3.ok ? `${d3.request.status} ${d3.request.outcome?.signature || ''}` : d3.message);
check('3 daily', 'approved transfer landed on devnet', (await lamportsOf(recipient)) - before3 === Math.round(SMALL * LAMPORTS_PER_SOL));
const autoAfter = await guards.getAutoSpendUsd(agentId, NETWORK);
check('3 daily', 'an owner-approved spend does not eat the agent daily allowance', Math.abs(autoAfter - autoSpent) < 1e-6, `$${autoAfter.toFixed(2)}`);

// ── 2. confirm (above the per-spend cap) ────────────────────────────────────
heading(`2. confirm: ${SMALL * 2} SOL ($${(unit * 2).toFixed(2)}) is above the $${policy.autoMaxUsd} per-spend cap`);
const c1 = await fire(mid);
check('2 confirm', 'spend becomes a pending approval', c1.status === 'awaiting_approval' && Boolean(c1.approval_id), `${c1.status}: ${c1.note || ''}`);
const v2 = c1.approval_id ? await approvalView(c1.approval_id) : null;
const table = Object.fromEntries((v2?.confirmation || []).map((r) => [r.key, r.full || r.value]));
check('2 confirm', 'confirmation shows recipient, amount, token and chain', table.recipient === recipient && /0\.008 SOL/.test(table.amount || '') && table.asset === 'SOL' && table.chain === 'Solana devnet', JSON.stringify(table));
const windowMin = v2 ? (new Date(v2.expires_at) - new Date(v2.created_at)) / 60000 : 0;
check('2 confirm', `request expires in the owner's ${policy.expiryMinutes}-minute window`, Math.abs(windowMin - policy.expiryMinutes) < 0.1, `${windowMin.toFixed(2)} min`);
check('2 confirm', 'a tap is enough at this tier (no wallet signature)', v2?.requires_wallet_signature === false);
const before2 = await lamportsOf(recipient);
const d2 = c1.approval_id ? await decide(c1.approval_id) : { ok: false };
check('2 confirm', 'owner tap executes the spend', d2.ok && d2.request?.status === 'executed', d2.ok ? `${d2.request.status} ${d2.request.outcome?.signature || ''}` : d2.message);
check('2 confirm', 'approved transfer landed on devnet', (await lamportsOf(recipient)) - before2 === Math.round(SMALL * 2 * LAMPORTS_PER_SOL));

// ── 4. owner_sign (above the signature threshold) ───────────────────────────
heading(`4. owner_sign: ${SMALL * 5} SOL ($${(unit * 5).toFixed(2)}) is above the $${policy.confirmAboveUsd} signature threshold`);
const s1 = await fire(big);
check('4 owner_sign', 'spend becomes a pending approval', s1.status === 'awaiting_approval' && Boolean(s1.approval_id), `${s1.status}: ${s1.note || ''}`);
const v4 = s1.approval_id ? await approvalView(s1.approval_id) : null;
check('4 owner_sign', 'request demands a wallet signature', v4?.requires_wallet_signature === true && /request: /.test(v4?.sign_message || ''));
console.log(`   message the owner signs:\n${(v4?.sign_message || '').split('\n').map((l) => `      ${l}`).join('\n')}`);
const before4 = await lamportsOf(recipient);
const tap = s1.approval_id ? await decide(s1.approval_id) : { ok: true };
check('4 owner_sign', 'a tap without a signature is refused', !tap.ok && tap.code === 'wallet_signature_required', tap.message);
const sign = (kp, msg) => bs58.encode(ed25519.sign(new TextEncoder().encode(msg), kp.secretKey.slice(0, 32)));
const bad = s1.approval_id ? await decide(s1.approval_id, { walletSignature: { address: stranger.publicKey.toBase58(), signature: sign(stranger, v4.sign_message) } }) : { ok: true };
check('4 owner_sign', 'a signature from an unlinked wallet is refused', !bad.ok && /not linked/.test(bad.message || ''), bad.message);
check('4 owner_sign', 'nothing moved while refused', (await lamportsOf(recipient)) === before4);
const good = s1.approval_id ? await decide(s1.approval_id, { walletSignature: { address: ownerWallet.publicKey.toBase58(), signature: sign(ownerWallet, v4.sign_message) } }) : { ok: false };
check('4 owner_sign', "the owner's linked wallet signature executes it", good.ok && good.request?.status === 'executed', good.ok ? `${good.request.status} ${good.request.outcome?.signature || ''}` : good.message);
check('4 owner_sign', 'approved transfer landed on devnet', (await lamportsOf(recipient)) - before4 === Math.round(SMALL * 5 * LAMPORTS_PER_SOL));

// ── 5. expiry ───────────────────────────────────────────────────────────────
heading(`5. expiry: a pending request left past its ${policy.expiryMinutes}-minute window`);
const e1 = await fire(mid);
check('5 expiry', 'spend becomes a pending approval', e1.status === 'awaiting_approval' && Boolean(e1.approval_id), `${e1.status}`);
const v5 = e1.approval_id ? await approvalView(e1.approval_id) : null;
const waitMs = v5 ? Math.max(0, new Date(v5.expires_at) - Date.now()) + 3000 : 0;
console.log(`   waiting ${(waitMs / 1000).toFixed(0)} s for the real window to close`);
await new Promise((r) => setTimeout(r, waitMs));
const before5 = await lamportsOf(recipient);
const late = e1.approval_id ? await decide(e1.approval_id) : { ok: true };
check('5 expiry', 'approving after the window is refused as expired', !late.ok && late.code === 'expired' && late.status === 410, late.message);
const after5 = await approvalView(e1.approval_id);
check('5 expiry', 'request is recorded as expired', after5.status === 'expired', after5.status);
check('5 expiry', 'nothing moved', (await lamportsOf(recipient)) === before5);
const custodyForExpired = await db.query(`select count(*)::int as n from agent_custody_events where agent_id = $1 and meta->>'approval_id' = $2`, [agentId, e1.approval_id]);
check('5 expiry', 'no custody spend row exists for the expired request', custodyForExpired[0].n === 0);

// ── decision trail ───────────────────────────────────────────────────────────
heading('decision trail');
const trail = await db.query(
	`select subject_ref, action_ref, inputs->>'tier' as tier from agent_decisions where agent_id = $1 and kind = 'burner_gate' order by seq`,
	[agentId],
).catch((e) => ({ error: e.message }));
if (Array.isArray(trail)) {
	const events = trail.map((t) => `${t.action_ref}:${t.tier}`);
	console.log(`   ${events.join(', ')}`);
	check('trail', 'every request and decision landed in the decision trail', ['requested', 'approved', 'expired'].every((e) => trail.some((t) => t.action_ref === e)), events.join(' '));
} else {
	check('trail', 'decision trail readable', false, trail.error);
}

const spends = await db.query(
	`select status, usd, signature, meta->>'approval_id' as approval_id from agent_custody_events where agent_id = $1 and event_type = 'spend' order by created_at`,
	[agentId],
);
heading('custody spend rows');
console.table(spends.map((s) => ({ status: s.status, usd: Number(s.usd).toFixed(2), by: s.approval_id ? 'owner approval' : 'agent alone', signature: s.signature })));

heading('summary');
console.table(results);
console.log(`\n${results.length - failed}/${results.length} checks passed on Solana devnet (${RPC}).`);
await pg.close().catch(() => {});
process.exit(failed ? 1 : 0);
