// /event: shows the scheduled event's market, matched on the event id in /event.json.
import { mountMarketStrip } from './entry-strip.js';

const el = document.getElementById('em-strip');
if (el) {
	fetch('/event.json', { headers: { accept: 'application/json' } })
		.then((r) => (r.ok ? r.json() : null))
		.then((ev) => {
			if (ev?.id) mountMarketStrip(el, { sourceKind: 'event_leaderboard', sourceRef: ev.id, limit: 1, heading: 'Who wins this event?' });
		})
		.catch(() => {});
}
