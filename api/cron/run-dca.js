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

// ── Operational tunables ──────────────────────────────────────────────────────

const RPC_TIMEOUT_MS = 10_000;
const RPC_MAX_RETRIES = 2; // total attempts = 1 + retries
const RELAYER_TIMEOUT_MS = 30_000;
const RELAYER_MAX_RETRIES = 1;
const RELAYER_RETRY_BACKOFF_MS = 1_500;

// ── Structured logging ────────────────────────────────────────────────────────

function log(level, event, fields = {}) {
	const line = JSON.stringify({
		level,
		event,
		ts: new Date().toISOString(),
		component: 'cron/run-dca',
		...fields,
	});
	if (level === 'error') console.error(line);
	else console.log(line);
}

// ── Retry helper for transient failures ───────────────────────────────────────

function isTransient(err) {
	// Network-level & RPC transport errors
	const code = err?.code;
	const name = err?.name;
	const status = err?.status;
	if (name === 'AbortError' || name === 'TimeoutError') return true;
	if (code === 'ETIMEDOUT' || code === 'ECONNRESET' || code === 'ECONNREFUSED' || code === 'ENOTFOUND' || code === 'EAI_AGAIN') return true;
	if (typeof status === 'number' && status >= 500 && status < 600) return true;
	// viem transport errors
	const msg = String(err?.message || '');
	if (/HttpRequestError|TimeoutError|fetch failed|network|socket hang up/i.test(msg)) return true;
	return false;
}

async function withRetry(fn, { retries, backoffMs = 500, label }) {
	let attempt = 0;
	// eslint-disable-next-line no-constant-condition
	while (true) {
		try {
			return await fn();
		} catch (err) {
			attempt++;
			if (attempt > retries || !isTransient(err)) throw err;
			const delay = backoffMs * 2 ** (attempt - 1);
			log('warn', 'retry', { label, attempt, delay_ms: delay, message: err?.message, code: err?.code });
			await new Promise((r) => setTimeout(r, delay));
		}
	}
}

// ── RPC client factory ────────────────────────────────────────────────────────

function getViemClient(chainId) {
	const cfg = CHAIN_CONFIG[chainId];
	if (!cfg) throw new Error(`Unsupported chainId: ${chainId}`);
	const rpcUrl = env.getRpcUrl(chainId);
	const transport = rpcUrl
		? http(rpcUrl, { timeout: RPC_TIMEOUT_MS, retryCount: 0 })
		: http(undefined, { timeout: RPC_TIMEOUT_MS, retryCount: 0 });
	return createPublicClient({ chain: cfg.chain, transport });
}

// ── Quote with divergence check ───────────────────────────────────────────────

/**
 * Fetch a quote twice 15s apart; abort if they diverge by more than 0.5%.
 * Returns { amountOut, divergenceBps } or throws if divergence exceeds limit.
 */
