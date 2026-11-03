// Coin Control: one place for a creator to see and run their coin's money.
//
// Reads (owner):  overview of one coin: the fee split, earnings, the wallet,
//                 the fee-engine rules (buyback and burn, holder rewards, DCA),
//                 everything the engine already did, bounties, and the X badge.
// Reads (public): the proof feed for a coin: every buyback, burn and holder
//                 reward with its transaction, so holders can check the creator.
// Writes (owner): bounties for the coin, paid from the agent wallet through the
//                 standard send flow (allowlist, caps, approvals inbox).
//
// The rules themselves live in api/_lib/revenue-reinvest.js and are edited
// through /api/revenue/rules; this module only reads them.

import { sql } from '../db.js';
import { getLaunchEconomics, describeFeeSplit } from '../launch-economics.js';
import { listRules } from '../revenue-reinvest.js';
import { ledgerView } from '../revenue-ledger.js';
import { solanaConnection } from '../solana/connection.js';
import { explorerTxUrl } from '../agent-commerce/solana-pay.js';
import { lamportsToSolString, rawToUi } from './core.js';

export const ENGINE_KINDS = Object.freeze(['buyback_burn', 'holder_rewards', 'dca_own_coin']);
export const BOUNTY_TITLE_MAX = 200;
export const BOUNTY_DESCRIPTION_MAX = 4000;

function fail(status, code, message) {
	return Object.assign(new Error(message), { status, code });
}

const num = (v) => (v == null ? null : Number(v));

// ── coins ───────────────────────────────────────────────────────────────────

/** Every coin the owner launched through three.ws, newest first. */
export async function listCoins(userId) {
	const rows = await sql`
		select m.agent_id, m.network, m.mint, m.name, m.symbol, m.buyback_bps, m.created_at, a.name as agent_name, a.avatar_id
		from pump_agent_mints m join agent_identities a on a.id = m.agent_id
		where m.user_id = ${userId} and a.deleted_at is null
		order by m.created_at desc`;
	return rows.map((r) => ({
		agent_id: r.agent_id, agent_name: r.agent_name, avatar_id: r.avatar_id, network: r.network, mint: r.mint,
		name: r.name, symbol: r.symbol, buyback_bps: r.buyback_bps, created_at: r.created_at,
	}));
}

async function ownedCoin({ userId, agentId, network }) {
	const [c] = await sql`
		select m.agent_id, m.network, m.mint, m.name, m.symbol, m.buyback_bps, m.created_at,
		       a.name as agent_name, a.avatar_id, a.meta->>'solana_address' as wallet
		from pump_agent_mints m join agent_identities a on a.id = m.agent_id
		where m.agent_id = ${agentId} and m.user_id = ${userId} and m.network = ${network} and a.deleted_at is null
		order by m.created_at desc limit 1`;
	if (!c) throw fail(404, 'not_found', 'You have no coin for that agent on this network.');
	return c;
}

async function feeSplit({ mint, network }) {
	const econ = await getLaunchEconomics();
	const [sp] = await sql`select 1 as gasless from launch_sponsorships where mint = ${mint} and network = ${network} limit 1`;
	const gasless = Boolean(sp);
	return {
		gasless,
		creator_share_bps: gasless ? econ.gasless.creator_share_bps : 10000,
		platform_share_bps: gasless ? econ.gasless.platform_share_bps : 0,
		sentence: describeFeeSplit(econ, { gasless }),
	};
}

async function verifiedX(userId) {
	const [x] = await sql`
		select username, connected_at from social_connections
		where user_id = ${userId} and provider = 'x' and disconnected_at is null limit 1`;
	return x ? { verified: true, username: x.username, connected_at: x.connected_at } : { verified: false, username: null };
}

