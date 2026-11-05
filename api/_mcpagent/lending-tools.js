// threews-agent MCP: lending from the agent wallet.
//
// Thin adapters over api/_lib/lending/service.js, the same service the
// /api/v1/agents/:id/lending routes use.
//
//   read       lend_markets, lend_positions, lend_preview (simulates the
//              transaction against live Solana state; moves nothing)
//   financial  lend_deposit, lend_withdraw. Each needs confirm_lend: true after
//              the user saw lend_preview's table and said yes. A deposit also
//              runs the wallet spend policy (per-transaction and daily caps,
//              rules, anomaly guard) before the key is touched.

import { hasScope } from '../_lib/auth.js';
import { limits as rateLimits } from '../_lib/rate-limit.js';
import * as lending from '../_lib/lending/service.js';

const READ = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true };
const FINANCIAL = { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true };

const pct = (n) => (n == null ? 'n/a' : `${(Number(n) * 100).toFixed(2)}%`);
const usd = (n) => (n == null || !Number.isFinite(Number(n)) ? 'n/a' : `$${Number(n).toFixed(2)}`);

function refusal(text, reason, extra = {}) {
	return { content: [{ type: 'text', text }], structuredContent: { ok: false, reason, ...extra }, isError: true };
}

async function enforce(auth) {
	const rl = await rateLimits.mcpAgent(auth.userId || auth.rateKey || 'anon');
	if (!rl.success) {
		throw Object.assign(new Error('rate_limited'), { code: -32000, data: { retry_after: Math.ceil((rl.reset - Date.now()) / 1000) } });
	}
}

async function run(auth, { scope = null, signIn = true }, fn) {
	await enforce(auth);
	if (signIn && !auth.userId) return refusal('Sign in to three.ws to act on your agents.', 'auth_required', { signed_in: false });
	if (scope && !hasScope(auth.scope, scope) && !(scope === 'wallet:read' && hasScope(auth.scope, 'wallet:trade'))) {
		return refusal(`This action needs the ${scope} scope. Re-authorize with it granted.`, 'insufficient_scope', { required: scope });
	}
	try {
		return await fn();
	} catch (err) {
		const d = lending.describeError(err);
		if (d) return refusal(d.message, d.code, d.detail ? { detail: d.detail } : {});
		throw err;
	}
}

const reply = (text, structuredContent) => ({ content: [{ type: 'text', text }], structuredContent: { ok: true, ...structuredContent } });

const agentIdProp = { type: 'string', format: 'uuid', description: 'The agent whose Solana wallet lends. wallet_status or three://agents lists yours.' };
const tokenProp = { type: 'string', minLength: 2, maxLength: 44, description: 'A token symbol such as "USDC" or "SOL", or its mint address. lend_markets lists what can be supplied.' };
const amountProp = { type: ['number', 'string'], description: 'Token amount in whole units, e.g. "25" or "0.5". Not base units.' };
const venueProp = { type: 'string', maxLength: 32, description: 'Venue id. Defaults to the platform venue.' };

const previewSchema = (kind) => ({
	type: 'object',
	properties: {
		agent_id: agentIdProp, token: tokenProp, venue: venueProp,
		amount: amountProp,
		...(kind === 'withdraw' ? { all: { type: 'boolean', description: 'Withdraw the whole position including accrued interest. Overrides amount.' } } : {}),
	},
	required: ['agent_id', 'token'],
	additionalProperties: false,
});

const financialSchema = (kind) => ({
	type: 'object',
	properties: {
		...previewSchema(kind).properties,
		confirm_lend: { type: 'boolean', description: 'Must be true. Set it only after showing the lend_preview table to the user and getting a clear yes.' },
	},
	required: ['agent_id', 'token', 'confirm_lend'],
	additionalProperties: false,
});

function previewText(p) {
	const tool = p.kind === 'deposit' ? 'lend_deposit' : 'lend_withdraw';
	const lines = [
		`Show this table to the user and wait for a clear yes before calling ${tool} with confirm_lend: true:`,
		`  Action:   ${p.kind === 'deposit' ? 'Supply' : 'Withdraw'} on ${p.venue_name} (Solana mainnet)`,
		`  From:     ${p.from}`,
		`  To:       ${p.to}`,
		`  Amount:   ${p.amount} ${p.token} (${usd(p.amount_usd)})${p.all ? ', the whole position' : ''}`,
		`  Program:  ${p.program}`,
	];
	if (p.kind === 'deposit') {
		lines.push(`  Yield:    ${pct(p.supply_apy)} supply APY, about ${p.projected_yearly == null ? 'n/a' : p.projected_yearly.toFixed(4)} ${p.token} per year`);
		if (p.opens_position) lines.push('  Note:     opens the lending account first (one-time SOL rent)');
	}
	lines.push(`  Simulated: ${p.simulation.ok ? `passed, ${p.simulation.compute_units ?? '?'} compute units` : 'FAILED against current Solana state'}`);
	for (const c of p.checks) lines.push(`  ${c.ok ? '[ok]' : '[blocked]'} ${c.label}`);
	return lines.join('\n');
}

function resultText(r) {
	return [`${r.summary}.`, `Signature ${r.signature}`, r.explorer].join('\n');
}

const args = (a, auth) => ({ agentId: a.agent_id, userId: auth.userId, venueId: a.venue, token: a.token, amount: a.amount, all: a.all === true, source: 'mcp' });

