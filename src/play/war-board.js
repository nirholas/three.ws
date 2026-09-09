// war-board.js: the war room panel the arena shows on any terminal card.
//
// /play/war is a destination, not a place you browse to: the war portal in a
// coin world hands it a signed pairing. That leaves every terminal state on this
// page (a hand-typed URL, a shared link, an expired ticket, a holding that came
// up short) staring at one sentence and a button back to the lobby, which tells
// a player nothing about where a war actually is.
//
// This panel answers that with real league state off /api/wars: the battles
// running right now, the communities queued for an opponent, and the top of the
// Elo ladder. Every row is a link into that coin's world, which is where the war
// portal stands, so "there is no battle here" always ends in a door.
//
// The data is the same fold the in-world portal board reads
// (multiplayer/src/war-standings.js through api/_lib/wars-store.js), so a rating
// shown here is never a second opinion.

import { createLogger } from '../shared/log.js';

const log = createLogger('war-board');

const ENDPOINT = '/api/wars';
const TOP_N = 5;
const LIVE_N = 4;
const QUEUE_N = 4;
// A war that kicks off while the player reads the card should appear. The live
// registry heartbeats every 2s, so this is far cheaper than the data it tracks.
const REFRESH_MS = 15_000;

/**
 * Render the war room into `host` and keep it fresh while the tab is visible.
 * @param {HTMLElement} host container the panel is appended to
 * @param {{network?: string, coin?: string}} opts the arena's network, and the
 *   coin this player came for (its ladder row is pinned when it has one)
 * @returns {{dispose: () => void}}
 */
export function mountWarBoard(host, { network = 'mainnet', coin = '' } = {}) {
	const root = el('section', 'war-board');
	root.setAttribute('aria-live', 'polite');
	host.appendChild(root);

	let timer = 0;
	let disposed = false;
	let inFlight = null;

	const load = async () => {
		if (disposed) return;
		if (inFlight) return;
		const q = new URLSearchParams({ network, limit: '6' });
		if (coin) q.set('coin', coin);
		inFlight = fetch(`${ENDPOINT}?${q}`, { headers: { accept: 'application/json' } });
		try {
			const res = await inFlight;
			const body = await res.json().catch(() => null);
			if (disposed) return;
			if (!res.ok || !body?.data) throw new Error(body?.error_description || `HTTP ${res.status}`);
			paint(root, body.data, coin);
		} catch (err) {
			if (disposed) return;
			log.warn('war board read failed', err);
			paintError(root, load);
		} finally {
			inFlight = null;
		}
	};

	const tick = () => {
		if (disposed) return;
		if (!document.hidden) load();
		timer = setTimeout(tick, REFRESH_MS);
	};

	paintLoading(root);
	load();
	timer = setTimeout(tick, REFRESH_MS);

	const onVisible = () => { if (!document.hidden) load(); };
	document.addEventListener('visibilitychange', onVisible);

	return {
		dispose() {
			disposed = true;
			clearTimeout(timer);
			document.removeEventListener('visibilitychange', onVisible);
			root.remove();
		},
	};
}

// ── painting ─────────────────────────────────────────────────────────────────

function paintLoading(root) {
	root.textContent = '';
	root.appendChild(heading('Reading the league'));
	const skel = el('div', 'war-board-skeleton');
	skel.setAttribute('aria-hidden', 'true');
	for (let i = 0; i < 3; i++) skel.appendChild(el('span', 'war-board-skeleton-row'));
	root.appendChild(skel);
}

function paintError(root, retry) {
	root.textContent = '';
	root.appendChild(heading('The league board is unreachable'));
	root.appendChild(note('The battle ledger did not answer. Your record and rating are unaffected; this panel is only a view of them.'));
	const btn = el('button', 'war-board-retry');
	btn.type = 'button';
	btn.textContent = 'Try the board again';
	btn.addEventListener('click', () => { paintLoading(root); retry(); });
	root.appendChild(btn);
	root.appendChild(links());
}

