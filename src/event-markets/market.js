// /event-markets/:slug: entrants, odds over time, countdown, pick flow, share actions.

import { attachLiveOdds } from './market-live.js';
import { h, api, ApiError, SOURCE_LABELS, seriesColor, pct, countdown, when, initials, profileHref, statusLabel } from './common.js';

const root = document.getElementById('em-root');
const live = document.getElementById('em-live');
const SHOW_FIRST = 8;

const params = new URLSearchParams(location.search);
const slug = params.get('m') || '';
const challenge = params.get('pick');

const S = { market: null, history: null, viewer: null, expanded: false, tick: null, busy: false };
let toastTimer;

const announce = (msg) => { live.textContent = ''; setTimeout(() => { live.textContent = msg; }, 30); };
const shareUrl = (pickId) => `${location.origin}/event-markets/${encodeURIComponent(slug)}${pickId ? `?pick=${encodeURIComponent(pickId)}` : ''}`;

function toast(msg) {
	document.querySelector('.em-toast')?.remove();
	const t = h('div', { class: 'em-toast', role: 'status' }, msg);
	document.body.append(t);
	clearTimeout(toastTimer);
	toastTimer = setTimeout(() => t.remove(), 2600);
}

function setMeta(m) {
	document.title = `${m.title} · Event Markets · three.ws`;
}

/* ───────────── entrants ───────────── */