async function walletBalance(address, network) {
	if (!address) return { address: null, sol: null };
	try {
		const { PublicKey } = await import('@solana/web3.js');
		const lamports = await solanaConnection({ network }).getBalance(new PublicKey(address), 'confirmed');
		return { address, sol: lamportsToSolString(lamports) };
	} catch {
		return { address, sol: null, note: 'The balance could not be read right now.' };
	}
}

// ── what the engine did ─────────────────────────────────────────────────────

async function mintDecimals(mint, network) {
	try {
		const { PublicKey } = await import('@solana/web3.js');
		const s = await solanaConnection({ network }).getTokenSupply(new PublicKey(mint), 'confirmed');
		return s.value.decimals;
	} catch {
		return 6;
	}
}

/** Lifetime totals of every engine leg that ran for this coin's agent on this network. */
async function engineTotals({ agentId, network, decimals }) {
	const rows = await sql`
		select l.kind,
		       count(*) filter (where l.status = 'executed')::int as runs,
		       coalesce(sum(l.capped_usd) filter (where l.status = 'executed'), 0)::float8 as usd,
		       coalesce(sum((l.detail->>'burned_raw')::numeric), 0)::text as burned_raw,
		       coalesce(sum((l.detail->>'sent_lamports')::numeric) filter (where l.status = 'executed'), 0)::text as rewarded_lamports,
		       coalesce(sum(jsonb_array_length(coalesce(l.detail->'sent', '[]'::jsonb))) filter (where l.status = 'executed'), 0)::int as rewards_sent,
		       count(*) filter (where l.kind = 'buyback_burn' and l.status = 'executed' and l.detail->>'burn_signature' is null and l.detail->>'burn_skipped' is null)::int as burns_pending
		from revenue_reinvest_legs l
		join revenue_reinvest_runs r on r.id = l.run_id
		join revenue_reinvest_rules ru on ru.id = r.rule_id
		where r.agent_id = ${agentId} and ru.network = ${network} and r.mode = 'live' and l.kind = any(${ENGINE_KINDS}::text[])
		group by l.kind`;
	const by = Object.fromEntries(rows.map((r) => [r.kind, r]));
	const bb = by.buyback_burn || {};
	const hr = by.holder_rewards || {};
	const dca = by.dca_own_coin || {};
	return {
		bought_back_usd: (bb.usd || 0) + (dca.usd || 0),
		buyback_runs: (bb.runs || 0) + (dca.runs || 0),
		burned: rawToUi(bb.burned_raw || '0', decimals),
		burned_raw: bb.burned_raw || '0',
		burns_pending: bb.burns_pending || 0,
		rewarded_sol: lamportsToSolString(BigInt(String(hr.rewarded_lamports || '0').split('.')[0])),
		rewarded_usd: hr.usd || 0,
		rewards_sent: hr.rewards_sent || 0,
		reward_runs: hr.runs || 0,
	};
}

function eventView(l, network, decimals) {
	const d = l.detail || {};
	const tx = (sig) => (sig ? { signature: sig, url: explorerTxUrl(sig, network) } : null);
	const base = { id: l.id, kind: l.kind, at: l.executed_at || l.created_at, usd: num(l.capped_usd), status: l.status };
	if (l.kind === 'buyback_burn') {
		return {
			...base, buy_tx: tx(l.signature), burn_tx: tx(d.burn_signature),
			burned: d.burned_raw ? rawToUi(d.burned_raw, d.decimals ?? decimals) : null,
			burn_state: d.burn_signature ? 'burned' : d.burn_skipped ? 'skipped' : d.burn_claimed_at ? 'in_flight' : 'pending',
			burn_note: d.burn_error || null,
		};
	}
	if (l.kind === 'holder_rewards') {
		const plan = d.plan || {};
		return {
			...base, mode: plan.mode || null,
			sol: d.sent_lamports ? lamportsToSolString(BigInt(d.sent_lamports)) : null,
			recipients: (d.sent || []).map((s) => ({ owner: s.owner, sol: lamportsToSolString(BigInt(s.lamports)), tx: tx(s.signature) })),
			not_sent: (d.failed || []).length,
			txs: (d.signatures || []).map(tx),
			lottery: plan.lottery ? { seed: plan.lottery.seed, blockhash: plan.lottery.blockhash, leg_key: plan.lottery.leg_key, pool_size: (plan.lottery.pool || []).length } : null,
		};
	}
	return { ...base, buy_tx: tx(l.signature), sol: d.sol ?? null };
}