async function getVerifiedQuote(client, quoterAddress, tokenIn, tokenOut, amountIn, logCtx) {
	const params = {
		tokenIn,
		tokenOut,
		amountIn: BigInt(amountIn),
		fee: FEE_TIER,
		sqrtPriceLimitX96: 0n,
	};

	const readQuote = () =>
		client.readContract({
			address: quoterAddress,
			abi: QUOTER_V2_ABI,
			functionName: 'quoteExactInputSingle',
			args: [params],
		});

	// First quote (with retry on transient RPC failures)
	const [q1] = await withRetry(readQuote, {
		retries: RPC_MAX_RETRIES,
		backoffMs: 500,
		label: `quote1:${logCtx?.strategy_id ?? ''}`,
	});

	// Wait 15s then quote again
	await new Promise((r) => setTimeout(r, 15_000));

	const [q2] = await withRetry(readQuote, {
		retries: RPC_MAX_RETRIES,
		backoffMs: 500,
		label: `quote2:${logCtx?.strategy_id ?? ''}`,
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

async function redeemViaRelayer(delegationId, calls, logCtx) {
	const relayerUrl = `${env.APP_ORIGIN}/api/permissions/redeem`;

	const doFetch = async () => {
		const res = await fetch(relayerUrl, {
			method: 'POST',
			headers: {
				'content-type': 'application/json',
				authorization: `Bearer ${env.CRON_SECRET}`,
			},
			body: JSON.stringify({ id: delegationId, calls }),
			signal: AbortSignal.timeout(RELAYER_TIMEOUT_MS),
		});

		if (!res.ok) {
			const body = await res.json().catch(() => ({ message: res.statusText }));
			throw Object.assign(
				new Error(body.error_description || body.message || `Relayer ${res.status}`),
				{ code: body.error || 'relayer_error', status: res.status },
			);
		}
		return res.json();
	};

	return withRetry(doFetch, {
		retries: RELAYER_MAX_RETRIES,
		backoffMs: RELAYER_RETRY_BACKOFF_MS,
		label: `relayer:${logCtx?.strategy_id ?? ''}`,
	});
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
	const logCtx = { strategy_id: strategyId, chain_id: chainId };

	// Get verified quote
	const { amountOut, divergenceBps } = await getVerifiedQuote(
		client,
		cfg.quoter_v2,
		tokenIn,
		tokenOut,
		amountIn,
		logCtx,
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
	const result = await redeemViaRelayer(delegationId, calls, logCtx);

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

	const runId = (globalThis.crypto?.randomUUID?.() ?? `run_${Date.now()}`);
	log('info', 'tick_start', { run_id: runId });

	// Fetch all due active strategies
	let strategies;
	try {
		strategies = await sql`
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
	} catch (err) {
		log('error', 'fetch_due_failed', { run_id: runId, message: err?.message });
		throw err;
	}

	const results = [];
	for (const strategy of strategies) {
		const logCtx = { run_id: runId, strategy_id: strategy.id, chain_id: strategy.chain_id };

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
			await sql`INSERT INTO dca_executions ${sql(execRow)}`.catch((e) =>
				log('error', 'exec_insert_failed', { ...logCtx, message: e?.message }),
			);
			log('info', 'skipped', { ...logCtx, reason: execRow.error });
			results.push({ id: strategy.id, skipped: true, reason: execRow.error });
			continue;
		}

		if (new Date(strategy.delegation_expires_at) <= new Date()) {
			await sql`
				UPDATE dca_strategies SET status = 'expired' WHERE id = ${strategy.id}
			`;
			execRow.status = 'aborted';
			execRow.error = 'Delegation expired';
			await sql`INSERT INTO dca_executions ${sql(execRow)}`.catch((e) =>
				log('error', 'exec_insert_failed', { ...logCtx, message: e?.message }),
			);
			log('info', 'skipped', { ...logCtx, reason: execRow.error });
			results.push({ id: strategy.id, skipped: true, reason: execRow.error });
			continue;
		}

		// ── Idempotency claim ───────────────────────────────────────────────
		// Atomically advance next_execution_at so a concurrent tick (or a retry
		// of this tick) will not re-pick this row. We advance by period_seconds
		// provisionally; on success we leave it; on failure we reset to NOW so
		// the next tick retries it.
		const nowIso = new Date().toISOString();
		const provisionalNextIso = new Date(
			Date.now() + strategy.period_seconds * 1000,
		).toISOString();

		const claim = await sql`
			UPDATE dca_strategies
			SET next_execution_at = ${provisionalNextIso}
			WHERE id = ${strategy.id}
			  AND status = 'active'
			  AND next_execution_at <= ${nowIso}
			RETURNING id
		`;
		if (claim.length === 0) {
			log('info', 'claim_lost', { ...logCtx });
			results.push({ id: strategy.id, skipped: true, reason: 'claim_lost' });
			continue;
		}

		log('info', 'execute_start', { ...logCtx });

		try {
			const { txHash, quoteAmountOut, divergenceBps } = await onPeriod(strategy);

			execRow.tx_hash = txHash;
			execRow.quote_amount_out = quoteAmountOut;
			execRow.quote_divergence_bps = divergenceBps;
			execRow.status = 'success';

			await sql`
				UPDATE dca_strategies
				SET last_execution_at = NOW()
				WHERE id = ${strategy.id}
			`;

			log('info', 'execute_success', { ...logCtx, tx_hash: txHash, divergence_bps: divergenceBps });
			results.push({ id: strategy.id, txHash, quoteAmountOut });
		} catch (err) {
			execRow.status = err.code === 'quote_divergence' ? 'aborted' : 'failed';
			execRow.error = err.message;
			execRow.quote_divergence_bps = err.divergenceBps ?? null;

			// Release the idempotency claim so the next tick can retry this
			// strategy — but only for transient / recoverable failures. For
			// aborts (quote_divergence, delegation_gone) leave the advanced
			// next_execution_at in place so we wait the full period.
			const shouldRetryNextTick =
				err.code !== 'quote_divergence' &&
				err.code !== 'delegation_gone' &&
				err.code !== 'unsupported_chain';
			if (shouldRetryNextTick) {
				await sql`
					UPDATE dca_strategies
					SET next_execution_at = ${nowIso}
					WHERE id = ${strategy.id}
				`.catch((e) =>
					log('error', 'claim_release_failed', { ...logCtx, message: e?.message }),
				);
			}

			log('error', 'execute_failed', {
				...logCtx,
				code: err.code,
				message: err.message,
				status: err.status,
				will_retry_next_tick: shouldRetryNextTick,
			});
			results.push({ id: strategy.id, error: err.message, code: err.code });
		}

		// Insert execution record regardless of outcome
		await sql`INSERT INTO dca_executions ${sql(execRow)}`.catch((e) =>
			log('error', 'exec_insert_failed', { ...logCtx, message: e?.message }),
		);
	}

	log('info', 'tick_done', { run_id: runId, processed: strategies.length });

	return json(res, 200, {
		ok: true,
		processed: strategies.length,
		results,
	});
});
