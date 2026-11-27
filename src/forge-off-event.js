// /forge-off: the Forge-Off contest page.
//
// Data: GET /api/forge-off/event (event config, phase, per-board top 3 and
// crowned winners, the rules, every event's summary, and the server clock) and
// GET /api/forge-off/event?slug=<slug>&board=day-<n>|overall (one full board).
// Between events the same endpoint answers phase "none" and the page shows the
// standing weekly board (/api/forge-gallery window=week), past events with
// their winners, and a way to hear about the next one.
//
// Deadlines are UTC instants decided on the server. The page shows them in the
// visitor's own time zone and runs every countdown on the server's clock (the
// offset measured from the endpoint's `now`), so a wrong computer clock cannot
// show a deadline that is not the real one. When a countdown reaches zero the
// page reloads its data and the board turns read-only.
//
// Votes use POST /api/forge-vote with the same browser id (forge:cid) as
// /forge, so voting needs no login. A vote from an event board names the board,
// and the server refuses it once that board has closed.

const $ = (id) => document.getElementById(id);
const els = {
	hero: $('fo-hero'),
	days: $('fo-days'),
	boardWrap: $('fo-board-wrap'),
	boardTitle: $('fo-board-title'),
	boardStatus: $('fo-board-status'),
	winner: $('fo-winner'),
	board: $('fo-board'),
	overall: $('fo-overall'),
	events: $('fo-events'),
	rules: $('fo-rules'),
	share: $('fo-share'),
	toast: $('fo-toast'),
};

const TIME_ZONE = (() => {
	try {
		return Intl.DateTimeFormat().resolvedOptions().timeZone || '';
	} catch {
		return '';
	}
})();

