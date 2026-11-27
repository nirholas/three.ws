// Forge-Off standings: the one set of contest rules every board, crown and
// page reads. The event endpoint, the event board on /api/forge-gallery, the
// event crown and the weekly crown all rank through rankBoard, so what the page
// shows at a board's close is exactly what the crown writes.
//
// The rules (also served to the page as RULES so entrants can read them):
//   Entry      a finished, public model made on three.ws inside the board's
//              [from, to) window (UTC). Rejected by its maker, private,
//              unlisted, held or blocked by the content screen: not an entry.
//              Any number of entries per person. Making an entry private or
//              deleting it withdraws it at once.
//   Vote       one per browser per entry (forge_votes primary key). A vote
//              counts toward a board only if it was cast before the board
//              closed. A vote from the browser that made the entry does not
//              count. At most VOTES_PER_NETWORK_PER_ENTRY votes from one
//              network (hashed IP) count toward one entry, oldest first, so a
//              script rotating browser ids from one machine cannot stuff a board.
//   Rank       counted votes, most first; ties go to the entry published
//              first; the creation id settles the impossible last tie.
//   Winner     the top-ranked entry with at least one counted vote. It must
//              have passed the content screen; while its screen is still
//              pending the board waits (the crown retries hourly) rather than
//              crowning someone else.
//
// Everything here except the two loaders is pure, so the rules are tested to
// the millisecond with fixed rows and an injected clock.

import { sql } from './db.js';
import { normalizeStoredUrl } from './r2.js';

export const VOTES_PER_NETWORK_PER_ENTRY = 3;

// The rules as plain sentences, served by /api/forge-off/event and rendered on
// /forge-off, so the page can never state a rule the code does not apply.
export const RULES = Object.freeze([
	'Every day has its own board. A model you make and publish on three.ws during that UTC day is entered on it automatically, and models made during the event also compete for the overall title.',
	'Enter as many models as you like. Making one private or deleting it withdraws it straight away.',
	'Anyone can vote, no account needed: one vote per browser per model. Votes count only until the board closes.',
	'Votes on your own models do not count, and at most 3 votes from one network count toward any one model.',
	'Most counted votes wins. A tie goes to the model published first.',
	'Only models that pass the content check can be listed or win. Removed or disqualified models drop off the board.',
	'A winner is crowned shortly after each board closes and never changes after that.',
]);

const ms = (d) => (d instanceof Date ? d.getTime() : new Date(d).getTime());

/** A row that may sit on a board: finished, stored, public and not stopped by the screen. */
export function isEligibleEntry(row) {
	if (!row || row.status !== 'done' || !row.glb_url) return false;
	if (row.outcome === 'rejected') return false;
	if (!(row.visibility == null || row.visibility === 'public')) return false;
	if (row.safety_status === 'held' || row.safety_status === 'blocked') return false;
	return true;
}

/** Whether an eligible entry may be crowned: its content screen came back clear. */
export function hasPassedScreen(row) {
	return row?.safety_status === 'clear';
}

/**
 * Counted votes per creation id.
 * @param {Array<{creation_id: string, voter_key: string, ip_hash?: string|null, created_at: Date|string}>} votes
 * @param {{ closesAt: Date|number|string, ownerKeyOf?: ((id: string) => string|null)|null, perNetworkCap?: number }} opts
 */
export function countVotes(votes, { closesAt, ownerKeyOf = null, perNetworkCap = VOTES_PER_NETWORK_PER_ENTRY }) {
	const close = ms(closesAt);
	const ordered = votes
		.filter((v) => ms(v.created_at) < close)
		.filter((v) => !ownerKeyOf || !v.voter_key || ownerKeyOf(v.creation_id) !== v.voter_key)
		.sort((a, b) => ms(a.created_at) - ms(b.created_at) || String(a.voter_key).localeCompare(String(b.voter_key)));
	const perNetwork = new Map();
	const tally = new Map();
	for (const v of ordered) {
		if (v.ip_hash) {
			const k = `${v.creation_id}\u0000${v.ip_hash}`;
			const used = perNetwork.get(k) || 0;
			if (used >= perNetworkCap) continue;
			perNetwork.set(k, used + 1);
		}
		tally.set(v.creation_id, (tally.get(v.creation_id) || 0) + 1);
	}
	return tally;
}

/**
 * Rank one board. Returns [{ entry, votes }] in finishing order.
 *
 * `ties` and the self/network rules exist so the weekly crown can keep
 * mirroring its live board (newest first on a tie, raw one-per-browser votes);
 * every event board uses the defaults.
 */
