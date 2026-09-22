// v1 agent wallet routes: read the custodial Solana wallet, page its custody
// ledger, and move funds out of it through quote-then-confirm.
//
// Every route forwards to the existing owner-gated handler in
// api/agents/solana-wallet.js so the ownership check, spend policy
// (enforceSpendLimit), withdraw allowlist, real-funds agreement, CSRF, rate
// limits and custody ledger all apply exactly as they do for the dashboard.
//
//   GET  /agents/:id/wallet                   balance and address
//   GET  /agents/:id/wallet/history           custody ledger, newest first, paged
//   POST /agents/:id/wallet/transfer/quote    simulate a transfer, return a quoteId
//   POST /agents/:id/wallet/transfer          { quoteId, confirm: true } sends it

import { apiError, page, requireUuid, intParam, strParam } from '../http.js';
import { forward, forwardData, toApiError } from '../forward.js';
import { issueQuote, verifyQuote, requireConfirm } from '../quote-token.js';

/** Bind the solana-wallet dispatcher to one agent and action. */
async function walletAction(id, action) {
	const mod = await import('../../../agents/solana-wallet.js');
	return (req, res) => mod.default(req, res, id, action);
}

export function networkParam(v) {
	if (v === undefined || v === null || v === '' || v === 'mainnet') return 'mainnet';
	if (v === 'devnet') return 'devnet';
	throw apiError(400, 'invalid_parameter', 'network must be "mainnet" or "devnet".', { parameter: 'network' });
}

function amountParam(v) {
	if (v === 'max') return 'max';
	const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
	if (typeof n !== 'number' || !Number.isFinite(n) || n <= 0) {
		throw apiError(400, 'invalid_parameter', 'amount must be a positive number or "max".', { parameter: 'amount' });
	}
	return n;
}

function shapeWallet(d, agentId) {
	return {
		agentId,
		chain: 'solana',
		network: d?.network ?? 'mainnet',
		address: d?.address ?? null,
		lamports: d?.lamports != null ? String(d.lamports) : null,
		sol: d?.sol ?? null,
		signable: d?.signable ?? null,
		depositsEnabled: d?.deposits_enabled ?? null,
		snsDomain: d?.sns_domain ?? null,
	};
}

function shapeLedgerItem(e) {
	return {
		id: e.id,
		type: e.event_type,
		category: e.category,
		network: e.network,
		asset: e.asset,
		amountLamports: e.amount_lamports,
		amountRaw: e.amount_raw,
		usd: e.usd,
		destination: e.destination,
		signature: e.signature,
		explorer: e.explorer,
		status: e.status,
		reason: e.reason ?? null,
		createdAt: e.created_at,
	};
}

function shapePreview(d) {
	return {
		asset: d.asset,
		network: d.network,
		destination: d.destination,
		amount: d.amount,
		lamports: d.lamports ?? null,
		amountRaw: d.amount_raw ?? null,
		usd: d.usd ?? null,
		note: d.note ?? null,
		simulation: { ok: d.err == null, error: d.err ?? null, unitsConsumed: d.units_consumed ?? null },
	};
}