let clientIdCache = null;
function clientId() {
	if (clientIdCache) return clientIdCache;
	try {
		let v = localStorage.getItem('forge:cid');
		if (!v) {
			v = crypto.randomUUID?.() || `c-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
			localStorage.setItem('forge:cid', v);
		}
		clientIdCache = v;
	} catch {
		clientIdCache = `c-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
	}
	return clientIdCache;
}

function slugFromPath() {
	const m = location.pathname.match(/^\/forge-off\/([a-z0-9][a-z0-9-]{1,63})\/?$/);
	return m ? m[1] : '';
}

function el(tag, cls, text) {
	const n = document.createElement(tag);
	if (cls) n.className = cls;
	if (text !== undefined) n.textContent = text;
	return n;
}

async function getJson(url) {
	const res = await fetch(url, { headers: { 'x-forge-client': clientId() } });
	const data = await res.json().catch(() => null);
	if (!res.ok || !data) {
		const err = new Error(data?.message || `Request failed (${res.status}).`);
		err.status = res.status;
		throw err;
	}
	return data;
}

let toastTimer = null;
function toast(msg) {
	els.toast.textContent = msg;
	els.toast.hidden = false;
	clearTimeout(toastTimer);
	toastTimer = setTimeout(() => {
		els.toast.hidden = true;
	}, 3600);
}

// ── Time: server clock, visitor's time zone ──────────────────────────────────

const state = {
	event: null,
	skew: 0,
	selected: null,
	boardToken: 0,
	timers: new Set(),
	reloading: false,
};

// The server's idea of now. `skew` is measured on every event fetch.
const serverNow = () => Date.now() + state.skew;

function fmtCountdown(ms) {
	if (ms <= 0) return '0s';
	const s = Math.floor(ms / 1000);
	const d = Math.floor(s / 86400);
	const h = Math.floor((s % 86400) / 3600);
	const m = Math.floor((s % 3600) / 60);
	const sec = s % 60;
	if (d > 0) return `${d}d ${h}h ${m}m`;
	if (h > 0) return `${h}h ${m}m ${sec}s`;
	return `${m}m ${sec}s`;
}

// An instant in the visitor's own zone, with the zone named.
function fmtLocal(iso) {
	return new Date(iso).toLocaleString(undefined, {
		weekday: 'short',
		month: 'short',
		day: 'numeric',
		hour: 'numeric',
		minute: '2-digit',
		timeZoneName: 'short',
	});
}

// The UTC calendar dates an event covers, e.g. "Nov 9 to Nov 13, 2026 (UTC)".
// Contest days are UTC dates, so the range is labelled in UTC, like the tabs.
function fmtUtcRange(startIso, endIso) {
	const opts = { month: 'short', day: 'numeric', timeZone: 'UTC' };
	const last = new Date(Date.parse(endIso) - 1);
	const first = new Date(startIso).toLocaleDateString(undefined, opts);
	return `${first} to ${last.toLocaleDateString(undefined, { ...opts, year: 'numeric' })} (UTC)`;
}

// A contest day is a UTC calendar date; label it as that date.
function fmtUtcDay(iso) {
	return new Date(iso).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
}

function clearTimers() {
	for (const t of state.timers) clearInterval(t);
	state.timers.clear();
}

// Repaint `node` every second until `deadline`; then reload the page data so
// the phase, the board and its voting state follow the server.
function countdown(node, deadlineIso, label) {
	const deadline = Date.parse(deadlineIso);
	const paint = () => {
		const left = deadline - serverNow();
		node.textContent = `${label} ${fmtCountdown(left)}`;
		return left;
	};
	if (paint() <= 0) return;
	const t = setInterval(() => {
		if (paint() <= 0) {
			clearInterval(t);
			state.timers.delete(t);
			reload();
		}
	}, 1000);
	state.timers.add(t);
}

async function reload() {
	if (state.reloading) return;
	state.reloading = true;
	try {
		await init({ keepSelection: true });
	} finally {
		state.reloading = false;
	}
}

// ── Vote pill ────────────────────────────────────────────────────────────────

function voteLabel(voted, count) {
	return `${voted ? 'Remove your vote' : 'Vote'}: ${count} ${count === 1 ? 'vote' : 'votes'}`;
}

function paintVote(btn, voted, count) {
	btn.classList.toggle('is-voted', voted);
	btn.setAttribute('aria-pressed', voted ? 'true' : 'false');
	btn.setAttribute('aria-label', voteLabel(voted, count));
	btn.querySelector('.fo-vote-count').textContent = String(Math.max(0, count));
}

// `board` is { event, board } for an event board, null for the weekly board.
function buildVote(c, board) {
	const btn = el('button', 'fo-vote');
	btn.type = 'button';
	btn.innerHTML =
		'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 15l-6-6-6 6"/></svg><span class="fo-vote-count"></span>';
	paintVote(btn, Boolean(c.voted), Number(c.vote_count) || 0);
	btn.addEventListener('click', async () => {
		if (btn.dataset.busy) return;
		const was = btn.classList.contains('is-voted');
		const prev = Number(btn.querySelector('.fo-vote-count').textContent) || 0;
		const optimistic = prev + (was ? -1 : 1);
		paintVote(btn, !was, optimistic);
		btn.dataset.busy = '1';
		try {
			const res = await fetch('/api/forge-vote', {
				method: 'POST',
				headers: { 'content-type': 'application/json', 'x-forge-client': clientId() },
				body: JSON.stringify({ creation_id: c.id, vote: !was, ...(board || {}) }),
			});
			const data = await res.json().catch(() => ({}));
			if (res.status === 409) {
				paintVote(btn, was, prev);
				toast(data?.error === 'voting_not_open' ? 'Voting on this board has not opened yet.' : 'Voting on this board has closed. Showing the final standings.');
				reload();
				return;
			}
			if (!res.ok || !data?.ok) throw new Error(data?.message || 'vote failed');
			// An event board shows its counted contest votes, so keep the
			// optimistic step; the weekly board shows the raw tally the server sent.
			paintVote(btn, Boolean(data.voted), board ? optimistic : Number(data.vote_count) || 0);
		} catch {
			paintVote(btn, was, prev);
			toast('Your vote did not go through. Check your connection and try again.');
		} finally {
			delete btn.dataset.busy;
		}
	});
	return btn;
}

// ── Cards and states ─────────────────────────────────────────────────────────

function thumb(url) {
	if (!url) return el('span', 'fo-thumb fo-thumb-ph', 'Preview unavailable');
	const img = el('img', 'fo-thumb');
	img.loading = 'lazy';
	img.alt = '';
	img.src = url;
	img.addEventListener('error', () => img.replaceWith(el('span', 'fo-thumb fo-thumb-ph', 'Preview unavailable')));
	return img;
}

// `opts.board`: votable event board; `opts.readOnly`: a closed board.
function buildCard(c, rank, opts = {}) {
	const card = el('article', 'fo-card');
	const link = el('a', 'fo-card-link');
	link.href = `/m/${encodeURIComponent(c.id)}`;
	link.setAttribute('aria-label', `Open model: ${c.prompt || 'untitled'}`);
	link.appendChild(thumb(c.preview_image_url));
	card.appendChild(link);
	const foot = el('div', 'fo-card-foot');
	const left = el('div', 'fo-card-meta');
	if (rank) left.appendChild(el('span', 'fo-rank', `#${rank}`));
	left.appendChild(el('span', 'fo-prompt', c.prompt || 'Untitled'));
	foot.appendChild(left);
	const actions = el('div', 'fo-card-actions');
	if (opts.readOnly) {
		const n = Number(c.vote_count) || 0;
		actions.appendChild(el('span', 'fo-votes-final', `${n} ${n === 1 ? 'vote' : 'votes'}`));
	} else {
		actions.appendChild(buildVote(c, opts.board || null));
	}
	const share = el('button', 'fo-share-btn', 'Share');
	share.type = 'button';
	share.addEventListener('click', () => shareUrl(`${location.origin}/m/${encodeURIComponent(c.id)}`, c.prompt || 'A Forge-Off entry'));
	actions.appendChild(share);
	foot.appendChild(actions);
	card.appendChild(foot);
	return card;
}

// A crowned winner (from forge_event_winners) as a compact banner.
function winnerBanner(w, label) {
	const box = el('div', 'fo-winner');
	if (w.removed) {
		box.classList.add('fo-winner-gone');
		box.appendChild(el('span', 'fo-winner-label', label));
		box.appendChild(el('strong', '', 'Winner withdrawn'));
		box.appendChild(el('p', '', `The winning model (${w.votes} ${w.votes === 1 ? 'vote' : 'votes'}) has since been deleted, made private or stopped by the content check, so it is no longer shown. The crown is not passed to anyone else.`));
		return box;
	}
	const link = el('a', 'fo-winner-link');
	link.href = `/m/${encodeURIComponent(w.creation_id)}`;
	link.setAttribute('aria-label', `Open the winning model: ${w.prompt || 'untitled'}`);
	link.appendChild(thumb(w.preview_image_url));
	const text = el('span', 'fo-winner-text');
	text.appendChild(el('span', 'fo-winner-label', label));
	text.appendChild(el('strong', '', w.prompt || 'Untitled'));
	text.appendChild(el('span', 'fo-muted-inline', `${w.votes} ${w.votes === 1 ? 'vote' : 'votes'}`));
	link.appendChild(text);
	box.appendChild(link);
	return box;
}

// What a closed board says when it has no crowned winner yet.
function noWinnerNote(hasVotes) {
	const box = el('div', 'fo-winner fo-winner-pending');
	if (hasVotes) {
		box.appendChild(el('strong', '', 'Crowning in progress'));
		box.appendChild(el('p', '', 'Voting is closed and the standings below are final. The winner is confirmed within the hour, once it has passed the content check.'));
	} else {
		box.appendChild(el('strong', '', 'No winner on this board'));
		box.appendChild(el('p', '', 'No votes were cast before it closed, so nobody was crowned.'));
	}
	return box;
}

async function shareUrl(url, title) {
	if (navigator.share) {
		try {
			await navigator.share({ title, url });
			return;
		} catch (err) {
			if (err?.name === 'AbortError') return;
		}
	}
	try {
		await navigator.clipboard.writeText(url);
		toast('Link copied.');
	} catch {
		toast(`Copy this link: ${url}`);
	}
}

function skeletonGrid(n = 6) {
	const grid = el('div', 'fo-grid');
	grid.setAttribute('aria-hidden', 'true');
	for (let i = 0; i < n; i++) {
		const s = el('div', 'fo-card fo-skel');
		s.appendChild(el('div', 'fo-thumb'));
		s.appendChild(el('div', 'fo-skel-line'));
		grid.appendChild(s);
	}
	return grid;
}

function errorState(container, title, message, retry) {
	container.replaceChildren();
	const box = el('div', 'fo-note fo-note-bad');
	box.setAttribute('role', 'alert');
	box.appendChild(el('strong', '', title));
	box.appendChild(el('p', '', `${message} Votes you already cast are safe.`));
	const btn = el('button', 'fo-btn', 'Try again');
	btn.type = 'button';
	btn.addEventListener('click', retry);
	box.appendChild(btn);
	container.appendChild(box);
}

function emptyState(container, title, body, ctaHref, ctaLabel) {
	container.replaceChildren();
	const box = el('div', 'fo-note');
	box.appendChild(el('strong', '', title));
	box.appendChild(el('p', '', body));
	if (ctaHref) {
		const cta = el('a', 'fo-btn fo-btn-primary', ctaLabel);
		cta.href = ctaHref;
		box.appendChild(cta);
	}
	container.appendChild(box);
}

// ── Notify me and calendar ───────────────────────────────────────────────────

function notifyForm(lead) {
	const form = el('form', 'fo-notify');
	form.noValidate = true;
	const label = el('label', 'fo-notify-label', lead);
	label.htmlFor = 'fo-notify-email';
	const row = el('div', 'fo-notify-row');
	const input = el('input', 'fo-input');
	input.type = 'email';
	input.id = 'fo-notify-email';
	input.name = 'email';
	input.required = true;
	input.autocomplete = 'email';
	input.placeholder = 'you@example.com';
	const btn = el('button', 'fo-btn fo-btn-primary', 'Notify me');
	btn.type = 'submit';
	row.append(input, btn);
	const msg = el('p', 'fo-notify-msg');
	msg.setAttribute('role', 'status');
	form.append(label, row, msg);
	form.addEventListener('submit', async (e) => {
		e.preventDefault();
		const email = input.value.trim();
		if (!input.checkValidity() || !email) {
			msg.textContent = 'Enter a valid email address.';
			msg.className = 'fo-notify-msg is-bad';
			input.focus();
			return;
		}
		btn.disabled = true;
		btn.textContent = 'Sending...';
		msg.textContent = '';
		msg.className = 'fo-notify-msg';
		try {
			const res = await fetch('/api/newsletter-subscribe', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ email, source: 'forge-off', locale: (navigator.language || '').slice(0, 10) || undefined }),
			});
			const data = await res.json().catch(() => ({}));
			if (res.status === 429) throw new Error('Too many sign-ups from this network. Try again in a few minutes.');
			if (!res.ok || !data?.success) throw new Error(data?.message || 'The sign-up did not go through. Try again.');
			form.replaceChildren(el('p', 'fo-notify-msg is-good', data.status === 'confirmed'
				? 'You are already on the list. New Forge-Off events are announced there first.'
				: 'Check your inbox and confirm your address. New Forge-Off events are announced there first.'));
		} catch (err) {
			msg.textContent = err.message;
			msg.className = 'fo-notify-msg is-bad';
			btn.disabled = false;
			btn.textContent = 'Notify me';
		}
	});
	return form;
}

