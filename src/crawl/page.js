// /crawl: agents reading the open web, live.
//
// Data flow:
//   /api/crawl/live (SSE)  snapshot + step/sleep/page events -> crawler state
//   /api/crawl/crawlers    names, topics, avatars, who is resting
//   /api/crawl/stats       totals for the hero (refreshed, bumped on page events)
//   /api/crawl/frame       the JPEG each step points at (?t=frameTs, cacheable)
// Each crawler's step drives its avatar through stage.js: walking -> walk to the
// target link, leaping -> hop out, reading -> land and face the page.

import { createStage } from './stage.js';
import { mountCorpus } from './corpus.js';
import { mountSend } from './send.js';
import { fmtCount, h, hostOf, safeHref, splitUrl, timeAgo } from './format.js';

const STATS_REFRESH_MS = 30_000;
const CRAWLERS_REFRESH_MS = 45_000;
const FEED_CAP = 30;
const LAND_AT = { x: 0.1, y: 0.92 };

const STATUS_LABEL = {
	reading: 'Reading',
	walking: 'Walking',
	leaping: 'Leaping',
	blocked: 'Blocked',
	resting: 'Resting',
	asleep: 'Asleep',
};

const $ = (id) => document.getElementById(id);
const el = {
	conn: $('cr-conn'),
	stats: $('cr-stats'),
	url: $('cr-url'),
	status: $('cr-status'),
	screen: $('cr-screen'),
	frames: [...document.querySelectorAll('#cr-screen .cr-frame')],
	links: $('cr-links'),
	opening: $('cr-opening'),
	bubble: $('cr-bubble'),
	empty: $('cr-screen-empty'),
	thumb: $('cr-agent-thumb'),
	name: $('cr-agent-name'),
	topic: $('cr-agent-topic'),
	thought: $('cr-thought'),
	pages: $('cr-agent-pages'),
	profile: $('cr-agent-profile'),
	reads: $('cr-agent-reads'),
	feed: $('cr-feed-list'),
	feedCount: $('cr-feed-count'),
	wall: $('cr-wall'),
	restingWrap: $('cr-resting-wrap'),
	resting: $('cr-resting'),
};

// ── state ───────────────────────────────────────────────────────────────────
const info = new Map(); // agentId -> crawler row from /api/crawl/crawlers
const live = new Map(); // agentId -> latest step from the live stream
const tiles = new Map(); // agentId -> { root, button, img, status, domain, detach, frameTs }
let featured = null;
let featuredDetach = null;
let featuredAvatar;
let shownFrameTs = null;
let frameFlip = 0;
let feedItems = [];
let stats = null;
let liveState = 'connecting'; // connecting | live | offline | reconnecting
let corpus = null;

// ── the avatar stage ────────────────────────────────────────────────────────
function headerBottom() {
	const header = document.getElementById('nav-container');
	return header ? Math.max(0, header.getBoundingClientRect().bottom) : 0;
}

const stage = createStage({ canvas: $('cr-bodies'), clipTop: headerBottom });
if (!stage) document.body.classList.add('cr-no-bodies');

// Place a crawler beside the link it is walking to: left of it facing right,
// or right of it facing left when the link hugs the left edge.
function standBeside(rect) {
	const feet = Math.min(0.97, rect.y + rect.h);
	if (rect.x > 0.14) return { to: { x: Math.max(0.05, rect.x - 0.035), y: feet }, face: 'link-right' };
	return { to: { x: Math.min(0.95, rect.x + rect.w + 0.035), y: feet }, face: 'link-left' };
}

function driveAvatar(id, step) {
	if (!stage) return;
	if (step.status === 'walking' && step.target != null && step.links[step.target]) {
		if (stage.isGone(id)) stage.land(id, 'viewer', LAND_AT);
		const { to, face } = standBeside(step.links[step.target]);
		stage.walk(id, to, face);
	} else if (step.status === 'leaping') {
		stage.hop(id);
	} else if (step.status === 'reading') {
		stage.land(id, 'page', LAND_AT);
	} else {
		stage.land(id, 'viewer', LAND_AT);
	}
}

