// @ts-check
// Agent earnings read model: the single computation behind
// GET /api/agents/:id/earnings and GET /api/leaderboard/earnings, so an agent's
// own page and its leaderboard row can never disagree.
//
// An agent earns two ways, and both are counted here:
//
//   creator fees    pump.fun creator fees on the coins it launched, from the
//                   agent_coin_earnings snapshot (api/_lib/creator-earnings-snapshot.js).
//                   pump.fun reports these per creator WALLET, so a wallet's
//                   figure counts toward an agent only when that wallet is the
//                   agent's own custodial wallet (agent_identities.meta.solana_address)
//                   and no other agent's coin on file shares it. A coin whose
//                   fees go to any other wallet (an owner's connected wallet, a
//                   launch sponsor) is listed but not counted: that wallet's
//                   total can include coins launched anywhere.
//   service income  x402 skill sales (agent_revenue_events, USDC net of the
//                   platform fee) and hires by other agents (agent_hires,
//                   completed). USDC is valued 1:1 in USD.
//   invoice income  agent commerce invoices paid on Solana mainnet
//                   (agent_commerce_invoices, api/_lib/agent-commerce/), in
//                   USDC, SOL or $THREE, valued in USD at the moment the
//                   watcher verified the payment. Offer sales are invoices too.
//
// Windows: 'all' uses the lifetime creator-fee totals; '24h' sums the 30-minute
// fee buckets of the last 24 hours; '7d' and '30d' sum UTC-day buckets (today
// plus the previous 6 or 29 days). Service income uses the same time range.
// Everything is converted at one SOL/USD price per call (solPriceUsd()).

import { sql } from './db.js';
import { solPriceUsd } from './sol-price.js';
import { SOLANA_USDC_MINT } from '../payments/_config.js';
import { publicUrl as r2PublicUrl } from './r2.js';

// A portrait is decoration: a misconfigured public-URL resolver degrades it to
// null instead of failing the board.
function safeR2Url(key) {
	if (!key) return null;
	try {
		return r2PublicUrl(key);
	} catch {
		return null;
	}
}

export const EARNINGS_WINDOWS = /** @type {const} */ (['24h', '7d', '30d', 'all']);
const DAY_MS = 86_400_000;

/** @param {unknown} w */
export function normalizeWindow(w) {
	return EARNINGS_WINDOWS.includes(/** @type {any} */ (w)) ? /** @type {'24h'|'7d'|'30d'|'all'} */ (w) : 'all';
}

/**
 * The time range a window covers, `back` windows ago (0 = current, 1 = the one
 * before it, used for rank movement). 'all' has no range.
 * @param {'24h'|'7d'|'30d'|'all'} window
 * @param {number} [back]
 * @param {number} [now]
 * @returns {{ interval: '30m'|'1d', start: Date, end: Date } | null}
 */
export function windowRange(window, back = 0, now = Date.now()) {
	if (window === 'all') return null;
	if (window === '24h') {
		const end = new Date(now - back * DAY_MS);
		return { interval: '30m', start: new Date(end.getTime() - DAY_MS), end };
	}
	const days = window === '7d' ? 7 : 30;
	const todayStart = Math.floor(now / DAY_MS) * DAY_MS;
	const end = new Date(todayStart + DAY_MS - back * days * DAY_MS);
	return { interval: '1d', start: new Date(end.getTime() - days * DAY_MS), end };
}

export function earningsMethod(window) {
	const range =
		window === 'all'
			? 'lifetime totals'
			: window === '24h'
				? 'the last 24 hours, summed from 30-minute buckets'
				: `the last ${window === '7d' ? 7 : 30} UTC days including today, summed from daily buckets`;
	return (
		`Creator fees come from pump.fun's creator-fee index for each coin's on-chain fee recipient ` +
		`(read from the bonding curve or AMM pool), refreshed every 30 minutes into a snapshot; ` +
		`unclaimed is the creator vault balance read on-chain, claimed is earned minus unclaimed. ` +
		`pump.fun reports fees per creator wallet, so a wallet counts toward an agent only when it is ` +
		`that agent's own custodial wallet; coins paying any other wallet are listed but not counted. ` +
		`Service income is x402 skill sales (net, USDC) plus completed hires by other agents, valued 1:1 in USD, ` +
		`plus invoices paid on Solana mainnet, valued in USD when the payment was verified. ` +
		`Figures cover ${range}. SOL and USD are converted at one live SOL/USD price. Devnet coins are excluded.`
	);
}

