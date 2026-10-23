// Trade commands for every paired chat: /buy, /sell, /snipe, /orders, /cancel.
//
// A money-moving command never signs. It asks the same trade engine the web
// wallet uses for a live quote (route, price impact, fee, and every guard:
// kill switch, per-trade cap, daily budget, spend policy, impact cap, the
// firewall), adds a RugCheck verdict, and stores a quote card that lives
// CONFIRM_TTL_SECONDS. Only the exact word `yes`, typed by the paired owner
// while the card is live, executes it; anything else cancels it. The card is
// stored as a gateway preview marked typed_confirm, so it has no Approve button
// and a button press can never run it (approvals.js refuses).
//
// Take-profit and stop-loss from `buy ... tp= sl=` become linked OCO sell
// orders in the orders engine after the buy fills. They are switched on with
// GATEWAY_TPSL_ORDERS=1 once the engine's workers are deployed (work order
// 614); until then a buy that asks for them is refused up front, before any
// quote, so nobody pays for an exit that will not rest.
//
// Every dependency that touches the network is a named member of `deps`, so the
// state machine is exercised end to end against a real Postgres in the worker
// tests with only the quote, the RugCheck call and the signing engine answered
// locally.

import { PublicKey } from '@solana/web3.js';
import { sql } from '../db.js';
import { getTradeLimits } from '../agent-trade-guards.js';
import { previewAgentTrade, parseTradeInput } from '../../agents/agent-trade.js';
import { solanaPublicConnection } from '../agent-pumpfun.js';
import { fetchRugcheckSummary } from '../rugcheck.js';
import { getPortfolio } from '../portfolio.js';
import { appendThreadMessage } from '../agent-thread.js';
import { cancelOrder, createOrder, createOrderGroup, listOrders, normalizeOco, normalizeOrder } from '../orders.js';
import { resolveChatAgent } from './agents.js';
import { createPreview, setPreviewMessageRef, findTypedPending, claimPreview, cancelPreview, expirePreview, finishPreview } from './store.js';
import { executePreview } from './approvals.js';
import {
	CONFIRM_TTL_SECONDS, CONFIRM_WORD, confirmationVerdict, escapeUntrusted, parseTradeCommand, parseTradeText,
} from './trade-parse.js';
import { appOrigin, explorerTx, fmtNum, fmtUsd, short } from './format.js';

export const TRADE_COMMANDS = [
	{ name: 'buy', description: 'Buy a token: /buy <mint or symbol> <sol> [tp=%] [sl=%]', arg: 'mint sol' },
	{ name: 'sell', description: 'Sell part of a holding: /sell <mint or symbol> <percent>', arg: 'mint percent' },
	{ name: 'snipe', description: 'Fast buy of a fresh mint: /snipe <mint> <sol>', arg: 'mint sol' },
	{ name: 'orders', description: 'Your resting orders, take-profits and stops' },
	{ name: 'cancel', description: 'Cancel an order by id, or the trade waiting for your yes', arg: 'id' },
];

// $THREE, the one symbol that always resolves without being held.
const THREE_MINT = 'FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump';
const NETWORK = 'mainnet';
const SLIPPAGE_BPS = { buy: 300, sell: 300, snipe: 1500 };
const LIVE_ORDER_STATUSES = ['active', 'partial', 'firing', 'paused'];
const MAX_ORDERS_SHOWN = 10;

export const tpslEnabled = () => process.env.GATEWAY_TPSL_ORDERS === '1';

async function mintDecimals(mint) {
	try {
		const info = await solanaPublicConnection(NETWORK).getParsedAccountInfo(new PublicKey(mint));
		const d = info?.value?.data?.parsed?.info?.decimals;
		return Number.isInteger(d) ? d : null;
	} catch {
		return null;
	}
}

async function coinLabel(mint) {
	const [row] = await sql`
		SELECT symbol, name FROM pump_coin_intel WHERE mint = ${mint} AND network = ${NETWORK} LIMIT 1`.catch(() => []);
	return { symbol: row?.symbol || null, name: row?.name || null };
}