function paint(root, data, coin) {
	const live = (data.live || []).slice(0, LIVE_N);
	const waiting = (data.queue?.waiting || []).slice(0, QUEUE_N);
	const table = ladder(data.standings || [], data.standing, coin);

	root.textContent = '';

	if (live.length) {
		root.appendChild(heading(live.length === 1 ? 'One war is running now' : `${live.length} wars are running now`));
		const list = el('ul', 'war-board-list');
		for (const m of live) list.appendChild(liveRow(m));
		root.appendChild(list);
	}

	if (waiting.length) {
		root.appendChild(heading(waiting.length === 1 ? 'One community is waiting for an opponent' : `${waiting.length} communities are waiting for an opponent`));
		const list = el('ul', 'war-board-list');
		for (const c of waiting) list.appendChild(queueRow(c));
		root.appendChild(list);
	} else if (data.queue && data.queue.available === false) {
		root.appendChild(note('Matchmaking is offline right now, so no community can queue. Battles already running are unaffected.'));
	}

	if (table.length) {
		root.appendChild(heading('Top of the ladder'));
		const list = el('ul', 'war-board-list');
		for (const row of table) list.appendChild(ladderRow(row, coin));
		root.appendChild(list);
	} else if (data.ledgerAvailable === false) {
		root.appendChild(note('The battle ledger is unreachable, so the ladder cannot be shown. Wars still run and still report.'));
	}

	if (!live.length && !waiting.length && !table.length) {
		root.appendChild(heading('The ladder is empty'));
		root.appendChild(note('No community has fought a war yet. Walk into a coin world, find the war portal in the plaza, press E, and yours takes the first rung.'));
	}

	root.appendChild(links());
}

// ── rows ─────────────────────────────────────────────────────────────────────

function liveRow(m) {
	const li = el('li', 'war-board-row');
	const a = link(coinWorldUrl(m.a, m.matchKey), 'war-board-link');
	a.appendChild(avatar(m.a));
	const main = el('span', 'war-board-main');
	main.appendChild(text('span', 'war-board-title', `${label(m.a)} ${m.a?.score ?? 0} - ${m.b?.score ?? 0} ${label(m.b)}`));
	main.appendChild(text('span', 'war-board-sub', liveSub(m)));
	a.appendChild(main);
	a.appendChild(text('span', 'war-board-tag war-board-tag-live', 'live'));
	li.appendChild(a);
	return li;
}

function liveSub(m) {
	const fighters = (m.a?.fighters || 0) + (m.b?.fighters || 0);
	const bodies = `${fighters} ${fighters === 1 ? 'fighter' : 'fighters'} on the field`;
	if (m.phase === 'countdown') return `Starting: ${bodies}`;
	if (m.phase === 'sudden_death') return `Sudden death: ${bodies}`;
	if (m.phase === 'lobby') return `Waiting to start: ${bodies}`;
	const left = Number(m.endsAt) - Date.now();
	return left > 0 ? `${clock(left)} left, first to ${m.scoreCap || '?'}: ${bodies}` : bodies;
}

function queueRow(c) {
	const li = el('li', 'war-board-row');
	const a = link(coinWorldUrl(c, ''), 'war-board-link');
	a.appendChild(avatar(c));
	const main = el('span', 'war-board-main');
	main.appendChild(text('span', 'war-board-title', label(c)));
	main.appendChild(text('span', 'war-board-sub', `Queued ${ago(c.since)}: queue your coin and this is who you fight.`));
	a.appendChild(main);
	a.appendChild(text('span', 'war-board-tag', 'in queue'));
	li.appendChild(a);
	return li;
}

function ladderRow(row, coin) {
	const li = el('li', 'war-board-row');
	const a = link(coinWorldUrl(row, ''), 'war-board-link');
	if (row.mint === coin) a.classList.add('is-yours');
	a.appendChild(text('span', 'war-board-rank', `#${row.rank}`));
	a.appendChild(avatar(row));
	const main = el('span', 'war-board-main');
	main.appendChild(text('span', 'war-board-title', label(row)));
	main.appendChild(text('span', 'war-board-sub', record(row)));
	a.appendChild(main);
	a.appendChild(text('span', 'war-board-rating', String(row.rating ?? '')));
	li.appendChild(a);
	return li;
}

