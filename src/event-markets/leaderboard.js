// /event-markets/leaderboard: season and all-time rankings, the viewer's own standing,
// season rewards and the scoring rules. Every number quoted in "How scoring works"
// comes from `rules` in the API response (data/event-market-scoring.json).

import { h, api, ApiError, SOURCE_LABELS, initials } from './common.js';

const root = document.getElementById('em-root');
const live = document.getElementById('em-live');

const state = { scope: 'season', season: '', source: 'all', seasons: [], data: null, me: null, signedIn: null, rewards: null, loading: true, error: null, gen: 0 };
try {
	const p = new URLSearchParams(location.search);
	if (p.get('scope') === 'all') state.scope = 'all';
	if (/^\d{4}-Q[1-4]$/.test(p.get('season') || '')) state.season = p.get('season');
	if (p.get('source') in SOURCE_LABELS) state.source = p.get('source');
} catch { /* defaults */ }

const els = {};
const announce = (m) => { live.textContent = m; };
const num = (n) => Number(n || 0).toLocaleString('en-US');
const prob = (p) => (p == null ? 'n/a' : `${Math.round(p * 100)}%`);
const rate = (r) => (r == null ? 'n/a' : `${Math.round(r * 100)}%`);

function syncUrl() {
	const p = new URLSearchParams();
	if (state.scope === 'all') p.set('scope', 'all');
	else if (state.season && state.season !== state.data?.currentSeasonId) p.set('season', state.season);
	if (state.source !== 'all') p.set('source', state.source);
	history.replaceState(null, '', `${location.pathname}${p.size ? `?${p}` : ''}`);
}