/** Executed engine actions for the agent's coin, newest first. */
async function engineEvents({ agentId, network, decimals, limit = 30 }) {
	const rows = await sql`
		select l.id, l.kind, l.status, l.signature, l.capped_usd, l.detail, l.executed_at, l.created_at
		from revenue_reinvest_legs l
		join revenue_reinvest_runs r on r.id = l.run_id
		join revenue_reinvest_rules ru on ru.id = r.rule_id
		where r.agent_id = ${agentId} and ru.network = ${network} and r.mode = 'live'
		  and l.kind = any(${ENGINE_KINDS}::text[]) and l.status = 'executed'
		order by coalesce(l.executed_at, l.created_at) desc
		limit ${Math.min(Math.max(1, limit), 100)}`;
	return rows.map((l) => eventView(l, network, decimals));
}

// ── overview ────────────────────────────────────────────────────────────────

/** The owner's full view of one coin. Every number is read from live data. */
export async function overview({ userId, agentId, network }) {
	await reconcileBountyPayouts({ agentId }).catch((err) => console.error('[coin-control] bounty reconcile failed', err?.message));
	const coin = await ownedCoin({ userId, agentId, network });
	const decimals = await mintDecimals(coin.mint, network);
	const [split, x, wallet, rules, totals, events, bounties, ledger] = await Promise.all([
		feeSplit({ mint: coin.mint, network }),
		verifiedX(userId),
		walletBalance(coin.wallet, network),
		listRules({ userId, agentId }),
		engineTotals({ agentId, network, decimals }),
		engineEvents({ agentId, network, decimals }),
		listBounties({ agentId, network, includeSubmissions: true }),
		ledgerView({ userId, agentId, period: 'month' }).catch(() => null),
	]);
	return {
		coin: {
			agent_id: coin.agent_id, agent_name: coin.agent_name, avatar_id: coin.avatar_id, network, mint: coin.mint,
			name: coin.name, symbol: coin.symbol, decimals, launched_at: coin.created_at,
			onchain_buyback_bps: coin.buyback_bps,
		},
		fee_split: split,
		earnings: ledger
			? {
				revenue_usd: ledger.summary.revenue_usd, net_usd: ledger.summary.net_usd, trading_pnl_usd: ledger.summary.trading_pnl_usd,
				by_source: ledger.summary.by_source, unclaimed_creator_fees: ledger.unclaimed_creator_fees, synced_at: ledger.synced_at,
			}
			: null,
		wallet,
		x,
		rules: rules.filter((r) => r.network === network),
		totals,
		events,
		bounties,
		public_url: `/coin-control/${coin.mint}`,
	};
}

// ── public proof ────────────────────────────────────────────────────────────

/**
 * What anyone can check about a coin's fee engine: totals, every executed
 * action with its transaction, the creator's verified X handle, and the shape
 * of the rules that are switched on (kinds and percentages, never caps).
 */
