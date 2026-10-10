// Entrant amplification: who the entrants are (as platform accounts), telling
// them they are in a market, the per-entrant kit, the "in N live markets"
// profile surface, and the opt-out flag that notifications and the announcement
// drafter both read.

import { sql } from '../db.js';
import { insertNotification, emailAllowedForType } from '../notify.js';
import { sendEventMarketEntrantEmail } from '../email.js';
import { ensureReferralCode } from '../referrals.js';

export const ENTRANT_NOTICE_TYPE = 'event_market_entrant';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Probabilities straight from getMarket's view: share per outcome, even_prior flag. */
function oddsOf(market) {
	const outcomes = market.outcomes || [];
	return {
		evenPrior: Boolean(market.odds?.even_prior),
		totalPicks: outcomes.reduce((n, o) => n + (o.picks || 0), 0),
		odds: outcomes.map((o) => ({
			outcome_id: o.id,
			picks: o.picks || 0,
			points: o.points || 0,
			probability: typeof o.share === 'number' ? o.share : outcomes.length ? 1 / outcomes.length : 0,
		})),
	};
}

export function marketPath(slug) {
	return `/event-markets/${encodeURIComponent(slug)}`;
}

/**
 * Map each outcome of a market to the platform account behind it, when there is
 * one. An agent belongs to its owner; a wallet belongs to the account that has
 * linked it. Projects and teams have no single owning account and map to null.
 * @returns {Promise<Array<{ outcome: object, accountId: string|null }>>}
 */
export async function entrantAccounts(market) {
	const agentIds = market.outcomes.filter((o) => o.ref_kind === 'agent' && UUID_RE.test(o.ref_id)).map((o) => o.ref_id);
	const wallets = market.outcomes.filter((o) => o.ref_kind === 'wallet').map((o) => o.ref_id);
	const [agents, links] = await Promise.all([
		agentIds.length
			? sql`select id, user_id from agent_identities where id = any(${agentIds}::uuid[]) and deleted_at is null`
			: [],
		wallets.length
			? sql`select address, user_id from user_wallets where address = any(${wallets}::text[]) or address = any(${wallets.map((w) => w.toLowerCase())}::text[])`
			: [],
	]);
	const agentOwner = new Map(agents.map((a) => [a.id, a.user_id]));
	const walletOwner = new Map(links.map((w) => [w.address.toLowerCase(), w.user_id]));
	return market.outcomes.map((outcome) => ({
		outcome,
		accountId:
			outcome.ref_kind === 'agent'
				? agentOwner.get(outcome.ref_id) || null
				: outcome.ref_kind === 'wallet'
					? walletOwner.get(outcome.ref_id.toLowerCase()) || null
					: null,
	}));
}

// ── opt-out ──────────────────────────────────────────────────────────────────

export async function isEntrantOptedOut(accountId) {
	if (!accountId) return false;
	const [row] = await sql`select opt_out from event_market_entrant_prefs where account_id = ${accountId}`;
	return Boolean(row?.opt_out);
}

/** The subset of `accountIds` that opted out. */
export async function optedOutAccounts(accountIds) {
	const ids = [...new Set(accountIds.filter(Boolean))];
	if (!ids.length) return new Set();
	const rows = await sql`select account_id from event_market_entrant_prefs where opt_out and account_id = any(${ids}::uuid[])`;
	return new Set(rows.map((r) => r.account_id));
}

export async function setEntrantOptOut(accountId, optOut) {
	await sql`
		insert into event_market_entrant_prefs (account_id, opt_out) values (${accountId}, ${Boolean(optOut)})
		on conflict (account_id) do update set opt_out = excluded.opt_out, updated_at = now()`;
	return { opt_out: Boolean(optOut) };
}

/**
 * Entrants a market may tag or feature: have an account and have not opted out.
 * The announcement drafter reads this instead of entrantAccounts so the opt-out
 * is honored in one place.
 */
export async function taggableEntrants(market) {
	const all = (await entrantAccounts(market)).filter((e) => e.accountId);
	const out = await optedOutAccounts(all.map((e) => e.accountId));
	return all.filter((e) => !out.has(e.accountId));
}

// ── notify ───────────────────────────────────────────────────────────────────

/**
 * Tell each entrant with an account that they are in this market, once per
 * market per account. In-app and push go through the preference center; email
 * goes only to a verified address whose owner left the email channel on.
 * Opted-out entrants are skipped without being recorded, so opting back in
 * later does not retroactively spam them.
 */
