// GET /api/cron/run-dca
// Hourly cron: executes pending DCA strategies via Uniswap V3 SwapRouter.
// Scheduled in vercel.json: "0 * * * *"

import { createPublicClient, http, encodeFunctionData, parseAbi } from 'viem';
import { baseSepolia, base } from 'viem/chains';

import { sql } from '../_lib/db.js';
import { env } from '../_lib/env.js';
import { json, error, wrap } from '../_lib/http.js';

// ── Chain config ──────────────────────────────────────────────────────────────

const CHAIN_CONFIG = {
	84532: {
		chain: baseSepolia,
		swap_router: '0x94cC0AaC535CCDB3C01d6787D6413C739ae12bc4',
		quoter_v2: '0xC5290058841028F1614F3A6F0F5816cAd0df5E27',
	},
	8453: {
		chain: base,
		swap_router: '0x2626664c2603336E57B271c5C0b26F421741e481',
		quoter_v2: '0x3d4e44Eb1374240CE5F1B871ab261CD16335B76a',
	},
};

// ── ABIs (minimal) ────────────────────────────────────────────────────────────

const QUOTER_V2_ABI = parseAbi([
	'function quoteExactInputSingle((address tokenIn, address tokenOut, uint256 amountIn, uint24 fee, uint160 sqrtPriceLimitX96) params) external returns (uint256 amountOut, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)',
]);

const SWAP_ROUTER_ABI = parseAbi([
	'function exactInputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96) params) external payable returns (uint256 amountOut)',
]);

const ERC20_ABI = parseAbi([
	'function approve(address spender, uint256 amount) external returns (bool)',
]);

// Uniswap V3 standard fee tier — 0.3% pool is the most liquid USDC/WETH tier
const FEE_TIER = 3000;

// ── RPC client factory ────────────────────────────────────────────────────────

function getViemClient(chainId) {
	const cfg = CHAIN_CONFIG[chainId];
	if (!cfg) throw new Error(`Unsupported chainId: ${chainId}`);
	const rpcUrl = env.getRpcUrl(chainId);
	return createPublicClient({
		chain: cfg.chain,
		transport: rpcUrl ? http(rpcUrl) : http(),
	});
}

// ── Quote with divergence check ───────────────────────────────────────────────

/**
 * Fetch a quote twice 15s apart; abort if they diverge by more than 0.5%.
 * Returns { amountOut, divergenceBps } or throws if divergence exceeds limit.
 */
async function getVerifiedQuote(client, quoterAddress, tokenIn, tokenOut, amountIn) {
	const params = {
		tokenIn,
		tokenOut,
		amountIn: BigInt(amountIn),
		fee: FEE_TIER,
		sqrtPriceLimitX96: 0n,
	};

	// First quote
	const [q1] = await client.readContract({
		address: quoterAddress,
		abi: QUOTER_V2_ABI,
		functionName: 'quoteExactInputSingle',
		args: [params],
	});

	// Wait 15s then quote again
	await new Promise((r) => setTimeout(r, 15_000));

	const [q2] = await client.readContract({
		address: quoterAddress,
		abi: QUOTER_V2_ABI,
		functionName: 'quoteExactInputSingle',
		args: [params],
	});

	// Divergence in basis points: |q2-q1| / q1 * 10000
	const divergenceBps =
		q1 === 0n ? 0 : Number(((q2 > q1 ? q2 - q1 : q1 - q2) * 10000n) / q1);

	if (divergenceBps > 50) {
		throw Object.assign(
			new Error(`Quote divergence ${divergenceBps}bps exceeds 50bps limit — aborting`),
			{ code: 'quote_divergence', divergenceBps },
		);
	}

	// Use the more conservative (lower) of the two quotes
	const amountOut = q1 < q2 ? q1 : q2;
	return { amountOut, divergenceBps };
}

// ── Calldata builders ─────────────────────────────────────────────────────────

function buildApproveCalldata(spender, amount) {
	return encodeFunctionData({
		abi: ERC20_ABI,
		functionName: 'approve',
		args: [spender, BigInt(amount)],
	});
}

function buildSwapCalldata(tokenIn, tokenOut, recipient, amountIn, amountOutMinimum) {
	return encodeFunctionData({
		abi: SWAP_ROUTER_ABI,
		functionName: 'exactInputSingle',
		args: [
			{
				tokenIn,
				tokenOut,
				fee: FEE_TIER,
				recipient,
				amountIn: BigInt(amountIn),
				amountOutMinimum: BigInt(amountOutMinimum),
				sqrtPriceLimitX96: 0n,
			},
		],
	});
}

// ── Relayer redemption ────────────────────────────────────────────────────────

async function redeemViaRelayer(delegationId, calls) {
	const relayerUrl = `${env.APP_ORIGIN}/api/permissions/redeem`;
	const res = await fetch(relayerUrl, {
		method: 'POST',
		headers: {
			'content-type': 'application/json',
			// Cron uses the shared relayer bearer token set in env
			authorization: `Bearer ${env.CRON_SECRET}`,
		},
		body: JSON.stringify({ id: delegationId, calls }),
	});

	if (!res.ok) {
		const body = await res.json().catch(() => ({ message: res.statusText }));
		throw Object.assign(
			new Error(body.error_description || body.message || `Relayer ${res.status}`),
			{ code: body.error || 'relayer_error', status: res.status },
		);
	}
	return res.json();
}

// ── onPeriod — process one strategy ──────────────────────────────────────────