export async function publicProof({ mint }) {
	const [coin] = await sql`
		select m.agent_id, m.user_id, m.network, m.mint, m.name, m.symbol, m.buyback_bps, m.created_at, a.name as agent_name, a.avatar_id
		from pump_agent_mints m join agent_identities a on a.id = m.agent_id
		where m.mint = ${mint} and a.deleted_at is null
		order by (m.network = 'mainnet') desc, m.created_at desc limit 1`;
	if (!coin) throw fail(404, 'not_found', 'No coin launched through three.ws has that mint.');
	const decimals = await mintDecimals(coin.mint, coin.network);
	const [totals, events, x, rules, bounties, split] = await Promise.all([
		engineTotals({ agentId: coin.agent_id, network: coin.network, decimals }),
		engineEvents({ agentId: coin.agent_id, network: coin.network, decimals, limit: 50 }),
		verifiedX(coin.user_id),
		sql`select legs, period, confirmed_at from revenue_reinvest_rules
		    where agent_id = ${coin.agent_id} and network = ${coin.network} and status = 'active' and confirmed_hash is not null`,
		listBounties({ agentId: coin.agent_id, network: coin.network, includeSubmissions: false }),
		feeSplit({ mint: coin.mint, network: coin.network }),
	]);
	const engine = rules.flatMap((r) => (r.legs || [])
		.filter((l) => ENGINE_KINDS.includes(l.kind))
		.map((l) => ({ kind: l.kind, pct: l.pct, period: r.period, mode: l.mode || null, recipients: l.recipients || null, since: r.confirmed_at })));
	return {
		coin: {
			agent_id: coin.agent_id, agent_name: coin.agent_name, avatar_id: coin.avatar_id, network: coin.network, mint: coin.mint,
			name: coin.name, symbol: coin.symbol, decimals, launched_at: coin.created_at, onchain_buyback_bps: coin.buyback_bps,
		},
		fee_split: { gasless: split.gasless, creator_share_bps: split.creator_share_bps, sentence: split.sentence },
		creator_x: x.verified ? { verified: true, username: x.username } : { verified: false },
		engine,
		totals,
		events,
		bounties: bounties.map(({ submissions: _s, ...b }) => b),
	};
}

// ── bounties ────────────────────────────────────────────────────────────────

function bountyView(b) {
	return {
		id: b.id, title: b.title, description: b.description, status: b.status, network: b.network,
		reward_sol: num(b.reward_sol), reward_usd: num(b.reward_usd), coin_symbol: b.coin_symbol, coin_mint: b.coin_mint,
		submission_count: b.submission_count, expires_at: b.expires_at, created_at: b.created_at,
		winner_submission_id: b.winner_submission_id,
		payout: b.payout_signature
			? { state: 'paid', tx: { signature: b.payout_signature, url: explorerTxUrl(b.payout_signature, b.network || 'mainnet') } }
			: b.payout_approval_id
				? { state: 'awaiting_approval', approval_link: `/approvals/${b.payout_approval_id}` }
				: null,
		board_url: `/bounty/${b.id}`,
	};
}

export async function listBounties({ agentId, network, includeSubmissions }) {
	const rows = await sql`
		select * from bounties where agent_id = ${agentId} and network = ${network} and deleted_at is null
		order by (status = 'open') desc, created_at desc limit 50`;
	const out = rows.map(bountyView);
	if (!includeSubmissions || !rows.length) return out;
	const subs = await sql`
		select s.id, s.bounty_id, s.user_id, s.username, s.content, s.media_url, s.media_type, s.status, s.tx_hash, s.created_at,
		       (select address from user_wallets w where w.user_id = s.user_id and w.chain_type = 'solana' order by w.is_primary desc, w.created_at asc limit 1) as payout_address
		from bounty_submissions s where s.bounty_id = any(${rows.map((r) => r.id)}::uuid[])
		order by s.created_at desc`;
	return out.map((b) => ({
		...b,
		submissions: subs.filter((s) => s.bounty_id === b.id).map((s) => ({
			id: s.id, username: s.username, content: s.content, media_url: s.media_url, media_type: s.media_type,
			status: s.status, created_at: s.created_at, payout_address: s.payout_address, tx_hash: s.tx_hash,
		})),
	}));
}

