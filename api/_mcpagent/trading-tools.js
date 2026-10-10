// threews-agent MCP: Solana trading tools.
//
// Thin adapters over api/_lib/trading-tools/registry.js, the same definitions
// the REST API serves at /api/v1/trading/*, so both surfaces share one schema,
// one guard chain and one refusal vocabulary.
//
// Tool policy (docs/prompts/03): each definition carries `group: 'trading'` and
// its tier. swap_execute is the only financial tool: it needs confirm_swap: true
// and a quote_id swap_quote issued for the same account in the last five
// minutes. swap_execute verifies that quote_id itself (signed, single use,
// re-priced before signing), so its policy row is own().

import { limits } from '../_lib/rate-limit.js';
import { TRADING_TOOLS } from '../_lib/trading-tools/registry.js';
import { describeToolError } from '../_lib/trading-tools/context.js';

const READ = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true };
// swap_quote and swap_simulate read and price; they sign a quote id but move nothing.
const PREVIEW = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true };
const FINANCIAL = { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true };

const ANNOTATIONS = { swap_quote: PREVIEW, swap_simulate: PREVIEW, swap_execute: FINANCIAL };

function refusal(text, reason, extra = {}) {
	return { content: [{ type: 'text', text }], structuredContent: { ok: false, reason, ...extra }, isError: true };
}

async function enforce(auth) {
	const rl = await limits.mcpAgent(auth.userId || auth.rateKey || 'anon');
	if (!rl.success) {
		throw Object.assign(new Error('rate_limited'), { code: -32000, data: { retry_after: Math.ceil((rl.reset - Date.now()) / 1000) } });
	}
}

const num = (n, digits = 6) => (n == null || !Number.isFinite(Number(n)) ? 'n/a' : Number(Number(n).toPrecision(digits)).toString());
const pct = (n) => (n == null || !Number.isFinite(Number(n)) ? 'n/a' : `${Number(n).toFixed(2)}%`);

function swapQuoteText(r) {
	const lines = [`${r.input.amount} ${r.input.symbol || 'input'} -> ${r.output.symbol || 'output'} (dex ${r.dex}, slippage ${r.slippage_bps} bps)`];
	const chosen = r.selected?.aggregator;
	for (const row of r.routes || []) {
		lines.push(`  ${row.aggregator === chosen ? '*' : ' '} ${row.aggregator}: ${num(row.out_amount)} out, ${num(row.net_out)} net, impact ${pct(row.price_impact_pct)}`);
	}
	if (r.selected?.net_basis) lines.push(`  (net is ${r.selected.net_basis})`);
	for (const u of r.unavailable || []) lines.push(`    ${u.aggregator}: ${u.status} (${u.reason})`);
	lines.push(...(r.why || []).map((w) => `  ${w}`));
	if (r.confirmation) {
		const c = r.confirmation;
		lines.push(
			'',
			'Confirm with the user before swap_execute:',
			`  chain      ${c.chain} ${c.network}`,
			`  wallet     ${c.wallet}`,
			`  recipient  ${c.recipient}`,
			`  pay        ${c.pay.amount} (${c.pay.mint})`,
			`  receive    at least ${c.receive_at_least.amount}, expected ${c.receive_expected.amount} (${c.receive_at_least.mint})`,
			`  via        ${c.via}${c.route?.length ? ` (${c.route.join(' > ')})` : ''}`,
			`  fees       three.ws ${c.three_ws_fee_bps} bps, network about ${c.network_fee_lamports} lamports`,
		);
	}
	if (r.quote_id) lines.push('', `quote_id ${r.quote_id} (expires ${r.expires_at}). Executable: ${r.executable ? 'yes' : 'no'}.`);
	if (r.execution?.reason) lines.push(`Not executable: ${r.execution.reason}`);
	for (const b of r.execution?.blocked_by || []) lines.push(`  blocked: ${b.reason || b.code || b}`);
	return lines.join('\n');
}

function swapResultText(r) {
	if (r.simulated) {
		return `Simulation ${r.status === 'would_succeed' ? 'passed' : 'failed'}: ${r.in.amount} in via ${r.via}, at least ${r.min_received.amount} out. ${r.simulation.err ? `Error: ${JSON.stringify(r.simulation.err)}` : `${r.simulation.units_consumed} compute units.`} Nothing was signed; the quote_id is still valid.`;
	}
	if (r.status === 'submitted_unconfirmed') return `Submitted but not yet confirmed. ${r.message || ''} Check the signature before retrying.`;
	return `Swap confirmed via ${r.via}: ${r.in.amount} in, about ${r.expected_out.amount} out. Signature ${r.signature} ${r.explorer || ''}`.trim();
}

function arbitrageText(r) {
	const lines = [`${r.verdict}: ${r.reason}`, `expected net ${num(r.expected.net_profit)} (${pct(r.expected.net_profit_pct)}), worst case ${num(r.worst_case.worst_net_profit)} (max loss ${pct(r.worst_case.max_loss_pct)})`];
	for (const s of r.worst_case.scenarios) lines.push(`  ${s.id}: out ${num(s.quote_out)}, net ${num(s.net_profit)}`);
	lines.push(`legs: buy on ${r.legs[0].venue}, sell on ${r.legs[1].venue}. ${r.risk.summary}`);
	return lines.join('\n');
}

const TEXT = {
	swap_quote: swapQuoteText,
	swap_simulate: swapResultText,
	swap_execute: swapResultText,
	arbitrage_quote: arbitrageText,
};

function toolText(name, result) {
	const fmt = TEXT[name];
	if (fmt) {
		try {
			return fmt(result);
		} catch {
			return JSON.stringify(result);
		}
	}
	return JSON.stringify(result);
}

export const tradingToolDefs = TRADING_TOOLS.map((t) => ({
	name: t.name,
	title: t.title,
	group: 'trading',
	tier: t.tier,
	...(t.confirmFlag ? { confirmFlag: t.confirmFlag, previewTool: t.previewTool } : {}),
	annotations: ANNOTATIONS[t.name] || READ,
	description: t.description,
	inputSchema: t.inputSchema,
	handler: async (args, auth, req) => {
		await enforce(auth);
		try {
			const result = await t.run(args || {}, { principal: auth.userId ? auth : null, req });
			return { content: [{ type: 'text', text: toolText(t.name, result) }], structuredContent: result };
		} catch (err) {
			const d = describeToolError(err);
			if (d) return refusal(d.message, d.code, d.detail ? { detail: d.detail } : {});
			throw err;
		}
	},
}));