export const defaultDeps = Object.freeze({
	preview: previewAgentTrade,
	execute: executePreview,
	rugcheck: fetchRugcheckSummary,
	portfolio: getPortfolio,
	decimals: mintDecimals,
	label: coinLabel,
});

const refusal = (code, message) => `Not sent (${code}): ${message}`;

function confirmCard(p) {
	const lines = [];
	const label = p.label_text ? `"${p.label_text}" ` : '';
	if (p.kind === 'buy') {
		lines.push(`${p.mode === 'snipe' ? 'Snipe' : 'Buy'} quote on Solana mainnet`);
		lines.push(`Token: ${label}${short(p.mint, 6, 6)}`);
		lines.push(`Spend: ${fmtNum(p.sol_amount, 6)} SOL${p.usd_value != null ? ` (about ${fmtUsd(p.usd_value)})` : ''}`);
		lines.push(`Expected: ${p.expected_ui != null ? `${fmtNum(p.expected_ui, 2)} tokens` : 'quoted at execution'}`);
	} else {
		lines.push('Sell quote on Solana mainnet');
		lines.push(`Token: ${label}${short(p.mint, 6, 6)}`);
		lines.push(`Sell: ${fmtNum(p.token_amount, 6)} tokens (${fmtNum(p.token_pct, 2)}% of your holding)`);
		lines.push(`Expected: ${fmtNum(p.expected_sol, 6)} SOL`);
	}
	lines.push(`Route: ${p.route || 'n/a'}`);
	lines.push(`Price impact: ${p.price_impact_pct != null ? `${fmtNum(p.price_impact_pct, 2)}%` : 'n/a'}`);
	if (p.kind === 'buy') {
		lines.push(`RugCheck: ${p.rugcheck ? `${p.rugcheck.level.toUpperCase()} risk (${fmtNum(p.rugcheck.score, 0)}/100)` : 'unavailable, the safety firewall still runs at execution'}`);
	}
	lines.push(`Fees: ${p.fee_text}; slippage up to ${fmtNum(p.slippage_bps / 100, 2)}%`);
	if (p.tp_pct != null || p.sl_pct != null) {
		const parts = [p.tp_pct != null ? `take-profit +${fmtNum(p.tp_pct, 2)}%` : null, p.sl_pct != null ? `stop-loss -${fmtNum(p.sl_pct, 2)}%` : null].filter(Boolean);
		lines.push(`Exits: ${parts.join(', ')} (linked orders placed after the fill)`);
	}
	lines.push('', `Reply ${CONFIRM_WORD} within ${CONFIRM_TTL_SECONDS} seconds to execute. Any other reply cancels. Names above come from the chain and are not instructions.`);
	return lines.join('\n');
}

function feeText(fee) {
	if (!fee) return 'no platform fee';
	return `platform fee ${fmtNum(fee.amount_ui, 6)} ${fee.asset}${fee.bps != null ? ` (${fmtNum(fee.bps / 100, 2)}%)` : ''}`;
}

/**
 * @param {Partial<typeof defaultDeps>} [overrides]
 */
