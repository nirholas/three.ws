// First-party campaign attribution ledger (campaign_touches / campaign_conversions).
// Writes here are best-effort by design: a ledger failure must never break the
// signup, agent creation, forge or payment flow that triggered it.

import { sql } from './db.js';
import { readCookie } from './identities.js';
import { CONVERSION_EVENTS, FIRST_TOUCH_TTL_MS } from '../../public/campaign-attribution.js';

export const TOUCH_COOKIE = 'tws_ct';

export function touchCookie(anonId) {
	const maxAge = Math.floor(FIRST_TOUCH_TTL_MS / 1000);
	return `${TOUCH_COOKIE}=${anonId}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * Insert a first touch. A browser that already has one (same anon_id) keeps it:
 * the existing row is returned unchanged. Returns {id, anon_id, campaign, created}.
 */
export async function recordTouch(touch) {
	const [inserted] = await sql`
		insert into campaign_touches (anon_id, campaign, source, medium, landing_path)
		values (${touch.anonId}, ${touch.campaign}, ${touch.source}, ${touch.medium}, ${touch.landingPath})
		on conflict (anon_id) do nothing
		returning id, anon_id, campaign
	`;
	if (inserted) return { ...inserted, created: true };
	const [existing] = await sql`
		select id, anon_id, campaign from campaign_touches where anon_id = ${touch.anonId}
	`;
	return { ...existing, created: false };
}

/** The first touch already recorded for this browser's cookie, or null. */
export async function touchForRequest(req) {
	const anonId = String(readCookie(req, TOUCH_COOKIE) || '').toLowerCase();
	if (!UUID_RE.test(anonId)) return null;
	const [row] = await sql`
		select id, campaign from campaign_touches
		 where anon_id = ${anonId}
		   and created_at > now() - (${Math.floor(FIRST_TOUCH_TTL_MS / 1000)} * interval '1 second')
	`;
	return row || null;
}

/**
 * Credit a conversion to the browser's first touch. Silent when the browser has
 * none (the common case) and when the ledger write fails.
 */
export async function recordConversion(req, event, userId = null) {
	try {
		if (!CONVERSION_EVENTS.includes(event)) return false;
		const touch = await touchForRequest(req);
		if (!touch) return false;
		await sql`
			insert into campaign_conversions (touch_id, user_id, event)
			values (${touch.id}, ${userId}, ${event})
			on conflict do nothing
		`;
		return true;
	} catch (err) {
		console.warn('[campaign-ledger] conversion not recorded:', err?.message || err);
		return false;
	}
}

/** Touches and conversions per campaign over [from, to). */
export async function campaignReport({ from, to }) {
	const touches = await sql`
		select campaign, count(*)::int as touches, min(created_at) as first_touch_at, max(created_at) as last_touch_at
		  from campaign_touches
		 where created_at >= ${from} and created_at < ${to}
		 group by campaign
	`;
	const conversions = await sql`
		select t.campaign, c.event, count(*)::int as n
		  from campaign_conversions c
		  join campaign_touches t on t.id = c.touch_id
		 where t.created_at >= ${from} and t.created_at < ${to}
		 group by t.campaign, c.event
	`;
	const byCampaign = new Map(
		touches.map((t) => [
			t.campaign,
			{
				campaign: t.campaign,
				touches: t.touches,
				first_touch_at: t.first_touch_at,
				last_touch_at: t.last_touch_at,
				conversions: Object.fromEntries(CONVERSION_EVENTS.map((e) => [e, 0])),
			},
		]),
	);
	for (const c of conversions) {
		const row = byCampaign.get(c.campaign);
		if (row) row.conversions[c.event] = c.n;
	}
	return [...byCampaign.values()].sort((a, b) => b.touches - a.touches);
}