export async function createBounty({ userId, agentId, network, title, description, rewardSol, days }) {
	const coin = await ownedCoin({ userId, agentId, network });
	const t = String(title || '').trim();
	if (!t) throw fail(400, 'invalid_parameter', 'A bounty needs a title.');
	if (t.length > BOUNTY_TITLE_MAX) throw fail(400, 'invalid_parameter', `The title is too long (max ${BOUNTY_TITLE_MAX}).`);
	const desc = description == null ? null : String(description).trim() || null;
	if (desc && desc.length > BOUNTY_DESCRIPTION_MAX) throw fail(400, 'invalid_parameter', `The description is too long (max ${BOUNTY_DESCRIPTION_MAX}).`);
	const reward = Number(rewardSol);
	if (!Number.isFinite(reward) || reward < 0.001 || reward > 1000) throw fail(400, 'invalid_parameter', 'The reward must be between 0.001 and 1000 SOL.');
	const d = Math.min(30, Math.max(1, Math.floor(Number(days) || 7)));
	const { cachedSolUsd } = await import('../trader-stats.js');
	const solUsd = await cachedSolUsd().catch(() => null);
	const [u] = await sql`select display_name, username, email from users where id = ${userId}`;
	const username = u?.display_name || u?.username || u?.email?.split('@')[0] || 'creator';
	const symbol = coin.symbol ? `$${String(coin.symbol).replace(/^\$/, '')}` : 'coin';
	const [row] = await sql`
		insert into bounties (user_id, username, title, description, coin_symbol, coin_mint, reward_sol, reward_usd, expires_at, agent_id, network)
		values (${userId}, ${username}, ${t}, ${desc}, ${symbol}, ${coin.mint}, ${reward}, ${solUsd && network === 'mainnet' ? Math.round(reward * solUsd * 100) / 100 : null},
			${new Date(Date.now() + d * 86400000).toISOString()}, ${agentId}, ${network})
		returning *`;
	return bountyView(row);
}

async function ownedBounty({ userId, bountyId }) {
	const [b] = await sql`select * from bounties where id = ${bountyId} and deleted_at is null`;
	if (!b || String(b.user_id) !== String(userId) || !b.agent_id) throw fail(404, 'not_found', 'No Coin Control bounty with that id.');
	return b;
}

async function winnerOf(bounty, submissionId) {
	const [s] = await sql`
		select s.id, s.user_id, s.username,
		       (select address from user_wallets w where w.user_id = s.user_id and w.chain_type = 'solana' order by w.is_primary desc, w.created_at asc limit 1) as address
		from bounty_submissions s where s.id = ${submissionId} and s.bounty_id = ${bounty.id}`;
	if (!s) throw fail(404, 'not_found', 'That submission is not on this bounty.');
	if (String(s.user_id) === String(bounty.user_id)) throw fail(409, 'self_payout', 'You cannot pay your own submission.');
	if (!s.address) throw fail(409, 'winner_has_no_wallet', `${s.username || 'The winner'} has no Solana wallet linked to their account, so the reward has nowhere to go. Ask them to link one, then pay again.`);
	return s;
}

/** Quote the payout. Nothing is reserved or signed. */
export async function previewBountyPayout({ userId, bountyId, submissionId }) {
	const bounty = await ownedBounty({ userId, bountyId });
	if (bounty.status !== 'open') throw fail(409, 'bounty_not_open', `This bounty is ${bounty.status}, so it cannot be paid again.`);
	if (!(Number(bounty.reward_sol) > 0)) throw fail(409, 'no_sol_reward', 'This bounty has no SOL reward to pay.');
	const winner = await winnerOf(bounty, submissionId);
	const { previewSend } = await import('../agent-commerce/send.js');
	const preview = await previewSend({
		agentId: bounty.agent_id, to: winner.address, amount: String(bounty.reward_sol), asset: 'SOL', network: bounty.network || 'mainnet',
		memo: `bounty: ${bounty.title}`.slice(0, 120),
	});
	return { bounty: bountyView(bounty), winner: { submission_id: winner.id, username: winner.username, address: winner.address }, ...preview };
}

