// /forge-off landing page: a themed Forge-Off event with a board per UTC day.
//
// Data: GET /api/forge-off/event (config, phase, per-day top 3, overall) and
// GET /api/forge-gallery?scope=community&sort=top&event=<slug>&day=<n> (the
// selected day's board). With no live or upcoming event the page shows the
// standing weekly board (window=week). Votes use POST /api/forge-vote with the
// same browser id (forge:cid) as /forge, so voting needs no login and a
// visitor's votes light up here and on the Forge strip alike.

const $ = (id) => document.getElementById(id);
const els = {
	hero: $('fo-hero'),
	days: $('fo-days'),
	board: $('fo-board'),
	boardTitle: $('fo-board-title'),
	overall: $('fo-overall'),
	past: $('fo-past'),
	share: $('fo-share'),
	toast: $('fo-toast'),
};

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
		const err = new Error(data?.message || `Request failed (${res.status})`);
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
	}, 3200);
}

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

function fmtDate(iso) {
	return new Date(iso).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
}

// ── Vote pill (same endpoint and optimistic contract as the Forge strip) ──────

function voteLabel(voted, count) {
	return `${voted ? 'Remove your upvote' : 'Upvote'}: ${count} ${count === 1 ? 'vote' : 'votes'}`;
}

function paintVote(btn, voted, count) {
	btn.classList.toggle('is-voted', voted);
	btn.setAttribute('aria-pressed', voted ? 'true' : 'false');
	btn.setAttribute('aria-label', voteLabel(voted, count));
	btn.querySelector('.fo-vote-count').textContent = String(Math.max(0, count));
}

function buildVote(c) {
	const btn = el('button', 'fo-vote');
	btn.type = 'button';
	btn.innerHTML =
		'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 15l-6-6-6 6"/></svg><span class="fo-vote-count"></span>';
	paintVote(btn, Boolean(c.voted), Number(c.vote_count) || 0);
	btn.addEventListener('click', async () => {
		if (btn.dataset.busy) return;
		const was = btn.classList.contains('is-voted');
		const prev = Number(btn.querySelector('.fo-vote-count').textContent) || 0;
		paintVote(btn, !was, prev + (was ? -1 : 1));
		btn.dataset.busy = '1';
		try {
			const res = await fetch('/api/forge-vote', {
				method: 'POST',
				headers: { 'content-type': 'application/json', 'x-forge-client': clientId() },
				body: JSON.stringify({ creation_id: c.id, vote: !was }),
			});
			const data = await res.json().catch(() => ({}));
			if (!res.ok || !data?.ok) throw new Error(data?.message || 'vote failed');
			paintVote(btn, Boolean(data.voted), Number(data.vote_count) || 0);
		} catch {
			paintVote(btn, was, prev);
			toast('Your vote did not go through. Check your connection and try again.');
		} finally {
			delete btn.dataset.busy;
		}
	});
	return btn;
}

// ── Cards and states ──────────────────────────────────────────────────────────

