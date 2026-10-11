// Helpers every event-source adapter shares. An adapter lists upcoming and live
// events from our own tables and returns them in one normalized shape:
//
//   { sourceKind, sourceRef, title, startsAt, endsAt, lockAt, resolvesAt,
//     entrants: [{ label, refKind, refId, imageUrl }],
//     rule: { type, description, ... },
//     winnerDefined, noWinnerReason }
//
// Times are Date objects. `lockAt` is when picks close (documented per adapter in
// docs/event-markets.md); `resolvesAt` is when the winner can be read.

import { thumbnailUrl } from '../../r2.js';

/** Date at `fraction` of the way from `startsAt` to `endsAt`. */
export function fractionOf(startsAt, endsAt, fraction) {
	return new Date(startsAt.getTime() + (endsAt.getTime() - startsAt.getTime()) * fraction);
}

/** Public thumbnail for an agent row joined to its avatar, or null when not public. */
export function agentImage(row) {
	const pub = row.avatar_visibility === 'public' || row.avatar_visibility === 'unlisted';
	return row.avatar_thumbnail_key && pub ? thumbnailUrl(row.avatar_thumbnail_key) : null;
}

/** Short stable label for a wallet-shaped id. */
export function shortAddress(id) {
	const s = String(id || '');
	return s.length > 12 ? `${s.slice(0, 4)}...${s.slice(-4)}` : s;
}
