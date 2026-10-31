// Seasonal drops: free gifts a signed-in account can claim inside one fixed
// window and then keeps forever.
//
// A drop is a short list of gifts handed out together by one claim:
//   • a permanent profile badge (a user_badges row, the canonical claim record),
//   • /play wearables (event-tier cosmetics, granted, never sold),
//   • a desktop wallpaper the claimer keeps in Settings after the window.
//
// The window is server-authoritative. The client shows a countdown to the same
// timestamps (src/shared/seasonal-drops.js mirrors them, and a test pins the two
// together), but only this module decides whether a claim lands. After `endsAt`
// nothing new is ever granted; an account that already claimed can still
// re-sync its wearables (an idempotent re-grant of what its badge proves it
// owns), which is how a Redis outage during the claim heals itself later.
//
// Why the badge is the claim record: user_badges is unique on (user_id, code)
// and its rows never disappear, which is exactly "claimed once, kept forever".
// No new table, no migration, and the badge renders on the owner's public
// profile with no extra wiring.

import { sql } from './db.js';
import { getRedis } from './redis.js';
import { BADGES, badgeMeta } from './streaks.js';

// The /play grant ledger. Separate from `cosmetics:owned:` (the x402 purchase
// ledger, which the game server deliberately filters to premium ids) so a
// granted gift can never be confused with a purchase and a purchase write can
// never mint a gift. Keep the prefix byte-for-byte in lockstep with
// multiplayer/src/cosmetics-ownership.js.
export const GRANTED_PREFIX = 'cosmetics:granted:';
// Account-scoped key for a site user. WalkRoom reads it from the verified
// presence ticket's uid, so a gift claimed on the website reaches the player
// in every world they join while signed in.
export const userGrantKey = (userId) => `${GRANTED_PREFIX}u:${userId}`;
const GRANT_TTL_S = 60 * 60 * 24 * 365 * 10; // a gift is forever; refreshed on every write

export const HALLOWEEN_2026 = Object.freeze({
	id: 'halloween-2026',
	name: 'Halloween Weekend 2026',
	// Saturday 00:00 in the earliest timezone (UTC+14) to Sunday 24:00 in the
	// latest (UTC-12): the whole weekend, wherever the visitor lives.
	startsAt: '2026-10-30T10:00:00Z',
	endsAt: '2026-11-02T12:00:00Z',
	badge: BADGES.HALLOWEEN_2026,
	gifts: Object.freeze([
		Object.freeze({
			kind: 'cosmetic',
			id: 'pumpkin-cap-halloween-2026',
			name: 'Pumpkin Cap',
			detail: 'A carved jack-o\'-lantern cap with a curled vine. Headwear, wearable in every /play world.',
			thumb: '/accessories/thumbs/pumpkin-cap-halloween-2026.png',
		}),
		Object.freeze({
			kind: 'cosmetic',
			id: 'aura-witchlight-halloween-2026',
			name: 'Witchlight Aura',
			detail: 'A low pumpkin-orange glow that follows you around /play.',
			swatch: '#ff7a1a',
		}),
		Object.freeze({
			kind: 'badge',
			id: BADGES.HALLOWEEN_2026,
			name: 'Halloween 2026 Badge',
			detail: 'Shows on your public profile, permanently.',
			icon: '🎃',
		}),
		Object.freeze({
			kind: 'wallpaper',
			id: 'haunted',
			name: 'Haunted Wallpaper',
			detail: 'A moonlit haunted hill for your desktop, kept in Settings after the weekend.',
		}),
	]),
});

const DROPS = new Map([[HALLOWEEN_2026.id, HALLOWEEN_2026]]);

/** The drop with this id, or null. */
export function getDrop(id) {
	return DROPS.get(String(id || '')) || null;
}

/** 'upcoming' | 'live' | 'ended' for `drop` at epoch-ms `now`. Pure. */
export function dropPhase(drop, now = Date.now()) {
	const t = Number(now);
	if (t < Date.parse(drop.startsAt)) return 'upcoming';
	if (t >= Date.parse(drop.endsAt)) return 'ended';
	return 'live';
}

/** The cosmetic ids a claim of `drop` grants into /play. */
export function dropCosmeticIds(drop) {
	return drop.gifts.filter((g) => g.kind === 'cosmetic').map((g) => g.id);
}

/** Public, cacheable description of a drop (no per-user state). */
export function publicDrop(drop, now = Date.now()) {
	const meta = badgeMeta(drop.badge);
	return {
		id: drop.id,
		name: drop.name,
		startsAt: drop.startsAt,
		endsAt: drop.endsAt,
		phase: dropPhase(drop, now),
		serverTime: new Date(Number(now)).toISOString(),
		badge: { code: drop.badge, label: meta.label, icon: meta.icon, description: meta.description },
		gifts: drop.gifts.map((g) => ({ ...g })),
	};
}

/** When `userId` claimed `drop`, as an ISO string, or null if they have not. */
export async function claimedAt(userId, drop) {
	const rows = await sql`
		select unlocked_at from user_badges
		where user_id = ${userId} and code = ${drop.badge}
		limit 1
	`;
	return rows[0] ? new Date(rows[0].unlocked_at).toISOString() : null;
}

// Write the drop's wearables into the account's grant ledger. Idempotent (a SET).
// Returns false when no store is configured or the write failed, so the caller
// can tell the user their wearables are still syncing rather than claim a grant
// that did not land. The badge (already written) stays the source of truth, and
// the next claim call re-runs this.
async function grantWearables(userId, drop) {
	const ids = dropCosmeticIds(drop);
	if (!ids.length) return true;
	const r = getRedis();
	if (!r) return false;
	const key = userGrantKey(userId);
	try {
		await r.sadd(key, ...ids);
		r.expire(key, GRANT_TTL_S).catch(() => {});
		return true;
	} catch (err) {
		console.warn('[seasonal-drops] wearable grant failed:', err?.message);
		return false;
	}
}

/**
 * Claim `drop` for `userId` at `now`.
 *
 * Live window, first claim: writes the badge (throws if the database rejects
 * it, so the caller never reports a claim that was not recorded), then grants
 * the wearables. Any later call, inside or after the window, by an account that
 * already holds the badge re-syncs the wearables and reports the original claim
 * time. Outside the window without a prior claim: { ok:false, reason }.
 *
 * @returns {Promise<{ ok: true, newlyClaimed: boolean, claimedAt: string, wearablesSynced: boolean }
 *   | { ok: false, reason: 'upcoming' | 'ended' }>}
 */
export async function claimDrop(userId, drop, now = Date.now()) {
	const existing = await claimedAt(userId, drop);
	if (existing) {
		const wearablesSynced = await grantWearables(userId, drop);
		return { ok: true, newlyClaimed: false, claimedAt: existing, wearablesSynced };
	}

	const phase = dropPhase(drop, now);
	if (phase !== 'live') return { ok: false, reason: phase };

	const rows = await sql`
		insert into user_badges (user_id, code, context)
		values (${userId}, ${drop.badge}, ${JSON.stringify({ drop: drop.id })}::jsonb)
		on conflict (user_id, code) do nothing
		returning unlocked_at
	`;
	// A concurrent double-click can lose the insert race; the row it lost to is
	// this same account's claim, so read it back rather than report a failure.
	const at = rows[0] ? new Date(rows[0].unlocked_at).toISOString() : await claimedAt(userId, drop);
	const wearablesSynced = await grantWearables(userId, drop);
	return { ok: true, newlyClaimed: rows.length > 0, claimedAt: at, wearablesSynced };
}
