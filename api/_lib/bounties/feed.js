// Public shape of the aggregated bounty feed: row serialization, url dedupe,
// opaque offset cursors and per-source health. Pure, so it unit-tests without
// a database. The queries live in store.js.

// A source is stale when nothing it lists has been seen for this long. The
// refresh cron runs every 30 minutes, so six hours is twelve missed runs.
export const STALE_AFTER_MS = 6 * 60 * 60 * 1000;

const num = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));

/** One bounty_listings row in the shape the API returns. */
export function serializeListing(r) {
	return {
		id: r.id,
		source: r.source,
		kind: r.kind,
		title: r.title,
		summary: r.summary ?? null,
		url: r.url,
		venue: r.venue,
		venueUrl: r.venue_url ?? null,
		sponsor: r.sponsor ?? null,
		sponsorLogo: r.sponsor_logo ?? null,
		rewardAmount: num(r.reward_amount),
		rewardMax: num(r.reward_max),
		rewardCurrency: r.reward_currency ?? null,
		rewardUsd: num(r.reward_usd),
		deadline: r.deadline ? new Date(r.deadline).toISOString() : null,
		requirements: r.requirements || [],
		skills: r.skills || [],
		agentEligible: r.agent_eligible ?? null,
		submitMode: r.submit_mode,
		status: r.status,
		submissionsCount: r.submissions_count ?? null,
		programRoundId: r.program_round_id ?? null,
		triage: r.triage ?? null,
		firstSeenAt: r.first_seen_at ? new Date(r.first_seen_at).toISOString() : null,
	};
}

const urlKey = (u) => String(u || '').replace(/[#?].*$/, '').replace(/\/+$/, '').toLowerCase();

/** One listing per url (a trailing slash does not make a new one); the larger reward wins. */
export function dedupeByUrl(listings) {
	const byUrl = new Map();
	for (const l of listings) {
		const key = urlKey(l.url);
		const prev = byUrl.get(key);
		if (!prev || (Number(l.rewardUsd) || 0) > (Number(prev.rewardUsd) || 0)) byUrl.set(key, l);
	}
	return [...byUrl.values()];
}

export function encodeCursor(offset) {
	return Buffer.from(JSON.stringify({ o: offset })).toString('base64url');
}

/** Offset from an opaque cursor; anything malformed is the first page. */
export function decodeCursor(cursor) {
	if (!cursor) return 0;
	try {
		const o = JSON.parse(Buffer.from(String(cursor), 'base64url').toString('utf8'))?.o;
		return Number.isInteger(o) && o >= 0 && o < 100_000 ? o : 0;
	} catch {
		return 0;
	}
}

/**
 * Per-source status for the page's "source unavailable" notice. `stats` is the
 * grouped output of feedStats().bySource.
 */
export function sourceHealth(sources, stats, now = Date.now()) {
	const bySource = new Map(stats.map((s) => [s.source, s]));
	return sources.map((s) => {
		const st = bySource.get(s.id);
		const lastSeen = st?.last_seen ? new Date(st.last_seen).toISOString() : null;
		let status = 'ok';
		if (!st || !st.open) status = 'empty';
		else if (now - new Date(st.last_seen).getTime() > STALE_AFTER_MS) status = 'stale';
		return { id: s.id, label: s.label, status, open: st?.open ?? 0, rewardUsd: st ? Number(st.usd) || 0 : 0, lastSeenAt: lastSeen };
	});
}
