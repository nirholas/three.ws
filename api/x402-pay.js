// POST /api/x402-pay
//
// Server-side x402 payer: takes { tool, args } from the chat UI, fires a
// real paid x402 call to /api/mcp using a server-held Solana keypair, and
// returns the MCP result + on-chain settlement proof.
//
// This powers the demo at /pay (and the in-chat x402 button) — the agent
// pays USDC on behalf of the viewer so the UX is one-click.
//
// Env (required for prod):
//   X402_AGENT_SOLANA_SECRET_BASE58  base58-encoded 64-byte ed25519 secret key
// Local dev fallback (when env unset): reads the keypair JSON at
//   /home/codespace/.config/x402-test-wallets/solana.json

import { readFileSync } from 'node:fs';
import {
	Connection, PublicKey, Keypair, TransactionMessage, VersionedTransaction,
	ComputeBudgetProgram,
} from '@solana/web3.js';
import {
	getAssociatedTokenAddressSync, createTransferCheckedInstruction,
	createAssociatedTokenAccountIdempotentInstruction,
	TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID, getMint,
} from '@solana/spl-token';
import bs58 from 'bs58';

import { cors, json, readJson, wrap } from './_lib/http.js';
import { limits, clientIp } from './_lib/rate-limit.js';

const ALLOWED_TOOLS = new Set([
	'tools/list',
	'validate_model',
	'inspect_model',
	'optimize_model',
	'search_public_avatars',
]);

const MCP_URL = process.env.X402_PAY_TARGET_URL || 'https://three.ws/api/mcp';
const SOLANA_RPC = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';

let _agent = null;
function loadAgentKeypair() {
	if (_agent) return _agent;
	const b58 = process.env.X402_AGENT_SOLANA_SECRET_BASE58;
	if (b58) {
		_agent = Keypair.fromSecretKey(bs58.decode(b58));
		return _agent;
	}
	try {
		const path = '/home/codespace/.config/x402-test-wallets/solana.json';
		const arr = JSON.parse(readFileSync(path, 'utf8'));
		_agent = Keypair.fromSecretKey(Uint8Array.from(arr));
		return _agent;
	} catch (err) {
		const e = new Error('agent wallet not configured (set X402_AGENT_SOLANA_SECRET_BASE58)');
		e.status = 500;
		throw e;
	}
}

function buildJsonRpc(tool, args) {
	if (tool === 'tools/list') {
		return { jsonrpc: '2.0', id: 1, method: 'tools/list' };
	}
	return {
		jsonrpc: '2.0',
		id: 1,
		method: 'tools/call',
		params: { name: tool, arguments: args || {} },
	};
}