const lamportsToSol = (v) => (v == null ? null : Number(BigInt(v)) / 1e9);
const round = (n, dp) => (n == null || !Number.isFinite(n) ? null : Math.round(n * 10 ** dp) / 10 ** dp);

/**
 * Per-agent creator-fee lamports for a window, plus lifetime claimed/unclaimed.
 * Only counted wallets (see header). `agentId` narrows to one agent; `publicOnly`
 * keeps the leaderboard to public agents.
 */
async function creatorFeeRows(window, { agentId = null, publicOnly = false, back = 0 } = {}) {
	const range = windowRange(window, back);
	const agentFilter = agentId ? sql`and e.agent_id = ${agentId}` : sql``;
	const publicFilter = publicOnly ? sql`and ai.is_public = true` : sql``;
	const windowed = range
		? sql`
			left join (
				select creator, sum(fee_lamports) as fee
				from creator_fee_buckets
				where bucket_interval = ${range.interval}
				  and bucket_start >= ${range.start.toISOString()}
				  and bucket_start < ${range.end.toISOString()}
				group by creator
			) b on b.creator = w.creator`
		: sql``;
	const value = range ? sql`coalesce(b.fee, 0)` : sql`coalesce(w.earned_lamports, 0)`;
	return sql`
		with w as (
			select distinct on (e.creator)
				e.creator, e.agent_id, e.earned_lamports, e.claimed_lamports, e.unclaimed_lamports, e.refreshed_at
			from agent_coin_earnings e
			join agent_identities ai on ai.id = e.agent_id and ai.deleted_at is null
			where e.network = 'mainnet'
			  and e.source = 'pumpfun_creator_fees'
			  and e.wallet_agent_count = 1
			  and e.creator = ai.meta->>'solana_address'
			  ${agentFilter}
			  ${publicFilter}
			order by e.creator, e.refreshed_at desc nulls last
		)
		select w.agent_id,
		       sum(${value})::text as lamports,
		       sum(coalesce(w.earned_lamports, 0))::text as lifetime_lamports,
		       sum(coalesce(w.claimed_lamports, 0))::text as claimed_lamports,
		       sum(coalesce(w.unclaimed_lamports, 0))::text as unclaimed_lamports,
		       min(w.refreshed_at) as refreshed_at
		from w
		${windowed}
		group by w.agent_id
	`;
}

/** Skill sales (USDC net), completed hires and paid invoices, per agent, for a window. */
async function serviceRows(window, { agentId = null, publicOnly = false, back = 0 } = {}) {
	const range = windowRange(window, back);
	const salesRange = range
		? sql`and r.created_at >= ${range.start.toISOString()} and r.created_at < ${range.end.toISOString()}`
		: sql``;
	const hireRange = range
		? sql`and coalesce(h.completed_at, h.created_at) >= ${range.start.toISOString()}
		      and coalesce(h.completed_at, h.created_at) < ${range.end.toISOString()}`
		: sql``;
	const invoiceRange = range
		? sql`and i.paid_at >= ${range.start.toISOString()} and i.paid_at < ${range.end.toISOString()}`
		: sql``;
	const salesAgent = agentId ? sql`and r.agent_id = ${agentId}` : sql``;
	const hireAgent = agentId ? sql`and h.provider_agent_id = ${agentId}` : sql``;
	const invoiceAgent = agentId ? sql`and i.agent_id = ${agentId}` : sql``;
	const publicFilter = publicOnly ? sql`and ai.is_public = true` : sql``;
	const [sales, hires, invoices] = await Promise.all([
		sql`
			select r.agent_id, sum(r.net_amount)::text as atomics, count(*)::int as n
			from agent_revenue_events r
			join agent_identities ai on ai.id = r.agent_id and ai.deleted_at is null
			where r.currency_mint = ${SOLANA_USDC_MINT} ${salesRange} ${salesAgent} ${publicFilter}
			group by r.agent_id
		`,
		sql`
			select h.provider_agent_id as agent_id, coalesce(sum(h.usd), 0)::float8 as usd, count(*)::int as n
			from agent_hires h
			join agent_identities ai on ai.id = h.provider_agent_id and ai.deleted_at is null
			where h.status = 'completed' ${hireRange} ${hireAgent} ${publicFilter}
			group by h.provider_agent_id
		`,
		sql`
			select i.agent_id, coalesce(sum(i.paid_usd), 0)::float8 as usd, count(*)::int as n
			from agent_commerce_invoices i
			join agent_identities ai on ai.id = i.agent_id and ai.deleted_at is null
			where i.status = 'paid' and i.network = 'mainnet' and i.paid_usd is not null
			  ${invoiceRange} ${invoiceAgent} ${publicFilter}
			group by i.agent_id
		`,
	]);
	return { sales, hires, invoices };
}

