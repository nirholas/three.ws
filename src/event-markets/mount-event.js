// /event: shows the scheduled event's market, matched on the event id in /event.json.
import { mountMarketStrip } from './entry-strip.js';
import { fetchEventDocument } from '../shared/event-config.js';

const el = document.getElementById('em-strip');
if (el) {
	fetchEventDocument()
		.then((ev) => {
			if (ev?.id) mountMarketStrip(el, { sourceKind: 'event_leaderboard', sourceRef: ev.id, limit: 1, heading: 'Who wins this event?' });
		})
		.catch(() => {});
}
