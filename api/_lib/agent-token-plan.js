// Agent token plans: the launch configuration bound to an agent record.
//
// An agent token is the economic object an agent becomes: one coin, on Solana,
// whose identity belongs to the agent rather than to whichever form the owner
// happened to fill in. This module owns that object end to end:
//
//   - normalization of a submitted configuration (`normalizePlanInput`)
//   - the readiness verdict that decides draft vs ready (`planReadiness`)
//   - the launch cost estimate the owner sees before spending (`estimateLaunchCost`)
//   - the DB accessors the API handlers use (get / upsert / markLaunched / delete)
//
// Everything above `getPlan` is pure so the rules are unit-testable without a
// database or a chain. Solana is the home chain: `network` is 'mainnet' or
// 'devnet' and nothing here has an EVM leg.
//
// The plan never spends. It is configuration plus a free proof lane (see the
// `plan-dry-run` action in api/agents/tokens/[action].js, which compiles and
// simulates the real launch instructions without broadcasting). The only writes
// that cost money live on the existing launch paths, which call
// `markPlanLaunched` once a real mint confirms.

import { sql } from './db.js';
import { recordFunnelStep } from './launch-funnel.js';

/** Hard bounds, mirrored by the zod schema on the API and by the SQL checks. */
export const PLAN_LIMITS = {
	nameMax: 32,
	symbolMin: 2,
	symbolMax: 10,
	descriptionMax: 280,
	solBuyInMax: 50,
	usdcBuyInMax: 1_000_000,
	buybackBpsMax: 10_000,
};

export const COIN_TYPES = ['regular', 'mayhem', 'agent'];
export const QUOTE_CURRENCIES = ['sol', 'usdc'];
export const NETWORKS = ['mainnet', 'devnet'];

// Conservative upper bounds for a pump.fun create, in SOL. These are the rents
// and fees the launch transaction pays regardless of any dev buy: they are the
// same numbers the /api/agents/tokens/launch-quote endpoint quotes, exported
// from here so the quote and the plan can never disagree about what a launch
// costs.
export const FIXED_LAUNCH_COST_SOL = {
	mintRent: 0.00146,
	bondingCurveRent: 0.00203,
	metadataRent: 0.00561,
	txFee: 0.000005,
};

export const FIXED_LAUNCH_TOTAL_SOL =
	FIXED_LAUNCH_COST_SOL.mintRent +
	FIXED_LAUNCH_COST_SOL.bondingCurveRent +
	FIXED_LAUNCH_COST_SOL.metadataRent +
	FIXED_LAUNCH_COST_SOL.txFee;

// pump.fun takes ~1% of an initial buy as protocol fee.
const PROTOCOL_FEE_RATE = 0.01;

const str = (v) => (typeof v === 'string' ? v.trim() : '');
const num = (v) => {
	const n = typeof v === 'string' ? Number(v) : v;
	return Number.isFinite(n) ? n : 0;
};

/**
 * Normalize a submitted plan configuration into the exact shape the table
 * stores. Pure: no DB, no chain, no clock. Out-of-range numbers are clamped
 * rather than rejected so a slider that overshoots by a hair still saves; the
 * shape errors that matter (missing name/symbol, a symbol with punctuation in
 * it) are the readiness check's job, which reports them to the owner instead of
 * throwing them away.
 *
 * @param {object} raw
 * @returns {{
 *   network: string, name: string, symbol: string, description: string,
 *   image_url: string|null, website: string|null, twitter: string|null,
 *   telegram: string|null, coin_type: string, quote_currency: string,
 *   buyback_bps: number, sol_buy_in: number, usdc_buy_in: number
 * }}
 */