function icsStamp(iso) {
	return new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

function icsEscape(s) {
	return String(s || '').replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/([,;])/g, '\\$1');
}

function calendarLink(ev) {
	const url = `${location.origin}/forge-off/${ev.slug}`;
	const ics = [
		'BEGIN:VCALENDAR',
		'VERSION:2.0',
		'PRODID:-//three.ws//Forge-Off//EN',
		'BEGIN:VEVENT',
		`UID:${ev.slug}@three.ws`,
		`DTSTAMP:${icsStamp(new Date().toISOString())}`,
		`DTSTART:${icsStamp(ev.starts_at)}`,
		`DTEND:${icsStamp(ev.ends_at)}`,
		`SUMMARY:${icsEscape(ev.title)}`,
		`DESCRIPTION:${icsEscape(`${ev.summary}\n${url}`)}`,
		`URL:${url}`,
		'END:VEVENT',
		'END:VCALENDAR',
	].join('\r\n');
	const a = el('a', 'fo-btn', 'Add to calendar');
	a.href = URL.createObjectURL(new Blob([ics], { type: 'text/calendar' }));
	a.download = `${ev.slug}.ics`;
	return a;
}

// ── Rules and past events ────────────────────────────────────────────────────

function renderRules(rules, heading) {
	els.rules.replaceChildren();
	if (!rules?.items?.length) {
		els.rules.hidden = true;
		return;
	}
	els.rules.hidden = false;
	els.rules.appendChild(el('h2', 'fo-h2', heading));
	const ol = el('ol', 'fo-rules-list');
	for (const r of rules.items) ol.appendChild(el('li', '', r));
	els.rules.appendChild(ol);
	els.rules.appendChild(el('p', 'fo-muted', `Every deadline is set in UTC on the server. This page shows it in your time zone${TIME_ZONE ? ` (${TIME_ZONE})` : ''} and counts down on the server's clock.`));
}