export async function notifyEntrants(market, { origin = process.env.APP_ORIGIN || 'https://three.ws' } = {}) {
	if (market.status !== 'open') return { notified: 0, skipped: 0 };
	const entrants = await entrantAccounts(market);
	const odds = oddsOf(market);
	const optedOut = await optedOutAccounts(entrants.map((e) => e.accountId));
	const oddsByOutcome = new Map(odds.odds.map((o) => [o.outcome_id, o]));
	const seen = new Set();
	let notified = 0;
	let skipped = 0;
	for (const { outcome, accountId } of entrants) {
		if (!accountId || seen.has(accountId) || optedOut.has(accountId)) {
			skipped += 1;
			continue;
		}
		seen.add(accountId);
		const [claimed] = await sql`
			insert into event_market_entrant_notices (market_id, account_id, outcome_id)
			values (${market.id}, ${accountId}, ${outcome.id})
			on conflict (market_id, account_id) do nothing
			returning market_id`;
		if (!claimed) {
			skipped += 1;
			continue;
		}
		const probability = oddsByOutcome.get(outcome.id)?.probability ?? 0;
		const kitLink = `${marketPath(market.slug)}/kit`;
		const channels = {};
		const res = await insertNotification(accountId, ENTRANT_NOTICE_TYPE, {
			market_slug: market.slug,
			title: market.title,
			outcome_label: outcome.label,
			probability,
			even_prior: odds.evenPrior,
			link: kitLink,
		});
		channels.in_app = Boolean(res?.id);
		try {
			const [user] = await sql`select email, email_verified, display_name from users where id = ${accountId} and deleted_at is null`;
			if (user?.email_verified && (await emailAllowedForType(accountId, ENTRANT_NOTICE_TYPE))) {
				const sent = await sendEventMarketEntrantEmail({
					to: user.email,
					title: market.title,
					outcomeLabel: outcome.label,
					probability,
					evenPrior: odds.evenPrior,
					kitUrl: `${origin}${kitLink}`,
				});
				channels.email = !sent?.skipped;
			}
		} catch (err) {
			console.error('[event-markets] entrant email failed:', err.message);
			channels.email = false;
		}
		await sql`update event_market_entrant_notices set channels = ${JSON.stringify(channels)}::jsonb where market_id = ${market.id} and account_id = ${accountId}`;
		notified += 1;
	}
	return { notified, skipped };
}

// ── kit ──────────────────────────────────────────────────────────────────────

export function sharePostText({ title, outcomeLabel, probability, evenPrior, url }) {
	const pct = `${Math.round(probability * 100)}%`;
	const stance = evenPrior ? 'No picks yet, so it starts even.' : `The crowd has me at ${pct}.`;
	return `I'm in "${title}" on three.ws. ${stance} Call it: ${url}`;
}

/**
 * Everything the entrant kit page shows for the signed-in account. Null when the
 * account is not an entrant of this market.
 */
export async function entrantKit(market, accountId, { origin = process.env.APP_ORIGIN || 'https://three.ws' } = {}) {
	const entrants = await entrantAccounts(market);
	const odds = oddsOf(market);
	const mine = entrants.filter((e) => e.accountId === accountId);
	if (!mine.length) return null;
	const ranked = [...odds.odds].sort((a, b) => b.points - a.points || b.picks - a.picks);
	const refCode = await ensureReferralCode(accountId);
	const picks = await sql`
		select p.outcome_id, r.referrer_id as ref_account_id
		from event_market_picks p
		left join event_market_pick_referrals r on r.market_id = p.market_id and r.account_id = p.account_id
		where p.market_id = ${market.id} and p.agent_id is null`;
	const prefs = await isEntrantOptedOut(accountId);

	const outcomes = mine.map(({ outcome }) => {
		const o = odds.odds.find((x) => x.outcome_id === outcome.id);
		const onMe = picks.filter((p) => p.outcome_id === outcome.id);
		const viaMe = onMe.filter((p) => p.ref_account_id === accountId).length;
		const viaOthers = onMe.filter((p) => p.ref_account_id && p.ref_account_id !== accountId).length;
		const shareUrl = `${origin}${marketPath(market.slug)}?ref=${encodeURIComponent(refCode)}`;
		return {
			outcome_id: outcome.id,
			label: outcome.label,
			picks: o.picks,
			points: o.points,
			probability: o.probability,
			rank: ranked.findIndex((r) => r.outcome_id === outcome.id) + 1,
			of: ranked.length,
			sources: { your_link: viaMe, other_referrals: viaOthers, direct: onMe.length - viaMe - viaOthers },
			share_url: shareUrl,
			card_url: `${origin}/api/event-market-card?slug=${encodeURIComponent(market.slug)}&outcome=${outcome.id}`,
			post_text: sharePostText({
				title: market.title,
				outcomeLabel: outcome.label,
				probability: o.probability,
				evenPrior: odds.evenPrior,
				url: shareUrl,
			}),
		};
	});
	return {
		market: { slug: market.slug, title: market.title, status: market.status, locks_at: market.locks_at },
		even_prior: odds.evenPrior,
		total_picks: odds.totalPicks,
		entrants: outcomes,
		opt_out: prefs,
	};
}

// ── profile surface ──────────────────────────────────────────────────────────

/**
 * Live markets (open or locked) an agent, wallet, project or team is an entrant
 * in. Returns nothing for an entrant whose account opted out of being featured.
 */
export async function liveMarketsForEntrant(refKind, refId, { limit = 5 } = {}) {
	const rows = await sql`
		select m.slug, m.title, m.status, m.locks_at
		from event_market_outcomes o join event_markets m on m.id = o.market_id
		where o.ref_kind = ${refKind} and o.ref_id = ${String(refId)} and m.status in ('open','locked')
		order by m.locks_at nulls last, m.created_at desc`;
	if (!rows.length) return { count: 0, markets: [] };
	const probe = await entrantAccounts({
		outcomes: [{ ref_kind: refKind, ref_id: String(refId) }],
	});
	if (probe[0]?.accountId && (await isEntrantOptedOut(probe[0].accountId))) return { count: 0, markets: [] };
	return { count: rows.length, markets: rows.slice(0, limit).map((r) => ({ ...r, url: marketPath(r.slug) })) };
}