async function closeBounty({ bountyId, submissionId, signature, rewardSol }) {
	await sql.transaction([
		sql`update bounty_submissions set status = 'rejected' where bounty_id = ${bountyId} and id != ${submissionId}`,
		sql`update bounty_submissions set status = 'accepted', reward_sol = ${rewardSol}, tx_hash = ${signature} where id = ${submissionId}`,
		sql`update bounties set status = 'closed', winner_submission_id = ${submissionId}, payout_signature = ${signature}, payout_approval_id = null where id = ${bountyId}`,
	]);
}

/**
 * Pay the winner from the agent wallet and close the bounty. The bounty is
 * claimed first, so two clicks never pay twice. If the owner's policy wants a
 * yes, the bounty waits in 'resolving' and closes when the approval executes.
 */
export async function confirmBountyPayout({ userId, bountyId, submissionId, previewId }) {
	const bounty = await ownedBounty({ userId, bountyId });
	const winner = await winnerOf(bounty, submissionId);
	const [quote] = await sql`
		select payload from agent_commerce_quotes
		where id = ${String(previewId || '')} and kind = 'send' and agent_id = ${bounty.agent_id} and consumed_at is null and expires_at > now()`;
	if (!quote) throw fail(410, 'preview_expired', 'That payout preview expired or was already used. Preview it again.');
	const { parseAmount } = await import('../agent-commerce/assets.js');
	if (quote.payload.to !== winner.address || quote.payload.asset !== 'SOL' || BigInt(quote.payload.atomics) !== parseAmount(String(bounty.reward_sol), 9)) {
		throw fail(409, 'preview_mismatch', 'That preview is for a different payment. Preview this payout again.');
	}
	const [claimed] = await sql`
		update bounties set status = 'resolving', payout_submission_id = ${submissionId}
		where id = ${bountyId} and status = 'open' returning id`;
	if (!claimed) throw fail(409, 'bounty_not_open', 'This bounty is already being paid or is closed.');
	const { confirmSend } = await import('../agent-commerce/send.js');
	let out;
	try {
		out = await confirmSend({ agentId: bounty.agent_id, previewId });
	} catch (err) {
		await sql`update bounties set status = 'open', payout_submission_id = null where id = ${bountyId} and status = 'resolving'`;
		throw err;
	}
	if (out.status === 'sent') {
		await closeBounty({ bountyId, submissionId, signature: out.signature, rewardSol: bounty.reward_sol });
		return { status: 'paid', signature: out.signature, explorer_url: out.explorer_url };
	}
	await sql`update bounties set payout_approval_id = ${out.approval.id} where id = ${bountyId}`;
	return { status: 'awaiting_approval', approval: out.approval, message: out.message };
}

/**
 * Close bounties whose payout approval executed, and reopen the ones whose
 * approval was denied, expired or failed. Runs on every owner read.
 */
export async function reconcileBountyPayouts({ agentId = null } = {}) {
	const rows = await sql`
		select b.id, b.payout_submission_id, b.reward_sol, a.status as a_status, a.signature as a_sig
		from bounties b join approval_requests a on a.id = b.payout_approval_id
		where b.status = 'resolving' and b.payout_approval_id is not null ${agentId ? sql`and b.agent_id = ${agentId}` : sql``}
		  and a.status in ('executed', 'denied', 'expired', 'failed')`;
	for (const r of rows) {
		if (r.a_status === 'executed' && r.a_sig) {
			await closeBounty({ bountyId: r.id, submissionId: r.payout_submission_id, signature: r.a_sig, rewardSol: r.reward_sol });
		} else {
			await sql`update bounties set status = 'open', payout_submission_id = null, payout_approval_id = null where id = ${r.id}`;
		}
	}
	return rows.length;
}
