// Entry points into Event Markets from other surfaces (Arena, /event, launches, home).
// mountMarketStrip() reads the public list and renders a compact "Call the winner" strip.
// With nothing live it renders nothing, so a surface never shows an empty promo.

import './entry-strip.css';
import { h, api, SOURCE_LABELS, pct, countdown, marketHref, listOf } from './common.js';

/**
 * @param {HTMLElement} el  mount point
 * @param {{ sourceKind?: string, sourceRef?: string, limit?: number, heading?: string }} [opts]
 * @returns {Promise<number>} markets shown
 */
export async function mountMarketStrip(el, { sourceKind = null, sourceRef = null, limit = 3, heading = 'Call the winner' } = {}) {
	if (!el) return 0;
	let rows;
	try {
		const qs = new URLSearchParams({ status: 'open', limit: sourceRef ? '50' : String(Math.max(limit, 3)) });
		if (sourceKind) qs.set('source_kind', sourceKind);
		rows = listOf(await api(`?${qs}`)).items;
	} catch {
		return 0;
	}
	if (sourceRef) rows = rows.filter((m) => m.source_ref === sourceRef);
	rows = rows.slice(0, limit);
	if (!rows.length) return 0;
	el.replaceChildren(h('section', { class: 'emx', 'aria-label': 'Event Markets' },
		h('div', { class: 'emx-head' },
			h('strong', null, heading),
			h('a', { href: '/event-markets' }, 'All markets')),
		h('ul', { class: 'emx-list' }, rows.map((m) => {
			const lead = [...m.outcomes].sort((a, b) => b.percent - a.percent)[0];
			return h('li', null, h('a', { class: 'emx-item', href: marketHref(m) },
				h('span', { class: 'emx-t' }, m.title),
				h('span', { class: 'emx-s' }, `${lead ? `${lead.label} ${pct(lead.percent)} · ` : ''}locks in ${countdown(m.seconds_to_lock)}`),
				h('span', { class: 'emx-s' }, `${SOURCE_LABELS[m.source_kind] || m.source_kind} · ${m.pick_count} ${m.pick_count === 1 ? 'pick' : 'picks'}`)));
		}))));
	return rows.length;
}