/**
 * Totals per agent for one window, as plain numbers, keyed by agent id.
 * @returns {Promise<Map<string, { creator_lamports: bigint, lifetime_lamports: bigint, claimed_lamports: bigint, unclaimed_lamports: bigint, refreshed_at: any, skill_sales_usd: number, skill_sales_count: number, hires_usd: number, hires_count: number, invoices_usd: number, invoices_count: number }>>}
 */
async function totalsByAgent(window, opts) {
	const [fees, service] = await Promise.all([creatorFeeRows(window, opts), serviceRows(window, opts)]);
	const out = new Map();
	const get = (id) => {
		let row = out.get(id);
		if (!row) {
			row = {
				creator_lamports: 0n,
				lifetime_lamports: 0n,
				claimed_lamports: 0n,
				unclaimed_lamports: 0n,
				refreshed_at: null,
				skill_sales_usd: 0,
				skill_sales_count: 0,
				hires_usd: 0,
				hires_count: 0,
				invoices_usd: 0,
				invoices_count: 0,
			};
			out.set(id, row);
		}
		return row;
	};
	for (const f of fees) {
		const row = get(f.agent_id);
		row.creator_lamports = BigInt(f.lamports || 0);
		row.lifetime_lamports = BigInt(f.lifetime_lamports || 0);
		row.claimed_lamports = BigInt(f.claimed_lamports || 0);
		row.unclaimed_lamports = BigInt(f.unclaimed_lamports || 0);
		row.refreshed_at = f.refreshed_at;
	}
	for (const s of service.sales) {
		const row = get(s.agent_id);
		row.skill_sales_usd = Number(BigInt(s.atomics || 0)) / 1e6;
		row.skill_sales_count = s.n;
	}
	for (const h of service.hires) {
		const row = get(h.agent_id);
		row.hires_usd = Number(h.usd) || 0;
		row.hires_count = h.n;
	}
	for (const i of service.invoices) {
		const row = get(i.agent_id);
		row.invoices_usd = Number(i.usd) || 0;
		row.invoices_count = i.n;
	}
	return out;
}

/**
 * Shape one agent's totals into the public figures. Exported so both endpoints
 * shape identically.
 */
export function shapeTotals(t, price) {
	const creatorSol = Number(t.creator_lamports) / 1e9;
	const serviceUsd = serviceIncomeUsd(t);
	const serviceSol = price > 0 ? serviceUsd / price : null;
	const totalSol = creatorSol + (serviceSol ?? 0);
	return {
		creator_fees: {
			lamports: t.creator_lamports.toString(),
			sol: round(creatorSol, 9),
			usd: price > 0 ? round(creatorSol * price, 2) : null,
		},
		service_income: {
			skill_sales_usd: round(t.skill_sales_usd, 2),
			skill_sales_count: t.skill_sales_count,
			hires_usd: round(t.hires_usd, 2),
			hires_count: t.hires_count,
			invoices_usd: round(t.invoices_usd || 0, 2),
			invoices_count: t.invoices_count || 0,
			usd: round(serviceUsd, 2),
			sol: serviceSol == null ? null : round(serviceSol, 9),
		},
		total: {
			sol: round(totalSol, 9),
			usd: price > 0 ? round(totalSol * price, 2) : serviceUsd > 0 ? round(serviceUsd, 2) : null,
		},
	};
}

/** Skill sales, hires and paid invoices, in USD. */
export const serviceIncomeUsd = (t) => t.skill_sales_usd + t.hires_usd + (t.invoices_usd || 0);

const rankKey = (t, price) => Number(t.creator_lamports) / 1e9 + (price > 0 ? serviceIncomeUsd(t) / price : 0);

/** Ranked public agents for a window (only agents that earned something). */
async function rankedAgents(window, price, back = 0) {
	const totals = await totalsByAgent(window, { publicOnly: true, back });
	return [...totals.entries()]
		.map(([agentId, t]) => ({ agentId, t, key: rankKey(t, price) }))
		.filter((r) => r.key > 0)
		.sort((a, b) => b.key - a.key || String(a.agentId).localeCompare(String(b.agentId)));
}

/**
 * One agent's earnings: windowed totals, lifetime creator-fee figures, the
 * per-coin breakdown, and its recorded claims.
 * @param {{ id: string, name: string, is_public: boolean, solana_address: string | null }} agent
 * @param {{ window?: string }} [opts]
 */
