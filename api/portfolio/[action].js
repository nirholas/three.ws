// Portfolio dispatcher for the user's agent custodial wallets.
//
//   GET  /api/portfolio/summary?snapshot=1   → live aggregated balances; opt. snapshot
//   GET  /api/portfolio/history?days=30      → past snapshots for the chart
//   POST /api/portfolio/send                 → server-signed transfer from an agent wallet
//
// All endpoints require a session cookie and operate only on agents owned by
// the caller (agent_identities.user_id = session.user_id). Balances are
// memoized for 60s in-process to shield Helius/Alchemy/CoinGecko from
// per-page-load fan-out.

import { cors, json, method, readJson, wrap, error, validationError } from '../_lib/http.js';
import { limits, clientIp } from '../_lib/rate-limit.js';
import { getSessionUser, isSameSiteOrigin } from '../_lib/auth.js';
import { requireCsrf } from '../_lib/csrf.js';
import { logAudit } from '../_lib/audit.js';
import { sql } from '../_lib/db.js';
import { getBalances, walletUsdTotal, invalidateBalances } from '../_lib/balances.js';
import { recoverAgentKey, recoverSolanaAgentKeypair } from '../_lib/agent-wallet.js';
import { env } from '../_lib/env.js';
import { z } from 'zod';

const ETH_ADDR_RE = /^0x[a-fA-F0-9]{40}$/;
const SOL_ADDR_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

function parse(schema, raw) {
	const r = schema.safeParse(raw);
	if (!r.success) {
		const err = new Error(r.error.issues[0]?.message || 'invalid input');
		err.status = 400;
		err.code = 'validation_error';
		err.issues = r.error.issues;
		throw err;
	}
	return r.data;
}

async function listUserAgentWallets(userId) {
	const rows = await sql`
		select id, name, wallet_address, chain_id, meta
		  from agent_identities
		 where user_id = ${userId} and deleted_at is null
		 order by created_at asc
	`;
	const wallets = [];
	for (const row of rows) {
		const meta = row.meta || {};
		if (row.wallet_address) {
			wallets.push({
				agent_id: row.id,
				agent_name: row.name || 'Agent',
				kind: 'evm',
				chain: 'evm',
				chain_id: row.chain_id || 8453,
				address: row.wallet_address,
			});
		}
		const solAddr = meta.solana_address;
		if (solAddr) {
			wallets.push({
				agent_id: row.id,
				agent_name: row.name || 'Agent',
				kind: 'solana',
				chain: 'solana',
				address: solAddr,
			});
		}
	}
	return wallets;
}

// ── GET /api/portfolio/summary ─────────────────────────────────────────────