function who(r) {
	const av = h('span', { class: 'em-av', 'aria-hidden': 'true' }, r.avatar ? h('img', { src: r.avatar, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' }) : initials(r.name));
	const name = r.profile ? h('a', { href: r.profile }, r.name) : h('span', { class: 'nm' }, r.name);
	return h('div', { class: 'lb-who' }, av, name);
}

function row(r, extra = '') {
	return h('tr', { 'data-mine': r.is_me ? 'true' : null, class: extra },
		h('td', null, h('span', { class: 'lb-rank', 'data-top': r.rank <= 3 ? 'true' : null }, r.rank == null ? '-' : `#${r.rank}`)),
		h('td', null, who(r), r.is_me ? h('span', { class: 'em-sr' }, ' (you)') : null),
		h('td', { class: 'lb-score' }, num(r.score)),
		h('td', null, num(r.calls)),
		h('td', null, rate(r.hit_rate)),
		h('td', null, prob(r.avg_odds)),
		h('td', null, r.best_call > 0 ? `+${num(r.best_call)}` : '-'),
		h('td', { class: r.current_streak >= 3 ? 'lb-streak' : '' }, `${r.current_streak} / ${r.longest_streak}`));
}

function signIn() {
	location.href = `/app?next=${encodeURIComponent(location.pathname + location.search)}`;
}

function skeleton() {
	return h('div', { 'aria-busy': 'true', 'aria-label': 'Loading leaderboard' }, ...Array.from({ length: 8 }, () => h('div', { class: 'em-skel lb-skel' })));
}

function emptyState(d) {
	const min = d?.min_calls_to_rank || 3;
	return h('div', { class: 'em-state' },
		h('h2', null, state.scope === 'season' ? 'Nobody is ranked yet this season' : 'No ranked calls yet'),
		h('p', null, `Make ${min} calls on open markets to take a place on the board. Calls are free and score by how unlikely they were.`),
		h('div', { class: 'row' }, h('a', { class: 'em-btn primary', href: '/event-markets' }, 'Browse open markets')));
}

function errorState(err) {
	return h('div', { class: 'em-state' },
		h('h2', null, 'Could not load the leaderboard'),
		h('p', null, err.message || 'Something went wrong.'),
		h('div', { class: 'row' }, h('button', { class: 'em-btn primary', type: 'button', onclick: load }, 'Retry')));
}

function board() {
	const d = state.data;
	if (state.loading && !d) return skeleton();
	if (state.error && !d) return errorState(state.error);
	if (!d.leaders.length && !d.me) return emptyState(d);
	const meInList = d.me && d.leaders.some((r) => r.is_me);
	const body = h('tbody', null, d.leaders.map((r) => row(r)));
	if (d.me && !meInList) {
		body.append(h('tr', { class: 'gap' }, h('td', { colspan: 8 }, '...')));
		body.append(row(d.me, 'pinned'));
	}
	const cap = state.scope === 'all' ? 'All-time ranking' : `${d.season.label} ranking`;
	return h('div', { class: 'lb-scroll' },
		h('table', { class: 'lb-table' },
			h('caption', null, `${cap}${state.source !== 'all' ? `, ${SOURCE_LABELS[state.source]}` : ''}. Ranked after ${d.min_calls_to_rank} calls.`),
			h('thead', null, h('tr', null, ...['Rank', 'Forecaster', 'Score', 'Calls', 'Hit rate', 'Avg odds', 'Best call', 'Streak'].map((t) => h('th', { scope: 'col', title: t === 'Streak' ? 'Current / longest' : t === 'Avg odds' ? 'Average chance the market gave your pick when you made it' : null }, t)))),
			body));
}

function myCard() {
	const m = state.me;
	if (state.signedIn === false) {
		return h('section', { class: 'em-panel lb-me' }, h('h2', null, 'Your standing'),
			h('p', { class: 'em-note' }, 'Sign in to see your rank, streak and badges.'),
			h('button', { class: 'em-btn primary', type: 'button', onclick: signIn }, 'Sign in'));
	}
	if (!m) return h('div', { class: 'em-skel lb-skel', style: 'height:7rem' });
	const s = m.season_standing, a = m.all_time;
	if (!a) {
		return h('section', { class: 'em-panel lb-me' }, h('h2', null, 'Your standing'),
			h('p', { class: 'em-note' }, 'You have no scored calls yet. Pick a winner on any open market and your stats start here.'),
			h('a', { class: 'em-btn primary', href: '/event-markets' }, 'Make a call'));
	}
	const stat = (v, l) => h('li', null, h('b', null, v), h('span', null, l));
	return h('section', { class: 'em-panel lb-me' },
		h('h2', null, 'Your standing', h('span', { class: 'rank' }, s?.rank ? `#${s.rank} this season` : 'Unranked this season')),
		h('ul', { class: 'lb-stats' },
			stat(num(a.score), 'All-time score'), stat(num(a.calls), 'Calls'), stat(rate(a.hit_rate), 'Hit rate'),
			stat(prob(a.avg_odds), 'Avg odds at pick'), stat(`${a.current_streak}`, 'Current streak'), stat(`${a.longest_streak}`, 'Longest streak')),
		h('p', { class: 'em-note' }, 'Badges you earn show on ', a.profile ? h('a', { href: a.profile }, 'your profile') : 'your profile', '.'));
}

function rewardsPanel() {
	const r = state.rewards;
	if (!r) return h('section', { class: 'em-panel' }, h('h2', null, 'Season rewards'), h('div', { class: 'em-skel lb-skel' }));
	const tiers = h('div', null, r.tiers.map((t) => h('div', { class: 'lb-tier' }, h('b', null, `#${t.ranks}`), h('div', null, h('b', null, `${num(t.three)} $THREE`), h('br'), h('span', null, t.perk)))));
	let list = null;
	if (r.published && r.rewards.length) {
		list = h('div', null,
			h('h3', { class: 'em-note' }, `${r.season.label} winners`),
			h('ol', { class: 'lb-rewards' }, r.rewards.map((w) => h('li', null, h('b', null, `#${w.rank}`), w.profile ? h('a', { href: w.profile }, w.name) : w.name, h('span', { class: 'amt' }, `${num(w.amount)} ${w.token}`)))),
			h('p', { class: 'em-note' }, r.rewards.some((w) => w.status === 'paid') ? 'Paid rewards are on-chain.' : 'This list is a proposal until the owner approves the payout.'));
	}
	return h('section', { class: 'em-panel' }, h('h2', null, 'Season rewards'),
		h('p', { class: 'em-note' }, 'Top forecasters each season earn $THREE on Solana plus platform perks.'), tiers, list);
}

const BADGE_COPY = [
	['✅', 'First correct call', 'Your first right pick.'],
	['⚡', 'Upset call', 'Right when the market gave the pick under {u}%.'],
	['🔥', '{s} in a row', '{s} correct calls without a miss.'],
	['🏆', 'Season top {t}', 'Finish a season in the top {t}.'],
];

function how() {
	const R = state.data?.rules;
	if (!R) return null;
	const { min_win_multiplier: lo, max_win_multiplier: hi } = R.scoring;
	const fill = (t) => t.replace(/\{u\}/g, Math.round(R.badges.upset_probability_below * 100)).replace(/\{s\}/g, R.badges.streak_target).replace(/\{t\}/g, R.badges.season_top_n);
	const ex = [0.8, 0.5, 0.2, 0.05].map((p) => {
		const m = Math.min(hi, Math.max(lo, 1 / p - 1));
		return h('tr', null, h('td', null, `${Math.round(p * 100)}%`), h('td', null, `x${+m.toFixed(2)}`), h('td', null, `+${Math.round(100 * m)}`), h('td', null, '-100'));
	});
	const f = R.fairness;
	return h('section', { class: 'em-panel lb-how' }, h('h2', null, 'How scoring works'),
		h('p', { class: 'em-note' }, 'You back one entrant per market. The earlier the call and the longer the odds, the more a right call is worth.'),
		h('div', { class: 'lb-formula' }, `win  = round(stake x clamp(1 / p - 1, ${lo}, ${hi}))\nloss = -stake\nscore = running total, never below 0`),
		h('p', { class: 'em-note' }, 'p is the market\'s chance for your pick at the moment you made it. Worked examples on a 100-point stake:'),
		h('table', null, h('thead', null, h('tr', null, ['Odds at pick', 'Multiplier', 'Right', 'Wrong'].map((t) => h('th', { scope: 'col' }, t)))), h('tbody', null, ex)),
		h('p', { class: 'em-note' }, `Seasons are calendar quarters (UTC). You rank after ${R.seasons.min_calls_to_rank} resolved calls. Void markets do not count.`),
		h('h3', null, 'Badges'),
		h('ul', { class: 'lb-badges' }, BADGE_COPY.map(([ic, t, d]) => h('li', null, h('span', { class: 'ic', 'aria-hidden': 'true' }, ic), h('div', null, h('b', null, fill(t)), h('span', null, fill(d)))))),
		h('h3', null, 'Fair play'),
		h('ul', null,
			h('li', null, 'One account, one pick per market. Changing a pick before lock replaces it.'),
			h('li', null, `Accounts must be at least ${f.min_account_age_hours} hours old to rank.`),
			f.require_linked_wallet_or_verified_email ? h('li', null, 'A linked wallet or a verified email is required to rank.') : null,
			f.exclude_service_accounts ? h('li', null, 'Service and agent-operated accounts are excluded from human rankings.') : null,
			h('li', null, 'Picks that do not pass these checks still play, they just do not rank or earn rewards.')));
}

function controls() {
	const seasonSel = h('select', { class: 'em-select', id: 'lb-season', 'aria-label': 'Season', disabled: state.scope === 'all' ? true : null,
		onchange: (e) => { state.season = e.target.value; load(); } },
		state.seasons.map((s) => h('option', { value: s.id, selected: s.id === state.season ? true : null }, s.label)));
	const srcSel = h('select', { class: 'em-select', id: 'lb-source', 'aria-label': 'Market source',
		onchange: (e) => { state.source = e.target.value; load(); } },
		h('option', { value: 'all' }, 'All sources'),
		Object.entries(SOURCE_LABELS).map(([k, v]) => h('option', { value: k, selected: k === state.source ? true : null }, v)));
	const tab = (id, label) => h('button', { class: 'em-tab', type: 'button', role: 'tab', 'aria-selected': state.scope === id ? 'true' : 'false',
		onclick: () => { state.scope = id; load(); } }, label);
	return h('div', { class: 'lb-bar' },
		h('div', { class: 'em-tabs', role: 'tablist', style: 'margin:0;border:0' }, tab('season', 'This season'), tab('all', 'All time')),
		h('div', { class: 'lb-filters' }, seasonSel, srcSel));
}

function render() {
	const d = state.data;
	const sub = state.scope === 'all' ? 'Every ranked call, all time.' : d ? `${d.season.label}${d.season.ended ? ' (final)' : `, ends ${new Date(d.season.end).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`}` : '';
	root.replaceChildren(
		h('section', { class: 'em-hero' },
			h('h1', null, 'Event Markets leaderboard'),
			h('p', null, 'The sharpest forecasters on three.ws. Right calls on long odds score the most; wrong calls cost the stake.'),
			h('p', { class: 'lb-season' }, sub, ' ', h('a', { href: '/event-markets' }, 'Browse markets'))),
		controls(),
		h('div', { class: 'lb-layout' },
			h('div', null, board()),
			h('aside', null, myCard(), rewardsPanel())),
		how());
}

async function load() {
	const gen = ++state.gen;
	state.loading = true; state.error = null;
	if (!state.data) render();
	try {
		const qs = new URLSearchParams({ scope: state.scope, source_kind: state.source, limit: '50' });
		if (state.scope === 'season' && state.season) qs.set('season', state.season);
		const d = await api(`/leaderboard?${qs}`);
		if (gen !== state.gen) return;
		d.currentSeasonId = state.data?.currentSeasonId || d.season?.id;
		state.data = d;
		if (d.season && !state.season) state.season = d.season.id;
		state.rewards = null;
		syncUrl();
		render();
		announce(`${d.leaders.length} forecasters shown.`);
		const rid = state.scope === 'season' ? state.season : state.seasons.find((s) => s.ended)?.id;
		api(`/seasons/${rid || state.season}/rewards`).then((r) => { if (gen === state.gen) { state.rewards = r; render(); } }).catch(() => {
			if (gen === state.gen) { state.rewards = { tiers: d.rules.rewards.tiers.map((t) => ({ ...t, ranks: t.from_rank === t.to_rank ? `${t.from_rank}` : `${t.from_rank}-${t.to_rank}` })), published: false, rewards: [] }; render(); }
		});
	} catch (err) {
		if (gen !== state.gen) return;
		state.error = err;
		state.loading = false;
		render();
		announce(err.message);
		return;
	}
	state.loading = false;
	render();
}

async function init() {
	render();
	const [seasons] = await Promise.all([
		api('/seasons').catch(() => null),
		api('/me').then((m) => { state.me = m; state.signedIn = true; }).catch((e) => { state.signedIn = e instanceof ApiError && e.status === 401 ? false : null; }),
	]);
	state.seasons = seasons?.seasons || [];
	await load();
}

init();