function renderEvents(events, currentSlug) {
	els.events.replaceChildren();
	const past = (events || []).filter((e) => e.phase === 'ended' && e.slug !== currentSlug);
	if (!past.length) {
		els.events.hidden = true;
		return;
	}
	els.events.hidden = false;
	els.events.appendChild(el('h2', 'fo-h2', currentSlug ? 'Other Forge-Off events' : 'Past events'));
	const list = el('div', 'fo-event-list');
	for (const e of past) {
		const item = el('article', 'fo-event');
		const head = el('div', 'fo-event-head');
		head.appendChild(el('strong', 'fo-event-title', e.title));
		head.appendChild(el('span', 'fo-muted-inline', `${fmtUtcRange(e.starts_at, e.ends_at)}, ${e.days} ${e.days === 1 ? 'day' : 'days'}`));
		item.appendChild(head);
		if (e.winner) item.appendChild(winnerBanner(e.winner, 'Overall winner'));
		else item.appendChild(el('p', 'fo-muted', 'No overall winner was crowned.'));
		const a = el('a', 'fo-btn', 'See the final standings');
		a.href = `/forge-off/${e.slug}`;
		item.appendChild(a);
		list.appendChild(item);
	}
	els.events.appendChild(list);
}

function renderShare(path, title) {
	els.share.replaceChildren();
	const btn = el('button', 'fo-btn', 'Share this page');
	btn.type = 'button';
	btn.addEventListener('click', () => shareUrl(`${location.origin}${path}`, title));
	els.share.appendChild(btn);
}