function record(row) {
	const parts = [`${row.wins || 0}W ${row.losses || 0}L`];
	if (row.draws) parts.push(`${row.draws}D`);
	if (row.streak > 1) parts.push(`${row.streak} in a row`);
	if (row.streak < -1) parts.push(`${-row.streak} straight losses`);
	return parts.join(' · ');
}

// The top of the table, with this player's community pinned on when it ranks
// below the cut: a board that never shows you your own row is a board you stop
// reading.
function ladder(standings, mine, coin) {
	const ranked = standings.map((row, i) => ({ ...row, rank: i + 1 }));
	const top = ranked.slice(0, TOP_N);
	if (!coin || top.some((r) => r.mint === coin)) return top;
	const own = ranked.find((r) => r.mint === coin);
	if (own) return [...top, own];
	if (mine) return [...top, { ...mine, rank: ranked.length + 1 }];
	return top;
}

// ── helpers ──────────────────────────────────────────────────────────────────

function links() {
	const nav = el('p', 'war-board-links');
	const docs = link('/docs/coin-wars', 'war-board-textlink');
	docs.textContent = 'How Coin Wars works';
	const play = link('/play', 'war-board-textlink');
	play.textContent = 'Browse coin worlds';
	nav.appendChild(docs);
	nav.appendChild(play);
	return nav;
}

// Always a same-origin /play link built from the coin's own identity, so the
// world loads already dressed as that community and its portal board is one walk
// away. `war` echoes a specific battle onto that board.
function coinWorldUrl(c, matchKey) {
	const q = new URLSearchParams({ coin: c?.mint || '' });
	if (c?.name) q.set('name', String(c.name).slice(0, 48));
	if (c?.symbol) q.set('symbol', String(c.symbol).slice(0, 16));
	if (c?.image) q.set('image', String(c.image).slice(0, 400));
	if (matchKey) q.set('war', String(matchKey).slice(0, 160));
	return `/play?${q}`;
}

// Coin metadata is untrusted on-chain text: every value here lands through
// textContent or a URLSearchParams-encoded query, never markup.
function label(c) {
	if (c?.symbol) return `$${String(c.symbol).slice(0, 16)}`;
	if (c?.name) return String(c.name).slice(0, 24);
	const mint = String(c?.mint || '');
	return mint ? `${mint.slice(0, 4)}…${mint.slice(-4)}` : 'Community';
}

function avatar(c) {
	const wrap = el('span', 'war-board-avatar');
	const url = String(c?.image || '');
	if (/^https?:\/\//i.test(url)) {
		const img = document.createElement('img');
		img.src = url;
		img.alt = '';
		img.loading = 'lazy';
		img.decoding = 'async';
		img.referrerPolicy = 'no-referrer';
		// A dead metadata URL must leave the row intact, not a broken-image glyph.
		img.addEventListener('error', () => { img.remove(); wrap.textContent = initial(c); }, { once: true });
		wrap.appendChild(img);
	} else {
		wrap.textContent = initial(c);
	}
	wrap.setAttribute('aria-hidden', 'true');
	return wrap;
}

function initial(c) {
	const s = String(c?.symbol || c?.name || c?.mint || '?');
	return s.slice(0, 1).toUpperCase();
}

function ago(since) {
	const ms = Date.now() - (Number(since) || 0);
	if (!Number.isFinite(ms) || ms < 0) return 'just now';
	const s = Math.round(ms / 1000);
	if (s < 60) return `${s}s ago`;
	const m = Math.round(s / 60);
	if (m < 60) return `${m}m ago`;
	return `${Math.round(m / 60)}h ago`;
}

function clock(ms) {
	const s = Math.max(0, Math.round((Number(ms) || 0) / 1000));
	return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function el(tag, className) {
	const node = document.createElement(tag);
	if (className) node.className = className;
	return node;
}

function text(tag, className, value) {
	const node = el(tag, className);
	node.textContent = value;
	return node;
}

function heading(value) {
	return text('h3', 'war-board-heading', value);
}

function note(value) {
	return text('p', 'war-board-note', value);
}

function link(href, className) {
	const a = el('a', className);
	a.href = href;
	return a;
}