function entrantCard(o, i, m) {
	const mine = S.viewer?.pick?.outcome_id === o.id;
	const href = profileHref(o);
	const external = href && /^https?:/.test(href);
	const name = href ? h('a', { href, ...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {}) }, o.label) : o.label;
	const open = m.status === 'open';
	const resultTag = m.status === 'resolved' && o.is_winner ? h('span', { class: 'em-tag' }, 'Winner') : null;
	return h('li', { class: 'em-ent', 'data-oid': o.id, style: `--em-c:${seriesColor(i)}`, 'data-mine': String(mine), 'data-winner': String(!!o.is_winner) },
		h('span', { class: 'em-av', 'aria-hidden': 'true' }, o.image_url ? h('img', { src: o.image_url, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' }) : initials(o.label)),
		h('div', null,
			h('div', { class: 'nm' }, name, ' ', mine ? h('span', { class: 'em-tag' }, `Your pick${S.viewer.pick.points ? `, ${S.viewer.pick.points} pts` : ''}`) : null, ' ', resultTag),
			h('div', { class: 'sub' }, `${o.picks} ${o.picks === 1 ? 'pick' : 'picks'}`)),
		h('div', { class: 'pc', 'aria-label': `${pct(o.percent)} implied odds` }, pct(o.percent)),
		h('div', { class: 'em-bar-track', role: 'presentation' }, h('div', { class: 'em-bar-fill', style: `width:${Math.max(1, o.percent)}%` })),
		open ? h('div', { class: 'act' },
			h('button', { class: `em-btn${mine ? '' : ' primary'}`, type: 'button', 'aria-label': `${mine ? 'Change pick, currently' : 'Pick'} ${o.label} to win`, onclick: () => startPick(o) }, mine ? 'Your pick' : 'Pick to win'),
			mine ? h('button', { class: 'em-btn', type: 'button', onclick: withdraw }, 'Withdraw') : null,
			h('button', { class: 'em-btn', type: 'button', 'aria-label': `Share a challenge: pick ${o.label}`, onclick: () => challengeShare(o) }, 'Challenge')) : null);
}

function entrantsPanel(m) {
	const sorted = [...m.outcomes].sort((a, b) => b.percent - a.percent);
	const idx = new Map(m.outcomes.map((o, i) => [o.id, i]));
	const shown = S.expanded ? sorted : sorted.slice(0, SHOW_FIRST);
	return h('section', { class: 'em-panel', 'aria-labelledby': 'em-h-ent' },
		h('h2', { id: 'em-h-ent' }, `Entrants (${m.outcomes.length})`),
		m.odds?.note ? h('p', { class: 'em-note' }, m.odds.note) : null,
		h('ul', { class: 'em-entrants' }, shown.map((o) => entrantCard(o, idx.get(o.id), m))),
		sorted.length > SHOW_FIRST ? h('div', { class: 'em-more' }, h('button', { class: 'em-btn', type: 'button', 'aria-expanded': String(S.expanded), onclick: () => { S.expanded = !S.expanded; render(); } },
			S.expanded ? 'Show fewer' : `Show all ${sorted.length}`)) : null);
}

/* ───────────── chart ───────────── */

function chartPanel(m) {
	const hist = S.history;
	const panel = h('section', { class: 'em-panel', 'aria-labelledby': 'em-h-chart' }, h('h2', { id: 'em-h-chart' }, 'Odds over time'));
	if (!hist) { panel.append(h('div', { class: 'em-skel', style: 'height:14rem' })); return panel; }
	if (hist === 'error') { panel.append(h('p', { class: 'em-note' }, 'The odds history could not load. '), h('button', { class: 'em-btn', type: 'button', onclick: loadHistory }, 'Retry')); return panel; }

	const outcomes = m.outcomes;
	const pts = [{ at: hist.prior.at, odds: hist.prior.odds }, ...hist.points].map((p) => ({ t: Date.parse(p.at), odds: new Map(p.odds.map((o) => [o.outcome_id, o.percent])) }));
	if (hist.points.length === 0) {
		panel.append(h('p', { class: 'em-note' }, 'No picks yet, so the odds have not moved from the even split. The line draws itself as the crowd weighs in.'));
		return panel;
	}
	const endT = m.status === 'open' ? Date.now() : Math.max(pts[pts.length - 1].t, Date.parse(m.locks_at) || 0);
	if (pts[pts.length - 1].t < endT) pts.push({ t: endT, odds: pts[pts.length - 1].odds });
	const t0 = pts[0].t, span = Math.max(1, endT - t0);

	// Top six by current odds keep their slot color; the rest fold into one "Other" line.
	const ranked = [...outcomes].sort((a, b) => b.percent - a.percent);
	const slotOf = new Map(outcomes.map((o, i) => [o.id, i]));
	const series = ranked.slice(0, 6).map((o) => ({ id: o.id, label: o.label, color: seriesColor(slotOf.get(o.id)), get: (p) => p.odds.get(o.id) ?? 0 }));
	const rest = ranked.slice(6);
	if (rest.length) series.push({ id: 'other', label: `Other (${rest.length})`, color: 'var(--em-other)', get: (p) => rest.reduce((s, o) => s + (p.odds.get(o.id) ?? 0), 0) });

	const W = 640, H = 240, L = 36, R = 12, T = 12, B = 26;
	const maxY = Math.min(100, Math.max(20, Math.ceil(Math.max(...series.flatMap((s) => pts.map(s.get))) / 10) * 10));
	const x = (t) => L + ((t - t0) / span) * (W - L - R);
	const y = (v) => T + (1 - v / maxY) * (H - T - B);
	const NS = 'http://www.w3.org/2000/svg';
	const svg = document.createElementNS(NS, 'svg');
	svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
	svg.setAttribute('class', 'em-chart');
	svg.setAttribute('role', 'img');
	svg.setAttribute('tabindex', '0');
	svg.setAttribute('aria-label', `Line chart of implied odds over time for ${series.length} lines. Use left and right arrows to step through ${pts.length} points. A table view follows.`);
	const mk = (tag, attrs) => { const e = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); return e; };
	for (let v = 0; v <= maxY; v += maxY / 4) {
		svg.append(mk('line', { class: 'grid', x1: L, x2: W - R, y1: y(v), y2: y(v) }));
		const tx = mk('text', { x: L - 6, y: y(v) + 4, 'text-anchor': 'end' }); tx.textContent = `${Math.round(v)}%`; svg.append(tx);
	}
	for (const f of [0, 0.5, 1]) {
		const tx = mk('text', { x: L + f * (W - L - R), y: H - 6, 'text-anchor': f === 0 ? 'start' : f === 1 ? 'end' : 'middle' });
		tx.textContent = new Date(t0 + f * span).toLocaleString(undefined, span > 2 * 86400000 ? { month: 'short', day: 'numeric' } : { hour: 'numeric', minute: '2-digit' });
		svg.append(tx);
	}
	for (const s of series) {
		// step line: odds hold until the next real event
		let d = '';
		pts.forEach((p, i) => { const px = x(p.t), py = y(s.get(p)); d += i === 0 ? `M${px},${py}` : `H${px}V${py}`; });
		svg.append(mk('path', { class: 'line', d, stroke: s.color.startsWith('var') ? '' : s.color, style: `stroke:${s.color}` }));
	}
	const cross = mk('line', { class: 'cross', y1: T, y2: H - B, x1: 0, x2: 0, visibility: 'hidden' });
	svg.append(cross);
	const wrap = h('div', { class: 'em-chartwrap' }, svg);
	const tip = h('div', { class: 'em-tip', hidden: true });
	wrap.append(tip);

	let cur = -1;
	const show = (i) => {
		cur = Math.max(0, Math.min(pts.length - 1, i));
		const p = pts[cur];
		cross.setAttribute('x1', x(p.t)); cross.setAttribute('x2', x(p.t)); cross.setAttribute('visibility', 'visible');
		tip.hidden = false;
		tip.replaceChildren(h('div', null, when(new Date(p.t).toISOString())), ...series.map((s) => h('div', null, h('span', { style: `display:inline-block;width:8px;height:8px;border-radius:2px;background:${s.color};margin-right:.4rem` }), `${s.label} `, h('b', null, pct(s.get(p))))));
		const r = svg.getBoundingClientRect();
		const px = (x(p.t) / W) * r.width;
		tip.style.left = `${Math.min(Math.max(px + 10, 0), r.width - 180)}px`;
		tip.style.top = '8px';
	};
	const hide = () => { cross.setAttribute('visibility', 'hidden'); tip.hidden = true; cur = -1; };
	svg.addEventListener('pointermove', (e) => {
		const r = svg.getBoundingClientRect();
		const t = t0 + (((e.clientX - r.left) / r.width) * W - L) / (W - L - R) * span;
		let best = 0;
		pts.forEach((p, i) => { if (Math.abs(p.t - t) < Math.abs(pts[best].t - t)) best = i; });
		show(best);
	});
	svg.addEventListener('pointerleave', hide);
	svg.addEventListener('blur', hide);
	svg.addEventListener('keydown', (e) => {
		if (e.key === 'ArrowRight') { e.preventDefault(); show(cur < 0 ? 0 : cur + 1); announce(`${pts.length ? series.map((s) => `${s.label} ${pct(s.get(pts[Math.min(pts.length - 1, cur)]))}`).join(', ') : ''}`); }
		else if (e.key === 'ArrowLeft') { e.preventDefault(); show(cur < 0 ? pts.length - 1 : cur - 1); announce(series.map((s) => `${s.label} ${pct(s.get(pts[cur]))}`).join(', ')); }
		else if (e.key === 'Escape') hide();
	});

	panel.append(wrap,
		h('ul', { class: 'em-legend' }, series.map((s) => h('li', { style: `--c:${s.color}` }, h('i'), h('span', { title: s.label }, s.label)))),
		h('details', { class: 'em-table' }, h('summary', null, 'View as table'),
			h('div', { style: 'overflow-x:auto' }, h('table', null,
				h('thead', null, h('tr', null, h('th', { scope: 'col' }, 'Time'), series.map((s) => h('th', { scope: 'col' }, s.label)))),
				h('tbody', null, pts.slice(-40).map((p) => h('tr', null, h('td', null, when(new Date(p.t).toISOString())), series.map((s) => h('td', null, pct(s.get(p))))))))),
			pts.length > 40 ? h('p', { class: 'em-note' }, `Showing the latest 40 of ${pts.length} points.`) : null));
	return panel;
}

/* ───────────── side column ───────────── */

function clockPanel(m) {
	const body = m.status === 'open'
		? [h('div', { class: 'em-note', style: 'margin:0 0 .25rem' }, 'Picks lock in'), h('div', { class: 'em-clock', id: 'em-clock', role: 'timer', 'aria-live': 'off' }, countdown(m.seconds_to_lock)), h('p', { class: 'em-note' }, `Locks ${when(m.locks_at)}`)]
		: m.status === 'locked'
			? [h('div', { class: 'em-clock' }, 'Picks are locked'), h('p', { class: 'em-note' }, `Locked ${when(m.locks_at)}. Waiting on the result.`)]
			: [h('div', { class: 'em-clock' }, m.status === 'void' ? 'Market voided' : 'Market resolved'), m.void_reason ? h('p', { class: 'em-note' }, m.void_reason) : null];
	return h('section', { class: 'em-panel' }, body);
}

function rulePanel(m) {
	return h('section', { class: 'em-panel', 'aria-labelledby': 'em-h-rule' },
		h('h2', { id: 'em-h-rule' }, 'How it resolves'),
		h('p', { class: 'em-rule' }, m.resolution_text),
		h('p', { class: 'em-note' }, 'Picks are free-to-play points. Nothing is staked and no funds move. Implied odds are the share of crowd points on each entrant.'));
}

function sharePanel(m) {
	const text = `${m.title} Who wins? Make your call on three.ws.`;
	return h('section', { class: 'em-panel', 'aria-labelledby': 'em-h-share' },
		h('h2', { id: 'em-h-share' }, 'Share'),
		h('div', { class: 'em-share' },
			h('button', { class: 'em-btn', type: 'button', onclick: () => copy(shareUrl()) }, 'Copy link'),
			h('a', { class: 'em-btn', target: '_blank', rel: 'noopener noreferrer', href: `https://x.com/intent/post?text=${encodeURIComponent(text)}&url=${encodeURIComponent(shareUrl())}` }, 'Post on X'),
			S.viewer?.pick ? h('button', { class: 'em-btn', type: 'button', onclick: () => copy(shareUrl(S.viewer.pick.outcome_id)) }, 'Challenge a friend') : null),
		S.viewer?.pick ? null : m.status === 'open' ? h('p', { class: 'em-note' }, 'Make a pick to challenge a friend with it.') : null);
}

async function copy(text) {
	try { await navigator.clipboard.writeText(text); toast('Link copied'); }
	catch { window.prompt('Copy this link', text); }
}

function challengeShare(o) { copy(shareUrl(o.id)); }

function banners(m) {
	const out = [];
	if (m.status === 'resolved' && m.winner) {
		const mine = S.viewer?.pick;
		const won = mine && mine.outcome_id === m.winner.outcome_id;
		const winner = m.outcomes.find((o) => o.id === m.winner.outcome_id);
		out.push(h('div', { class: `em-banner ${mine ? (won ? 'win' : 'lost') : ''}`, role: 'status' },
			h('div', null,
				h('div', null, h('strong', null, `${m.winner.label} won.`)),
				h('div', { class: 'em-note', style: 'margin:0' }, `${winner?.picks ?? 0} ${winner?.picks === 1 ? 'person' : 'people'} called it.${mine ? (won ? ' You called it.' : ' Your pick missed this time.') : S.viewer ? ' You did not pick on this market.' : ''}`))));
	}
	if (m.status === 'void') out.push(h('div', { class: 'em-banner', role: 'status' }, h('div', null, h('strong', null, 'This market was voided.'), ' Picks were returned and no points were awarded.')));
	if (challenge && m.status === 'open') {
		const o = m.outcomes.find((x) => x.id === challenge);
		if (o) out.push(h('div', { class: 'em-banner em-challenge', role: 'status' },
			h('div', null, h('strong', null, `A friend picked ${o.label} to win.`), ' Do you agree?'),
			h('button', { class: 'em-btn primary', type: 'button', onclick: () => startPick(o) }, 'Make your pick')));
	}
	return out;
}

/* ───────────── pick flow ───────────── */

async function startPick(o) {
	if (S.viewer === null && !(await ensureSignedIn())) return;
	const m = S.market;
	const b = S.viewer?.budget || {};
	const min = b.min_pick ?? b.minPick ?? 1;
	const cap = b.remaining_for_this_market ?? b.max_pick_per_market ?? b.maxPickPerMarket ?? 100;
	if (cap < min) { toast('No points left this season. Withdraw a pick on another market to free some.'); return; }
	const start = Math.min(cap, Math.max(min, S.viewer?.pick?.points ?? b.default_pick ?? Math.min(10, cap)));
	const dlg = h('dialog', { class: 'em-dialog', 'aria-labelledby': 'em-d-h' });
	const val = h('output', { for: 'em-d-pts', style: 'font-weight:700;color:var(--ink-bright)' }, String(start));
	const range = h('input', { id: 'em-d-pts', type: 'range', min: String(min), max: String(cap), step: '1', value: String(start) });
	range.addEventListener('input', () => { val.textContent = range.value; });
	const err = h('p', { class: 'em-err', role: 'alert' });
	const go = h('button', { class: 'em-btn primary', type: 'submit' }, S.viewer?.pick ? 'Confirm change' : 'Confirm pick');
	const cancel = h('button', { class: 'em-btn', type: 'button', onclick: () => dlg.close() }, 'Cancel');
	const form = h('form', { method: 'dialog' },
		h('h2', { id: 'em-d-h' }, `Pick ${o.label} to win`),
		h('p', null, `Currently ${pct(o.percent)} of the crowd. Free-to-play points only. You can change or withdraw before ${when(m.locks_at)}.`),
		h('label', { for: 'em-d-pts' }, 'Points to put on this call: ', val),
		range, err, h('div', { class: 'row' }, cancel, go));
	form.addEventListener('submit', async (e) => {
		e.preventDefault();
		go.disabled = true; cancel.disabled = true; err.textContent = '';
		try {
			await submitPick(o, Number(range.value));
			dlg.close();
		} catch (ex) {
			go.disabled = false; cancel.disabled = false;
			if (ex.status === 401) { err.textContent = 'Your session expired. Sign in again to continue.'; setTimeout(() => signIn(), 900); }
			else err.textContent = ex.message;
		}
	});
	dlg.append(form);
	dlg.addEventListener('close', () => dlg.remove());
	document.body.append(dlg);
	dlg.showModal();
	range.focus();
}

async function submitPick(o, points) {
	const prev = S.market;
	const res = await api(`/${encodeURIComponent(slug)}/pick`, { method: 'POST', body: { outcome_id: o.id, points } });
	const m = res.market || res.data?.market;
	if (m) { S.market = m; S.viewer = m.viewer || { pick: { outcome_id: o.id, points }, budget: S.viewer?.budget }; }
	else { await refresh(); }
	if (!S.viewer?.pick) S.viewer = { ...(S.viewer || {}), pick: { outcome_id: o.id, points } };
	render();
	loadHistory();
	announce(`Pick placed on ${o.label}. Odds are now ${pct(S.market.outcomes.find((x) => x.id === o.id)?.percent)}.`);
	toast(`Picked ${o.label}`);
	return prev;
}

async function withdraw() {
	try {
		const res = await api(`/${encodeURIComponent(slug)}/pick`, { method: 'DELETE' });
		if (res?.market) { S.market = res.market; S.viewer = res.market.viewer ?? null; } else await refresh();
		render();
		loadHistory();
		announce('Pick withdrawn.');
		toast('Pick withdrawn');
	} catch (ex) {
		toast(ex.message);
	}
}

async function ensureSignedIn() {
	let me = null;
	try { const r = await fetch('/api/auth/me', { credentials: 'include' }); if (r.ok) me = await r.json(); } catch { /* treated as signed out */ }
	if (me && (me.user || me.data?.user || me.id)) { await refresh(); return true; }
	signIn();
	return false;
}

function signIn() {
	location.href = `/app?next=${encodeURIComponent(location.pathname + location.search)}`;
}

/* ───────────── data + render ───────────── */

function render() {
	const m = S.market;
	setMeta(m);
	const focus = document.activeElement?.closest?.('.em-ent')?.querySelector?.('.nm')?.textContent;
	root.replaceChildren(
		h('a', { class: 'em-crumb', href: '/event-markets' }, 'Event Markets'),
		h('header', { class: 'em-head' },
			h('div', { class: 'em-meta', style: 'justify-content:flex-start;gap:.6rem' },
				h('span', { class: `em-pill ${m.status}` }, statusLabel[m.status] || m.status),
				h('span', null, SOURCE_LABELS[m.source_kind] || m.source_kind),
				h('span', null, `${m.pick_count} ${m.pick_count === 1 ? 'pick' : 'picks'}`)),
			h('h1', null, m.title),
			m.description ? h('p', { class: 'em-rule' }, m.description) : null),
		...banners(m),
		h('div', { class: 'em-layout' },
			h('div', null, entrantsPanel(m), chartPanel(m)),
			h('div', null, clockPanel(m), rulePanel(m), sharePanel(m))));
	root.removeAttribute('aria-busy');
	if (focus) [...root.querySelectorAll('.em-ent')].find((e) => e.querySelector('.nm')?.textContent === focus)?.querySelector('button')?.focus();
	startClock();
}

function startClock() {
	clearInterval(S.tick);
	if (S.market.status !== 'open') return;
	const end = Date.parse(S.market.locks_at);
	S.tick = setInterval(() => {
		const left = Math.round((end - Date.now()) / 1000);
		const el = document.getElementById('em-clock');
		if (left <= 0) { clearInterval(S.tick); refresh(); return; }
		if (el) el.textContent = countdown(left);
	}, 1000);
}

async function refresh() {
	const data = await api(`/${encodeURIComponent(slug)}`);
	const m = data.market || data;
	S.market = m;
	S.viewer = m.viewer ?? (data.my_pick ? { pick: data.my_pick } : S.viewer ?? null);
	render();
}

async function loadHistory() {
	try { S.history = await api(`/${encodeURIComponent(slug)}/history`); }
	catch { S.history = 'error'; }
	if (S.market) render();
}

function fail(err) {
	root.replaceChildren(h('a', { class: 'em-crumb', href: '/event-markets' }, 'Event Markets'),
		h('div', { class: 'em-state', role: 'alert' },
			h('h2', null, err.status === 404 ? 'Market not found' : 'Could not load this market'),
			h('p', null, err.status === 404 ? 'It may have been removed, or the link is mistyped.' : err.message),
			h('div', { class: 'row' },
				err.status === 404 ? null : h('button', { class: 'em-btn primary', type: 'button', onclick: boot }, 'Retry'),
				h('a', { class: 'em-btn', href: '/event-markets' }, 'Browse markets'))));
	root.removeAttribute('aria-busy');
}

function skeleton() {
	root.setAttribute('aria-busy', 'true');
	root.replaceChildren(h('div', { class: 'em-skel', style: 'height:2.4rem;width:60%;margin-bottom:1rem', 'aria-hidden': 'true' }),
		h('div', { class: 'em-layout', 'aria-hidden': 'true' }, h('div', { class: 'em-skel', style: 'height:24rem' }), h('div', { class: 'em-skel', style: 'height:16rem' })));
}

async function boot() {
	if (!slug) return fail(new ApiError(404, 'not_found', 'No market specified.'));
	skeleton();
	try { await refresh(); } catch (err) { return fail(err instanceof ApiError ? err : new ApiError(0, 'error', 'Something went wrong.')); }
	loadHistory();
	if (S.market && !S.live) S.live = attachLiveOdds({ slug, getMarket: () => S.market, onReload: () => refresh().catch(() => {}), announce });
}

boot();
