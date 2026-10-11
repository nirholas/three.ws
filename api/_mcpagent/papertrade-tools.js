// threews-agent MCP: Papertrade, the synthetic-perps exchange on HyperEVM.
//
// Thin adapters over api/_lib/papertrade/index.js, the same service behind
// GET /api/papertrade. All four tools are reads (policy group `perps`, tier
// read): they price and report, and need no sign-in. Nothing here signs an
// intent, deposits or trades; a trade happens on Papertrade itself, from the
// user's own wallet. Guide: docs/papertrade.md.

import { limits as rateLimits } from '../_lib/rate-limit.js';
import * as papertrade from '../_lib/papertrade/index.js';

const READ = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true };

const usd = (n) => (n == null || !Number.isFinite(Number(n)) ? 'n/a' : `${Number(n) < 0 ? '-' : ''}$${Math.abs(Number(n)).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
const price = (n) => (n == null ? 'n/a' : `$${Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 })}`);
const compact = (n) => (n == null ? 'n/a' : `$${Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 2 }).format(n)}`);

function refusal(text, reason, extra = {}) {
	return { content: [{ type: 'text', text }], structuredContent: { ok: false, reason, ...extra }, isError: true };
}

const reply = (text, structuredContent) => ({ content: [{ type: 'text', text }], structuredContent });

async function run(auth, fn) {
	const rl = await rateLimits.mcpAgent(auth.userId || auth.rateKey || 'anon');
	if (!rl.success) {
		throw Object.assign(new Error('rate_limited'), { code: -32000, data: { retry_after: Math.ceil((rl.reset - Date.now()) / 1000) } });
	}
	try {
		return await fn();
	} catch (err) {
		if (err instanceof papertrade.PapertradeError) return refusal(err.message, err.code, err.detail ? { detail: err.detail } : {});
		throw err;
	}
}

function marketLine(m) {
	return `${m.symbol}: ${price(m.mid_price)} (${m.status}), up to ${m.max_leverage}x, max ${compact(m.max_position_notional_usd)} per position, OI long ${compact(m.open_interest_long_usd)} / short ${compact(m.open_interest_short_usd)}, 24h volume ${compact(m.volume_24h_usd)}`;
}

function quoteText(q) {
	const ladder = q.scenarios
		.map((s) => `  +${s.move_pct}% to ${price(s.exit_price)}: raw ${usd(s.raw_pnl_usd)}, paid ${usd(s.payout_pnl_usd)}${s.kept_pct == null ? '' : ` (${s.kept_pct}% kept)`}`)
		.join('\n');
	const checks = q.checks.map((c) => `  ${c.ok ? '[ok]' : '[blocked]'} ${c.label}`).join('\n');
	return [
		`Papertrade ${q.symbol} ${q.side.toUpperCase()} ${q.leverage}x, ${usd(q.margin_usd)} margin = ${usd(q.notional_usd)} notional`,
		`Entry ${price(q.entry_price)} (Hyperliquid mid now). Bust at ${price(q.bust_price)}, ${q.bust_distance_pct}% away: crossing it loses the full ${usd(q.margin_usd)}.`,
		`No open fee, no funding. Win fee ${q.win_fee_pct}% after the impact haircut. What a close would pay:`,
		ladder,
		'Checks:',
		checks,
		q.openable ? `Openable now at ${q.trade_url} from the user's own wallet.` : `Not openable as sized. Blocked by: ${q.blocked_by.join(', ')}.`,
	].join('\n');
}

function accountText(a) {
	const head = `Papertrade ${a.address}: balance ${usd(a.balance_usd)}, ${usd(a.locked_margin_usd)} locked in margin, ${usd(a.queued_payout_usd)} waiting in the payout queue. Lifetime realized PnL ${usd(a.lifetime.realized_pnl_usd)} on ${compact(a.lifetime.traded_notional_usd)} traded.`;
	if (!a.positions.length) return `${head}\nNo open positions.`;
	const rows = a.positions.slice(0, 25).map((p) =>
		`  #${p.id} ${p.symbol} ${p.side} ${p.leverage}x ${usd(p.margin_usd)}: entry ${price(p.entry_price)}, mark ${price(p.mark_price)}, bust ${price(p.bust_price)} (${p.risk_pct ?? 'n/a'}% of the way), close pays ${usd(p.close_payout_pnl_usd)}${p.bust_crossed ? ' [BUST CROSSED]' : ''}`);
	const more = a.positions.length > 25 ? `\n  plus ${a.positions.length - 25} more in structuredContent` : '';
	return `${head}\n${a.open_positions} open, closing all now would pay ${usd(a.close_all_payout_pnl_usd)}:\n${rows.join('\n')}${more}`;
}

const symbolProp = { type: 'string', minLength: 2, maxLength: 16, description: 'Market symbol, e.g. BTC or ETH (papertrade_markets lists them).' };