async function buildSolanaPaymentPayload({ accept, buyer, conn }) {
	const mint = new PublicKey(accept.asset);
	const payTo = new PublicKey(accept.payTo);
	const feePayer = new PublicKey(accept.extra.feePayer);
	const amount = BigInt(accept.amount);

	const senderAta = getAssociatedTokenAddressSync(
		mint, buyer.publicKey, false, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID,
	);
	const receiverAta = getAssociatedTokenAddressSync(
		mint, payTo, false, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID,
	);

	const mintInfo = await getMint(conn, mint);

	const ixs = [
		ComputeBudgetProgram.setComputeUnitLimit({ units: 60_000 }),
		ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1 }),
	];
	const receiverInfo = await conn.getAccountInfo(receiverAta);
	if (!receiverInfo) {
		ixs.push(createAssociatedTokenAccountIdempotentInstruction(
			feePayer, receiverAta, payTo, mint,
			TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID,
		));
	}
	ixs.push(createTransferCheckedInstruction(
		senderAta, mint, receiverAta, buyer.publicKey,
		amount, mintInfo.decimals, [], TOKEN_PROGRAM_ID,
	));

	const { blockhash } = await conn.getLatestBlockhash('confirmed');
	const message = new TransactionMessage({
		payerKey: feePayer,
		recentBlockhash: blockhash,
		instructions: ixs,
	}).compileToV0Message();
	const vtx = new VersionedTransaction(message);
	vtx.sign([buyer]);

	const txBase64 = Buffer.from(vtx.serialize()).toString('base64');
	return {
		x402Version: 2,
		scheme: 'exact',
		network: accept.network,
		resource: { url: MCP_URL, mimeType: 'application/json' },
		accepted: accept,
		payload: { transaction: txBase64 },
	};
}

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'POST,OPTIONS', origins: '*' })) return;
	if (req.method !== 'POST') return json(res, 405, { error: 'method_not_allowed' });

	const ip = clientIp(req);
	const ipRl = await limits.x402PayIp(ip);
	if (!ipRl.success) {
		return json(res, 429, {
			error: 'rate_limited',
			retry_after: Math.ceil((ipRl.reset - Date.now()) / 1000),
		});
	}
	const globalRl = await limits.x402PayGlobal();
	if (!globalRl.success) {
		return json(res, 429, {
			error: 'rate_limited_global',
			retry_after: Math.ceil((globalRl.reset - Date.now()) / 1000),
		});
	}

	const input = await readJson(req, 50_000);
	const tool = String(input.tool || '');
	const args = input.args && typeof input.args === 'object' ? input.args : {};
	if (!ALLOWED_TOOLS.has(tool)) {
		return json(res, 400, { error: 'invalid_tool', allowed: [...ALLOWED_TOOLS] });
	}

	const buyer = loadAgentKeypair();
	const conn = new Connection(SOLANA_RPC, 'confirmed');

	const t0 = Date.now();
	const initRes = await fetch(MCP_URL, {
		method: 'POST',
		headers: { 'content-type': 'application/json', accept: 'application/json' },
		body: JSON.stringify(buildJsonRpc(tool, args)),
	});
	const tInit = Date.now();
	if (initRes.status !== 402) {
		const body = await initRes.text();
		return json(res, 502, {
			error: 'unexpected_initial_response',
			status: initRes.status,
			body: body.slice(0, 1000),
		});
	}
	const initBody = await initRes.json();
	const accept = (initBody.accepts || []).find((a) => a.network && a.network.startsWith('solana:'));
	if (!accept) {
		return json(res, 502, { error: 'no_solana_accept_in_402' });
	}

	const paymentPayload = await buildSolanaPaymentPayload({ accept, buyer, conn });
	const tBuilt = Date.now();
	const xPayment = Buffer.from(JSON.stringify(paymentPayload)).toString('base64');

	const paidRes = await fetch(MCP_URL, {
		method: 'POST',
		headers: {
			'content-type': 'application/json',
			accept: 'application/json',
			'x-payment': xPayment,
		},
		body: JSON.stringify(buildJsonRpc(tool, args)),
	});
	const tPaid = Date.now();
	const settleHeader = paidRes.headers.get('x-payment-response');
	let settle = null;
	if (settleHeader) {
		try {
			settle = JSON.parse(Buffer.from(settleHeader, 'base64').toString('utf8'));
		} catch {}
	}
	const text = await paidRes.text();
	let parsed;
	try { parsed = JSON.parse(text); } catch { parsed = { raw: text }; }

	if (!paidRes.ok) {
		return json(res, paidRes.status, {
			ok: false,
			error: parsed.error || 'paid_call_failed',
			body: parsed,
			payment: { network: accept.network, payer: buyer.publicKey.toBase58(), amount: accept.amount, asset: accept.asset },
		});
	}

	return json(res, 200, {
		ok: true,
		tool,
		args,
		result: parsed.result ?? parsed,
		payment: {
			network: accept.network,
			payer: buyer.publicKey.toBase58(),
			payTo: accept.payTo,
			asset: accept.asset,
			amount: accept.amount,
			tx: settle?.transaction || null,
			explorer: settle?.transaction
				? `https://solscan.io/tx/${settle.transaction}`
				: null,
		},
		durations: {
			challenge_ms: tInit - t0,
			build_ms: tBuilt - tInit,
			settle_ms: tPaid - tBuilt,
			total_ms: tPaid - t0,
		},
	});
});