export async function getAgentEarnings(agent, { window: rawWindow = 'all' } = {}) {
	const window = normalizeWindow(rawWindow);
	const [price, totals, lifetimeTotals, coins, devnet, claims] = await Promise.all([
		solPriceUsd(),
		totalsByAgent(window, { agentId: agent.id }),
		window === 'all' ? null : totalsByAgent('all', { agentId: agent.id }),
		sql`
			select pam.mint, pam.name, pam.symbol, pam.created_at,
			       e.creator, e.earned_lamports::text, e.claimed_lamports::text, e.unclaimed_lamports::text,
			       e.wallet_coin_count, e.wallet_agent_count, e.source, e.error, e.refreshed_at, e.attempted_at
			from pump_agent_mints pam
			left join agent_coin_earnings e on e.mint = pam.mint and e.network = pam.network
			where pam.agent_id = ${agent.id} and pam.network = 'mainnet'
			order by pam.created_at desc
		`,
		sql`select count(*)::int as n from pump_agent_mints where agent_id = ${agent.id} and network = 'devnet'`,
		recentClaims(agent.id),
	]);
	const t = totals.get(agent.id) || emptyTotals();
	const life = (lifetimeTotals ? lifetimeTotals.get(agent.id) : totals.get(agent.id)) || emptyTotals();
	const shaped = shapeTotals(t, price);
	const lifeSol = (v) => round(Number(v) / 1e9, 9);
	const usd = (sol) => (price > 0 && sol != null ? round(sol * price, 2) : null);

	const coinRows = coins.map((c) => shapeCoin(c, agent.solana_address, price));
	const refreshedTimes = coinRows.map((c) => c.refreshed_at).filter(Boolean).map((d) => new Date(d).getTime());
	const refreshedAt = refreshedTimes.length ? new Date(Math.min(...refreshedTimes)).toISOString() : null;

	let rank = null;
	if (agent.is_public) rank = await agentRank(agent.id, window === 'all' ? '7d' : window, price);

	return {
		agent: { id: agent.id, name: agent.name, url: `/agents/${agent.id}` },
		network: 'mainnet',
		window,
		sol_price_usd: price > 0 ? price : null,
		has_coins: coins.length > 0,
		devnet_coins_excluded: devnet[0]?.n || 0,
		...shaped,
		lifetime_creator_fees: {
			earned_sol: lifeSol(life.lifetime_lamports),
			earned_usd: usd(lifeSol(life.lifetime_lamports)),
			claimed_sol: lifeSol(life.claimed_lamports),
			claimed_usd: usd(lifeSol(life.claimed_lamports)),
			unclaimed_sol: lifeSol(life.unclaimed_lamports),
			unclaimed_usd: usd(lifeSol(life.unclaimed_lamports)),
		},
		coins: coinRows,
		claims,
		rank,
		refreshed_at: refreshedAt,
		stale: refreshedAt ? Date.now() - new Date(refreshedAt).getTime() > 2 * 3_600_000 : false,
		method: earningsMethod(window),
	};
}

function emptyTotals() {
	return {
		creator_lamports: 0n,
		lifetime_lamports: 0n,
		claimed_lamports: 0n,
		unclaimed_lamports: 0n,
		refreshed_at: null,
		skill_sales_usd: 0,
		skill_sales_count: 0,
		hires_usd: 0,
		hires_count: 0,
		invoices_usd: 0,
		invoices_count: 0,
	};
}

function shapeCoin(c, agentWallet, price) {
	const reported = c.source === 'pumpfun_creator_fees' && c.earned_lamports != null;
	const counted = reported && c.creator === agentWallet && Number(c.wallet_agent_count) === 1;
	const earnedSol = reported ? lamportsToSol(c.earned_lamports) : null;
	return {
		mint: c.mint,
		name: c.name,
		symbol: c.symbol,
		url: `/launches/${c.mint}`,
		launched_at: c.created_at,
		creator: c.creator || null,
		status: !reported ? 'not_reported' : counted ? 'counted' : 'other_wallet',
		earned_sol: earnedSol,
		earned_usd: price > 0 && earnedSol != null ? round(earnedSol * price, 2) : null,
		claimed_sol: reported ? lamportsToSol(c.claimed_lamports) : null,
		unclaimed_sol: reported ? lamportsToSol(c.unclaimed_lamports) : null,
		wallet_coin_count: c.wallet_coin_count ?? null,
		refreshed_at: c.refreshed_at || null,
		error: c.error || null,
	};
}

/**
 * Recorded creator-fee claims for an agent: autonomous claims (launcher_claims)
 * and owner-triggered claims (agent_actions 'pumpfun.collect_creator_fee').
 * A claim sweeps every coin of the wallet at once, so `mint` names the coin the
 * claim was started from.
 */