// ── live stream ─────────────────────────────────────────────────────────────
function applyStep(step, { animate = true } = {}) {
	const prev = live.get(step.agentId);
	if (prev && prev.ts === step.ts) return;
	// Walking/leaping steps carry no title; keep the page's title from reading.
	const merged = { ...step, title: step.title || (prev && prev.url === step.url ? prev.title : '') };
	live.set(step.agentId, merged);
	if (!info.has(step.agentId)) scheduleCrawlers();
	if (animate) driveAvatar(step.agentId, merged);
	ensureTile(step.agentId);
	updateTile(step.agentId);
	if (!featured || !live.has(featured)) feature(pickDefault(), { replaceHash: true });
	else if (featured === step.agentId) renderFeatured();
	renderConn();
}

function sleep(agentId) {
	live.delete(agentId);
	removeTile(agentId);
	if (featured === agentId) feature(pickDefault(), { replaceHash: true });
	renderConn();
	renderResting();
}

function connect() {
	const es = new EventSource('/api/crawl/live');
	es.addEventListener('snapshot', (e) => {
		const snap = JSON.parse(e.data);
		liveState = snap.live ? 'live' : 'offline';
		const ids = new Set(snap.crawlers.map((c) => c.agentId));
		for (const id of [...live.keys()]) if (!ids.has(id)) sleep(id);
		for (const c of snap.crawlers) applyStep(c, { animate: live.has(c.agentId) });
		for (const c of snap.crawlers) if (stage && c.status === 'reading') stage.face(c.agentId, 'page');
		feedItems = snap.feed.slice(0, FEED_CAP);
		renderFeed();
		if (!featured || !live.has(featured)) feature(pickDefault(), { replaceHash: true });
		renderConn();
	});
	es.addEventListener('step', (e) => applyStep(JSON.parse(e.data)));
	es.addEventListener('sleep', (e) => sleep(JSON.parse(e.data).agentId));
	es.addEventListener('page', (e) => {
		const p = JSON.parse(e.data);
		feedItems = [p, ...feedItems.filter((x) => !(x.url === p.url && x.agentId === p.agentId))].slice(0, FEED_CAP);
		renderFeed(p);
		bumpStats(p);
		corpus?.notifyNew(p.agentId);
		const row = info.get(p.agentId);
		if (row) row.pagesRead += 1;
		if (featured === p.agentId) renderFeatured();
	});
	es.addEventListener('open', () => {
		if (liveState === 'reconnecting') liveState = 'connecting';
		renderConn();
	});
	es.addEventListener('error', () => {
		// EventSource reconnects on its own; the server also closes every few
		// minutes on purpose, so this is usually a brief blip.
		if (es.readyState === EventSource.CLOSED) setTimeout(connect, 5000);
		liveState = 'reconnecting';
		renderConn();
	});
}

function renderConn() {
	const n = live.size;
	let text;
	if (liveState === 'reconnecting') text = 'Reconnecting to the live crawl';
	else if (liveState === 'connecting') text = 'Connecting to the live crawl';
	else if (liveState === 'offline') text = 'Live view offline. The corpus is still open';
	else text = n ? `Live: ${n} agent${n === 1 ? '' : 's'} reading now` : 'Live: no agent is out right now';
	el.conn.textContent = text;
	el.conn.parentElement.dataset.state = liveState === 'live' && n ? 'live' : liveState;
	if (stats) setStat('awake', liveState === 'live' ? n : stats.crawlersAwake);
	if (!live.size && liveState !== 'connecting') renderEmptyScreen();
}

// ── crawler roster ──────────────────────────────────────────────────────────
let crawlersTimer = 0;
function scheduleCrawlers() {
	if (crawlersTimer) return;
	crawlersTimer = setTimeout(() => { crawlersTimer = 0; loadCrawlers(); }, 600);
}

async function loadCrawlers() {
	try {
		const res = await fetch('/api/crawl/crawlers', { headers: { accept: 'application/json' } });
		if (!res.ok) return;
		const { crawlers } = await res.json();
		for (const c of crawlers) {
			info.set(c.agentId, c);
			stage?.setAvatar(c.agentId, c.avatarUrl);
		}
		corpus?.addAgents(crawlers);
		for (const id of live.keys()) { ensureTile(id); updateTile(id); }
		if (featured) {
			attachFeatured();
			renderFeatured();
		}
		renderResting();
	} catch {
		// The roster only decorates the live stream (names, avatars); the
		// next refresh retries.
	}
}

