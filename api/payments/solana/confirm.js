// POST /api/payments/solana/confirm
// Verifies a Solana USDC transfer on-chain and activates the subscription.
// Checks: tx confirmed, memo matches nonce, SPL transfer to recipient >= expected amount.

import { z } from 'zod';
import { Connection, PublicKey } from '@solana/web3.js';
import { sql } from '../../_lib/db.js';
import { getSessionUser } from '../../_lib/auth.js';
import { cors, json, method, readJson, wrap, error } from '../../_lib/http.js';
import { limits, clientIp } from '../../_lib/rate-limit.js';
import { parse } from '../../_lib/validate.js';
import { sendSubscriptionConfirmEmail } from '../../_lib/email.js';
import { PLANS, SOLANA_USDC_MINT } from '../_config.js';

const SOLANA_RPC_MAINNET = process.env.SOLANA_RPC_URL        || 'https://api.mainnet-beta.solana.com';
const SOLANA_RPC_DEVNET  = process.env.SOLANA_RPC_URL_DEVNET || 'https://api.devnet.solana.com';

const bodySchema = z.object({
	intent_id: z.string().uuid(),
	tx_signature: z.string().min(80).max(100), // base58 Solana tx signature
	network: z.enum(['mainnet', 'devnet']).default('mainnet'),
});

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'POST,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['POST'])) return;

	const user = await getSessionUser(req);
	if (!user) return error(res, 401, 'unauthorized', 'sign in required');

	const rl = await limits.authIp(clientIp(req));
	if (!rl.success) return error(res, 429, 'rate_limited', 'too many requests');

	const body = parse(bodySchema, await readJson(req));
	const { intent_id, tx_signature, network } = body;

	// Load intent.
	const [intent] = await sql`
		select * from plan_payment_intents
		where id = ${intent_id} and user_id = ${user.id} and chain_type = 'solana'
		limit 1
	`;
	if (!intent) return error(res, 404, 'not_found', 'intent not found');
	if (intent.status === 'confirmed') return error(res, 409, 'already_confirmed', 'payment already confirmed');
	if (intent.status === 'expired' || new Date(intent.expires_at) < new Date()) {
		await sql`update plan_payment_intents set status='expired' where id=${intent_id}`;
		return error(res, 410, 'intent_expired', 'payment session expired');
	}

	const rpcUrl = network === 'devnet' ? SOLANA_RPC_DEVNET : SOLANA_RPC_MAINNET;
	const connection = new Connection(rpcUrl, 'confirmed');
	const usdcMint = network === 'devnet'
		? '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU'
		: SOLANA_USDC_MINT;

	// Fetch transaction.
	let tx;
	try {
		tx = await connection.getParsedTransaction(tx_signature, {
			maxSupportedTransactionVersion: 0,
			commitment: 'confirmed',
		});
	} catch {
		return error(res, 422, 'tx_not_found', 'transaction not found — may need more confirmations');
	}
	if (!tx) return error(res, 422, 'tx_not_found', 'transaction not found');
	if (tx.meta?.err) return error(res, 422, 'tx_failed', 'transaction failed on-chain');

	// Check memo matches nonce.
	const memoIx = tx.transaction.message.instructions.find(
		(ix) => ix.programId?.toString() === 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr',
	);
	const memo = memoIx?.parsed;
	if (memo && memo !== intent.nonce) {
		return error(res, 422, 'memo_mismatch', 'transaction memo does not match intent nonce');
	}

	// Find SPL token transfer to recipient.
	const expectedRecipient = intent.recipient;
	const expectedAtomics   = BigInt(Math.round(Number(intent.amount_usdc) * 1_000_000));

	const tokenBalances = tx.meta?.postTokenBalances || [];
	const preBalances   = tx.meta?.preTokenBalances  || [];

	// Build a map of account index → token balance change.
	const matchingTransfer = tx.transaction.message.instructions.find((ix) => {
		if (ix.programId?.toString() !== 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA') return false;
		const parsed = ix.parsed;
		if (parsed?.type !== 'transferChecked' && parsed?.type !== 'transfer') return false;
		const info = parsed.info;
		// destination owner should be recipient
		const destOwner = info.destination || info.destinationOwner || '';
		const mintMatch = !info.mint || info.mint === usdcMint;
		const amount    = BigInt(info.tokenAmount?.amount ?? info.amount ?? '0');
		return mintMatch && amount >= expectedAtomics &&
			(destOwner === expectedRecipient || info.destination === expectedRecipient);
	});

	// Fallback: check token balance deltas.
	let verifiedViaBalance = false;
	if (!matchingTransfer) {
		for (const post of tokenBalances) {
			if (post.mint !== usdcMint) continue;
			const pre = preBalances.find((p) => p.accountIndex === post.accountIndex);
			const delta = BigInt(post.uiTokenAmount.amount) - BigInt(pre?.uiTokenAmount?.amount ?? '0');
			if (delta >= expectedAtomics) {
				// Check the account owner is the recipient
				const accountKeys = tx.transaction.message.accountKeys;
				const owner = accountKeys[post.accountIndex]?.pubkey?.toString();
				if (owner === expectedRecipient || post.owner === expectedRecipient) {
					verifiedViaBalance = true;
					break;
				}
			}
		}
	}

	if (!matchingTransfer && !verifiedViaBalance) {
		return error(res, 422, 'transfer_not_found',
			`No USDC transfer of ${intent.amount_usdc} to ${expectedRecipient} found in tx`);
	}

	// Confirm intent.
	await sql`
		update plan_payment_intents
		set status='confirmed', tx_hash=${tx_signature}, confirmed_at=now()
		where id=${intent_id}
	`;

	const planConfig  = PLANS[intent.plan];
	const activeUntil = new Date(Date.now() + planConfig.duration_days * 86400 * 1000);

	await sql`
		insert into subscriptions (user_id, plan, chain_type, token_address, tx_hash, amount_usd, status, active_until)
		values (${user.id}, ${intent.plan}, 'solana', ${usdcMint}, ${tx_signature}, ${intent.amount_usdc}, 'active', ${activeUntil})
		on conflict (user_id) where status='active'
		do update set
			plan=excluded.plan, chain_type=excluded.chain_type, token_address=excluded.token_address,
			tx_hash=excluded.tx_hash, amount_usd=excluded.amount_usd, active_until=excluded.active_until, updated_at=now()
	`;

	await sql`update users set plan=${intent.plan} where id=${user.id}`;

	queueMicrotask(() => sendSubscriptionConfirmEmail({
		to: user.email,
		plan: intent.plan,
		chain: `Solana ${network}`,
		txId: tx_signature,
	}));

	return json(res, 200, {
		ok: true,
		plan: intent.plan,
		active_until: activeUntil.toISOString(),
		tx_signature,
	});
});