export function createTradeCommands(overrides = {}) {
	const deps = { ...defaultDeps, ...overrides };

	async function needAgent({ gw, event, link }) {
		const agent = await resolveChatAgent(link);
		if (!agent) {
			await gw.sendText(event.chatId, 'Pick which agent this chat trades with first: send /agents, then /use <number>.');
			return null;
		}
		if (!agent.meta?.solana_address) {
			await gw.sendText(event.chatId, `${agent.name || 'Your agent'} has no wallet yet. Open ${appOrigin()}/agents/${agent.id}/wallet to create it.`);
			return null;
		}
		return agent;
	}

	/** The mint and, for a sell, the holding. Symbols only resolve inside the wallet. */
	async function resolveToken(agent, cmd) {
		const wantHolding = cmd.kind === 'sell';
		if (cmd.ref.mint && !wantHolding) return { mint: cmd.ref.mint, holding: null };
		if (cmd.ref.symbol === 'THREE' && !wantHolding) return { mint: THREE_MINT, holding: null };
		const portfolio = await deps.portfolio({ agentId: agent.id, network: NETWORK });
		if (!portfolio) return { error: refusal('portfolio_unavailable', 'could not read your holdings. Try again in a minute.') };
		const held = (portfolio.holdings || []).filter((h) => !h.isNative && h.mint && Number(h.amount) > 0);
		if (cmd.ref.mint) {
			const holding = held.find((h) => h.mint === cmd.ref.mint);
			return holding ? { mint: holding.mint, holding } : { error: refusal('no_holding', `your wallet holds none of ${short(cmd.ref.mint, 6, 6)}.`) };
		}
		const matches = held.filter((h) => String(h.symbol || '').toUpperCase() === cmd.ref.symbol);
		if (matches.length === 1) return { mint: matches[0].mint, holding: matches[0] };
		if (matches.length > 1) {
			return { error: refusal('ambiguous_symbol', `${matches.length} tokens in your wallet use that symbol. Use the mint address: ${matches.map((m) => short(m.mint, 6, 6)).join(', ')}.`) };
		}
		return { error: refusal('unknown_symbol', 'symbols are only matched against what your wallet holds, because anyone can mint a token with any symbol. Use the mint address.') };
	}

	async function supersedePending(link) {
		const stale = await findTypedPending(link.id);
		if (stale) await cancelPreview(stale.id);
	}

	/** buy, sell and snipe: quote, guard, store the card, ask for the word. */
	async function startTrade({ gw, event, link }, cmd) {
		const mode = cmd.kind === 'snipe' ? 'snipe' : null;
		const side = cmd.kind === 'sell' ? 'sell' : 'buy';
		if ((cmd.tp_pct != null || cmd.sl_pct != null) && !tpslEnabled()) {
			return gw.sendText(event.chatId, refusal('exits_not_enabled', 'take-profit and stop-loss orders are not switched on for this deployment yet. Send the buy without tp= and sl=, then set exits on the web.'));
		}
		const agent = await needAgent({ gw, event, link });
		if (!agent) return;
		await supersedePending(link);

		let token;
		try {
			token = await resolveToken(agent, cmd);
		} catch (e) {
			console.error('[gateway] trade token lookup failed', e?.message);
			return gw.sendText(event.chatId, refusal('lookup_failed', 'could not look that token up. Try again in a minute.'));
		}
		if (token.error) return gw.sendText(event.chatId, token.error);

		const limits = getTradeLimits(agent.meta);
		let amount;
		let tokenAmount = null;
		if (side === 'buy') {
			amount = cmd.sol;
		} else {
			const dec = Number.isInteger(token.holding.decimals) ? token.holding.decimals : 6;
			const factor = 10 ** dec;
			tokenAmount = cmd.pct >= 100 ? Number(token.holding.amount) : Math.floor(Number(token.holding.amount) * cmd.pct / 100 * factor) / factor;
			amount = cmd.pct >= 100 ? 'max' : tokenAmount;
			if (!(tokenAmount > 0)) return gw.sendText(event.chatId, refusal('amount_too_small', 'that percent of your holding rounds to zero tokens.'));
		}

		let input;
		try {
			input = parseTradeInput({ side, mint: token.mint, amount, slippageBps: SLIPPAGE_BPS[mode || side], network: NETWORK }, limits);
		} catch (e) {
			return gw.sendText(event.chatId, refusal(e?.code || 'validation_error', e?.message || 'that trade is not valid.'));
		}

		let quote;
		try {
			quote = await deps.preview({ id: agent.id, userId: agent.user_id, meta: agent.meta || {}, input, burnerExempt: true });
		} catch (e) {
			return gw.sendText(event.chatId, refusal(e?.code || 'quote_failed', e?.message || 'could not get a quote. Try again in a minute.'));
		}
		if (!quote.allowed) {
			const why = quote.blocked_reason || {};
			return gw.sendText(event.chatId, refusal(why.code || 'blocked', why.message || 'the trade guards refused this trade.'));
		}

		let rugcheck = null;
		if (side === 'buy') {
			const report = await Promise.resolve(deps.rugcheck(token.mint)).catch(() => null);
			if (report?.level) {
				rugcheck = { level: report.level, score: report.score_normalised };
				const refuse = report.level === 'critical' || (mode === 'snipe' && report.level === 'high');
				if (refuse) {
					const top = (report.risks || []).find((r) => r.level === 'danger') || (report.risks || [])[0];
					return gw.sendText(event.chatId, refusal(`rugcheck_${report.level}`, `RugCheck rates this token ${report.level.toUpperCase()} risk (${fmtNum(report.score_normalised, 0)}/100)${top ? `, led by "${escapeUntrusted(top.name, 40)}"` : ''}. Nothing was quoted for signing.`));
				}
			}
		}

		const decimals = side === 'sell' ? (token.holding.decimals ?? null) : await Promise.resolve(deps.decimals(token.mint)).catch(() => null);
		if ((cmd.tp_pct != null || cmd.sl_pct != null) && decimals == null) {
			return gw.sendText(event.chatId, refusal('decimals_unavailable', 'could not read the token decimals, so the exit prices cannot be set. Try again in a minute.'));
		}
		const label = token.holding ? { symbol: token.holding.symbol, name: token.holding.name } : await Promise.resolve(deps.label(token.mint)).catch(() => ({}));
		const labelText = escapeUntrusted([label?.symbol, label?.name && label.name !== label.symbol ? label.name : null].filter(Boolean).join(' '));

		const proposal = {
			kind: side,
			mode,
			typed_confirm: true,
			network: NETWORK,
			mint: token.mint,
			label_text: labelText || null,
			slippage_bps: input.slippageBps,
			route: quote.venue,
			price_impact_pct: quote.price_impact_pct ?? null,
			fee_text: feeText(quote.platform_fee),
			usd_value: quote.usd_value ?? null,
			decimals,
			rugcheck,
			tp_pct: cmd.tp_pct ?? null,
			sl_pct: cmd.sl_pct ?? null,
			...(side === 'buy'
				? { sol_amount: cmd.sol, expected_ui: decimals != null ? Number(BigInt(quote.expected_tokens_out)) / 10 ** decimals : null }
				: { token_amount: tokenAmount, token_pct: cmd.pct, expected_sol: quote.expected_sol_out }),
		};
		const preview = await createPreview({ linkId: link.id, userId: link.user_id, agentId: agent.id, kind: side, proposal, ttlSeconds: CONFIRM_TTL_SECONDS });
		const ref = await gw.sendText(event.chatId, confirmCard(proposal));
		if (ref && typeof ref === 'object') await setPreviewMessageRef(preview.id, ref).catch(() => {});
	}

	async function placeExits(agent, proposal, data) {
		const dec = proposal.decimals;
		const tokens = Number(BigInt(data.tokens_received)) / 10 ** dec;
		const spent = Number(data.sol_spent);
		if (!(tokens > 0) || !(spent > 0)) return { error: 'the fill did not report amounts, so the exit prices could not be set' };
		const entry = spent / tokens;
		const base = { mint: proposal.mint, side: 'sell', network: NETWORK, trigger_metric: 'price_sol', sell_pct: 100, slippage_bps: 1000, symbol: proposal.label_text || null };
		const tpPrice = proposal.tp_pct != null ? entry * (1 + proposal.tp_pct / 100) : null;
		const slPrice = proposal.sl_pct != null ? entry * (1 - proposal.sl_pct / 100) : null;
		if (tpPrice && slPrice) {
			const oco = normalizeOco({ ...base, take_profit: tpPrice, stop_loss: slPrice });
			if (!oco.ok) return { error: oco.message };
			const group = await createOrderGroup(agent.id, agent.user_id, oco);
			return { orders: group.orders };
		}
		const single = normalizeOrder(tpPrice ? { ...base, type: 'limit', limit_price: tpPrice } : { ...base, type: 'stop', stop_price: slPrice });
		if (!single.ok) return { error: single.message };
		return { orders: [await createOrder(agent.id, agent.user_id, single.order)] };
	}

	function outcomeText(preview, result, exits) {
		if (!result.ok) {
			const sig = result.detail?.signature;
			return `Not executed (${result.code}): ${result.message}${sig ? `\nSignature: ${explorerTx(sig, NETWORK)}` : ''}`;
		}
		const d = result.data;
		const lines = [
			preview.kind === 'buy' ? `Bought with ${fmtNum(d.sol_spent, 6)} SOL.` : `Sold for about ${fmtNum(d.sol_received, 6)} SOL.`,
			`Signature: ${explorerTx(d.signature, d.network)}`,
		];
		if (d.new_balance_sol != null) lines.push(`Wallet now holds ${fmtNum(d.new_balance_sol, 6)} SOL.`);
		if (exits?.orders) lines.push(`Exits resting: ${exits.orders.map((o) => `${o.id.slice(0, 8)} ${o.readback}`).join('; ')}`, 'See them with /orders.');
		if (exits?.error) lines.push(`The buy filled but the exits were not placed: ${exits.error}. Set them on the web.`);
		return lines.join('\n');
	}

	async function runConfirmed({ gw, event, link }, preview) {
		const claimed = await claimPreview(preview.id);
		if (!claimed) return gw.sendText(event.chatId, 'That quote expired before it could run. Nothing was sent. Send the command again for a fresh quote.');
		await gw.sendText(event.chatId, 'Confirmed. Executing...');
		let result;
		try {
			result = await deps.execute(claimed, { confirm: true });
		} catch (e) {
			console.error('[gateway] typed trade crashed', e?.message);
			result = { ok: false, code: 'internal_error', message: 'something went wrong before anything was sent. Try again.' };
		}
		await finishPreview(preview.id, result.ok ? 'executed' : 'failed', result.ok ? result.data : { code: result.code, message: result.message, detail: result.detail });
		let exits = null;
		const p = claimed.proposal || {};
		if (result.ok && claimed.kind === 'buy' && (p.tp_pct != null || p.sl_pct != null)) {
			const [agent] = await sql`SELECT id, user_id FROM agent_identities WHERE id = ${claimed.agent_id} AND deleted_at IS NULL`;
			exits = agent ? await placeExits(agent, p, result.data).catch((e) => ({ error: e?.message || 'exit placement failed' })) : { error: 'the agent no longer exists' };
		}
		const text = outcomeText(claimed, result, exits);
		await gw.sendText(event.chatId, text);
		const signature = result.ok ? result.data?.signature : result.detail?.signature;
		await appendThreadMessage({
			agentId: claimed.agent_id, userId: claimed.user_id, role: 'assistant', content: text, channel: event.platform,
			signatures: signature ? [signature] : [],
		}).catch(() => {});
	}

	/**
	 * Called for every message from the paired owner before it is dispatched.
	 * Returns true when the message was fully consumed as a confirmation reply;
	 * false when it should carry on (a command or a new trade command that merely
	 * cancelled the pending one, or no trade was waiting).
	 */
	async function handlePendingConfirmation({ gw, event, link }) {
		const pending = await findTypedPending(link.id);
		if (!pending) return false;
		const typed = event.command ? null : (event.voice || event.photo ? null : String(event.text || ''));
		const verdict = confirmationVerdict({ text: typed, expiresAt: pending.expires_at });

		if (verdict === 'execute') {
			await runConfirmed({ gw, event, link }, pending);
			return true;
		}
		if (verdict === 'expired') {
			await expirePreview(pending.id);
			const wasYes = typed !== null && typed.trim().toLowerCase() === CONFIRM_WORD;
			await gw.sendText(event.chatId, `That quote expired (${CONFIRM_TTL_SECONDS} second limit). Nothing was sent. Send the command again for a fresh quote.`);
			return wasYes;
		}
		const done = await cancelPreview(pending.id);
		if (!done) return false;
		const asked = event.command ? parseTradeCommand(event.command, event.args) : typed !== null ? { ok: true, cmd: parseTradeText(typed) } : null;
		const plainCancel = asked?.ok && asked.cmd?.kind === 'cancel' && !asked.cmd.id;
		if (plainCancel) {
			await gw.sendText(event.chatId, 'Cancelled. Nothing was sent.');
			return true;
		}
		const continues = Boolean(event.command) || (typed !== null && parseTradeText(typed) !== null);
		await gw.sendText(event.chatId, continues
			? 'Cancelled the trade that was waiting for your yes. Nothing was sent.'
			: `Cancelled. Nothing was sent. Only a reply of exactly "${CONFIRM_WORD}" confirms a trade, so send the command again if you still want it.`);
		return !continues;
	}

	async function cmdOrders({ gw, event, link }) {
		const agent = await needAgent({ gw, event, link });
		if (!agent) return;
		const rows = await listOrders(agent.id, { network: NETWORK, statuses: LIVE_ORDER_STATUSES, limit: MAX_ORDERS_SHOWN + 1 });
		if (!rows.length) {
			return gw.sendText(event.chatId, `No resting orders. Buy with exits: /buy <mint> 0.25 tp=50 sl=20\nAll orders: ${appOrigin()}/agents/${agent.id}/wallet#orders`);
		}
		const lines = [`${agent.name || 'Your agent'}: resting orders`];
		for (const o of rows.slice(0, MAX_ORDERS_SHOWN)) {
			lines.push(`- ${o.id.slice(0, 8)} ${o.status}${o.group_kind === 'oco' ? ' (linked exit)' : ''}: ${o.readback}`);
		}
		if (rows.length > MAX_ORDERS_SHOWN) lines.push(`and more at ${appOrigin()}/agents/${agent.id}/wallet#orders`);
		lines.push('', 'Cancel one with /cancel <id>. Cancelling one side of a linked exit cancels both.');
		return gw.sendText(event.chatId, lines.join('\n'));
	}

	async function cmdCancel({ gw, event, link }, cmd) {
		if (!cmd.id) {
			const pending = await findTypedPending(link.id);
			if (pending && (await cancelPreview(pending.id))) return gw.sendText(event.chatId, 'Cancelled. Nothing was sent.');
			return gw.sendText(event.chatId, 'Nothing is waiting for your yes. Send /orders to see resting orders you can cancel.');
		}
		const agent = await needAgent({ gw, event, link });
		if (!agent) return;
		const rows = await listOrders(agent.id, { network: NETWORK, statuses: LIVE_ORDER_STATUSES, limit: 100 });
		const hits = rows.filter((o) => o.id.startsWith(cmd.id));
		if (!hits.length) return gw.sendText(event.chatId, `No resting order starts with ${cmd.id}. Send /orders to see them.`);
		if (hits.length > 1) return gw.sendText(event.chatId, `${hits.length} orders start with ${cmd.id}. Send more of the id.`);
		const done = await cancelOrder(agent.id, hits[0].id, { reason: 'owner_chat' });
		return gw.sendText(event.chatId, done?.status === 'cancelled' ? `Cancelled order ${hits[0].id.slice(0, 8)}: ${hits[0].readback}` : `Order ${hits[0].id.slice(0, 8)} is already ${done?.status || 'closed'}.`);
	}

	/** Run a parsed command. Shared by the slash path and the bare-words path. */
	async function run(ctx, cmd) {
		if (cmd.kind === 'orders') return cmdOrders(ctx);
		if (cmd.kind === 'cancel') return cmdCancel(ctx, cmd);
		return startTrade(ctx, cmd);
	}

	const handlerFor = (verb) => async (ctx) => {
		const parsed = parseTradeCommand(verb, ctx.event.args);
		if (!parsed.ok) return ctx.gw.sendText(ctx.event.chatId, parsed.error);
		return run(ctx, parsed.cmd);
	};

	/** A bare message that is exactly a trade command, or null to let the agent have it. */
	async function handleTradeText(ctx) {
		const cmd = parseTradeText(ctx.event.text);
		if (!cmd) return null;
		await run(ctx, cmd);
		return true;
	}

	return {
		handlers: { buy: handlerFor('buy'), sell: handlerFor('sell'), snipe: handlerFor('snipe'), orders: handlerFor('orders'), cancel: handlerFor('cancel') },
		handlePendingConfirmation,
		handleTradeText,
	};
}

const defaultCommands = createTradeCommands();
export const TRADE_COMMAND_HANDLERS = defaultCommands.handlers;
export const handlePendingConfirmation = defaultCommands.handlePendingConfirmation;
export const handleTradeText = defaultCommands.handleTradeText;