function buildCard(c, rank) {
	const card = el('article', 'fo-card');
	const link = el('a', 'fo-card-link');
	link.href = `/m/${encodeURIComponent(c.id)}`;
	link.setAttribute('aria-label', `Open model: ${c.prompt || 'untitled'}`);
	if (c.preview_image_url) {
		const img = el('img', 'fo-thumb');
		img.loading = 'lazy';
		img.alt = '';
		img.src = c.preview_image_url;
		img.addEventListener('error', () => img.replaceWith(el('span', 'fo-thumb fo-thumb-ph', 'Preview unavailable')));
		link.appendChild(img);
	} else {
		link.appendChild(el('span', 'fo-thumb fo-thumb-ph', 'Preview unavailable'));
	}
	card.appendChild(link);
	const foot = el('div', 'fo-card-foot');
	const left = el('div', 'fo-card-meta');
	if (rank) left.appendChild(el('span', 'fo-rank', `#${rank}`));
	left.appendChild(el('span', 'fo-prompt', c.prompt || 'Untitled'));
	foot.appendChild(left);
	const actions = el('div', 'fo-card-actions');
	actions.appendChild(buildVote(c));
	const share = el('button', 'fo-share-btn', 'Share');
	share.type = 'button';
	share.addEventListener('click', () => shareUrl(`${location.origin}/m/${encodeURIComponent(c.id)}`, c.prompt || 'A Forge-Off entry'));
	actions.appendChild(share);
	foot.appendChild(actions);
	card.appendChild(foot);
	return card;
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

function errorState(container, message, retry) {
	container.replaceChildren();
	const box = el('div', 'fo-note fo-note-bad');
	box.setAttribute('role', 'alert');
	box.appendChild(el('strong', '', 'Could not load this board.'));
	box.appendChild(el('p', '', `${message} Your votes are safe. Try again in a moment.`));
	const btn = el('button', 'fo-btn', 'Retry');
	btn.type = 'button';
	btn.addEventListener('click', retry);
	box.appendChild(btn);
	container.appendChild(box);
	btn.focus({ preventScroll: true });
}

function emptyState(container, ctaHref, ctaLabel) {
	container.replaceChildren();
	const box = el('div', 'fo-note');
	box.appendChild(el('strong', '', 'No entries yet today.'));
	box.appendChild(el('p', '', 'Be first: it takes about a minute. Describe a thing in one sentence and publish it.'));
	const cta = el('a', 'fo-btn fo-btn-primary', ctaLabel);
	cta.href = ctaHref;
	box.appendChild(cta);
	container.appendChild(box);
	cta.focus({ preventScroll: true });
}

// ── Page state ────────────────────────────────────────────────────────────────

const state = { event: null, selectedDay: null, countdownTimer: null, boardToken: 0 };

async function loadBoard(url, ctaHref, ctaLabel, emptyIsEvent = true) {
	const token = ++state.boardToken;
	els.board.replaceChildren(skeletonGrid());
	els.board.setAttribute('aria-busy', 'true');
	try {
		const data = await getJson(url);
		if (token !== state.boardToken) return;
		if (data.enabled === false) throw new Error('Voting boards are offline right now.');
		const list = data.creations || [];
		if (!list.length) {
			emptyState(els.board, ctaHref, ctaLabel);
			if (!emptyIsEvent) els.board.querySelector('strong').textContent = 'No entries this week yet.';
			return;
		}
		const grid = el('div', 'fo-grid');
		list.forEach((c, i) => grid.appendChild(buildCard(c, i + 1)));
		els.board.replaceChildren(grid);
	} catch (err) {
		if (token !== state.boardToken) return;
		errorState(els.board, err.message, () => loadBoard(url, ctaHref, ctaLabel, emptyIsEvent));
	} finally {
		if (token === state.boardToken) els.board.setAttribute('aria-busy', 'false');
	}
}

function selectDay(index) {
	const ev = state.event;
	const day = ev.days.find((d) => d.index === index);
	if (!day) return;
	state.selectedDay = index;
	for (const b of els.days.querySelectorAll('button')) {
		const on = Number(b.dataset.day) === index;
		b.setAttribute('aria-selected', on ? 'true' : 'false');
		b.tabIndex = on ? 0 : -1;
	}
	els.boardTitle.textContent = `Day ${day.index}: ${day.theme}`;
	if (!day.started) {
		state.boardToken++;
		els.board.replaceChildren();
		const box = el('div', 'fo-note');
		box.appendChild(el('strong', '', `Opens ${fmtDate(day.starts_at)} (UTC).`));
		box.appendChild(el('p', '', `Theme: ${day.theme}. Make it on ${day.surface} when the day opens.`));
		els.board.appendChild(box);
		return;
	}
	loadBoard(
		`/api/forge-gallery?scope=community&sort=top&limit=24&event=${encodeURIComponent(ev.slug)}&day=${day.index}`,
		day.surface_href,
		`Make one now on ${day.surface}`,
	);
}

function renderDayTabs() {
	const ev = state.event;
	els.days.replaceChildren();
	els.days.setAttribute('role', 'tablist');
	els.days.setAttribute('aria-label', 'Event days');
	for (const d of ev.days) {
		const b = el('button', 'fo-tab');
		b.type = 'button';
		b.setAttribute('role', 'tab');
		b.dataset.day = String(d.index);
		b.appendChild(el('span', 'fo-tab-n', `Day ${d.index}`));
		b.appendChild(el('span', 'fo-tab-d', fmtDate(d.starts_at)));
		if (d.index === ev.live_day) b.appendChild(el('span', 'fo-live-dot', 'Live'));
		b.addEventListener('click', () => selectDay(d.index));
		b.addEventListener('keydown', (e) => {
			const dir = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
			if (!dir) return;
			const next = ev.days[(d.index - 1 + dir + ev.days.length) % ev.days.length];
			selectDay(next.index);
			els.days.querySelector(`[data-day="${next.index}"]`).focus();
			e.preventDefault();
		});
		els.days.appendChild(b);
	}
}

function renderHero() {
	const ev = state.event;
	const live = ev.days.find((d) => d.index === ev.live_day);
	els.hero.replaceChildren();
	els.hero.appendChild(el('p', 'fo-eyebrow', ev.phase === 'live' ? 'Live now' : ev.phase === 'upcoming' ? 'Starting soon' : 'Event closed'));
	els.hero.appendChild(el('h1', 'fo-title', ev.title));
	els.hero.appendChild(el('p', 'fo-sub', ev.summary));
	const theme = el('div', 'fo-theme');
	const count = el('span', 'fo-countdown');
	count.setAttribute('role', 'timer');
	if (live) {
		theme.appendChild(el('span', 'fo-theme-label', `Day ${live.index} theme`));
		theme.appendChild(el('strong', 'fo-theme-text', live.theme));
		const row = el('div', 'fo-cta-row');
		const cta = el('a', 'fo-btn fo-btn-primary', `Make one now on ${live.surface}`);
		cta.href = live.surface_href;
		cta.id = 'fo-make';
		row.appendChild(cta);
		const dl = new Date(live.ends_at).getTime();
		count.textContent = `Day closes in ${fmtCountdown(dl - Date.now())}`;
		row.appendChild(count);
		theme.appendChild(row);
		tick(() => {
			count.textContent = `Day closes in ${fmtCountdown(dl - Date.now())}`;
			return dl - Date.now() > 0;
		});
	} else if (ev.phase === 'upcoming') {
		const start = new Date(ev.starts_at).getTime();
		theme.appendChild(el('span', 'fo-theme-label', 'Opens'));
		theme.appendChild(el('strong', 'fo-theme-text', `${fmtDate(ev.starts_at)} (UTC)`));
		count.textContent = `Starts in ${fmtCountdown(start - Date.now())}`;
		theme.appendChild(count);
		tick(() => {
			count.textContent = `Starts in ${fmtCountdown(start - Date.now())}`;
			return start - Date.now() > 0;
		});
	} else {
		theme.appendChild(el('span', 'fo-theme-label', 'Final standings'));
		theme.appendChild(el('strong', 'fo-theme-text', 'Every board is closed. Browse the entries below.'));
	}
	els.hero.appendChild(theme);
	els.hero.appendChild(el('p', 'fo-prizes', ev.prizes_note));
}

function tick(fn) {
	clearInterval(state.countdownTimer);
	state.countdownTimer = setInterval(() => {
		if (!fn()) clearInterval(state.countdownTimer);
	}, 1000);
}

function renderOverall() {
	const ev = state.event;
	els.overall.replaceChildren();
	els.overall.appendChild(el('h2', 'fo-h2', 'Overall standings'));
	const stats = el('p', 'fo-stats', `${ev.overall.entries} ${ev.overall.entries === 1 ? 'entry' : 'entries'}, ${ev.overall.total_votes} ${ev.overall.total_votes === 1 ? 'vote' : 'votes'} across all days.`);
	els.overall.appendChild(stats);
	if (ev.overall.leader) {
		const grid = el('div', 'fo-grid fo-grid-one');
		grid.appendChild(buildCard(ev.overall.leader, 1));
		els.overall.appendChild(grid);
	} else {
		els.overall.appendChild(el('p', 'fo-muted', 'No votes yet. The first vote on any board starts the standings.'));
	}
}

function renderPast() {
	const ev = state.event;
	els.past.replaceChildren();
	const closed = ev.days.filter((d) => d.started && d.index !== ev.live_day && new Date(d.ends_at) <= new Date(ev.now));
	if (!closed.length) {
		els.past.hidden = true;
		return;
	}
	els.past.hidden = false;
	els.past.appendChild(el('h2', 'fo-h2', 'Past days'));
	for (const d of closed) {
		const det = el('details', 'fo-past-day');
		det.appendChild(el('summary', '', `Day ${d.index}: ${d.theme}`));
		if (!d.top.length) det.appendChild(el('p', 'fo-muted', 'No entries were published this day.'));
		else {
			const grid = el('div', 'fo-grid');
			d.top.forEach((c, i) => grid.appendChild(buildCard(c, i + 1)));
			det.appendChild(grid);
		}
		els.past.appendChild(det);
	}
}

function renderShare() {
	els.share.replaceChildren();
	const btn = el('button', 'fo-btn', 'Share this event');
	btn.type = 'button';
	btn.addEventListener('click', () => shareUrl(`${location.origin}/forge-off/${state.event.slug}`, state.event.title));
	els.share.appendChild(btn);
}

async function renderStanding() {
	document.title = 'Forge-Off | three.ws';
	els.hero.replaceChildren();
	els.hero.appendChild(el('p', 'fo-eyebrow', 'Weekly board'));
	els.hero.appendChild(el('h1', 'fo-title', 'The Forge-Off'));
	els.hero.appendChild(el('p', 'fo-sub', 'No themed event is running right now. The standing weekly board is open: the most-voted public models made this week (Monday to Monday UTC).'));
	const cta = el('a', 'fo-btn fo-btn-primary', 'Make one on the Forge');
	cta.href = '/forge';
	els.hero.appendChild(cta);
	els.days.hidden = true;
	els.overall.hidden = true;
	els.past.hidden = true;
	els.boardTitle.textContent = 'Top this week';
	await loadBoard('/api/forge-gallery?scope=community&sort=top&window=week&limit=24', '/forge', 'Make one on the Forge', false);
}

async function init() {
	els.board.replaceChildren(skeletonGrid());
	const slug = slugFromPath();
	let ev;
	try {
		ev = await getJson(`/api/forge-off/event${slug ? `?slug=${encodeURIComponent(slug)}` : ''}`);
	} catch (err) {
		if (err.status === 404 && !slug) return renderStanding();
		if (err.status === 404) {
			els.hero.replaceChildren();
			els.hero.appendChild(el('h1', 'fo-title', 'Event not found'));
			els.hero.appendChild(el('p', 'fo-sub', 'That Forge-Off event does not exist.'));
			const a = el('a', 'fo-btn fo-btn-primary', 'See the current Forge-Off');
			a.href = '/forge-off';
			els.hero.appendChild(a);
			for (const n of [els.days, els.overall, els.past, els.board, els.boardTitle]) n.hidden = true;
			return;
		}
		errorState(els.board, err.message, init);
		return;
	}
	if (ev.enabled === false) {
		errorState(els.board, 'The vote store is offline.', init);
		return;
	}
	state.event = ev;
	document.title = `${ev.title} | three.ws`;
	renderHero();
	renderDayTabs();
	renderOverall();
	renderPast();
	renderShare();
	const start = ev.live_day || (ev.phase === 'ended' ? ev.days.length : 1);
	selectDay(start);
	if (!ev.live_day && ev.phase === 'ended') els.boardTitle.textContent = `Day ${start}: ${ev.days[start - 1].theme}`;
}

init();