// ── Event view (upcoming, live, ended) ───────────────────────────────────────

function boardMeta(key) {
	const ev = state.event;
	if (key === 'overall') {
		return { key, title: 'Overall standings', starts_at: ev.starts_at, ends_at: ev.ends_at, started: ev.phase !== 'upcoming', closed: ev.phase === 'ended', winner: ev.overall?.winner || null, href: '/forge', surface: 'the Forge' };
	}
	const d = ev.days.find((x) => `day-${x.index}` === key);
	return d ? { key, title: `Day ${d.index}: ${d.theme}`, starts_at: d.starts_at, ends_at: d.ends_at, started: d.started, closed: d.closed, winner: d.winner, href: d.surface_href, surface: d.surface } : null;
}

async function loadEventBoard(meta) {
	const ev = state.event;
	const token = ++state.boardToken;
	els.board.replaceChildren(skeletonGrid());
	els.board.setAttribute('aria-busy', 'true');
	try {
		const data = await getJson(`/api/forge-off/event?slug=${encodeURIComponent(ev.slug)}&board=${meta.key}`);
		if (token !== state.boardToken) return;
		const list = data.entries || [];
		const closed = Boolean(data.closed);
		if (closed && !data.winner) els.winner.replaceChildren(noWinnerNote(list.some((c) => c.vote_count > 0)));
		if (!list.length) {
			if (closed) emptyState(els.board, 'No entries on this board.', 'Nothing was published during this window.', null);
			else emptyState(els.board, 'No entries yet.', `Be first: describe a thing in one sentence on ${meta.surface} and publish it. It is entered here automatically.`, meta.href, `Make one on ${meta.surface}`);
			return;
		}
		const grid = el('div', 'fo-grid');
		const board = { event: ev.slug, board: meta.key };
		list.forEach((c, i) => grid.appendChild(buildCard(c, i + 1, closed ? { readOnly: true } : { board })));
		els.board.replaceChildren(grid);
	} catch (err) {
		if (token !== state.boardToken) return;
		errorState(els.board, 'Could not load this board.', err.message, () => loadEventBoard(meta));
	} finally {
		if (token === state.boardToken) els.board.setAttribute('aria-busy', 'false');
	}
}