export function normalizePlanInput(raw = {}) {
	const network = NETWORKS.includes(raw.network) ? raw.network : 'mainnet';
	const coinType = COIN_TYPES.includes(raw.coin_type) ? raw.coin_type : 'agent';
	const quoteCurrency = QUOTE_CURRENCIES.includes(raw.quote_currency) ? raw.quote_currency : 'sol';

	const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
	// A buyback share only means anything on an agent-bound coin: the on-chain
	// pump agent that enforces it is only created for coin_type 'agent'.
	const buybackBps = coinType === 'agent'
		? Math.round(clamp(num(raw.buyback_bps), 0, PLAN_LIMITS.buybackBpsMax))
		: 0;

	// The dev buy is denominated in the quote currency. Carrying a stale amount
	// in the other currency would silently spend it if the owner flipped the
	// pairing back, so the inactive leg is zeroed at save time.
	const solBuyIn = quoteCurrency === 'sol'
		? clamp(num(raw.sol_buy_in), 0, PLAN_LIMITS.solBuyInMax)
		: 0;
	const usdcBuyIn = quoteCurrency === 'usdc'
		? clamp(num(raw.usdc_buy_in), 0, PLAN_LIMITS.usdcBuyInMax)
		: 0;

	const optional = (v) => str(v) || null;

	return {
		network,
		name: str(raw.name).slice(0, PLAN_LIMITS.nameMax),
		symbol: str(raw.symbol).toUpperCase().slice(0, PLAN_LIMITS.symbolMax),
		description: str(raw.description).slice(0, PLAN_LIMITS.descriptionMax),
		image_url: optional(raw.image_url ?? raw.image),
		website: optional(raw.website),
		twitter: optional(raw.twitter),
		telegram: optional(raw.telegram),
		coin_type: coinType,
		quote_currency: quoteCurrency,
		buyback_bps: buybackBps,
		sol_buy_in: solBuyIn,
		usdc_buy_in: usdcBuyIn,
	};
}

const HTTP_URL = /^https?:\/\/\S+$/i;
const SYMBOL_OK = /^[A-Z0-9]+$/;

/**
 * Is this configuration launchable, and if not, what exactly is missing?
 *
 * Readiness is reported, never enforced by deletion: a draft keeps every field
 * the owner already filled in and simply lists what remains. `blockers` are the
 * reasons a launch would fail or embarrass; `warnings` are things that will
 * work but that the owner probably did not intend.
 *
 * @param {object} plan A normalized plan (or a stored row).
 * @returns {{ ready: boolean, blockers: string[], warnings: string[] }}
 */
export function planReadiness(plan = {}) {
	const blockers = [];
	const warnings = [];

	const name = str(plan.name);
	const symbol = str(plan.symbol);

	if (!name) blockers.push('Give the coin a name.');
	else if (name.length > PLAN_LIMITS.nameMax) blockers.push(`Name must be ${PLAN_LIMITS.nameMax} characters or fewer.`);

	if (!symbol) blockers.push('Give the coin a ticker symbol.');
	else if (symbol.length < PLAN_LIMITS.symbolMin) blockers.push(`Symbol must be at least ${PLAN_LIMITS.symbolMin} characters.`);
	else if (symbol.length > PLAN_LIMITS.symbolMax) blockers.push(`Symbol must be ${PLAN_LIMITS.symbolMax} characters or fewer.`);
	else if (!SYMBOL_OK.test(symbol)) blockers.push('Symbol must be letters and digits only.');

	for (const [field, label] of [
		['image_url', 'Image URL'],
		['website', 'Website'],
		['twitter', 'X profile'],
		['telegram', 'Telegram'],
	]) {
		const v = str(plan[field]);
		if (v && !HTTP_URL.test(v)) blockers.push(`${label} must be a full http(s) URL.`);
	}

	if (!str(plan.description)) warnings.push('No description: the coin page will show only the name and ticker.');
	if (!str(plan.image_url)) warnings.push('No image: the coin will launch without artwork.');

	if (plan.coin_type === 'agent' && num(plan.buyback_bps) === 0) {
		warnings.push('Buyback share is 0%: the agent will not buy back its own coin from what it earns.');
	}
	if (plan.coin_type !== 'agent' && num(plan.buyback_bps) > 0) {
		warnings.push('Buyback share is ignored: only an agent-bound coin can run buybacks.');
	}
	if (num(plan.sol_buy_in) === 0 && num(plan.usdc_buy_in) === 0) {
		warnings.push('No dev buy: the agent will not hold any of its own coin at launch.');
	}

	return { ready: blockers.length === 0, blockers, warnings };
}