async function recentClaims(agentId) {
	const [launcher, studio] = await Promise.all([
		sql`
			select claim_sig as signature, claimed_lamports::text as lamports, mint, created_at
			from launcher_claims
			where agent_id = ${agentId} and network = 'mainnet' and claim_sig is not null
			order by created_at desc limit 20
		`,
		sql`
			select payload->>'signature' as signature, payload->>'lamports' as lamports,
			       payload->>'mint' as mint, created_at
			from agent_actions
			where agent_id = ${agentId} and type = 'pumpfun.collect_creator_fee'
			  and coalesce(payload->>'network', 'mainnet') = 'mainnet'
			  and payload->>'signature' is not null
			order by created_at desc limit 20
		`,
	]);
	const rows = [
		...launcher.map((r) => ({ ...r, source: 'autonomous' })),
		...studio.map((r) => ({ ...r, source: 'owner' })),
	];
	rows.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
	return rows.slice(0, 20).map((r) => ({
		signature: r.signature,
		sol: r.lamports != null && /^\d+$/.test(String(r.lamports)) ? lamportsToSol(r.lamports) : null,
		mint: r.mint,
		at: r.created_at,
		source: r.source,
		explorer: `https://solscan.io/tx/${r.signature}`,
	}));
}

/** Rank of one public agent on the earnings board for a window, or null. */
async function agentRank(agentId, window, price) {
	const ranked = await rankedAgents(window, price);
	const i = ranked.findIndex((r) => r.agentId === agentId);
	return i < 0 ? null : { window, position: i + 1, of: ranked.length, url: `/leaderboard?tab=earned&window=${window}` };
}

/**
 * The earnings leaderboard for a window, paginated. Each row's figures come
 * from shapeTotals over the same totals getAgentEarnings uses.
 */
export async function listEarningsLeaderboard({ window: rawWindow = '7d', limit = 25, offset = 0 } = {}) {
	const window = normalizeWindow(rawWindow);
	const price = await solPriceUsd();
	const [ranked, previous] = await Promise.all([
		rankedAgents(window, price),
		window === 'all' ? null : rankedAgents(window, price, 1),
	]);
	const prevPos = new Map((previous || []).map((r, i) => [r.agentId, i + 1]));
	const page = ranked.slice(offset, offset + limit);
	const ids = page.map((r) => r.agentId);
	const [profiles, coins] = ids.length
		? await Promise.all([
				sql`
					select ai.id, ai.name, ai.meta->>'solana_address' as solana_address,
					       a.thumbnail_key, a.visibility
					from agent_identities ai
					left join avatars a on a.id = ai.avatar_id and a.deleted_at is null
					where ai.id = any(${ids})
				`,
				sql`
					select distinct on (pam.agent_id) pam.agent_id, pam.mint, pam.symbol, pam.name
					from pump_agent_mints pam
					left join agent_coin_earnings e on e.mint = pam.mint and e.network = pam.network
					where pam.agent_id = any(${ids}) and pam.network = 'mainnet'
					order by pam.agent_id, e.earned_lamports desc nulls last, pam.created_at desc
				`,
			])
		: [[], []];
	const byId = new Map(profiles.map((p) => [p.id, p]));
	const coinById = new Map(coins.map((c) => [c.agent_id, c]));
	const refreshed = ranked.map((r) => r.t.refreshed_at).filter(Boolean).map((d) => new Date(d).getTime());

	return {
		window,
		sol_price_usd: price > 0 ? price : null,
		total: ranked.length,
		limit,
		offset,
		refreshed_at: refreshed.length ? new Date(Math.min(...refreshed)).toISOString() : null,
		method: earningsMethod(window),
		rows: page.map((r, i) => {
			const p = byId.get(r.agentId) || {};
			const coin = coinById.get(r.agentId) || null;
			const rank = offset + i + 1;
			const prev = prevPos.get(r.agentId) ?? null;
			return {
				rank,
				previous_rank: prev,
				movement: window === 'all' ? null : prev == null ? 'new' : prev - rank,
				agent: {
					id: r.agentId,
					name: p.name || 'Agent',
					url: `/agents/${r.agentId}`,
					thumbnail_url: p.visibility === 'public' || p.visibility === 'unlisted' ? safeR2Url(p.thumbnail_key) : null,
				},
				coin: coin ? { mint: coin.mint, symbol: coin.symbol, name: coin.name, url: `/launches/${coin.mint}` } : null,
				...shapeTotals(r.t, price),
			};
		}),
	};
}
