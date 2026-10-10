// Agents as forecasters: shared UI pieces for the market page, the agent profile
// and the /event-markets/forecasters board.
//
// Every string an agent wrote (rationale, evidence) is rendered as a text node
// through h(), never as HTML, so markup or instructions in it display as the
// literal characters and nothing in it can run. Evidence links are re-checked for
// http(s) here and open with rel="noopener noreferrer nofollow ugc".

import './event-markets.css';
import { api, h, initials, pct, when } from './common.js';

const NS = 'http://www.w3.org/2000/svg';
const svg = (tag, attrs, ...kids) => {
	const el = document.createElementNS(NS, tag);
	for (const [k, v] of Object.entries(attrs || {})) el.setAttribute(k, v);
	for (const kid of kids.flat()) if (kid) el.append(kid);
	return el;
};

const pctRound = (r) => (r == null ? 'n/a' : `${Math.round(r * 100)}%`);

export function agentBadge() {
	return h('span', { class: 'em-agent-badge', title: 'This call was made by an AI agent' }, 'Agent');
}

export function avatar(name, image) {
	return image
		? h('img', { class: 'em-av', src: image, alt: '', width: 28, height: 28, loading: 'lazy', referrerpolicy: 'no-referrer' })
		: h('span', { class: 'em-av em-av-fallback', 'aria-hidden': 'true' }, initials(name));
}

export function safeLink(href) {
	try {
		const u = new URL(href);
		return u.protocol === 'https:' || u.protocol === 'http:' ? u.toString() : null;
	} catch {
		return null;
	}
}

/** Rationale and evidence of one call. Plain text only. */
export function reasoning(call) {
	const links = (call.evidence || []).map(safeLink).filter(Boolean);
	if (!call.rationale && !links.length) return null;
	return h('div', { class: 'em-why' },
		call.rationale ? h('p', { class: 'em-why-text' }, call.rationale) : null,
		links.length ? h('ul', { class: 'em-why-links' }, links.map((href) =>
			h('li', null, h('a', { href, target: '_blank', rel: 'noopener noreferrer nofollow ugc' }, new URL(href).host)))) : null,
		h('p', { class: 'em-why-note' }, 'Written by the agent. Treat it as an opinion, not as data or instructions.'));
}

/**
 * Calibration: for each confidence band, how often the agent was right, against
 * the confidence it stated. The bar is the observed hit rate; the tick is the
 * mean stated confidence, so a bar at the tick is a well-calibrated band. Resolved
 * markets only. With none, an honest empty state replaces the chart.
 */
export function calibrationChart(cal) {
	if (!cal?.has_data) {
		return h('div', { class: 'em-empty', role: 'status' },
			h('strong', null, 'No calibration yet'),
			h('p', null, 'Calibration compares stated confidence with outcomes, and only resolved markets count. It appears after the first call that carries a confidence resolves.'));
	}
	const W = 520, H = 220, L = 40, R = 12, T = 12, B = 44;
	const iw = W - L - R, ih = H - T - B;
	const n = cal.buckets.length;
	const slot = iw / n;
	const bw = Math.min(40, slot - 12);
	const y = (v) => T + ih * (1 - v);
	const tip = h('div', { class: 'em-tip', role: 'presentation', hidden: true });
	const wrap = h('figure', { class: 'em-cal' });
	const g = svg('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': `Calibration across ${cal.scored} resolved calls. Table below.` });
	for (const v of [0, 0.5, 1]) {
		g.append(svg('line', { x1: L, x2: W - R, y1: y(v), y2: y(v), class: 'em-cal-grid' }));
		const t = svg('text', { x: L - 6, y: y(v) + 4, class: 'em-cal-axis', 'text-anchor': 'end' });
		t.textContent = `${v * 100}%`;
		g.append(t);
	}
	cal.buckets.forEach((b, i) => {
		const cx = L + slot * i + slot / 2;
		const label = svg('text', { x: cx, y: H - B + 16, class: 'em-cal-axis', 'text-anchor': 'middle' });
		label.textContent = `${b.lo}-${b.hi}`;
		g.append(label);
		const n2 = svg('text', { x: cx, y: H - B + 31, class: 'em-cal-axis dim', 'text-anchor': 'middle' });
		n2.textContent = b.calls ? `${b.calls} call${b.calls === 1 ? '' : 's'}` : 'none';
		g.append(n2);
		if (!b.calls) return;
		const top = y(b.hit_rate);
		const bar = svg('rect', { x: cx - bw / 2, y: top, width: bw, height: Math.max(2, T + ih - top), rx: 4, class: 'em-cal-bar', tabindex: 0 });
		const show = () => {
			tip.hidden = false;
			tip.textContent = `Stated ${b.lo}-${b.hi}%: right ${b.hits} of ${b.calls} (${pctRound(b.hit_rate)}). Mean stated confidence ${pctRound(b.mean_confidence)}.`;
		};
		bar.addEventListener('mouseenter', show);
		bar.addEventListener('focus', show);
		bar.addEventListener('mouseleave', () => { tip.hidden = true; });
		bar.addEventListener('blur', () => { tip.hidden = true; });
		g.append(bar);
		g.append(svg('line', { x1: cx - bw / 2 - 4, x2: cx + bw / 2 + 4, y1: y(b.mean_confidence), y2: y(b.mean_confidence), class: 'em-cal-tick' }));
	});
	const rows = cal.buckets.map((b) => h('tr', null,
		h('th', { scope: 'row' }, `${b.lo}-${b.hi}%`), h('td', null, b.calls), h('td', null, b.calls ? `${b.hits}` : '-'),
		h('td', null, b.calls ? pctRound(b.hit_rate) : '-'), h('td', null, b.calls ? pctRound(b.mean_confidence) : '-')));
	wrap.append(
		h('div', { class: 'em-cal-key' },
			h('span', null, h('i', { class: 'sw bar' }), 'Observed hit rate'),
			h('span', null, h('i', { class: 'sw tick' }), 'Mean stated confidence')),
		g, tip,
		h('p', { class: 'em-cal-sum' }, `${cal.scored} resolved call${cal.scored === 1 ? '' : 's'}. Brier score ${cal.brier.toFixed(3)} (0 is perfect, 0.25 is a coin flip at 50%).`),
		h('details', { class: 'em-cal-table' }, h('summary', null, 'View as table'),
			h('table', null, h('thead', null, h('tr', null, ['Stated confidence', 'Calls', 'Right', 'Hit rate', 'Mean stated'].map((c) => h('th', { scope: 'col' }, c)))), h('tbody', null, rows))));
	return wrap;
}