/**
 * What this launch will cost, in SOL, broken out so the owner can see rent and
 * fees separately from the money that actually goes into the curve. A
 * USDC-paired dev buy moves no SOL, so it is reported on its own line and the
 * SOL total covers only rent + fees.
 *
 * @param {object} plan A normalized plan (or a stored row).
 * @returns {{
 *   fixed: typeof FIXED_LAUNCH_COST_SOL, fixed_total_sol: number,
 *   dev_buy_sol: number, protocol_fee_sol: number, total_sol: number,
 *   dev_buy_usdc: number, quote_currency: string
 * }}
 */
export function estimateLaunchCost(plan = {}) {
	const quoteCurrency = QUOTE_CURRENCIES.includes(plan.quote_currency) ? plan.quote_currency : 'sol';
	const devBuySol = quoteCurrency === 'sol' ? Math.max(0, num(plan.sol_buy_in)) : 0;
	const devBuyUsdc = quoteCurrency === 'usdc' ? Math.max(0, num(plan.usdc_buy_in)) : 0;
	const protocolFeeSol = devBuySol * PROTOCOL_FEE_RATE;

	return {
		fixed: { ...FIXED_LAUNCH_COST_SOL },
		fixed_total_sol: FIXED_LAUNCH_TOTAL_SOL,
		dev_buy_sol: devBuySol,
		protocol_fee_sol: protocolFeeSol,
		total_sol: FIXED_LAUNCH_TOTAL_SOL + devBuySol + protocolFeeSol,
		dev_buy_usdc: devBuyUsdc,
		quote_currency: quoteCurrency,
	};
}

/**
 * Public JSON shape for a stored plan row. Numeric columns come back from
 * Postgres as strings, so they are coerced here once rather than at every
 * consumer. Readiness and the cost estimate are derived, never stored, so an
 * edit to the rules applies to plans saved before the rules changed.
 *
 * @param {object|null} row
 * @returns {object|null}
 */
export function shapePlan(row) {
	if (!row) return null;
	const plan = {
		id: row.id,
		agent_id: row.agent_id,
		network: row.network,
		name: row.name || '',
		symbol: row.symbol || '',
		description: row.description || '',
		image_url: row.image_url || null,
		website: row.website || null,
		twitter: row.twitter || null,
		telegram: row.telegram || null,
		coin_type: row.coin_type,
		quote_currency: row.quote_currency,
		buyback_bps: Number(row.buyback_bps) || 0,
		sol_buy_in: Number(row.sol_buy_in) || 0,
		usdc_buy_in: Number(row.usdc_buy_in) || 0,
		status: row.status,
		mint: row.mint || null,
		launched_at: row.launched_at || null,
		last_dry_run_at: row.last_dry_run_at || null,
		last_dry_run: row.last_dry_run || null,
		created_at: row.created_at || null,
		updated_at: row.updated_at || null,
	};
	return {
		...plan,
		readiness: planReadiness(plan),
		cost_estimate: estimateLaunchCost(plan),
	};
}

// ── Storage ──────────────────────────────────────────────────────────────────

/**
 * The plan for one agent on one network, or null.
 * @param {{ agentId: string, network?: string }} o
 */
export async function getPlan({ agentId, network = 'mainnet' }) {
	if (!agentId) return null;
	const [row] = await sql`
		select * from agent_token_plans
		where agent_id = ${agentId} and network = ${network}
		limit 1
	`;
	return row || null;
}

/** Every plan an agent holds, newest-updated first (mainnet and devnet). */
export async function listPlansForAgent(agentId) {
	if (!agentId) return [];
	return sql`
		select * from agent_token_plans
		where agent_id = ${agentId}
		order by updated_at desc
	`;
}

/**
 * Create or replace the plan for (agent, network). A launched plan is immutable:
 * its configuration is what actually minted, so editing it would rewrite
 * history. The caller gets `{ locked: true }` back and nothing is written.
 *
 * @param {{ agentId: string, userId: string, input: object }} o
 * @returns {Promise<{ locked: boolean, row: object|null }>}
 */