export const papertradeToolDefs = [
	{
		name: 'papertrade_markets',
		title: 'List Papertrade markets',
		group: 'perps',
		tier: 'read',
		annotations: READ,
		description: 'Papertrade (synthetic perps on HyperEVM, USDC collateral, up to 1000x, no funding) markets: live Hyperliquid mid, status, max leverage, per-position notional cap, open interest per side, 24h volume, the minimum margin and notional, and the live win fee. Call this first to see what can be traded.',
		inputSchema: { type: 'object', properties: {}, additionalProperties: false },
		handler: (_args, auth) => run(auth, async () => {
			const out = await papertrade.markets();
			const head = `Papertrade perps, USDC on HyperEVM${out.trading_paused ? ' (TRADING PAUSED)' : ''}. Min ${usd(out.min_margin_usd)} margin and ${usd(out.min_notional_usd)} notional, ${out.win_fee_pct}% win fee, no funding.`;
			return reply(`${head}\n${out.markets.map(marketLine).join('\n')}`, out);
		}),
	},
	{
		name: 'papertrade_quote',
		title: 'Quote a Papertrade position',
		group: 'perps',
		tier: 'read',
		annotations: READ,
		description: 'Price a Papertrade open exactly as the exchange would fill it now: entry at the Hyperliquid mid, the hard-bust price where the whole margin is lost, capacity and minimum-size checks, and what a winning close actually pays across a ladder of moves (after the 0.2 bps deadband, impact haircut and win fee). Small moves keep a small share of the raw profit; show the user the ladder. Read only: it never opens anything. Use this to size and price a Papertrade open before opening it.',
		inputSchema: {
			type: 'object',
			properties: {
				symbol: symbolProp,
				side: { type: 'string', enum: ['long', 'short'] },
				margin_usd: { type: 'number', exclusiveMinimum: 0, maximum: 10_000_000, description: 'Isolated margin in USDC. Papertrade requires at least $10.' },
				leverage: { type: 'integer', minimum: 1, maximum: 100_000, description: 'Leverage multiple. Margin times leverage must be at least the $10,000 minimum notional.' },
			},
			required: ['symbol', 'side', 'margin_usd', 'leverage'],
			additionalProperties: false,
		},
		handler: (args, auth) => run(auth, async () => {
			const out = await papertrade.quote({ symbol: args.symbol, side: args.side, marginUsd: args.margin_usd, leverage: args.leverage });
			return reply(quoteText(out), out);
		}),
	},
	{
		name: 'papertrade_account',
		title: 'Read a Papertrade wallet',
		group: 'perps',
		tier: 'read',
		annotations: READ,
		description: 'Any EVM wallet\'s Papertrade account from public chain-indexed state: balance, locked margin, queued payouts, lifetime deposits, realized PnL and fees, and every open position valued at the live mid (raw PnL, what a close would pay, bust price and how close the mark is to it). Use this to check the Papertrade balance and open positions.',
		inputSchema: {
			type: 'object',
			properties: { address: { type: 'string', pattern: '^0x[0-9a-fA-F]{40}$', description: 'The 0x wallet address that trades on Papertrade.' } },
			required: ['address'],
			additionalProperties: false,
		},
		handler: (args, auth) => run(auth, async () => {
			const out = await papertrade.account(args.address);
			return reply(accountText(out), out);
		}),
	},
	{
		name: 'papertrade_protocol',
		title: 'Check Papertrade protocol health',
		group: 'perps',
		tier: 'read',
		annotations: READ,
		description: 'Papertrade protocol health before sizing a trade: TVL, margin locked, the LP that pays winners, the payout queue (winners wait in it when the LP is short), lifetime volume and fees, the live win fee and whether the order relayer is ready. Use this to check protocol health before sizing a Papertrade trade.',
		inputSchema: { type: 'object', properties: {}, additionalProperties: false },
		handler: (_args, auth) => run(auth, async () => {
			const p = await papertrade.protocol();
			const queue = p.payout_queue == null
				? 'Payout queue status unavailable.'
				: p.payout_queue.active
					? `PAYOUT QUEUE ACTIVE: ${usd(p.payout_queue.total_usd)} across ${p.payout_queue.entries} winners is waiting for LP liquidity.`
					: 'Payout queue empty: winners are paid immediately.';
			const relayer = p.relayer_ready == null ? 'unknown' : p.relayer_ready ? 'ready' : 'NOT READY';
			const text = `Papertrade: TVL ${compact(p.tvl_usd)}, ${compact(p.margin_locked_usd)} in margin, LP ${compact(p.lp_usd)}, ${p.open_positions} open positions, ${compact(p.lifetime_volume_usd)} lifetime volume, ${compact(p.lifetime_fees_usd)} fees. Win fee ${p.win_fee_pct}%. Relayer ${relayer}.\n${queue}`;
			return reply(text, p);
		}),
	},
];
