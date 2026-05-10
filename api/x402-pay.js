// POST /api/x402-pay
//
// Server-side x402 payer for the /pay demo. Streams the payment lifecycle
// (challenge → build → verify → settle → result) as Server-Sent Events when
// the client requests `accept: text/event-stream`; otherwise returns a single
// JSON envelope on completion.
//
// In-process: this handler skips the HTTP round-trip to /api/mcp by
// replicating the same flow internally — paymentRequirements() + verifyPayment +
// dispatch() + settlePayment(). Saves ~50–200ms vs an external fetch and
// removes a self-egress hop.
//
// Env (required for prod):
//   X402_AGENT_SOLANA_SECRET_BASE58  base58-encoded 64-byte ed25519 secret
// Local dev fallback (when env unset): reads keypair JSON at
//   /home/codespace/.config/x402-test-wallets/solana.json
//
// Also: GET /api/x402-pay?balance=1 → returns the agent wallet's USDC + SOL
// balance so the UI can show it ticking down during the demo.

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
import {
	paymentRequirements,
	verifyPayment,
	settlePayment,
	NETWORK_SOLANA_MAINNET,
} from './_lib/x402-spec.js';
import { dispatch } from './_mcp/dispatch.js';

const ALLOWED_TOOLS = new Set([
	'tools/list',
	'validate_model',
	'inspect_model',
	'optimize_model',
	'search_public_avatars',
]);

const SOLANA_RPC = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
const USDC_MAINNET_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

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
	} catch {
		const e = new Error('agent wallet not configured (set X402_AGENT_SOLANA_SECRET_BASE58)');
		e.status = 500;
		throw e;
	}
}

function buildJsonRpc(tool, args) {
	if (tool === 'tools/list') return { jsonrpc: '2.0', id: 1, method: 'tools/list' };
	return {
		jsonrpc: '2.0',
		id: 1,
		method: 'tools/call',
		params: { name: tool, arguments: args || {} },
	};
}

async function buildSolanaPaymentPayload({ accept, buyer, conn, resourceUrl }) {
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
		resource: { url: resourceUrl, mimeType: 'application/json' },
		accepted: accept,
		payload: { transaction: txBase64 },
	};
}

async function getAgentBalance() {
	const buyer = loadAgentKeypair();
	const conn = new Connection(SOLANA_RPC, 'confirmed');
	const sol = await conn.getBalance(buyer.publicKey);
	let usdc = 0;
	try {
		const ata = getAssociatedTokenAddressSync(
			new PublicKey(USDC_MAINNET_MINT),
			buyer.publicKey, false, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID,
		);
		const acct = await conn.getTokenAccountBalance(ata);
		usdc = Number(acct.value.uiAmount || 0);
	} catch {}
	return {
		address: buyer.publicKey.toBase58(),
		sol: sol / 1e9,
		usdc,
	};
}

function sseInit(res) {
	res.statusCode = 200;
	res.setHeader('content-type', 'text/event-stream; charset=utf-8');
	res.setHeader('cache-control', 'no-cache, no-transform');
	res.setHeader('connection', 'keep-alive');
	res.setHeader('x-accel-buffering', 'no');
	if (typeof res.flushHeaders === 'function') res.flushHeaders();
}

function sseSend(res, event, data) {
	res.write(`event: ${event}\n`);
	res.write(`data: ${JSON.stringify(data)}\n\n`);
}

async function runFlow({ tool, args, emit }) {
	const buyer = loadAgentKeypair();
	const conn = new Connection(SOLANA_RPC, 'confirmed');

	const requirements = paymentRequirements();
	const accept = requirements.find((r) => r.network === NETWORK_SOLANA_MAINNET);
	if (!accept) throw Object.assign(new Error('no_solana_accept_configured'), { status: 500 });

	const t0 = Date.now();
	emit('challenge', { network: accept.network, amount: accept.amount, payTo: accept.payTo });

	const paymentPayload = await buildSolanaPaymentPayload({
		accept, buyer, conn, resourceUrl: 'https://three.ws/api/mcp',
	});
	const tBuilt = Date.now();
	emit('built', { build_ms: tBuilt - t0, network: accept.network });

	const paymentHeader = Buffer.from(JSON.stringify(paymentPayload)).toString('base64');
	const verified = await verifyPayment({ paymentHeader, requirements });
	const tVerified = Date.now();
	emit('verified', { verify_ms: tVerified - tBuilt, payer: verified.payer });

	const auth = {
		userId: null,
		rateKey: `x402:${verified.payer || 'anon'}`,
		scope: '',
		source: 'x402',
		payer: verified.payer,
	};
	const rpcResp = await dispatch(buildJsonRpc(tool, args), auth, null);
	const tDispatched = Date.now();
	emit('dispatched', { dispatch_ms: tDispatched - tVerified });

	if (rpcResp?.error) {
		throw Object.assign(
			new Error(rpcResp.error.message || 'mcp_dispatch_error'),
			{ status: 502, mcpError: rpcResp.error },
		);
	}

	const settled = await settlePayment({
		paymentPayload: verified.paymentPayload,
		requirement: verified.requirement,
	});
	const tSettled = Date.now();
	emit('settled', {
		settle_ms: tSettled - tDispatched,
		tx: settled.transaction,
		network: settled.network,
		payer: settled.payer,
		explorer: settled.transaction ? `https://solscan.io/tx/${settled.transaction}` : null,
	});

	const total_ms = tSettled - t0;
	emit('result', {
		ok: true,
		tool, args,
		result: rpcResp?.result ?? rpcResp,
		payment: {
			network: accept.network,
			payer: verified.payer || buyer.publicKey.toBase58(),
			payTo: accept.payTo,
			asset: accept.asset,
			amount: accept.amount,
			tx: settled.transaction || null,
			explorer: settled.transaction ? `https://solscan.io/tx/${settled.transaction}` : null,
		},
		durations: {
			build_ms: tBuilt - t0,
			verify_ms: tVerified - tBuilt,
			dispatch_ms: tDispatched - tVerified,
			settle_ms: tSettled - tDispatched,
			total_ms,
		},
	});
}

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,POST,OPTIONS', origins: '*' })) return;

	if (req.method === 'GET') {
		const u = new URL(req.url, 'http://x');
		if (u.searchParams.get('balance') === '1') {
			try {
				const b = await getAgentBalance();
				return json(res, 200, b);
			} catch (err) {
				return json(res, err.status || 500, { error: err.message });
			}
		}
		return json(res, 404, { error: 'not_found' });
	}
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

	const wantsStream =
		(req.headers.accept || '').includes('text/event-stream') ||
		input.stream === true;

	if (wantsStream) {
		sseInit(res);
		const emit = (ev, data) => sseSend(res, ev, data);
		try {
			await runFlow({ tool, args, emit });
		} catch (err) {
			emit('error', {
				ok: false,
				error: err.message || 'flow_failed',
				mcpError: err.mcpError || null,
			});
		} finally {
			res.end();
		}
		return;
	}

	// Non-streaming JSON path: collect events into a final envelope.
	let final = null;
	let errEnv = null;
	const emit = (ev, data) => {
		if (ev === 'result') final = data;
		else if (ev === 'error') errEnv = data;
	};
	try {
		await runFlow({ tool, args, emit });
	} catch (err) {
		errEnv = { ok: false, error: err.message || 'flow_failed', mcpError: err.mcpError || null };
	}
	if (errEnv) return json(res, errEnv.mcpError ? 502 : 500, errEnv);
	return json(res, 200, final);
});