export async function upsertPlan({ agentId, userId, input }) {
	const plan = normalizePlanInput(input);
	const { ready } = planReadiness(plan);
	const status = ready ? 'ready' : 'draft';

	const existing = await getPlan({ agentId, network: plan.network });
	if (existing && existing.status === 'launched') {
		return { locked: true, row: existing };
	}

	const [row] = await sql`
		insert into agent_token_plans
			(agent_id, user_id, network, name, symbol, description, image_url,
			 website, twitter, telegram, coin_type, quote_currency, buyback_bps,
			 sol_buy_in, usdc_buy_in, status)
		values
			(${agentId}, ${userId}, ${plan.network}, ${plan.name}, ${plan.symbol},
			 ${plan.description}, ${plan.image_url}, ${plan.website}, ${plan.twitter},
			 ${plan.telegram}, ${plan.coin_type}, ${plan.quote_currency},
			 ${plan.buyback_bps}, ${plan.sol_buy_in}, ${plan.usdc_buy_in}, ${status}, false)
		on conflict (agent_id, network) do update set
			name = excluded.name,
			symbol = excluded.symbol,
			description = excluded.description,
			image_url = excluded.image_url,
			website = excluded.website,
			twitter = excluded.twitter,
			telegram = excluded.telegram,
			coin_type = excluded.coin_type,
			quote_currency = excluded.quote_currency,
			buyback_bps = excluded.buyback_bps,
			sol_buy_in = excluded.sol_buy_in,
			usdc_buy_in = excluded.usdc_buy_in,
			status = excluded.status,
			auto_drafted = false,
			updated_at = now()
		returning *
	`;
	return { locked: false, row: row || null };
}

/** Drop the plan for (agent, network). A launched plan is kept: it is a record. */
export async function deletePlan({ agentId, network = 'mainnet' }) {
	const rows = await sql`
		delete from agent_token_plans
		where agent_id = ${agentId} and network = ${network} and status <> 'launched'
		returning id
	`;
	return rows.length > 0;
}

/**
 * Record the free proof run against the plan, so the owner can see the last
 * verdict without re-running it.
 *
 * @param {{ agentId: string, network: string, result: object }} o
 */
export async function recordDryRun({ agentId, network, result }) {
	const [row] = await sql`
		update agent_token_plans
		set last_dry_run = ${JSON.stringify(result)}::jsonb,
		    last_dry_run_at = now(),
		    updated_at = now()
		where agent_id = ${agentId} and network = ${network}
		returning *
	`;
	return row || null;
}

/**
 * Bind a confirmed on-chain launch back to the plan it came from. Idempotent and
 * safe to call when no plan exists (the launch paths accept a launch configured
 * inline, without a saved plan). It simply writes nothing and returns null.
 *
 * @param {{ agentId: string, network: string, mint: string }} o
 * @returns {Promise<object|null>} the launched plan row, or null
 */
export async function markPlanLaunched({ agentId, network, mint }) {
	if (!agentId || !mint || !NETWORKS.includes(network)) return null;
	const [row] = await sql`
		update agent_token_plans
		set status = 'launched',
		    mint = ${mint},
		    launched_at = now(),
		    updated_at = now()
		where agent_id = ${agentId} and network = ${network} and status <> 'launched'
		returning *
	`;
	// The funnel counts the launch whether or not a saved plan existed. A retry
	// may add a second row; the report counts distinct agents per step.
	await recordFunnelStep({ agentId, step: 'launch_succeeded', network });
	return row || null;
}

// ── Auto-drafted plan ────────────────────────────────────────────────────────

/** First sentence of a block of text, capped to the description limit. */
function firstSentence(text) {
	const t = str(text).replace(/\s+/g, ' ');
	if (!t) return '';
	const m = t.match(/^.+?[.!?](?=\s|$)/);
	return (m ? m[0] : t).slice(0, PLAN_LIMITS.descriptionMax);
}

/**
 * A ticker from an agent name: the first word's letters and digits, upper-cased
 * and capped at 6. Names with no latin letters or digits fall back to AGENT so
 * every draft is launchable as it stands.
 */
function symbolFromName(name) {
	const words = str(name).toUpperCase().split(/\s+/);
	for (const w of words) {
		const clean = w.replace(/[^A-Z0-9]/g, '').slice(0, 6);
		if (clean.length >= PLAN_LIMITS.symbolMin) return clean;
	}
	const all = str(name).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
	return all.length >= PLAN_LIMITS.symbolMin ? all : 'AGENT';
}