export const ROUTES = [
	{
		method: 'GET',
		path: '/agents/:id/wallet',
		name: 'v1.agents.wallet.get',
		auth: 'required',
		scope: 'wallet:read',
		summary: "The agent's custodial Solana wallet: address, SOL balance and whether it can sign.",
		params: { network: 'mainnet (default) or devnet' },
		handler: async (ctx) => {
			const id = requireUuid(ctx.params.id, 'agent');
			const network = networkParam(ctx.query.network);
			const d = await forwardData(await walletAction(id, ''), ctx, {
				method: 'GET',
				url: `/api/agents/${id}/solana?network=${network}`,
			});
			return shapeWallet(d, id);
		},
	},
	{
		method: 'GET',
		path: '/agents/:id/wallet/history',
		name: 'v1.agents.wallet.history',
		auth: 'required',
		scope: 'wallet:read',
		summary: "The agent wallet's custody ledger (every spend, receipt and withdrawal the platform signed), newest first.",
		params: {
			limit: '1-200, default 50',
			before: 'cursor from meta.nextCursor',
			network: 'mainnet or devnet (default both)',
			category: 'filter to one spend category, e.g. withdraw, trade, x402',
		},
		handler: async (ctx) => {
			const id = requireUuid(ctx.params.id, 'agent');
			const limit = intParam(ctx.query.limit, { name: 'limit', min: 1, max: 200, fallback: 50 });
			const before = strParam(ctx.query.before, { name: 'before', max: 32 });
			if (before && !/^\d+$/.test(before)) {
				throw apiError(400, 'invalid_parameter', 'before must be a cursor returned in meta.nextCursor.', { parameter: 'before' });
			}
			const category = strParam(ctx.query.category, { name: 'category', max: 32 });
			const qs = new URLSearchParams({ limit: String(limit) });
			if (before) qs.set('before', before);
			if (ctx.query.network) qs.set('network', networkParam(ctx.query.network));
			if (category) qs.set('category', category);
			const d = await forwardData(await walletAction(id, 'custody'), ctx, {
				method: 'GET',
				url: `/api/agents/${id}/solana/custody?${qs}`,
			});
			const items = (d?.items || []).map(shapeLedgerItem);
			return page(items, { hasMore: Boolean(d?.next_cursor), nextCursor: d?.next_cursor ?? null });
		},
	},
	{
		method: 'POST',
		path: '/agents/:id/wallet/transfer/quote',
		name: 'v1.agents.wallet.transfer_quote',
		auth: 'required',
		scope: 'wallet:read',
		// A quote is a simulation: it moves nothing and never touches the key,
		// which is why the withdraw handler also exempts it from CSRF.
		csrf: false,
		summary: 'Simulate a transfer out of the agent wallet and return a quoteId valid for five minutes.',
		params: {
			destination: 'Solana address to receive the funds (required)',
			amount: 'positive number in whole units, or "max" (required)',
			asset: '"SOL" (default) or an SPL mint address',
			network: 'mainnet (default) or devnet',
		},
		handler: async (ctx) => {
			const id = requireUuid(ctx.params.id, 'agent');
			const destination = strParam(ctx.body.destination, { name: 'destination', max: 64, required: true });
			const amount = amountParam(ctx.body.amount);
			const asset = strParam(ctx.body.asset, { name: 'asset', max: 64 }) || 'SOL';
			const network = networkParam(ctx.body.network);
			const d = await forwardData(await walletAction(id, 'withdraw'), ctx, {
				method: 'POST',
				url: `/api/agents/${id}/solana/withdraw`,
				body: { destination, amount, asset, network, simulate: true },
			});
			if (d?.err != null) {
				throw apiError(422, 'simulation_failed', 'The transfer failed simulation, so it would fail on chain. Nothing was sent.', {
					simulation: d.err,
					logs: Array.isArray(d.logs) ? d.logs.slice(-12) : null,
				});
			}
			// Pin the resolved amount, not "max": the owner confirms the number
			// they saw, even if the balance moves before they confirm.
			const pinned = Number(d.amount);
			const { quoteId, expiresAt } = issueQuote('transfer', {
				userId: ctx.principal.userId,
				agentId: id,
				destination,
				amount: pinned,
				asset,
				network,
			});
			return { quoteId, expiresAt, preview: shapePreview(d) };
		},
	},
	{
		method: 'POST',
		path: '/agents/:id/wallet/transfer',
		name: 'v1.agents.wallet.transfer',
		auth: 'required',
		scope: 'wallet:write',
		// The withdraw handler enforces CSRF for session callers itself; checking
		// here too would burn the single-use token before it gets there.
		csrf: false,
		summary: 'Send a previously quoted transfer. Requires { quoteId, confirm: true }.',
		params: { quoteId: 'from POST /agents/:id/wallet/transfer/quote (required)', confirm: 'must be true (required)' },
		handler: async (ctx) => {
			const id = requireUuid(ctx.params.id, 'agent');
			requireConfirm(ctx.body, 'transferQuote', `POST /api/v1/agents/${id}/wallet/transfer/quote`);
			const { claims, nonce } = verifyQuote(ctx.body.quoteId, 'transfer', { userId: ctx.principal.userId, agentId: id });
			const out = await forward(await walletAction(id, 'withdraw'), ctx, {
				method: 'POST',
				url: `/api/agents/${id}/solana/withdraw`,
				body: {
					destination: claims.destination,
					amount: claims.amount,
					asset: claims.asset,
					network: claims.network,
					// The quote nonce makes the quote single-use: a repeat
					// replays the first result instead of sending again.
					idempotency_key: `v1q:${nonce}`,
				},
			});
			// 202: submitted on chain but not yet confirmed. Not a failure, and
			// not safe to resend; report the signature so the caller can watch it.
			if (out.status === 202) {
				return {
					status: 'submitted',
					confirmed: false,
					replayed: false,
					signature: out.body?.signature ?? null,
					explorer: out.body?.explorer ?? null,
					asset: claims.asset,
					network: claims.network,
					destination: claims.destination,
					amount: claims.amount,
					usd: null,
					newBalanceSol: null,
					newTokenBalance: null,
				};
			}
			if (out.status < 200 || out.status >= 300) throw toApiError(out);
			const d = out.body?.data ?? {};
			return {
				status: 'confirmed',
				confirmed: true,
				replayed: Boolean(d.replayed),
				signature: d.signature ?? null,
				explorer: d.explorer ?? null,
				asset: d.asset ?? claims.asset,
				network: d.network ?? claims.network,
				destination: d.destination ?? claims.destination,
				amount: d.amount ?? claims.amount,
				usd: d.usd ?? null,
				newBalanceSol: d.new_balance_sol ?? null,
				newTokenBalance: d.new_token_balance ?? null,
			};
		},
	},
];