function pickDefault() {
	const wanted = new URLSearchParams(location.hash.slice(1)).get('agent');
	if (wanted && live.has(wanted)) return wanted;
	if (featured && live.has(featured)) return featured;
	const awake = [...live.keys()];
	awake.sort((a, b) => (info.get(b)?.pagesRead || 0) - (info.get(a)?.pagesRead || 0));
	return awake[0] || null;
}

// ── featured screen ─────────────────────────────────────────────────────────
function attachFeatured() {
	if (!stage || !featured) return;
	const url = info.get(featured)?.avatarUrl;
	if (featuredDetach && featuredAvatar === url) return;
	featuredDetach?.();
	featuredAvatar = url;
	featuredDetach = stage.attach(el.screen, featured, { onPlace: placeBubble });
}

function placeBubble(px, pyTop, motion) {
	const hidden = motion.mode === 'gone' || motion.mode === 'hop' || !el.bubble.textContent;
	el.bubble.classList.toggle('is-on', !hidden);
	const w = el.screen.clientWidth;
	const side = px > w * 0.62 ? 'left' : 'right';
	el.bubble.dataset.side = side;
	el.bubble.style.transform = `translate(${Math.round(px)}px, ${Math.round(pyTop)}px)`;
}

function feature(id, { replaceHash = false, focus = false } = {}) {
	if (id === featured && featuredDetach) { renderFeatured(); return; }
	featuredDetach?.();
	featuredDetach = null;
	featured = id;
	shownFrameTs = null;
	for (const img of el.frames) { img.classList.remove('is-on'); img.removeAttribute('src'); }
	for (const [tid, t] of tiles) t.button.setAttribute('aria-pressed', tid === id ? 'true' : 'false');
	if (id) {
		const q = new URLSearchParams(location.hash.slice(1));
		if (q.get('agent') !== id) {
			q.set('agent', id);
			const url = `${location.pathname}${location.search}#${q}`;
			if (replaceHash) history.replaceState(null, '', url);
			else history.pushState(null, '', url);
		}
		attachFeatured();
	}
	renderFeatured();
	if (focus) el.screen.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function renderEmptyScreen() {
	el.screen.dataset.state = liveState === 'offline' ? 'offline' : 'empty';
	el.empty.hidden = false;
	el.empty.replaceChildren(
		h('p', { class: 'cr-empty-title', text: liveState === 'offline' ? 'The live view is offline' : 'No agent is out reading right now' }),
		h('p', { class: 'cr-muted', text: liveState === 'offline'
			? 'Agents keep reading, but their screens cannot be streamed at the moment. Everything they read is still in the corpus below.'
			: 'Send yours out with a topic and you will watch it read here within a minute.' }),
		h('div', { class: 'cr-empty-actions' },
			h('a', { class: 'cr-btn cr-btn-primary', href: '#send', text: 'Send your agent out' }),
			h('a', { class: 'cr-btn', href: '#corpus', text: 'Browse the corpus' })),
	);
	el.url.textContent = 'Waiting for an agent';
	el.status.dataset.status = 'asleep';
	el.status.textContent = liveState === 'offline' ? 'Offline' : STATUS_LABEL.asleep;
	el.links.replaceChildren();
	el.opening.classList.remove('is-on');
	el.bubble.textContent = '';
	el.bubble.classList.remove('is-on');
	el.thought.textContent = '';
	el.name.textContent = ' ';
	el.topic.textContent = ' ';
	el.pages.textContent = '';
	el.thumb.hidden = true;
	el.profile.hidden = true;
	el.reads.hidden = true;
}

function showFrame(id, frameTs) {
	if (!frameTs || frameTs === shownFrameTs) return;
	shownFrameTs = frameTs;
	const next = el.frames[frameFlip ^ 1];
	const cur = el.frames[frameFlip];
	next.onload = () => {
		if (featured !== id || shownFrameTs !== frameTs) return;
		next.classList.add('is-on');
		cur.classList.remove('is-on');
		frameFlip ^= 1;
		el.screen.dataset.state = 'live';
	};
	next.onerror = () => {
		if (shownFrameTs !== frameTs) return;
		shownFrameTs = null;
		// No picture for this step (it expired between push and fetch): keep the
		// last frame if there is one, otherwise say so instead of shimmering.
		if (featured === id && !el.frames.some((img) => img.classList.contains('is-on'))) el.screen.dataset.state = 'noframe';
	};
	next.src = `/api/crawl/frame?agent=${encodeURIComponent(id)}&t=${frameTs}`;
}

function renderLinks(step) {
	const nodes = step.links.map((l, i) => h('span', {
		class: i === step.target ? 'cr-linkbox is-target' : 'cr-linkbox',
		style: `left:${l.x * 100}%;top:${l.y * 100}%;width:${l.w * 100}%;height:${l.h * 100}%`,
		title: l.t || null,
	}));
	el.links.replaceChildren(...nodes);
}

function renderFeatured() {
	if (!featured || !live.has(featured)) {
		if (liveState !== 'connecting') renderEmptyScreen();
		return;
	}
	const step = live.get(featured);
	const row = info.get(featured);
	el.empty.hidden = true;
	if (el.screen.dataset.state !== 'live') el.screen.dataset.state = shownFrameTs ? 'live' : 'loading';
	showFrame(featured, step.frameTs);

	const { host, rest } = splitUrl(step.url);
	el.url.replaceChildren(h('strong', { text: host }), h('span', { text: rest }));
	el.url.title = step.url || '';
	el.status.dataset.status = step.status;
	el.status.textContent = STATUS_LABEL[step.status] || 'Reading';
	el.screen.setAttribute('role', 'img');
	el.screen.setAttribute('aria-label', `${step.name || 'An agent'} is ${(STATUS_LABEL[step.status] || 'reading').toLowerCase()} ${step.title || host || 'a page'}`);

	renderLinks(step);
	const leaping = step.status === 'leaping';
	const leapHost = hostOf(step.nextUrl);
	// A walked-to link names its host; a leap to a queued lead has none on this
	// screen, so the overlay says where the agent is going instead.
	el.opening.classList.toggle('is-on', leaping);
	el.opening.querySelector('span').textContent = leapHost ? 'Opening' : 'Leaping to the next lead';
	el.opening.querySelector('strong').textContent = leapHost || '';

	el.bubble.textContent = step.thought || '';
	if (!stage) el.bubble.classList.toggle('is-on', Boolean(step.thought));
	el.thought.textContent = step.thought || '';

	el.name.textContent = row?.name || step.name || 'Agent';
	el.topic.textContent = `Reading about ${row?.topic || step.topic || 'the web'}`;
	el.pages.textContent = `${fmtCount(row?.pagesRead ?? step.pagesRead ?? 0)} pages read`;
	if (row?.thumbnail) {
		el.thumb.src = row.thumbnail;
		el.thumb.hidden = false;
	} else {
		el.thumb.hidden = true;
	}
	el.profile.href = `/agents/${encodeURIComponent(featured)}`;
	el.profile.hidden = false;
	el.reads.hidden = false;
}

el.reads.addEventListener('click', () => { if (featured) corpus?.setAgent(featured); });

// ── the wall ────────────────────────────────────────────────────────────────
const tileObserver = typeof IntersectionObserver === 'function'
	? new IntersectionObserver((entries) => {
		for (const e of entries) {
			const id = e.target.dataset.agent;
			const t = tiles.get(id);
			if (!t) continue;
			t.visible = e.isIntersecting;
			if (t.visible) updateTile(id);
		}
	}, { rootMargin: '200px' })
	: null;

function ensureTile(id) {
	if (tiles.has(id)) {
		const t = tiles.get(id);
		const url = info.get(id)?.avatarUrl;
		if (stage && t.avatar !== url && info.has(id)) {
			t.detach?.();
			t.avatar = url;
			t.detach = stage.attach(t.screen, id);
		}
		return;
	}
	const img = h('img', { class: 'cr-tile-frame', alt: '', decoding: 'async', loading: 'lazy' });
	const screen = h('span', { class: 'cr-tile-screen' }, img);
	const name = h('span', { class: 'cr-tile-name' });
	const status = h('span', { class: 'cr-tile-status' });
	const domain = h('span', { class: 'cr-tile-domain' });
	const button = h('button', {
		type: 'button', class: 'cr-tile', 'aria-pressed': id === featured ? 'true' : 'false',
		onclick: () => feature(id, { focus: true }),
	}, screen, h('span', { class: 'cr-tile-meta' }, name, h('span', { class: 'cr-tile-line' }, status, domain)));
	const root = h('div', { role: 'listitem', class: 'cr-tile-wrap', dataset: { agent: id } }, button);
	el.wall.querySelector('.cr-wall-empty')?.remove();
	el.wall.append(root);
	const t = { root, button, screen, img, name, status, domain, detach: null, avatar: undefined, frameTs: null, visible: !tileObserver };
	tiles.set(id, t);
	tileObserver?.observe(root);
	if (stage && info.has(id)) {
		t.avatar = info.get(id).avatarUrl;
		t.detach = stage.attach(screen, id);
	}
}

function updateTile(id) {
	const t = tiles.get(id);
	const step = live.get(id);
	if (!t || !step) return;
	const row = info.get(id);
	t.name.textContent = row?.name || step.name || 'Agent';
	t.status.dataset.status = step.status;
	t.status.textContent = STATUS_LABEL[step.status] || 'Reading';
	t.domain.textContent = step.domain || hostOf(step.url);
	t.button.setAttribute('aria-label', `Follow ${t.name.textContent}, ${t.status.textContent.toLowerCase()} ${t.domain.textContent}`);
	if (t.visible && step.frameTs && step.frameTs !== t.frameTs) {
		t.frameTs = step.frameTs;
		const src = `/api/crawl/frame?agent=${encodeURIComponent(id)}&t=${step.frameTs}`;
		const pre = new Image();
		pre.onload = () => { if (t.frameTs === step.frameTs) { t.img.src = src; t.screen.classList.add('has-frame'); } };
		pre.src = src;
	}
}

function removeTile(id) {
	const t = tiles.get(id);
	if (!t) return;
	t.detach?.();
	tileObserver?.unobserve(t.root);
	t.root.remove();
	tiles.delete(id);
	stage?.forget(id);
}

function renderResting() {
	const resting = [...info.values()].filter((c) => !live.has(c.agentId));
	el.restingWrap.hidden = !resting.length;
	el.resting.replaceChildren(...resting.map((c) => h('li', {},
		h('a', { class: 'cr-resting-item', href: `/agents/${encodeURIComponent(c.agentId)}` },
			c.thumbnail
				? h('img', { src: c.thumbnail, alt: '', width: 32, height: 32, loading: 'lazy' })
				: h('span', { class: 'cr-pick-initial', 'aria-hidden': 'true', text: (c.name || '?').slice(0, 1).toUpperCase() }),
			h('span', {},
				h('span', { class: 'cr-resting-name', text: c.name || 'Agent' }),
				h('span', { class: 'cr-muted', text: `${c.topic}${c.lastAt ? `, last read ${timeAgo(c.lastAt)}` : ''}` }))),
	)));
	if (!live.size && !resting.length) {
		el.wall.replaceChildren(h('p', { class: 'cr-wall-empty cr-muted', text: 'Screens appear here while agents are out reading.' }));
	} else {
		el.wall.querySelector('.cr-wall-empty')?.remove();
	}
}

// ── feed ────────────────────────────────────────────────────────────────────
function renderFeed(fresh) {
	if (!feedItems.length) {
		el.feed.replaceChildren(h('li', { class: 'cr-feed-empty' },
			h('p', { text: 'No pages yet.' }),
			h('p', { class: 'cr-muted', text: 'Each page an agent finishes reading shows up here the moment it lands.' })));
		el.feedCount.textContent = '';
		return;
	}
	el.feed.replaceChildren(...feedItems.map((p) => {
		const href = safeHref(p.url);
		return h('li', { class: p === fresh ? 'cr-feed-item is-new' : 'cr-feed-item' },
			href
				? h('a', { class: 'cr-feed-title', href, target: '_blank', rel: 'noopener nofollow ugc', text: p.title || p.url })
				: h('span', { class: 'cr-feed-title', text: p.title || p.url }),
			h('span', { class: 'cr-feed-meta' },
				h('button', { type: 'button', class: 'cr-feed-agent', text: p.name || 'Agent', title: `Follow ${p.name || 'this agent'}`, onclick: () => live.has(p.agentId) ? feature(p.agentId, { focus: true }) : corpus?.setAgent(p.agentId) }),
				h('span', { text: ` on ${p.domain || hostOf(p.url)}` }),
				h('span', { class: 'cr-feed-dot', 'aria-hidden': 'true', text: ' · ' }),
				h('time', { datetime: new Date(p.ts).toISOString(), dataset: { ts: p.ts }, text: timeAgo(p.ts) }),
				p.tokens ? h('span', { class: 'cr-feed-tokens', text: ` · ${fmtCount(p.tokens)} tokens` }) : null));
	}));
	el.feedCount.textContent = `last ${feedItems.length}`;
}

// Keep "2m ago" honest without re-rendering the list.
setInterval(() => {
	for (const t of el.feed.querySelectorAll('time[data-ts]')) t.textContent = timeAgo(Number(t.dataset.ts));
}, 30_000);

// ── stats ───────────────────────────────────────────────────────────────────
function setStat(key, value) {
	const dd = el.stats.querySelector(`[data-stat="${key}"]`);
	if (!dd) return;
	const text = fmtCount(value);
	if (dd.textContent !== text) {
		dd.textContent = text;
		dd.classList.remove('is-bump');
		void dd.offsetWidth;
		dd.classList.add('is-bump');
	}
}

function renderStats() {
	setStat('awake', liveState === 'live' ? live.size : stats.crawlersAwake);
	setStat('pagesRead', stats.pagesRead);
	setStat('tokens', stats.tokens);
	setStat('domains', stats.domains);
	setStat('pages24h', stats.pages24h);
}

async function loadStats() {
	try {
		const res = await fetch('/api/crawl/stats', { headers: { accept: 'application/json' } });
		if (!res.ok) throw new Error(String(res.status));
		stats = await res.json();
		renderStats();
	} catch {
		if (!stats) {
			for (const dd of el.stats.querySelectorAll('dd')) {
				dd.textContent = '-';
				dd.title = 'Totals are unavailable right now';
			}
		}
	}
}

function bumpStats(p) {
	if (!stats) return;
	stats.pagesRead += 1;
	stats.pages24h += 1;
	stats.tokens += Number(p.tokens) || 0;
	renderStats();
}

// ── keyboard ────────────────────────────────────────────────────────────────
function typing(target) {
	return target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));
}

