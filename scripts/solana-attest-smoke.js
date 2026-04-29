#!/usr/bin/env node
/**
 * End-to-end smoke test for the Solana ERC-8004 analog (devnet).
 *
 * Exercises: createTask → acceptTask → attestFeedback → attestValidation
 * → reputation read. Verifies the indexer correctly marks task-linked
 * feedback as verified and computes weighted scores.
 *
 * Usage:
 *   SMOKE_BASE_URL=https://your-app.vercel.app \
 *   SMOKE_AGENT_ASSET=<metaplex-core-asset-pubkey> \
 *   SMOKE_CLIENT_KEY=<base58 secret key for client wallet> \
 *   SMOKE_OWNER_KEY=<base58 secret key for agent owner wallet> \
 *   node scripts/solana-attest-smoke.js
 *
 * Both wallets need a small amount of devnet SOL. Get some at:
 *   https://faucet.solana.com (paste pubkey, select devnet).
 */

import {
	Connection, Keypair, PublicKey, Transaction, TransactionInstruction,
} from '@solana/web3.js';
import bs58 from 'bs58';
import assert from 'assert';

const BASE     = process.env.SMOKE_BASE_URL || 'http://localhost:3000';
const ASSET    = process.env.SMOKE_AGENT_ASSET;
const CLIENT_K = process.env.SMOKE_CLIENT_KEY;
const OWNER_K  = process.env.SMOKE_OWNER_KEY;

if (!ASSET || !CLIENT_K || !OWNER_K) {
	console.error('Missing SMOKE_AGENT_ASSET / SMOKE_CLIENT_KEY / SMOKE_OWNER_KEY');
	process.exit(1);
}

const RPC = process.env.SOLANA_RPC_URL_DEVNET || 'https://api.devnet.solana.com';
const MEMO = new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');
const NETWORK = 'devnet';

function loadKey(b58) {
	const bytes = bs58.decode(b58);
	return Keypair.fromSecretKey(bytes);
}

const conn   = new Connection(RPC, 'confirmed');
const client = loadKey(CLIENT_K);
const owner  = loadKey(OWNER_K);
const agent  = new PublicKey(ASSET);

console.log('client:', client.publicKey.toBase58());
console.log('owner :', owner.publicKey.toBase58());
console.log('agent :', agent.toBase58());

async function sendMemo(payer, payload) {
	const data = Buffer.from(JSON.stringify(payload));
	const ix   = new TransactionInstruction({
		programId: MEMO,
		keys: [{ pubkey: agent, isSigner: false, isWritable: false }],
		data,
	});
	const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash('finalized');
	const tx = new Transaction({ feePayer: payer.publicKey, recentBlockhash: blockhash }).add(ix);
	tx.sign(payer);
	const sig = await conn.sendRawTransaction(tx.serialize());
	await conn.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, 'confirmed');
	return sig;
}

const taskId    = `smoke-${Date.now()}`;
const scopeHash = 'sha256:smoke-' + Math.random().toString(36).slice(2);
const taskHash  = 'sha256:smoke-result-' + Math.random().toString(36).slice(2);

async function step(label, fn) {
	process.stdout.write(`→ ${label} … `);
	const t0 = Date.now();
	const r = await fn();
	console.log(`ok (${Date.now() - t0}ms)`, r?.sig ? r.sig.slice(0, 12) + '…' : '');
	return r;
}

(async () => {
	const taskSig = await step('client posts task', async () => {
		const sig = await sendMemo(client, {
			v: 1, kind: 'threews.task.v1', agent: ASSET,
			task_id: taskId, scope_hash: scopeHash, ts: Math.floor(Date.now() / 1000),
		});
		return { sig };
	});

	await step('owner accepts task', async () => {
		const sig = await sendMemo(owner, {
			v: 1, kind: 'threews.accept.v1', agent: ASSET,
			task_id: taskId, ts: Math.floor(Date.now() / 1000),
		});
		return { sig };
	});

	const fbSig = await step('client leaves feedback (5/5, task-linked)', async () => {
		const sig = await sendMemo(client, {
			v: 1, kind: 'threews.feedback.v1', agent: ASSET,
			score: 5, task_id: taskId, ts: Math.floor(Date.now() / 1000),
		});
		return { sig };
	});

	await step('client attests validation passed', async () => {
		const sig = await sendMemo(client, {
			v: 1, kind: 'threews.validation.v1', agent: ASSET,
			task_hash: taskHash, passed: true, ts: Math.floor(Date.now() / 1000),
		});
		return { sig };
	});

	// Trigger indexer + read reputation.
	await step('warm indexer (read attestations)', async () => {
		const r = await fetch(`${BASE}/api/agents/solana-attestations?asset=${ASSET}&network=${NETWORK}&limit=20`);
		assert(r.ok, 'attestations endpoint failed');
		const data = await r.json();
		assert(data.count >= 4, `expected >=4 attestations, got ${data.count}`);
		const sigs = new Set(data.data.map((d) => d.signature));
		assert(sigs.has(taskSig.sig),  'task signature missing');
		assert(sigs.has(fbSig.sig),    'feedback signature missing');
		return { count: data.count };
	});

	await step('reputation reflects verified feedback', async () => {
		const r = await fetch(`${BASE}/api/agents/solana-reputation?asset=${ASSET}&network=${NETWORK}`);
		assert(r.ok, 'reputation endpoint failed');
		const rep = await r.json();
		assert(rep.feedback.verified >= 1, `verified count expected >=1, got ${rep.feedback.verified}`);
		assert(rep.feedback.score_avg_verified >= 4.9, `verified avg expected ~5, got ${rep.feedback.score_avg_verified}`);
		assert(rep.tasks.accepted >= 1, 'tasks.accepted expected >=1');
		assert(rep.validation.passed >= 1, 'validation.passed expected >=1');
		return { verified: rep.feedback.verified, score: rep.feedback.score_avg_verified };
	});

	await step('agent card discovery', async () => {
		const r = await fetch(`${BASE}/a/sol/${ASSET}/.well-known/agent-card.json`);
		assert(r.ok, 'agent-card.json failed');
		const c = await r.json();
		assert(c.identity.asset_pubkey === ASSET, 'card asset mismatch');
		assert(c.attestation.schemas_url.endsWith('/.well-known/agent-attestation-schemas'), 'schemas_url wrong');
		return { name: c.name };
	});

	console.log('\n✓ all checks passed');
})().catch((e) => {
	console.error('\n✗ smoke failed:', e.message);
	process.exit(1);
});