export const lendingToolDefs = [
	{
		name: 'lend_markets',
		title: 'List lending markets',
		group: 'lending',
		tier: 'read',
		annotations: READ,
		description: 'List every token the agent wallet can supply to the Solana lending market, with supply APY, utilization, available liquidity, the deposit capacity left and the risk parameters. Use this to pick a token and compare yields before lend_preview.',
		inputSchema: { type: 'object', properties: { venue: venueProp }, additionalProperties: false },
		handler: (a, auth) => run(auth, { signIn: false }, async () => {
			const m = await lending.markets({ venueId: a.venue });
			const rows = m.markets.map((r) => `- ${r.symbol}: ${pct(r.supply_apy)} supply APY, ${pct(r.utilization)} utilized, ${usd(r.available_liquidity_usd)} available`);
			return reply([`${m.venue_name} markets (Solana mainnet):`, ...rows].join('\n'), m);
		}),
	},
	{
		name: 'lend_positions',
		title: 'Read lending positions',
		group: 'lending',
		tier: 'read',
		annotations: READ,
		description: 'Read what the agent wallet has supplied to the lending market: each deposit with its APY and projected yearly interest, any debt and health factor, and the earn rule plan if the owner set one. A wallet that never lent returns an empty position. Use this when the owner asks what the agent earns or holds in lending.',
		inputSchema: { type: 'object', properties: { agent_id: agentIdProp, venue: venueProp }, required: ['agent_id'], additionalProperties: false },
		handler: (a, auth) => run(auth, { scope: 'wallet:read' }, async () => {
			const p = await lending.positions({ agentId: a.agent_id, userId: auth.userId, venueId: a.venue });
			const rows = p.deposits.map((d) => `- ${d.amount} ${d.symbol} (${usd(d.value_usd)}) at ${pct(d.supply_apy)} APY`);
			return reply([
				p.has_position ? `${p.venue_name} position:` : `No ${p.venue_name} position. Idle funds earn nothing until supplied.`,
				...rows,
				p.stats?.health_factor != null ? `Health factor ${p.stats.health_factor.toFixed(2)} (floor ${p.health_floor}).` : null,
				p.earn_plan ? `Earn rule plan: ${p.earn_plan.action}${p.earn_plan.action === 'none' ? '' : ` ${p.earn_plan.amount} ${p.earn_plan.token}`} (${p.earn_plan.reason}).` : null,
			].filter(Boolean).join('\n'), p);
		}),
	},
	{
		name: 'lend_preview',
		title: 'Preview a lending deposit or withdraw',
		group: 'lending',
		tier: 'read',
		annotations: READ,
		description: 'Preview supplying to, or withdrawing from, the Solana lending market. Builds the real transaction and simulates it against current mainnet state, then shows from, to, amount, token, program, expected yield, compute units and every guard check. Signs and sends nothing. Use this before lend_deposit or lend_withdraw to show the owner the exact terms. Show the table to the owner, then call lend_deposit or lend_withdraw only after a clear yes.',
		inputSchema: {
			type: 'object',
			properties: { ...previewSchema('withdraw').properties, action: { type: 'string', enum: ['deposit', 'withdraw'] } },
			required: ['agent_id', 'token', 'action'],
			additionalProperties: false,
		},
		handler: (a, auth) => run(auth, { scope: 'wallet:read' }, async () => {
			const p = a.action === 'withdraw' ? await lending.withdraw({ ...args(a, auth), confirm: false }) : await lending.deposit({ ...args(a, auth), confirm: false });
			return reply(previewText(p), p);
		}),
	},
	{
		name: 'lend_deposit',
		title: 'Supply to lending',
		group: 'lending',
		tier: 'financial',
		confirmFlag: 'confirm_lend',
		previewTool: 'lend_preview',
		annotations: FINANCIAL,
		description: 'Supply tokens from the agent wallet to the Solana lending market so idle funds earn interest, signed by the agent wallet under the wallet spend caps. The transaction is simulated first and refused if it would move more than the confirmed amount. Call lend_preview first, show the owner the table, and pass confirm_lend: true only after a clear yes. Use this to put idle agent-wallet funds to work earning interest.',
		inputSchema: financialSchema('deposit'),
		handler: (a, auth) => run(auth, { scope: 'wallet:trade' }, async () => {
			if (a.confirm_lend !== true) return refusal('Not sent: confirm_lend must be true. Call lend_preview, show the owner the table, and ask for a clear yes.', 'confirmation_required');
			const r = await lending.deposit({ ...args(a, auth), confirm: true });
			return reply(resultText(r), r);
		}),
	},
	{
		name: 'lend_withdraw',
		title: 'Withdraw from lending',
		group: 'lending',
		tier: 'financial',
		confirmFlag: 'confirm_lend',
		previewTool: 'lend_preview',
		annotations: FINANCIAL,
		description: 'Withdraw supplied tokens from the Solana lending market back to the agent wallet, or everything with all: true. A withdraw larger than the position is refused before any transaction is built. Call lend_preview first, show the owner the table, and pass confirm_lend: true only after a clear yes. Use this to pull funds back out of lending into the agent wallet.',
		inputSchema: financialSchema('withdraw'),
		handler: (a, auth) => run(auth, { scope: 'wallet:trade' }, async () => {
			if (a.confirm_lend !== true) return refusal('Not sent: confirm_lend must be true. Call lend_preview, show the owner the table, and ask for a clear yes.', 'confirmation_required');
			const r = await lending.withdraw({ ...args(a, auth), confirm: true });
			return reply(resultText(r), r);
		}),
	},
];

export const LENDING_TOOL_NAMES = lendingToolDefs.map((t) => t.name);