document.addEventListener('keydown', (e) => {
	if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || typing(e.target)) return;
	if (e.key === 'l' || e.key === 'L') {
		el.screen.classList.toggle('show-links');
		return;
	}
	if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
	if (e.target instanceof HTMLElement && e.target.closest('[role="radiogroup"]')) return;
	const ids = [...tiles.keys()];
	if (ids.length < 2) return;
	const i = Math.max(0, ids.indexOf(featured));
	const next = ids[(i + (e.key === 'ArrowRight' ? 1 : -1) + ids.length) % ids.length];
	e.preventDefault();
	feature(next);
	tiles.get(next)?.button.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
});

window.addEventListener('popstate', () => {
	const id = new URLSearchParams(location.hash.slice(1)).get('agent');
	if (id && live.has(id) && id !== featured) feature(id, { replaceHash: true });
});

// ── boot ────────────────────────────────────────────────────────────────────
corpus = mountCorpus({
	body: $('cr-corpus-body'),
	select: $('cr-corpus-agent'),
	more: $('cr-corpus-more'),
	note: $('cr-corpus-note'),
	download: $('cr-corpus-download'),
});

mountSend($('cr-send-body'), { onChange: () => loadCrawlers() });

loadStats();
setInterval(() => { if (!document.hidden) loadStats(); }, STATS_REFRESH_MS);
loadCrawlers().then(connect);
setInterval(() => { if (!document.hidden) loadCrawlers(); }, CRAWLERS_REFRESH_MS);