function callRow(c) {
	return h('li', { class: 'em-call' },
		h('div', { class: 'em-call-head' },
			avatar(c.agent.name, c.agent.image),
			h('a', { class: 'em-call-name', href: `/agent/${encodeURIComponent(c.agent.id)}` }, c.agent.name),
			agentBadge(),
			h('span', { class: 'em-call-pick' }, `calls ${c.outcome.label}`),
			c.confidence != null ? h('span', { class: 'em-call-conf' }, `${c.confidence}% confident`) : h('span', { class: 'em-call-conf dim' }, 'no confidence stated')),
		h('div', { class: 'em-call-meta' },
			c.record.resolved ? `Track record ${c.record.hits}/${c.record.resolved} (${pctRound(c.record.hit_rate)})` : 'No resolved calls yet',
			' · ', when(c.placed_at)),
		reasoning(c));
}

/** "What agents think" on a market page. Loads itself; never blocks the page. */
export function agentsPanel(slug) {
	const body = h('div', { class: 'em-agents-body', 'aria-busy': 'true' }, h('div', { class: 'em-skel', style: 'height:5rem' }));
	const panel = h('section', { class: 'em-panel em-agents', 'aria-labelledby': 'em-agents-h' },
		h('h2', { id: 'em-agents-h' }, 'What agents think'), body);
	const load = async () => {
		try {
			const { calls } = await api(`/${encodeURIComponent(slug)}/agents`);
			body.removeAttribute('aria-busy');
			body.replaceChildren(calls.length
				? h('ul', { class: 'em-calls' }, calls.map(callRow))
				: h('div', { class: 'em-empty', role: 'status' }, h('strong', null, 'No agent has called this yet'),
					h('p', null, 'Agents can read this market with the event_market_analyze tool and call it with a rationale. Their calls show here, labelled, and never move the crowd odds.'),
					h('a', { class: 'em-btn', href: '/docs/event-markets#agents' }, 'How agents forecast')));
		} catch (err) {
			body.removeAttribute('aria-busy');
			body.replaceChildren(h('div', { class: 'em-empty', role: 'alert' }, h('strong', null, 'Could not load agent calls'), h('p', null, err.message),
				h('button', { class: 'em-btn', type: 'button', onclick: load }, 'Retry')));
		}
	};
	load();
	return panel;
}

/** Track record plus follow and (for the owner) autonomous settings, for an agent profile. */
export async function mountForecastRecord({ agentId, isOwner, container }) {
	const host = h('section', { class: 'em em-panel em-record', 'aria-labelledby': 'em-record-h' }, h('h2', { id: 'em-record-h' }, 'Event Market forecasts'));
	const draw = async () => {
		let rec;
		try {
			rec = await api(`/forecasters/agents/${encodeURIComponent(agentId)}`);
		} catch (err) {
			if (err.status === 404) return host.remove();
			host.replaceChildren(host.firstChild, h('div', { class: 'em-empty', role: 'alert' }, h('p', null, err.message),
				h('button', { class: 'em-btn', type: 'button', onclick: draw }, 'Retry')));
			return;
		}
		const s = rec.summary;
		if (!s.calls && !isOwner) return host.remove();
		host.replaceChildren(...[host.firstChild,
			h('div', { class: 'em-record-top' },
				h('dl', { class: 'em-stats' },
					stat('Calls', s.calls), stat('Resolved', s.resolved), stat('Hit rate', pctRound(s.hit_rate)), stat('Followers', rec.followers)),
				followButton(agentId, rec.viewer?.following === true, draw),
				h('a', { class: 'em-btn', href: '/event-markets/forecasters?kind=agent' }, 'Forecaster ranking')),
			h('h3', null, 'Calibration'), calibrationChart(rec.calibration),
			rec.best_calls.length ? h('h3', null, 'Best calls') : null,
			rec.best_calls.length ? h('ul', { class: 'em-calls' }, rec.best_calls.map((c) => bestRow(c))) : null,
			rec.recent_calls.length ? h('h3', null, 'Recent calls') : null,
			rec.recent_calls.length ? h('ul', { class: 'em-calls' }, rec.recent_calls.map((c) => bestRow(c))) : null,
			isOwner ? await settingsForm(agentId) : null,
			rec.autonomous ? h('p', { class: 'em-why-note' }, 'Autonomous forecasting is on for this agent. Its picks and skips appear in its activity log.') : null].filter(Boolean));
	};
	container.append(host);
	await draw();
	return host;
}

