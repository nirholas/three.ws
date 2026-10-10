// The live platform event (public/event.json, the `/play` quest line and `/event`
// page). Entrants are the wallets that have completed at least one event quest;
// the winner is the top of the event leaderboard when the event ends.

import { eventConfig } from '../../event-config.js';
import { readEventRecords } from '../../event-leaderboard-store.js';
import { eventMarketsAutoOpen } from '../config-auto-open.js';
import { fractionOf, shortAddress } from './shared.js';

export const sourceKind = 'event_leaderboard';

export async function listEvents(now = new Date()) {
	const event = eventConfig(now.getTime());
	if (!event) return [];
	const endsAt = new Date(event.endsAt);
	if (endsAt <= now) return [];
	const startsAt = new Date(event.startsAt);
	const { records } = await readEventRecords(event.id);
	const entrants = records
		.filter((r) => r.runs > 0)
		.sort((a, b) => a.lastAt - b.lastAt)
		.map((r) => ({
			label: r.name || shortAddress(r.account),
			refKind: 'wallet',
			refId: r.account,
			imageUrl: null,
		}));
	return [{
		sourceKind,
		sourceRef: event.id,
		title: event.name,
		startsAt,
		endsAt,
		lockAt: fractionOf(startsAt, endsAt, eventMarketsAutoOpen.lockFractions.event_leaderboard),
		resolvesAt: endsAt,
		entrants,
		rule: {
			type: 'event_leaderboard_top',
			event_id: event.id,
			description: 'Resolves to the entrant ranked first on the event leaderboard when the event ends.',
		},
		winnerDefined: true,
	}];
}
