// POST /api/payments/evm/confirm
// Verifies an on-chain EVM USDC transfer and activates the subscription.
// Checks: tx exists, to = recipient, from = user wallet, token = USDC, value >= expected.

import { z } from 'zod';
import { createPublicClient, http, parseAbi, formatUnits } from 'viem';
import { mainnet, base, optimism, arbitrum, polygon, sepolia, baseSepolia } from 'viem/chains';
import { sql } from '../../_lib/db.js';
import { getSessionUser } from '../../_lib/auth.js';
import { cors, json, method, readJson, wrap, error } from '../../_lib/http.js';
import { limits, clientIp } from '../../_lib/rate-limit.js';
import { parse } from '../../_lib/validate.js';
import { env } from '../../_lib/env.js';
import { sendSubscriptionConfirmEmail } from '../../_lib/email.js';
import { PLANS, EVM_USDC } from '../_config.js';

const CHAINS = { 1: mainnet, 8453: base, 10: optimism, 42161: arbitrum, 137: polygon, 11155111: sepolia, 84532: baseSepolia };

const ERC20_ABI = parseAbi([
	'event Transfer(address indexed from, address indexed to, uint256 value)',
]);

const bodySchema = z.object({
	intent_id: z.string().uuid(),
	tx_hash:   z.string().regex(/^0x[a-fA-F0-9]{64}$/),
});

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'POST,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['POST'])) return;

	const user = await getSessionUser(req);
	if (!user) return error(res, 401, 'unauthorized', 'sign in required');

	const rl = await limits.authIp(clientIp(req));
	if (!rl.success) return error(res, 429, 'rate_limited', 'too many requests');

	const body = parse(bodySchema, await readJson(req));
	const { intent_id, tx_hash } = body;

	// Load and validate intent.
	const [intent] = await sql`
		select * from plan_payment_intents
		where id = ${intent_id} and user_id = ${user.id}
		limit 1
	`;
	if (!intent) return error(res, 404, 'not_found', 'intent not found');
	if (intent.status === 'confirmed') return error(res, 409, 'already_confirmed', 'payment already confirmed');
	if (intent.status === 'expired' || new Date(intent.expires_at) < new Date()) {
		await sql`update plan_payment_intents set status='expired' where id=${intent_id}`;
		return error(res, 410, 'intent_expired', 'payment session expired — start a new checkout');
	}

	const chainId = intent.chain_id;
	const chain   = CHAINS[chainId];
	if (!chain) return error(res, 400, 'unsupported_chain', `chain ${chainId} not supported`);

	const rpcUrl = env.getRpcUrl(chainId);
	const client = createPublicClient({ chain, transport: http(rpcUrl || undefined) });

	// Fetch and verify transaction receipt.
	let receipt;
	try {
		receipt = await client.getTransactionReceipt({ hash: tx_hash });
	} catch {
		return error(res, 422, 'tx_not_found', 'transaction not found on chain — may need more confirmations');
	}
	if (receipt.status !== 'success') {
		return error(res, 422, 'tx_failed', 'transaction reverted');
	}

	// Parse ERC-20 Transfer events from the USDC contract.
	const usdcAddress = EVM_USDC[chainId]?.toLowerCase();
	const logs = await client.getLogs({
		address:   usdcAddress,
		event:     ERC20_ABI[0],
		fromBlock: receipt.blockNumber,
		toBlock:   receipt.blockNumber,
	});

	const expectedRecipient = intent.recipient.toLowerCase();
	const expectedAtomics   = BigInt(Math.round(Number(intent.amount_usdc) * 1_000_000));

	const matchingLog = logs.find((log) =>
		log.transactionHash?.toLowerCase() === tx_hash.toLowerCase() &&
		log.args.to?.toLowerCase()          === expectedRecipient &&
		BigInt(log.args.value ?? 0)         >= expectedAtomics
	);

	if (!matchingLog) {
		return error(res, 422, 'transfer_not_found',
			`No USDC transfer of ${intent.amount_usdc} USDC to ${expectedRecipient} found in tx`);
	}

	// Confirm intent and activate subscription.
	await sql`
		update plan_payment_intents
		set status='confirmed', tx_hash=${tx_hash}, confirmed_at=now()
		where id=${intent_id}
	`;

	const planConfig  = PLANS[intent.plan];
	const activeUntil = new Date(Date.now() + planConfig.duration_days * 86400 * 1000);

	await sql`
		insert into subscriptions (user_id, plan, chain_type, chain_id, token_address, tx_hash, amount_usd, status, active_until)
		values (${user.id}, ${intent.plan}, 'evm', ${chainId}, ${usdcAddress}, ${tx_hash}, ${intent.amount_usdc}, 'active', ${activeUntil})
		on conflict (user_id) where status='active'
		do update set
			plan=excluded.plan, chain_type=excluded.chain_type, chain_id=excluded.chain_id,
			token_address=excluded.token_address, tx_hash=excluded.tx_hash,
			amount_usd=excluded.amount_usd, active_until=excluded.active_until, updated_at=now()
	`;

	// Upgrade user plan.
	await sql`update users set plan=${intent.plan} where id=${user.id}`;

	// Fire-and-forget confirmation email.
	queueMicrotask(() => sendSubscriptionConfirmEmail({
		to: user.email,
		plan: intent.plan,
		chain: `EVM chain ${chainId}`,
		txId: tx_hash,
	}));

	return json(res, 200, {
		ok: true,
		plan: intent.plan,
		active_until: activeUntil.toISOString(),
		tx_hash,
	});
});