async function onPeriod(strategy) {
	const {
		id: strategyId,
		delegation_id: delegationId,
		chain_id: chainId,
		token_in: tokenIn,
		token_out: tokenOut,
		amount_per_execution: amountIn,
		slippage_bps: slippageBps,
	} = strategy;

	const cfg = CHAIN_CONFIG[chainId];
	if (!cfg) throw Object.assign(new Error(`No config for chainId ${chainId}`), { code: 'unsupported_chain' });

	const client = getViemClient(chainId);

	// Get verified quote
	const { amountOut, divergenceBps } = await getVerifiedQuote(
		client,
		cfg.quoter_v2,
		tokenIn,
		tokenOut,
		amountIn,
	);

	// Apply slippage: amountOutMinimum = amountOut * (10000 - slippageBps) / 10000
	const amountOutMinimum = (amountOut * BigInt(10000 - slippageBps)) / 10000n;

	// Resolve recipient — use the delegator address from the delegation row
	const [delegationRow] = await sql`
		SELECT delegator_address FROM agent_delegations
		WHERE id = ${delegationId} AND status = 'active'
		LIMIT 1
	`;
	if (!delegationRow) {
		throw Object.assign(new Error('Delegation not found or no longer active'), { code: 'delegation_gone' });
	}
	const recipient = delegationRow.delegator_address;

	// Build calls: [approve USDC → SwapRouter, exactInputSingle]
	const calls = [
		{
			to: tokenIn,
			value: '0',
			data: buildApproveCalldata(cfg.swap_router, amountIn),
		},
		{
			to: cfg.swap_router,
			value: '0',
			data: buildSwapCalldata(tokenIn, tokenOut, recipient, amountIn, amountOutMinimum),
		},
	];

	// Submit via relayer
	const result = await redeemViaRelayer(delegationId, calls);

	return { txHash: result.txHash, quoteAmountOut: amountOut.toString(), divergenceBps };
}

// ── Cron handler ──────────────────────────────────────────────────────────────

export default wrap(async (req, res) => {
	// Vercel cron passes Authorization: Bearer $CRON_SECRET
	const cronSecret = env.CRON_SECRET;
	if (cronSecret) {
		const auth = req.headers.authorization || '';
		if (auth !== `Bearer ${cronSecret}`) {
			return error(res, 401, 'unauthorized', 'invalid cron secret');
		}
	}

	// Fetch all due active strategies
	const strategies = await sql`
		SELECT
			s.id, s.delegation_id, s.chain_id,
			s.token_in, s.token_out, s.amount_per_execution,
			s.period_seconds, s.slippage_bps, s.agent_id,
			ad.status AS delegation_status, ad.expires_at AS delegation_expires_at
		FROM dca_strategies s
		JOIN agent_delegations ad ON ad.id = s.delegation_id
		WHERE s.status = 'active'
		  AND s.next_execution_at <= NOW()
		ORDER BY s.next_execution_at ASC
		LIMIT 50
	`;

	const results = [];
	for (const strategy of strategies) {
		const execRow = {
			strategy_id: strategy.id,
			chain_id: strategy.chain_id,
			amount_in: strategy.amount_per_execution,
			slippage_bps_used: strategy.slippage_bps,
			status: 'pending',
		};

		// Check delegation is still alive before spending gas on a quote
		if (strategy.delegation_status !== 'active') {
			await sql`
				UPDATE dca_strategies SET status = 'paused' WHERE id = ${strategy.id}
			`;
			execRow.status = 'aborted';
			execRow.error = `Delegation ${strategy.delegation_status}`;
			await sql`INSERT INTO dca_executions ${sql(execRow)}`;
			results.push({ id: strategy.id, skipped: true, reason: execRow.error });
			continue;
		}

		if (new Date(strategy.delegation_expires_at) <= new Date()) {
			await sql`
				UPDATE dca_strategies SET status = 'expired' WHERE id = ${strategy.id}
			`;
			execRow.status = 'aborted';
			execRow.error = 'Delegation expired';
			await sql`INSERT INTO dca_executions ${sql(execRow)}`;
			results.push({ id: strategy.id, skipped: true, reason: execRow.error });
			continue;
		}

		try {
			const { txHash, quoteAmountOut, divergenceBps } = await onPeriod(strategy);

			execRow.tx_hash = txHash;
			execRow.quote_amount_out = quoteAmountOut;
			execRow.quote_divergence_bps = divergenceBps;
			execRow.status = 'success';

			const nextExecAt = new Date(
				Date.now() + strategy.period_seconds * 1000,
			).toISOString();

			await sql`
				UPDATE dca_strategies
				SET last_execution_at = NOW(), next_execution_at = ${nextExecAt}
				WHERE id = ${strategy.id}
			`;

			results.push({ id: strategy.id, txHash, quoteAmountOut });
		} catch (err) {
			execRow.status = err.code === 'quote_divergence' ? 'aborted' : 'failed';
			execRow.error = err.message;
			execRow.quote_divergence_bps = err.divergenceBps ?? null;

			console.error('[cron/run-dca] strategy', strategy.id, err.code, err.message);
			results.push({ id: strategy.id, error: err.message, code: err.code });
		}

		// Insert execution record regardless of outcome
		await sql`INSERT INTO dca_executions ${sql(execRow)}`.catch((e) =>
			console.error('[cron/run-dca] failed to insert execution row', e.message),
		);
	}

	return json(res, 200, {
		ok: true,
		processed: strategies.length,
		results,
	});
});