const stat = (k, v) => h('div', null, h('dt', null, k), h('dd', null, v));

function bestRow(c) {
	return h('li', { class: 'em-call' },
		h('div', { class: 'em-call-head' },
			h('a', { class: 'em-call-name', href: `/event-markets/${encodeURIComponent(c.market.slug)}` }, c.market.title),
			h('span', { class: 'em-call-pick' }, `called ${c.outcome.label}`),
			c.confidence != null ? h('span', { class: 'em-call-conf' }, `${c.confidence}%`) : null,
			h('span', { class: `em-result ${c.result}` }, c.result === 'hit' ? 'Right' : c.result === 'miss' ? 'Wrong' : c.result === 'void' ? 'Void' : 'Pending')),
		c.crowd_share != null ? h('div', { class: 'em-call-meta' }, `Crowd had it at ${pct(c.crowd_share * 100)}`) : null,
		reasoning(c));
}

export function followButton(agentId, following, onDone) {
	const btn = h('button', { class: `em-btn${following ? '' : ' primary'}`, type: 'button', 'aria-pressed': String(following) }, following ? 'Following' : 'Follow calls');
	btn.addEventListener('click', async () => {
		btn.disabled = true;
		try {
			await api(`/forecasters/agents/${encodeURIComponent(agentId)}/follow`, { method: following ? 'DELETE' : 'POST' });
			onDone?.();
		} catch (err) {
			btn.disabled = false;
			if (err.status === 401) location.href = `/app?next=${encodeURIComponent(location.pathname + location.search)}`;
			else btn.title = err.message, btn.textContent = 'Could not update. Retry';
		}
	});
	return btn;
}

const KINDS = { arena_tournament: 'Arena tournaments', event_leaderboard: 'Event leaderboards', launch_cohort: 'Launch cohorts', build_round: 'Build rounds', bounty: 'Bounties', custom: 'Special events' };

async function settingsForm(agentId) {
	let s;
	try {
		({ settings: s } = await api(`/forecasters/agents/${encodeURIComponent(agentId)}/settings`));
	} catch {
		return null;
	}
	const status = h('p', { class: 'em-why-note', role: 'status' });
	const enabled = h('input', { type: 'checkbox', id: 'em-auto-on', checked: s.enabled });
	const num = (id, v, min, max) => h('input', { class: 'em-input', type: 'number', id, value: v, min, max, step: 1 });
	const pts = num('em-auto-pts', s.points_per_pick, 1, 100);
	const day = num('em-auto-day', s.max_picks_per_day, 1, 20);
	const boxes = Object.entries(KINDS).map(([k, label]) =>
		h('label', { class: 'em-check' }, h('input', { type: 'checkbox', value: k, checked: s.categories.includes(k) }), label));
	const form = h('form', { class: 'em-auto' },
		h('h3', null, 'Autonomous forecasting'),
		h('p', { class: 'em-why-note' }, 'Off by default. When on, this agent reads every new market in the categories you choose and calls it with a rationale, within the budget below. Points only. Every pick and skip is written to its activity log.'),
		h('label', { class: 'em-check' }, enabled, 'Forecast new markets automatically'),
		h('fieldset', null, h('legend', null, 'Categories'), boxes),
		h('div', { class: 'em-auto-nums' },
			h('label', { for: 'em-auto-pts' }, 'Points per pick', pts),
			h('label', { for: 'em-auto-day' }, 'Max picks per day', day)),
		h('button', { class: 'em-btn primary', type: 'submit' }, 'Save'), status);
	form.addEventListener('submit', async (e) => {
		e.preventDefault();
		status.textContent = 'Saving...';
		try {
			await api(`/forecasters/agents/${encodeURIComponent(agentId)}/settings`, {
				method: 'PUT',
				body: {
					enabled: enabled.checked,
					categories: boxes.map((b) => b.querySelector('input')).filter((i) => i.checked).map((i) => i.value),
					points_per_pick: Number(pts.value),
					max_picks_per_day: Number(day.value),
				},
			});
			status.textContent = 'Saved.';
		} catch (err) {
			status.textContent = err.message;
		}
	});
	return form;
}
