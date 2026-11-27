/**
 * Forge-Off votes — community curation for the forge showcase.
 *
 *   POST /api/forge-vote   { creation_id, vote: true | false }
 *     → { ok, creation_id, vote_count, voted }
 *
 * One upvote per anonymous browser per creation. The voter is the same hashed
 * browser-local id (x-forge-client) the gallery already scopes by, so voting
 * needs no login — consistent with /forge being auth-free. `vote: true` casts
 * (idempotent — a repeat is a no-op), `vote: false` removes the caller's vote.
 * The response carries the fresh authoritative tally and the caller's own
 * voted-state so the button can reconcile after an optimistic tap.
 *
 * Votes are only accepted on public, finished, non-rejected creations the
 * content screen has not stopped (the same bar the board and showcase render).
 * When persistence is unconfigured this returns a clean { ok: false }, same
 * contract as /api/forge-poster.
 *
 * A vote cast from a Forge-Off event board names it: { event: <slug>, board:
 * 'day-<n>' | 'overall' }. Outside that board's [opens, closes) window (UTC,
 * server clock) the vote, or its removal, is refused with 409 voting_closed or
 * voting_not_open, so a page left open past the deadline cannot add a vote the
 * board would not count. The standings never count a late vote either way
 * (api/_lib/forge-off-standings.js), whichever surface it came from.
 */

import { cors, json, method, readJson, wrap, rateLimited } from './_lib/http.js';
import { limits, clientIp } from './_lib/rate-limit.js';
import { hashClient, hashIp, castVote, removeVote, forgeStoreEnabled } from './_lib/forge-store.js';
import { isUuid } from './_lib/validate.js';
import { boardWindow, getEvent, isValidSlug } from './_lib/forge-off-events.js';

const MAX_BODY_BYTES = 4_096;

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'POST,OPTIONS' })) return;
	if (!method(req, res, ['POST'])) return;

	const ip = clientIp(req);
	const rl = await limits.forgeVote(ip);
	if (!rl.success) {
		return rateLimited(res, rl);
	}

	if (!forgeStoreEnabled()) {
		return json(res, 200, { ok: false, reason: 'persistence_unconfigured' });
	}

	const body = await readJson(req, MAX_BODY_BYTES).catch(() => null);
	const creationId = typeof body?.creation_id === 'string' ? body.creation_id.trim() : '';
	if (!isUuid(creationId)) {
		return json(res, 400, { error: 'invalid_creation', message: 'creation_id must be a uuid.' });
	}
	// Default to casting: the button's primary action is an upvote. Only an
	// explicit `vote: false` (or "remove") toggles it off.
	const removing = body?.vote === false || body?.vote === 'false' || body?.remove === true;

	if (body?.event !== undefined || body?.board !== undefined) {
		const slug = typeof body.event === 'string' ? body.event.trim() : '';
		if (!isValidSlug(slug)) {
			return json(res, 400, { error: 'invalid_event', message: 'event must be a Forge-Off event slug.' });
		}
		const event = getEvent(slug);
		if (!event) return json(res, 404, { error: 'unknown_event', message: 'No such Forge-Off event.' });
		const board = boardWindow(event, typeof body.board === 'string' ? body.board.trim() : '');
		if (!board) {
			return json(res, 400, { error: 'invalid_board', message: `board must be overall or day-1 to day-${event.days.length}.` });
		}
		const now = Date.now();
		if (now < board.from.getTime()) {
			return json(res, 409, {
				error: 'voting_not_open',
				message: 'Voting on this board has not opened yet.',
				opens_at: board.from.toISOString(),
			});
		}
		if (now >= board.to.getTime()) {
			return json(res, 409, {
				error: 'voting_closed',
				message: 'Voting on this board has closed.',
				closes_at: board.to.toISOString(),
			});
		}
	}

	const rawClient = req.headers['x-forge-client'];
	const voterKey = hashClient(Array.isArray(rawClient) ? rawClient[0] : rawClient);
	// 'anon' is the shared bucket for browsers with no stable id — a real vote
	// needs a real, unique voter so the tally means something and the toggle is
	// per-person. Reject the anonymous bucket rather than let everyone share one.
	if (voterKey === 'anon') {
		return json(res, 400, {
			error: 'no_client_id',
			message: 'A stable x-forge-client id is required to vote.',
		});
	}

	const result = removing
		? await removeVote({ creationId, voterKey })
		: await castVote({ creationId, voterKey, ipHash: hashIp(ip) });

	// castVote returns null when the creation isn't a votable public artifact.
	if (!result) {
		return json(res, 404, {
			error: 'not_votable',
			message: 'That creation is not available for voting.',
		});
	}

	return json(res, 200, {
		ok: true,
		creation_id: result.creationId,
		vote_count: result.voteCount,
		voted: result.voted,
	});
});
