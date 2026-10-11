// Live odds on /event-markets/:slug. Subscribes to the stream for one market and
// patches the rendered entrants in place (no re-render, so focus and scroll hold).
// A lock or resolve asks the page to reload the market, since that changes what
// the whole page offers. See live-feed.js for reconnect and polling behavior.

import { createLiveFeed, applyOdds } from './live-feed.js';
import { h, api, pct } from './common.js';

const STATUS_TEXT = {
	connecting: 'Connecting',
	live: 'Live',
	reconnecting: 'Reconnecting',
	polling: 'Live (refreshing every few seconds)',
	offline: 'Offline. Odds may be out of date.',
};

const reducedMotion = () => globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/**
 * @param {{ slug: string, getMarket: () => object|null, onReload: () => void, announce: (msg: string) => void }} opts
 */
export function attachLiveOdds({ slug, getMarket, onReload, announce }) {
	const chip = h('div', { class: 'em-livechip', 'data-status': 'connecting', role: 'status', 'aria-live': 'off' }, h('span', { class: 'dot', 'aria-hidden': 'true' }), h('span', { class: 'txt' }, STATUS_TEXT.connecting));
	document.body.append(chip);

	function paint(odds) {
		const m = getMarket();
		if (!m) return;
		const before = new Map(m.outcomes.map((o) => [o.id, o.percent]));
		if (!applyOdds(m, odds)) return;
		for (const o of m.outcomes) {
			const li = document.querySelector(`.em-ent[data-oid="${CSS.escape(o.id)}"]`);
			if (!li) continue;
			const pc = li.querySelector('.pc');
			const changed = before.get(o.id) !== o.percent;
			if (pc) { pc.textContent = pct(o.percent); pc.setAttribute('aria-label', `${pct(o.percent)} implied odds`); }
			const fill = li.querySelector('.em-bar-fill');
			if (fill) fill.style.width = `${Math.max(1, o.percent)}%`;
			const sub = li.querySelector('.sub');
			if (sub) sub.textContent = `${o.picks} ${o.picks === 1 ? 'pick' : 'picks'}`;
			if (changed && !reducedMotion()) {
				const dir = o.percent > before.get(o.id) ? 'up' : 'down';
				pc?.setAttribute('data-flash', dir);
				setTimeout(() => pc?.removeAttribute('data-flash'), 900);
			}
		}
	}

	const feed = createLiveFeed({
		slug,
		onStatus(s) {
			chip.dataset.status = s;
			chip.querySelector('.txt').textContent = STATUS_TEXT[s] || s;
		},
		onEvent(ev) {
			if (ev.type === 'snapshot' || ev.type === 'resync') {
				const odds = ev.markets?.find((x) => x.slug === slug);
				if (odds) {
					const m = getMarket();
					if (m && m.status !== odds.status) onReload();
					else paint(odds);
				}
			} else if (ev.type === 'odds' && ev.slug === slug) paint(ev);
			else if (ev.type === 'move' && ev.slug === slug) announce(`${ev.label} odds moved ${ev.delta_points > 0 ? 'up' : 'down'} ${Math.abs(ev.delta_points)} points, now ${pct(Math.round(ev.share_to * 100))}.`);
			else if ((ev.type === 'lock' || ev.type === 'resolve') && ev.slug === slug) onReload();
		},
		poll: async () => {
			const data = await api(`/${encodeURIComponent(slug)}`);
			const m = data.market || data;
			return { markets: [{ slug, status: m.status, pick_count: m.pick_count, outcomes: m.outcomes.map((o) => ({ id: o.id, picks: o.picks, percent: o.percent, share: o.share })) }] };
		},
	});
	feed.start();
	return { stop() { feed.stop(); chip.remove(); } };
}