export function rankBoard(entries, votes, { from, to, closesAt = to, excludeSelf = true, perNetworkCap = VOTES_PER_NETWORK_PER_ENTRY, ties = 'earliest' }) {
	const lo = ms(from);
	const hi = ms(to);
	const onBoard = entries.filter((e) => isEligibleEntry(e) && ms(e.created_at) >= lo && ms(e.created_at) < hi);
	const ids = new Set(onBoard.map((e) => e.id));
	const owner = new Map(onBoard.map((e) => [e.id, e.client_key || null]));
	const tally = countVotes(
		votes.filter((v) => ids.has(v.creation_id)),
		{ closesAt, ownerKeyOf: excludeSelf ? (id) => owner.get(id) : null, perNetworkCap },
	);
	const dir = ties === 'latest' ? -1 : 1;
	return onBoard
		.map((entry) => ({ entry, votes: tally.get(entry.id) || 0 }))
		.sort(
			(a, b) =>
				b.votes - a.votes ||
				dir * (ms(a.entry.created_at) - ms(b.entry.created_at)) ||
				String(a.entry.id).localeCompare(String(b.entry.id)),
		);
}

/**
 * Who wins a ranked board.
 * @returns {{ status: 'crowned'|'deferred'|'no_entries'|'no_votes', entry?: object, votes?: number }}
 */
export function pickWinner(ranked, { requireScreen = true } = {}) {
	if (!ranked.length) return { status: 'no_entries' };
	const top = ranked[0];
	if (top.votes < 1) return { status: 'no_votes' };
	if (requireScreen && !hasPassedScreen(top.entry)) return { status: 'deferred', entry: top.entry, votes: top.votes };
	return { status: 'crowned', entry: top.entry, votes: top.votes };
}

/** The card shape the page and the gallery read. vote_count is the board's counted tally. */
export function publicEntry(entry, votes, votedIds) {
	return {
		id: entry.id,
		prompt: entry.prompt,
		glb_url: normalizeStoredUrl(entry.glb_url),
		web_glb_url: normalizeStoredUrl(entry.web_glb_url) ?? null,
		preview_image_url: normalizeStoredUrl(entry.preview_image_url),
		model_category: entry.model_category ?? 'other',
		backend: entry.backend ?? null,
		created_at: entry.created_at,
		vote_count: votes,
		voted: votedIds.has(entry.id),
	};
}

/** Creation ids the given browser has voted on, whatever the deadline. */
export function votedBy(votes, voterKey) {
	const out = new Set();
	if (!voterKey) return out;
	for (const v of votes) if (v.voter_key === voterKey) out.add(v.creation_id);
	return out;
}

/**
 * Every finished model made in [from, to) and every vote on one. Eligibility,
 * deadlines and ranking are applied in JS by the pure functions above.
 */
export async function loadWindow({ from, to }) {
	const lo = new Date(from).toISOString();
	const hi = new Date(to).toISOString();
	const [entries, votes] = await Promise.all([
		sql`
			select fc.id, fc.prompt, fc.glb_url, fc.web_glb_url, fc.preview_image_url, fc.model_category,
				fc.backend, fc.created_at, fc.client_key, fc.status, fc.outcome, fc.visibility, fc.safety_status
			from forge_creations fc
			where fc.created_at >= ${lo}::timestamptz and fc.created_at < ${hi}::timestamptz
				and fc.status = 'done' and fc.glb_url is not null
		`,
		sql`
			select v.creation_id, v.voter_key, v.ip_hash, v.created_at
			from forge_votes v
			join forge_creations fc on fc.id = v.creation_id
			where fc.created_at >= ${lo}::timestamptz and fc.created_at < ${hi}::timestamptz
				and fc.status = 'done' and fc.glb_url is not null
		`,
	]);
	return { entries, votes };
}

/**
 * Crowned event winners for the given slugs, keyed `${slug}/${board_key}`.
 * A crown is permanent, but a winner whose model has since been deleted, made
 * private or stopped by the screen is reported as { removed: true } with no
 * model attached, so a withdrawn or disqualified entry never stays on show.
 */
export async function loadEventWinners(slugs) {
	if (!slugs.length) return new Map();
	const rows = await sql`
		select w.event_slug, w.board_key, w.creation_id, w.votes, w.prompt, w.preview_image_url,
			w.model_category, w.crowned_at,
			fc.status as creation_status, fc.glb_url as creation_glb_url, fc.outcome as creation_outcome,
			fc.visibility as creation_visibility, fc.safety_status as creation_safety_status
		from forge_event_winners w
		left join forge_creations fc on fc.id = w.creation_id
		where w.event_slug = any(${slugs})
	`;
	const out = new Map();
	for (const r of rows) {
		const still = r.creation_id
			? isEligibleEntry({
				status: r.creation_status,
				glb_url: r.creation_glb_url,
				outcome: r.creation_outcome,
				visibility: r.creation_visibility,
				safety_status: r.creation_safety_status,
			})
			: false;
		const votes = Number(r.votes) || 0;
		out.set(
			`${r.event_slug}/${r.board_key}`,
			still
				? {
					creation_id: r.creation_id,
					prompt: r.prompt,
					preview_image_url: normalizeStoredUrl(r.preview_image_url),
					model_category: r.model_category ?? 'other',
					votes,
					crowned_at: r.crowned_at,
				}
				: { removed: true, votes },
		);
	}
	return out;
}