/**
 * The coin plan the platform proposes for an agent, from its own name and
 * persona. Pure. The coin is mainnet, agent-bound, SOL-paired, with no dev buy
 * and no buyback: the owner decides what money goes in.
 *
 * @param {{ name?: string, description?: string|null, persona_prompt?: string|null }} agent
 * @param {{ imageUrl?: string|null }} [opts] an already-public image for the coin
 */
export function deriveDraftPlan(agent = {}, { imageUrl = null } = {}) {
	const name = str(agent.name).replace(/\s+/g, ' ').slice(0, PLAN_LIMITS.nameMax).trim();
	return normalizePlanInput({
		network: 'mainnet',
		name: /[A-Za-z0-9]/.test(name) ? name : 'My Agent',
		symbol: symbolFromName(name),
		description: firstSentence(agent.description) || firstSentence(agent.persona_prompt),
		image_url: imageUrl,
		coin_type: 'agent',
		quote_currency: 'sol',
	});
}

/**
 * Create the agent's draft coin plan if it has none on mainnet. Idempotent
 * (`on conflict do nothing`: an owner's saved plan is never overwritten) and
 * never throws, so it can sit on the agent-creation path. The row is always a
 * 'draft' flagged `auto_drafted`: visitors never see it, and it becomes the
 * owner's plan only when they save it.
 *
 * @param {{ agent: object, imageUrl?: string|null }} o
 * @returns {Promise<{ created: boolean, row: object|null }>}
 */
export async function ensureDraftPlan({ agent, imageUrl = null }) {
	if (!agent?.id || !agent?.user_id) return { created: false, row: null };
	try {
		const plan = deriveDraftPlan(agent, { imageUrl });
		const [row] = await sql`
			insert into agent_token_plans
				(agent_id, user_id, network, name, symbol, description, image_url,
				 coin_type, quote_currency, buyback_bps, sol_buy_in, usdc_buy_in,
				 status, auto_drafted)
			values
				(${agent.id}, ${agent.user_id}, ${plan.network}, ${plan.name}, ${plan.symbol},
				 ${plan.description}, ${plan.image_url}, ${plan.coin_type}, ${plan.quote_currency},
				 ${plan.buyback_bps}, ${plan.sol_buy_in}, ${plan.usdc_buy_in}, 'draft', true)
			on conflict (agent_id, network) do nothing
			returning *
		`;
		if (!row) return { created: false, row: null };
		await recordFunnelStep({ agentId: agent.id, userId: agent.user_id, step: 'plan_drafted', network: plan.network });
		return { created: true, row };
	} catch (err) {
		console.warn('[agent-token-plan] auto-draft failed:', err?.message);
		return { created: false, row: null };
	}
}

/**
 * Put a newly created agent on the coin path: make sure it holds a custodial
 * Solana wallet that can sign the launch, then draft its coin plan. Every
 * agent-creation surface calls this, so the agent home leads with the coin no
 * matter where the agent was born. Idempotent and never throws: a wallet that
 * cannot be minted now is minted lazily on first use, and the draft is still
 * written so the owner sees the plan. An agent that already launched a coin
 * gets no draft.
 *
 * @param {{ agent: { id: string, user_id: string, name?: string, meta?: object|null }, imageUrl?: string|null }} o
 * @returns {Promise<{ wallet: string|null, plan: { created: boolean, row: object|null } }>}
 */
export async function ensureAgentLaunchPath({ agent, imageUrl = null }) {
	const none = { created: false, row: null };
	if (!agent?.id || !agent?.user_id) return { wallet: null, plan: none };
	let wallet = agent.meta?.solana_address || null;
	if (!wallet) {
		try {
			const { getOrCreateAgentSolanaWallet } = await import('./agent-wallet.js');
			wallet = (await getOrCreateAgentSolanaWallet(agent.id))?.address || null;
		} catch (err) {
			console.warn('[agent-token-plan] solana wallet provisioning deferred:', err?.message);
		}
	}
	if (agent.meta?.token) return { wallet, plan: none };
	const plan = await ensureDraftPlan({ agent, imageUrl });
	return { wallet, plan };
}