function selectBoard(key, { focus = false } = {}) {
	const meta = boardMeta(key);
	if (!meta) return;
	state.selected = key;
	for (const b of els.days.querySelectorAll('[role="tab"]')) {
		const on = b.dataset.board === key;
		b.setAttribute('aria-selected', on ? 'true' : 'false');
		b.tabIndex = on ? 0 : -1;
		if (on && focus) b.focus();
	}
	els.boardTitle.textContent = meta.title;
	els.boardStatus.replaceChildren();
	els.winner.replaceChildren();
	if (!meta.started) {
		state.boardToken++;
		els.boardStatus.textContent = `Opens ${fmtLocal(meta.starts_at)}.`;
		emptyState(els.board, 'This board has not opened yet.', key === 'overall'
			? 'Every model made during the event competes for the overall title.'
			: `Theme: ${meta.title.replace(/^Day \d+: /, '')}. Make it on ${meta.surface} when the day opens.`, null);
		return;
	}
	if (meta.closed) {
		els.boardStatus.textContent = `Voting closed ${fmtLocal(meta.ends_at)}. Final standings.`;
		if (meta.winner) els.winner.appendChild(winnerBanner(meta.winner, key === 'overall' ? 'Overall winner' : 'Day winner'));
	} else {
		const span = el('span', 'fo-countdown');
		span.setAttribute('role', 'timer');
		els.boardStatus.append(`Voting open until ${fmtLocal(meta.ends_at)}. `, span);
		countdown(span, meta.ends_at, 'Closes in');
	}
	loadEventBoard(meta);
}

function renderTabs() {
	const ev = state.event;
	els.days.replaceChildren();
	els.days.hidden = false;
	els.days.setAttribute('role', 'tablist');
	els.days.setAttribute('aria-label', 'Contest boards');
	const keys = [...ev.days.map((d) => `day-${d.index}`), 'overall'];
	for (const key of keys) {
		const d = ev.days.find((x) => `day-${x.index}` === key);
		const b = el('button', 'fo-tab');
		b.type = 'button';
		b.setAttribute('role', 'tab');
		b.setAttribute('aria-controls', 'fo-board-wrap');
		b.dataset.board = key;
		if (d) {
			b.appendChild(el('span', 'fo-tab-n', `Day ${d.index}`));
			b.appendChild(el('span', 'fo-tab-d', fmtUtcDay(d.starts_at)));
			if (d.index === ev.live_day) b.appendChild(el('span', 'fo-tab-s fo-tab-live', 'Live'));
			else if (d.closed) b.appendChild(el('span', 'fo-tab-s', d.winner && !d.winner.removed ? 'Crowned' : 'Closed'));
		} else {
			b.appendChild(el('span', 'fo-tab-n', 'Overall'));
			b.appendChild(el('span', 'fo-tab-d', 'All days'));
			b.appendChild(el('span', `fo-tab-s${ev.phase === 'live' ? ' fo-tab-live' : ''}`, ev.phase === 'ended' ? (ev.overall?.winner && !ev.overall.winner.removed ? 'Crowned' : 'Closed') : ev.phase === 'live' ? 'Open' : 'Soon'));
		}
		b.addEventListener('click', () => selectBoard(key));
		b.addEventListener('keydown', (e) => {
			const i = keys.indexOf(key);
			const dir = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
			const next = e.key === 'Home' ? keys[0] : e.key === 'End' ? keys[keys.length - 1] : dir ? keys[(i + dir + keys.length) % keys.length] : null;
			if (!next) return;
			e.preventDefault();
			selectBoard(next, { focus: true });
		});
		els.days.appendChild(b);
	}
}