async function handleSummary(req, res) {
	if (cors(req, res, { methods: 'GET,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['GET'])) return;

	const user = await getSessionUser(req, res);
	if (!user) return error(res, 401, 'unauthorized', 'sign in required');

	const rl = await limits.walletRead(user.id);
	if (!rl.success) return error(res, 429, 'rate_limited', 'too many requests');

	const url = new URL(req.url, 'http://localhost');
	const wantSnapshot = url.searchParams.get('snapshot') === '1';

	const wallets = await listUserAgentWallets(user.id);

	const results = await Promise.allSettled(
		wallets.map((w) => getBalances({ chain: w.chain, address: w.address })),
	);

	const byWallet = wallets.map((w, i) => {
		const r = results[i];
		if (r.status === 'fulfilled') {
			const bal = r.value;
			return {
				agent_id: w.agent_id,
				agent_name: w.agent_name,
				chain: w.chain,
				chain_id: w.chain_id,
				address: w.address,
				native: bal.native,
				tokens: bal.tokens,
				usd: walletUsdTotal(bal),
				ok: true,
			};
		}
		const err = r.reason;
		return {
			agent_id: w.agent_id,
			agent_name: w.agent_name,
			chain: w.chain,
			chain_id: w.chain_id,
			address: w.address,
			native: { symbol: w.chain === 'solana' ? 'SOL' : 'ETH', amount: 0, usd: 0 },
			tokens: [],
			usd: 0,
			ok: false,
			error: err?.code === 'not_configured' ? `missing env: ${err.missing}` : err?.message || 'fetch failed',
		};
	});

	const totalUsd = byWallet.reduce((s, w) => s + (w.usd || 0), 0);

	if (wantSnapshot) {
		const breakdown = byWallet.map((w) => ({
			agent_id: w.agent_id,
			chain: w.chain,
			address: w.address,
			usd: w.usd,
		}));
		try {
			await sql`
				insert into portfolio_snapshots (user_id, total_usd, breakdown)
				values (${user.id}, ${totalUsd}, ${JSON.stringify(breakdown)}::jsonb)
			`;
		} catch (e) {
			console.error('[portfolio] snapshot insert failed', e?.message);
		}
	}

	return json(res, 200, {
		captured_at: new Date().toISOString(),
		total_usd: totalUsd,
		wallets: byWallet,
	});
}

// ── GET /api/portfolio/history ─────────────────────────────────────────────

async function handleHistory(req, res) {
	if (cors(req, res, { methods: 'GET,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['GET'])) return;

	const user = await getSessionUser(req, res);
	if (!user) return error(res, 401, 'unauthorized', 'sign in required');

	const rl = await limits.walletRead(user.id);
	if (!rl.success) return error(res, 429, 'rate_limited', 'too many requests');

	const url = new URL(req.url, 'http://localhost');
	const days = Math.min(365, Math.max(1, parseInt(url.searchParams.get('days') || '90', 10)));

	const rows = await sql`
		select captured_at, total_usd
		  from portfolio_snapshots
		 where user_id = ${user.id}
		   and captured_at > now() - (${days} || ' days')::interval
		 order by captured_at asc
	`;

	return json(res, 200, {
		days,
		points: rows.map((r) => ({
			t: new Date(r.captured_at).toISOString(),
			usd: Number(r.total_usd),
		})),
	});
}

// ── POST /api/portfolio/send ───────────────────────────────────────────────

const sendSchema = z.object({
	agent_id: z.string().uuid(),
	chain: z.enum(['solana', 'evm']),
	// 'native' for SOL/ETH, otherwise a mint (Solana) or 0x contract (EVM).
	asset: z.string().min(1),
	recipient: z.string().min(1),
	// Decimal string, in human units (e.g. "1.5" SOL or "100" USDC).
	amount: z.string().regex(/^\d+(\.\d+)?$/),
	memo: z.string().max(120).optional(),
});

function parseAmountToBaseUnits(amountStr, decimals) {
	const [whole, frac = ''] = amountStr.split('.');
	const fracPadded = (frac + '0'.repeat(decimals)).slice(0, decimals);
	const combined = (whole + fracPadded).replace(/^0+/, '') || '0';
	return BigInt(combined);
}

async function loadOwnedAgent(userId, agentId) {
	const [row] = await sql`
		select id, name, wallet_address, chain_id, meta
		  from agent_identities
		 where id = ${agentId} and user_id = ${userId} and deleted_at is null
		 limit 1
	`;
	return row || null;
}

async function sendEvm({ agent, asset, recipient, amount, memo }) {
	if (!ETH_ADDR_RE.test(recipient)) {
		const e = new Error('invalid EVM recipient');
		e.code = 'validation_error';
		e.status = 400;
		throw e;
	}
	const encryptedKey = agent.meta?.encrypted_wallet_key;
	if (!encryptedKey) {
		const e = new Error('agent has no EVM key');
		e.code = 'no_key';
		e.status = 409;
		throw e;
	}
	const chainId = agent.chain_id || 8453;
	const rpcUrl = env.getRpcUrl(chainId);
	if (!rpcUrl) {
		const e = new Error(`no RPC URL for chain ${chainId}`);
		e.code = 'no_rpc';
		e.status = 503;
		throw e;
	}

	const pkHex = await recoverAgentKey(encryptedKey);
	const { JsonRpcProvider, Wallet, parseEther, Contract } = await import('ethers');
	const provider = new JsonRpcProvider(rpcUrl);
	const signer = new Wallet(pkHex, provider);

	if (asset === 'native') {
		const value = parseEther(amount);
		const tx = await signer.sendTransaction({ to: recipient, value, data: memo ? '0x' + Buffer.from(memo, 'utf8').toString('hex') : undefined });
		return { tx_hash: tx.hash, chain_id: chainId };
	}

	if (!ETH_ADDR_RE.test(asset)) {
		const e = new Error('asset must be 0x contract or "native"');
		e.code = 'validation_error';
		e.status = 400;
		throw e;
	}
	const ERC20 = ['function decimals() view returns (uint8)', 'function transfer(address,uint256) returns (bool)'];
	const token = new Contract(asset, ERC20, signer);
	const decimals = Number(await token.decimals());
	const amountUnits = parseAmountToBaseUnits(amount, decimals);
	const tx = await token.transfer(recipient, amountUnits);
	return { tx_hash: tx.hash, chain_id: chainId };
}

async function sendSolana({ agent, asset, recipient, amount, userId }) {
	if (!SOL_ADDR_RE.test(recipient)) {
		const e = new Error('invalid Solana recipient');
		e.code = 'validation_error';
		e.status = 400;
		throw e;
	}
	const encryptedSecret = agent.meta?.encrypted_solana_secret;
	if (!encryptedSecret) {
		const e = new Error('agent has no Solana key');
		e.code = 'no_key';
		e.status = 409;
		throw e;
	}

	const { Connection, PublicKey, Transaction, SystemProgram, LAMPORTS_PER_SOL } = await import('@solana/web3.js');
	const rpcUrl = process.env.HELIUS_API_KEY
		? `https://mainnet.helius-rpc.com/?api-key=${process.env.HELIUS_API_KEY}`
		: 'https://api.mainnet-beta.solana.com';
	const conn = new Connection(rpcUrl, 'confirmed');

	const kp = await recoverSolanaAgentKeypair(encryptedSecret, {
		userId,
		agentId: agent.id,
		reason: 'portfolio_send',
	});

	const recipientPk = new PublicKey(recipient);
	const tx = new Transaction();

	if (asset === 'native') {
		const lamports = BigInt(Math.round(Number(amount) * LAMPORTS_PER_SOL));
		tx.add(SystemProgram.transfer({ fromPubkey: kp.publicKey, toPubkey: recipientPk, lamports }));
	} else {
		if (!SOL_ADDR_RE.test(asset)) {
			const e = new Error('asset must be SPL mint or "native"');
			e.code = 'validation_error';
			e.status = 400;
			throw e;
		}
		const { getAssociatedTokenAddress, createAssociatedTokenAccountInstruction, createTransferInstruction } = await import('@solana/spl-token');
		const mintPk = new PublicKey(asset);

		const mintInfo = await conn.getParsedAccountInfo(mintPk);
		const decimals = mintInfo.value?.data?.parsed?.info?.decimals ?? 6;

		const senderAta = await getAssociatedTokenAddress(mintPk, kp.publicKey);
		const recipientAta = await getAssociatedTokenAddress(mintPk, recipientPk);
		const recipientAccount = await conn.getAccountInfo(recipientAta);
		if (!recipientAccount) {
			tx.add(createAssociatedTokenAccountInstruction(kp.publicKey, recipientAta, recipientPk, mintPk));
		}
		const amountUnits = parseAmountToBaseUnits(amount, decimals);
		tx.add(createTransferInstruction(senderAta, recipientAta, kp.publicKey, amountUnits));
	}

	const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash();
	tx.feePayer = kp.publicKey;
	tx.recentBlockhash = blockhash;
	tx.sign(kp);

	const sig = await conn.sendRawTransaction(tx.serialize(), { skipPreflight: false });
	await conn.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, 'confirmed');
	return { tx_hash: sig };
}

async function handleSend(req, res) {
	if (cors(req, res, { methods: 'POST,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['POST'])) return;

	const user = await getSessionUser(req, res);
	if (!user) return error(res, 401, 'unauthorized', 'sign in required');

	if (!isSameSiteOrigin(req)) {
		return error(res, 403, 'forbidden', 'cross-site request denied');
	}
	if (!(await requireCsrf(req, res, user.id))) return;

	const rl = await limits.strict(`portfolio:send:${user.id}`);
	if (!rl.success) return error(res, 429, 'rate_limited', 'too many sends');

	let body;
	try {
		body = parse(sendSchema, await readJson(req));
	} catch (e) {
		return validationError(res, e);
	}

	const agent = await loadOwnedAgent(user.id, body.agent_id);
	if (!agent) return error(res, 404, 'not_found', 'agent not found');

	try {
		const out =
			body.chain === 'solana'
				? await sendSolana({ agent, asset: body.asset, recipient: body.recipient, amount: body.amount, userId: user.id })
				: await sendEvm({ agent, asset: body.asset, recipient: body.recipient, amount: body.amount, memo: body.memo });

		logAudit({
			userId: user.id,
			action: 'portfolio_send',
			resourceId: agent.id,
			meta: {
				chain: body.chain,
				asset: body.asset,
				recipient: body.recipient,
				amount: body.amount,
				tx_hash: out.tx_hash,
			},
		});

		// Invalidate cache so the next /summary reflects the new balance.
		const addr = body.chain === 'solana' ? agent.meta?.solana_address : agent.wallet_address;
		if (addr) invalidateBalances({ chain: body.chain, address: addr });

		return json(res, 200, { ok: true, ...out });
	} catch (e) {
		if (e.code === 'validation_error') return error(res, 400, 'validation_error', e.message);
		if (e.code === 'no_key') return error(res, 409, 'no_key', e.message);
		if (e.code === 'no_rpc') return error(res, 503, 'no_rpc', e.message);
		console.error('[portfolio/send] failed', e?.message);
		return error(res, 502, 'send_failed', e?.message || 'transaction failed');
	}
}

// ── Dispatcher ─────────────────────────────────────────────────────────────

export default wrap(async (req, res) => {
	const action = String(req.query?.action || '').toLowerCase();
	switch (action) {
		case 'summary':
			return handleSummary(req, res);
		case 'history':
			return handleHistory(req, res);
		case 'send':
			return handleSend(req, res);
		default:
			return error(res, 404, 'not_found', `unknown action: ${action}`);
	}
});
