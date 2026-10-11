// Mounts the Event Markets strip into #em-strip using its data-* attributes.
import { mountMarketStrip } from './entry-strip.js';

const el = document.getElementById('em-strip');
if (el) {
	mountMarketStrip(el, {
		sourceKind: el.dataset.sourceKind || null,
		heading: el.dataset.heading || undefined,
		limit: 3,
	});
}