function renderEventHero() {
	const ev = state.event;
	const live = ev.days.find((d) => d.index === ev.live_day);
	els.hero.replaceChildren();
	els.hero.appendChild(el('p', 'fo-eyebrow', ev.phase === 'live' ? 'Live now' : ev.phase === 'upcoming' ? 'Coming up' : 'Event closed'));
	els.hero.appendChild(el('h1', 'fo-title', ev.title));
	els.hero.appendChild(el('p', 'fo-sub', ev.summary));
	const box = el('div', 'fo-theme');
	if (ev.phase === 'live' && live) {
		box.appendChild(el('span', 'fo-theme-label', `Day ${live.index} of ${ev.days.length}: today's theme`));
		box.appendChild(el('strong', 'fo-theme-text', live.theme));
		const row = el('div', 'fo-cta-row');
		const cta = el('a', 'fo-btn fo-btn-primary', `Make one now on ${live.surface}`);
		cta.href = live.surface_href;
		row.appendChild(cta);
		const count = el('span', 'fo-countdown');
		count.setAttribute('role', 'timer');
		row.appendChild(count);
		box.appendChild(row);
		box.appendChild(el('span', 'fo-muted-inline', `Today's board closes ${fmtLocal(live.ends_at)}.`));
		countdown(count, live.ends_at, 'Closes in');
	} else if (ev.phase === 'upcoming') {
		box.appendChild(el('span', 'fo-theme-label', 'Opens'));
		box.appendChild(el('strong', 'fo-theme-text', fmtLocal(ev.starts_at)));
		const row = el('div', 'fo-cta-row');
		row.appendChild(calendarLink(ev));
		const count = el('span', 'fo-countdown');
		count.setAttribute('role', 'timer');
		row.appendChild(count);
		box.appendChild(row);
		box.appendChild(el('span', 'fo-muted-inline', `Day 1 theme: ${ev.days[0].theme}`));
		countdown(count, ev.starts_at, 'Starts in');
		box.appendChild(notifyForm('Get an email when it opens:'));
	} else {
		box.appendChild(el('span', 'fo-theme-label', `Ran ${fmtUtcRange(ev.starts_at, ev.ends_at)}`));
		if (ev.overall?.winner) box.appendChild(winnerBanner(ev.overall.winner, 'Overall winner'));
		else if (ev.overall?.leader) box.appendChild(noWinnerNote(true));
		else box.appendChild(noWinnerNote(false));
		const row = el('div', 'fo-cta-row');
		const all = el('a', 'fo-btn', 'See all Forge-Off events');
		all.href = '/forge-off';
		row.appendChild(all);
		box.appendChild(row);
	}
	els.hero.appendChild(box);
	if (ev.prizes_note) els.hero.appendChild(el('p', 'fo-prizes', ev.prizes_note));
}

function renderOverallSummary() {
	const ev = state.event;
	els.overall.replaceChildren();
	if (ev.phase === 'upcoming') {
		els.overall.hidden = true;
		return;
	}
	els.overall.hidden = false;
	els.overall.appendChild(el('h2', 'fo-h2', 'Across the whole event'));
	const o = ev.overall;
	els.overall.appendChild(el('p', 'fo-stats', `${o.entries} ${o.entries === 1 ? 'entry' : 'entries'} and ${o.total_votes} counted ${o.total_votes === 1 ? 'vote' : 'votes'} so far.`));
	if (ev.phase === 'live') {
		if (o.leader) {
			els.overall.appendChild(el('p', 'fo-muted', 'Leading the overall title right now:'));
			const grid = el('div', 'fo-grid fo-grid-one');
			grid.appendChild(buildCard(o.leader, 1, { board: { event: ev.slug, board: 'overall' } }));
			els.overall.appendChild(grid);
		} else {
			els.overall.appendChild(el('p', 'fo-muted', 'No votes yet. The first vote on any board starts the overall standings.'));
		}
	}
	const btn = el('button', 'fo-btn', 'Open the overall board');
	btn.type = 'button';
	btn.addEventListener('click', () => {
		selectBoard('overall', { focus: true });
		els.boardWrap.scrollIntoView({ behavior: 'smooth', block: 'start' });
	});
	els.overall.appendChild(btn);
}

function renderEventView(ev, keepSelection) {
	state.event = ev;
	document.title = `${ev.title} | Forge-Off | three.ws`;
	els.boardWrap.hidden = false;
	els.boardWrap.setAttribute('role', 'tabpanel');
	renderEventHero();
	renderTabs();
	renderOverallSummary();
	renderRules(ev.rules, 'Rules');
	renderEvents(ev.events, ev.slug);
	renderShare(`/forge-off/${ev.slug}`, ev.title);
	const keep = keepSelection && state.selected && boardMeta(state.selected) ? state.selected : null;
	selectBoard(keep || (ev.live_day ? `day-${ev.live_day}` : ev.phase === 'ended' ? 'overall' : 'day-1'));
}

// ── Between events ───────────────────────────────────────────────────────────

async function loadWeeklyBoard() {
	const token = ++state.boardToken;
	els.board.replaceChildren(skeletonGrid());
	els.board.setAttribute('aria-busy', 'true');
	try {
		const data = await getJson('/api/forge-gallery?scope=community&sort=top&window=week&limit=24');
		if (token !== state.boardToken) return;
		if (data.enabled === false) throw new Error('The weekly board is offline right now.');
		const list = data.creations || [];
		if (!list.length) {
			emptyState(els.board, 'No entries this week yet.', 'Describe a thing in one sentence, publish it, and it lands here for votes.', '/forge', 'Make one on the Forge');
			return;
		}
		const grid = el('div', 'fo-grid');
		list.forEach((c, i) => grid.appendChild(buildCard(c, i + 1)));
		els.board.replaceChildren(grid);
	} catch (err) {
		if (token !== state.boardToken) return;
		errorState(els.board, 'Could not load the weekly board.', err.message, loadWeeklyBoard);
	} finally {
		if (token === state.boardToken) els.board.setAttribute('aria-busy', 'false');
	}
}

function renderNoneView(data) {
	state.event = null;
	state.selected = null;
	document.title = 'Forge-Off | three.ws';
	els.hero.replaceChildren();
	els.hero.appendChild(el('p', 'fo-eyebrow', 'Between events'));
	els.hero.appendChild(el('h1', 'fo-title', 'No Forge-Off is running right now'));
	els.hero.appendChild(el('p', 'fo-sub', 'The next themed event has not been scheduled yet. Leave your email to hear the day it is announced, and keep playing on the weekly board in the meantime.'));
	const box = el('div', 'fo-theme');
	box.appendChild(notifyForm('Tell me when the next Forge-Off opens:'));
	els.hero.appendChild(box);
	els.days.hidden = true;
	els.days.replaceChildren();
	els.overall.hidden = true;
	els.boardWrap.hidden = false;
	els.boardWrap.removeAttribute('role');
	els.boardTitle.textContent = 'Top this week';
	els.winner.replaceChildren();
	els.boardStatus.textContent = 'The most-voted public models made this week (Monday to Monday, UTC). The week\'s top model is crowned each Monday.';
	renderEvents(data.events, null);
	renderRules(data.rules, 'How a Forge-Off works');
	renderShare('/forge-off', 'Forge-Off on three.ws');
	loadWeeklyBoard();
}

function renderNotFound() {
	els.hero.replaceChildren();
	els.hero.appendChild(el('h1', 'fo-title', 'Event not found'));
	els.hero.appendChild(el('p', 'fo-sub', 'There is no Forge-Off event at this address. It may have been renamed.'));
	const a = el('a', 'fo-btn fo-btn-primary', 'See the current Forge-Off');
	a.href = '/forge-off';
	els.hero.appendChild(a);
	for (const n of [els.days, els.overall, els.events, els.rules, els.boardWrap]) n.hidden = true;
}

// ── Boot ─────────────────────────────────────────────────────────────────────

async function init({ keepSelection = false } = {}) {
	clearTimers();
	if (!keepSelection) els.board.replaceChildren(skeletonGrid());
	const slug = slugFromPath();
	let data;
	try {
		const t0 = Date.now();
		data = await getJson(`/api/forge-off/event${slug ? `?slug=${encodeURIComponent(slug)}` : ''}`);
		const t1 = Date.now();
		if (data.now) state.skew = Date.parse(data.now) - (t0 + t1) / 2;
	} catch (err) {
		if (err.status === 404 && slug) return renderNotFound();
		els.boardWrap.hidden = false;
		els.boardTitle.textContent = 'Forge-Off';
		errorState(els.board, 'Could not load the Forge-Off.', err.message, () => init());
		return;
	}
	if (data.enabled === false) {
		els.boardWrap.hidden = false;
		errorState(els.board, 'Voting is offline right now.', 'The contest boards are temporarily unavailable.', () => init());
		return;
	}
	if (data.phase === 'none') renderNoneView(data);
	else renderEventView(data, keepSelection);
}

init();
