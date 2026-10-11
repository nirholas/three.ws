// The Field: three.ws as one zoomable living map instead of a desktop.
//
// Every light in the core is a real public agent, placed newest-first on a
// phyllotaxis spiral; zoom in and the lights become their faces. Around the
// core sit the districts (Forge, Gallery, Launchpad, Trenches, Pulse ...),
// each rendering its own live feed. Real wallet moves from /api/pulse draw
// trails from the agent that made them to the district they landed in, and a
// new one fires a comet across the map as it happens. Zoom far and each
// district is a name and one live number; zoom near and it is a card of real
// content; keep going (or press Enter) and the surface itself opens in place.
// There are no icons, windows, docks or taskbars.

import {
	CARD,
	CORE,
	DISTRICTS,
	NEAR_K,
	agentPosition,
	agentSize,
	clampCam,
	coreRadius,
	deepLink,
	describeEvent,
	districtForEvent,
	easeInOut,
	fitRect,
	fmtCount,
	fmtPct,
	fmtUsd,
	layoutDistricts,
	lodFor,
	relTime,
	ringFor,
	screenToWorld,
	searchField,
	trailAlpha,
	worldBounds,
	zoomAt,
	zoomPath,
} from './logic.js';
import { loadAccount, loadAvatars, loadLaunches, loadPages, loadPulse, loadStats, loadToken, streamAgents } from './data.js';
import './field.css';

const PULSE_POLL_MS = 12_000;
const TOKEN_POLL_MS = 60_000;
const COMET_MS = 1800;
const MAX_TRAILS = 60;
const THREE_MINT = 'FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const clip = (s, n) => {
	const t = String(s ?? '').trim();
	return t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t;
};
function hash32(s) {
	let h = 2166136261;
	for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
	return h >>> 0;
}

/** Swap a button's label for a moment to confirm an action. */
function flash(btn, text) {
	const was = btn.dataset.label || btn.textContent;
	btn.dataset.label = was;
	btn.textContent = text;
	clearTimeout(btn._flash);
	btn._flash = setTimeout(() => (btn.textContent = was), 1400);
}

/**
 * Mount the Field into `root`.
 * @param {HTMLElement} root
 */
export function mountField(root) {
	const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
	const S = {
		stats: null,
		token: null,
		agents: [],
		agentIndex: new Map(),
		avatars: null,
		launches: null,
		events: [],
		head: null,
		account: undefined,
		pages: [],
		err: {},
		agentsDone: false,
	};

	root.classList.add('fd');
	root.setAttribute('aria-label', 'three.ws');
	root.innerHTML = `
		<h1 class="fd-sr">three.ws: every agent, every surface, live on one map</h1>
		<canvas class="fd-sky" aria-hidden="true"></canvas>
		<div class="fd-world"><div class="fd-core-tag"></div></div>
		<header class="fd-top">
			<a class="fd-brand" href="/" aria-label="three.ws, back to the whole map"><b>three.ws</b><span class="fd-crumb" aria-live="polite">Field</span></a>
			<nav class="fd-actions" aria-label="Other ways in">
				<a class="fd-btn fd-ghost" href="/?world=1" title="Walk the 3D campus as your avatar">Walk in</a>
				<a class="fd-btn fd-ghost fd-hide-sm" href="/?view=desktop" title="The windowed desktop">Desktop</a>
				<span class="fd-acct"></span>
			</nav>
		</header>
		<div class="fd-status" role="status" aria-live="polite"><i class="fd-live"></i><span class="fd-status-text">Connecting to the network</span></div>
		<div class="fd-zoom" role="group" aria-label="Zoom">
			<button type="button" class="fd-zbtn" data-z="in" aria-label="Zoom in" title="Zoom in (+)">+</button>
			<button type="button" class="fd-zbtn" data-z="out" aria-label="Zoom out" title="Zoom out (-)">&minus;</button>
			<button type="button" class="fd-zbtn" data-z="home" aria-label="Whole map" title="Whole map (0)"><svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg></button>
		</div>
		<form class="fd-ask" role="search" autocomplete="off">
			<ul class="fd-results" role="listbox" id="fd-results" hidden></ul>
			<label class="fd-ask-row">
				<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" stroke-width="2"/><path d="m20 20-3.5-3.5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
				<input class="fd-ask-input" type="text" spellcheck="false" placeholder="Go anywhere. Find any agent." aria-label="Go anywhere or find an agent" role="combobox" aria-expanded="false" aria-controls="fd-results" aria-autocomplete="list" />
				<kbd class="fd-kbd" aria-hidden="true">/</kbd>
			</label>
		</form>
		<div class="fd-tip" hidden></div>
		<section class="fd-surface" hidden aria-label="Open surface">
			<header class="fd-surface-bar">
				<button type="button" class="fd-btn fd-back" title="Back to the map (Esc)"><svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M15 6l-6 6 6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg><span>Field</span></button>
				<span class="fd-surface-dot" aria-hidden="true"></span>
				<b class="fd-surface-title"></b>
				<span class="fd-surface-path"></span>
				<a class="fd-btn fd-ghost fd-surface-tab" target="_blank" rel="noopener">Open in new tab</a>
			</header>
			<div class="fd-surface-body"><div class="fd-surface-load"><i></i><span>Opening</span></div></div>
		</section>
	`;

	const $ = (sel) => root.querySelector(sel);
	const sky = $('.fd-sky');
	const g = sky.getContext('2d');
	const world = $('.fd-world');
	const coreTag = $('.fd-core-tag');
	const tip = $('.fd-tip');
	const crumb = $('.fd-crumb');
	const statusText = $('.fd-status-text');
	const ask = $('.fd-ask');
	const input = $('.fd-ask-input');
	const results = $('.fd-results');
	const surface = $('.fd-surface');

	let vw = innerWidth;
	let vh = innerHeight;
	let dpr = Math.min(2, devicePixelRatio || 1);
	let districts = layoutDistricts(DISTRICTS, ringFor(vw, vh));
	let cam = homeCam();
	let focusId = null;

	// ---- districts (DOM) ----
	const dEls = new Map();
	function buildDistricts() {
		world.querySelectorAll('.fd-d').forEach((n) => n.remove());
		dEls.clear();
		for (const d of districts) {
			const el = document.createElement('article');
			el.className = 'fd-d';
			el.dataset.id = d.id;
			el.style.setProperty('--hue', d.hue);
			el.style.left = `${d.rect.x}px`;
			el.style.top = `${d.rect.y}px`;
			el.style.width = `${CARD.w}px`;
			el.style.height = `${CARD.h}px`;
			el.innerHTML = `
				<button type="button" class="fd-d-tag" aria-label="${esc(d.title)}: ${esc(d.desc)}"><b>${esc(d.title)}</b><span class="fd-d-read"></span></button>
				<div class="fd-d-card">
					<header class="fd-d-head">
						<i class="fd-d-dot"></i><h2>${esc(d.title)}</h2><span class="fd-d-live"></span>
						<a class="fd-d-enter" href="${esc(d.href)}" data-dive="${esc(d.id)}" aria-label="Open ${esc(d.title)}">Open<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path d="M9 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></a>
					</header>
					<div class="fd-d-body"></div>
				</div>`;
			world.append(el);
			dEls.set(d.id, el);
			renderDistrict(d.id);
		}
	}

	const district = (id) => districts.find((d) => d.id === id) || null;

	/** Fill a district's readout and card body from the live store. */
	function renderDistrict(id) {
		const el = dEls.get(id);
		const d = district(id);
		if (!el || !d) return;
		const { read, live, body } = content(d);
		el.querySelector('.fd-d-read').innerHTML = read;
		el.querySelector('.fd-d-live').innerHTML = live || '';
		el.querySelector('.fd-d-body').innerHTML = body;
	}

	const skel = (n, cls = 'fd-sk-row') => Array.from({ length: n }, () => `<span class="fd-sk ${cls}"></span>`).join('');
	const offline = (what, key) => `<p class="fd-off">${esc(what)} is not answering right now. <button type="button" class="fd-retry" data-retry="${esc(key)}">Try again</button></p>`;

	function content(d) {
		switch (d.kind) {
			case 'create':
				return {
					read: 'Make an agent',
					body: `<p class="fd-lede">Give an AI a body. Start from whatever you have.</p>
						<div class="fd-tiles">
							<a class="fd-tile" href="/create-selfie" data-dive-path="/create-selfie" data-title="From a selfie"><b>From a selfie</b><span>Your face, rigged and walking</span></a>
							<a class="fd-tile" href="/create/prompt" data-dive-path="/create/prompt" data-title="From a sentence"><b>From a sentence</b><span>Describe it, get a character</span></a>
							<a class="fd-tile" href="/forge" data-dive="forge"><b>A 3D model</b><span>Any object, as a GLB</span></a>
						</div>`,
				};
			case 'forge':
				return {
					read: 'Text to 3D',
					body: `<p class="fd-lede">Type what you want to hold. Forge returns a textured, downloadable model.</p>
						<form class="fd-forge"><input name="prompt" maxlength="1000" placeholder="a brass telescope on a tripod" aria-label="Describe a 3D model" /><button class="fd-btn fd-solid" type="submit">Forge</button></form>
						<p class="fd-hint">Free lane, no account needed.</p>`,
				};
			case 'gallery': {
				if (S.err.avatars) return { read: 'Offline', body: offline('The avatar gallery', 'avatars') };
				if (!S.avatars) return { read: '<span class="fd-sk fd-sk-in"></span>', body: `<div class="fd-faces">${skel(8, 'fd-sk-face')}</div>` };
				if (!S.avatars.length) return { read: 'No avatars yet', body: '<p class="fd-empty">No public avatars yet. <a href="/create-selfie" data-dive-path="/create-selfie" data-title="From a selfie">Make the first one</a>.</p>' };
				const newest = S.avatars[0];
				return {
					read: `Newest: ${esc(clip(newest.name, 18))}`,
					live: relTime(newest.created_at),
					body: `<div class="fd-faces">${S.avatars
						.map((a) => `<a class="fd-face" href="/avatars/${esc(a.slug || a.id)}" data-dive-path="/avatars/${esc(a.slug || a.id)}" data-title="${esc(clip(a.name, 40))}" title="${esc(a.name)}"><img src="${esc(a.thumbnail_url)}" alt="${esc(clip(a.name, 40))}" loading="lazy" decoding="async" /><span>${esc(clip(a.name, 14))}</span></a>`)
						.join('')}</div>`,
				};
			}
			case 'launches': {
				const total = S.stats ? `${fmtCount(S.stats.launches)} launched` : '';
				if (S.err.launches) return { read: total || 'Offline', body: offline('The launch feed', 'launches') };
				if (!S.launches) return { read: '<span class="fd-sk fd-sk-in"></span>', body: skel(4) };
				if (!S.launches.length) return { read: total || 'No launches yet', body: '<p class="fd-empty">No agent has launched a coin yet. <a href="/launcher" data-dive="launcher">Launch the first</a>.</p>' };
				return {
					read: total || `${S.launches.length} recent`,
					live: relTime(S.launches[0].created_at),
					body: `<ul class="fd-list">${S.launches
						.map((l) => `<li><a href="/launcher" data-dive="launcher">${face(l.agent?.avatar_thumbnail_url, l.agent?.name)}<span class="fd-li-main"><b>${esc(clip(l.name, 22))}</b><span>by ${esc(clip(l.agent?.name || 'an agent', 20))}</span></span><span class="fd-li-side"><code>$${esc(clip(String(l.symbol || '').toUpperCase(), 10))}</code><time>${relTime(l.created_at)}</time></span></a></li>`)
						.join('')}</ul>`,
				};
			}
			case 'token': {
				if (S.err.token) return { read: '$THREE offline', body: offline('The $THREE feed', 'token') };
				if (!S.token) return { read: '<span class="fd-sk fd-sk-in"></span>', body: skel(3) };
				const t = S.token;
				const dir = t.change >= 0 ? 'up' : 'down';
				return {
					read: `<span class="fd-hide-sm">$THREE </span>${fmtUsd(t.price)} <em class="fd-${dir}">${fmtPct(t.change)}</em>`,
					body: `<div class="fd-quote"><span class="fd-sym">$THREE</span><b>${fmtUsd(t.price)}</b><em class="fd-${dir}">${fmtPct(t.change)} 24h</em></div>
						<dl class="fd-kv">
							<div><dt>Market cap</dt><dd>${fmtUsd(t.cap) || 'n/a'}</dd></div>
							<div><dt>24h volume</dt><dd>${fmtUsd(t.volume) || 'n/a'}</dd></div>
							<div><dt>Holders</dt><dd>${Number.isFinite(t.holders) ? fmtCount(t.holders) : 'n/a'}</dd></div>
						</dl>
						<div class="fd-ca">
							<span class="fd-ca-k">CA</span>
							<code title="${THREE_MINT}">${THREE_MINT.slice(0, 6)}…${THREE_MINT.slice(-6)}</code>
							<button type="button" class="fd-ca-copy" data-copy="${THREE_MINT}">Copy</button>
							<a class="fd-ca-more" href="/three-token" data-dive-path="/three-token" data-title="$THREE">About $THREE</a>
						</div>
						<p class="fd-hint">Open Trenches for live Solana launches, runners and smart money.</p>`,
				};
			}
			case 'pulse': {
				if (S.err.pulse) return { read: 'Offline', body: offline('Pulse', 'pulse') };
				if (!S.head && !S.events.length) return { read: '<span class="fd-sk fd-sk-in"></span>', body: skel(4) };
				if (!S.events.length) return { read: 'Quiet right now', body: '<p class="fd-empty">No public wallet moves yet. Every trade, tip and launch an agent makes lands here the moment it confirms.</p>' };
				const last = S.events[0];
				return {
					read: `Last move ${relTime(last.ts)}${relTime(last.ts) === 'now' ? '' : ' ago'}`,
					live: `${S.events.length} recent`,
					body: `<ul class="fd-list">${S.events
						.slice(0, 4)
						.map((e) => `<li><a href="${esc(e.explorer || '/pulse')}" ${e.explorer ? 'target="_blank" rel="noopener"' : 'data-dive="pulse"'}>${face(e.agent?.avatar_thumbnail_url, e.agent?.name)}<span class="fd-li-main"><b>${esc(clip(describeEvent(e), 46))}</b><span>${esc(e.kind)}${e.usd ? ` · ${fmtUsd(e.usd)}` : ''}</span></span><span class="fd-li-side"><time>${relTime(e.ts)}</time></span></a></li>`)
						.join('')}</ul>`,
				};
			}
			case 'skills': {
				if (!S.agents.length) return { read: S.stats ? `${S.stats.strategies} live strategies` : '<span class="fd-sk fd-sk-in"></span>', body: skel(3) };
				const skip = new Set(['greet', 'remember', 'think', 'present-model', 'validate-model', 'wave', 'help']);
				const count = new Map();
				for (const a of S.agents) for (const s of a.skills || []) if (!skip.has(s)) count.set(s, (count.get(s) || 0) + 1);
				const top = [...count.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
				return {
					read: S.stats ? `${S.stats.strategies} live strategies` : `${count.size} skills in use`,
					body: top.length
						? `<p class="fd-lede">Skills the newest ${S.agents.length} agents carry most.</p><div class="fd-chips">${top.map(([s, n]) => `<a class="fd-chip" href="/marketplace?q=${encodeURIComponent(s)}" data-dive-path="/marketplace?q=${encodeURIComponent(s)}" data-title="Marketplace"><b>${esc(s)}</b><span>${n}</span></a>`).join('')}</div>`
						: '<p class="fd-empty">No custom skills equipped yet. <a href="/agent-studio" data-dive="studio">Write the first one</a>.</p>',
				};
			}
			case 'chat': {
				if (!S.agents.length) return { read: '<span class="fd-sk fd-sk-in"></span>', body: skel(3) };
				const top = [...S.agents].sort((a, b) => (b.chat_count || 0) - (a.chat_count || 0)).slice(0, 4);
				return {
					read: `Talk to ${esc(clip(top[0]?.name || 'an agent', 16))}`,
					body: `<p class="fd-lede">The most talked-to agents right now.</p><ul class="fd-list">${top
						.map((a) => `<li><a href="${esc(a.home_url)}" data-dive-path="${esc(a.home_url)}" data-title="${esc(clip(a.name, 40))}">${face(a.avatar_thumbnail, a.name)}<span class="fd-li-main"><b>${esc(clip(a.name, 26))}</b><span>${esc(clip(a.description || 'Agent', 40))}</span></span><span class="fd-li-side"><code>${fmtCount(a.chat_count || 0)} chats</code></span></a></li>`)
						.join('')}</ul>`,
				};
			}
			case 'studio':
				return {
					read: 'Author an agent',
					body: `<p class="fd-lede">Write a persona, wire skills, tune a brain, and watch the agent use them.</p>
						<ul class="fd-steps"><li>Persona and voice</li><li>Skills from the marketplace or your own</li><li>Memory and strategy</li></ul>`,
				};
			case 'account': {
				if (S.account === undefined) return { read: '<span class="fd-sk fd-sk-in"></span>', body: skel(2) };
				if (!S.account) return { read: 'Sign in', body: '<p class="fd-lede">Your agents, wallets, keys and usage live here once you sign in.</p><a class="fd-btn fd-solid" href="/login?next=/">Sign in</a>' };
				return { read: esc(clip(S.account.name, 18)), body: `<p class="fd-lede">Signed in as <b>${esc(S.account.name)}</b>. Your agents, wallets, keys and usage.</p>` };
			}
			default:
				return { read: '', body: '' };
		}
	}

	function face(src, name) {
		const initial = esc(String(name || '?').trim().charAt(0).toUpperCase() || '?');
		return src ? `<img class="fd-li-face" src="${esc(src)}" alt="" loading="lazy" decoding="async" />` : `<span class="fd-li-face fd-li-init">${initial}</span>`;
	}

	// Agents drawn in the core. Search still covers every one loaded.
	const shown = () => Math.min(S.agents.length, ringFor(vw, vh).cap);

	function renderCore() {
		const n = shown();
		const total = S.stats?.agents;
		coreTag.style.setProperty('--y', `${-coreRadius(Math.max(n, 48)) - 36}px`);
		coreTag.innerHTML = `<button type="button" class="fd-core-btn" data-dive-path="/discover" data-title="Agents"><b>${total ? fmtCount(total) : n ? fmtCount(n) : ''}</b><span>${total || n ? 'agents' : 'Finding agents'}</span></button>`;
	}

	function renderStatus() {
		const parts = [];
		if (S.stats) parts.push(`${fmtCount(S.stats.agents)} agents`);
		if (S.events[0]) parts.push(`last wallet move ${relTime(S.events[0].ts)}${relTime(S.events[0].ts) === 'now' ? '' : ' ago'}`);
		if (S.token) parts.push(`$THREE ${fmtUsd(S.token.price)}`);
		const offlineCount = Object.values(S.err).filter(Boolean).length;
		root.classList.toggle('is-degraded', offlineCount > 0);
		statusText.textContent = parts.length ? parts.join(' · ') : offlineCount ? 'Some feeds are offline' : 'Connecting to the network';
		if (S.stats?.agents) {
			const n = fmtCount(S.stats.agents);
			input.placeholder = narrow.matches ? `Search ${n} agents and places` : `Go anywhere. Find any of ${n} agents.`;
		}
	}
	const narrow = matchMedia('(max-width: 640px)');
	narrow.addEventListener('change', () => renderStatus());

	function renderAccount() {
		const el = $('.fd-acct');
		if (S.account === undefined) return (el.innerHTML = '');
		el.innerHTML = S.account
			? `<a class="fd-btn" href="/dashboard" data-dive="dashboard">${esc(clip(S.account.name, 18))}</a>`
			: `<a class="fd-btn fd-solid" href="/login?next=/">Sign in</a>`;
	}

	// ---- camera ----
	function homeCam() {
		return fitRect(worldBounds(ringFor(vw, vh)), vw, vh, 16);
	}
	function nearCam(d) {
		const m = vw < 640 ? 1.15 : 2.1;
		return fitRect({ x: d.x - (CARD.w * m) / 2, y: d.y - (CARD.h * m) / 2, w: CARD.w * m, h: CARD.h * m }, vw, vh, 12);
	}
	let settleTimer = 0;
	function applyCam() {
		cam = clampCam(cam, worldBounds(ringFor(vw, vh)));
		const tx = vw / 2 - cam.x * cam.k;
		const ty = vh / 2 - cam.y * cam.k;
		world.style.transform = `translate(${tx}px, ${ty}px) scale(${cam.k})`;
		root.style.setProperty('--k', cam.k);
		root.style.setProperty('--inv', 1 / cam.k);
		root.dataset.lod = lodFor(cam.k);
		root.classList.add('is-moving');
		clearTimeout(settleTimer);
		settleTimer = setTimeout(() => root.classList.remove('is-moving'), 160);
		updateFocus();
		dirty();
	}

	/** The district the camera is looking at, for the crumb and keyboard Enter. */
	function updateFocus() {
		let best = null;
		let bestD = Infinity;
		if (cam.k >= NEAR_K) {
			for (const d of districts) {
				const dist = Math.hypot(d.x - cam.x, d.y - cam.y);
				if (dist < bestD) {
					bestD = dist;
					best = d;
				}
			}
			if (best && bestD * cam.k > Math.min(vw, vh) * 0.45) best = null;
		}
		const id = best ? best.id : null;
		if (id === focusId) return;
		focusId = id;
		for (const [k, el] of dEls) el.classList.toggle('is-focus', k === id);
		if (surface.hidden) crumb.textContent = best ? best.title : cam.k > 1.2 && Math.hypot(cam.x, cam.y) < coreRadius(shown()) ? 'Agents' : 'Field';
	}

	let flight = null;
	/** Fly the camera along the smooth zoom path. Any user input cancels it. */
	function flyTo(target, { duration } = {}) {
		cancelFlight();
		target = clampCam(target, worldBounds(ringFor(vw, vh)));
		if (reduced) {
			cam = target;
			applyCam();
			return Promise.resolve(true);
		}
		const path = zoomPath(cam, target, vw);
		const ms = duration ?? path.duration;
		return new Promise((resolve) => {
			const t0 = performance.now();
			const f = { raf: 0, resolve };
			flight = f;
			const step = (now) => {
				const t = Math.min(1, (now - t0) / ms);
				cam = path.at(easeInOut(t));
				applyCam();
				if (t < 1) f.raf = requestAnimationFrame(step);
				else {
					flight = null;
					cam = target;
					applyCam();
					resolve(true);
				}
			};
			f.raf = requestAnimationFrame(step);
		});
	}
	function cancelFlight() {
		if (!flight) return;
		cancelAnimationFrame(flight.raf);
		flight.resolve(false);
		flight = null;
	}

	// ---- the sky (canvas) ----
	const imgs = new Map();
	let loadingImgs = 0;
	function agentImg(a) {
		if (!a.avatar_thumbnail) return null;
		let rec = imgs.get(a.id);
		if (rec) return rec.ok ? rec.img : null;
		if (loadingImgs >= 10) return null;
		const img = new Image();
		img.decoding = 'async';
		rec = { img, ok: false };
		imgs.set(a.id, rec);
		loadingImgs++;
		img.onload = () => {
			rec.ok = true;
			loadingImgs--;
			dirty();
		};
		img.onerror = () => loadingImgs--;
		img.src = a.avatar_thumbnail;
		return null;
	}

	function css(name, fallback) {
		return getComputedStyle(root).getPropertyValue(name).trim() || fallback;
	}
	let palette = null;
	function readPalette() {
		palette = { star: css('--fd-star', '#e9e4ff'), road: css('--fd-road', 'rgba(255,255,255,0.06)'), ring: css('--fd-ring', 'rgba(255,255,255,0.05)'), light: root.ownerDocument.documentElement.dataset.theme === 'light' };
	}

	const comets = [];
	let hover = null;
	let pending = false;
	function dirty() {
		if (pending) return;
		pending = true;
		requestAnimationFrame(draw);
	}

	function eventOrigin(e) {
		const a = e.agent?.id && S.agentIndex.get(e.agent.id);
		if (a && a.i < shown()) return a.pos;
		const r = coreRadius(Math.max(shown(), 48));
		const ang = ((hash32(String(e.agent?.id || e.id)) % 3600) / 3600) * Math.PI * 2;
		return { x: Math.cos(ang) * r, y: Math.sin(ang) * r };
	}
	function curve(a, b) {
		const mx = (a.x + b.x) / 2;
		const my = (a.y + b.y) / 2;
		const dx = b.x - a.x;
		const dy = b.y - a.y;
		return { a, b, c: { x: mx - dy * 0.18, y: my + dx * 0.18 } };
	}
	const qAt = (q, t) => ({ x: (1 - t) * (1 - t) * q.a.x + 2 * (1 - t) * t * q.c.x + t * t * q.b.x, y: (1 - t) * (1 - t) * q.a.y + 2 * (1 - t) * t * q.c.y + t * t * q.b.y });

	function draw(now = performance.now()) {
		pending = false;
		if (!palette) readPalette();
		const k = cam.k;
		g.setTransform(dpr, 0, 0, dpr, 0, 0);
		g.clearRect(0, 0, vw, vh);
		g.save();
		g.translate(vw / 2 - cam.x * k, vh / 2 - cam.y * k);
		g.scale(k, k);

		const coreR = coreRadius(Math.max(shown(), 48));
		// Orbit the districts sit on, and the core's glow.
		const ring = ringFor(vw, vh);
		g.lineWidth = 1 / k;
		g.strokeStyle = palette.ring;
		g.beginPath();
		g.ellipse(0, 0, ring.rx, ring.ry, 0, 0, Math.PI * 2);
		g.stroke();
		const glow = g.createRadialGradient(0, 0, 0, 0, 0, coreR * 1.6);
		glow.addColorStop(0, palette.light ? 'rgba(124,92,255,0.10)' : 'rgba(150,120,255,0.16)');
		glow.addColorStop(1, 'rgba(150,120,255,0)');
		g.fillStyle = glow;
		g.beginPath();
		g.arc(0, 0, coreR * 1.6, 0, Math.PI * 2);
		g.fill();

		// District halos and the roads from the core.
		for (const d of districts) {
			const halo = g.createRadialGradient(d.x, d.y, 0, d.x, d.y, CARD.w * 0.95);
			halo.addColorStop(0, `hsla(${d.hue}, 80%, 62%, ${palette.light ? 0.13 : 0.2})`);
			halo.addColorStop(1, `hsla(${d.hue}, 80%, 62%, 0)`);
			g.fillStyle = halo;
			g.beginPath();
			g.arc(d.x, d.y, CARD.w * 0.95, 0, Math.PI * 2);
			g.fill();
			const len = Math.hypot(d.x, d.y);
			const q = curve({ x: (d.x / len) * coreR, y: (d.y / len) * coreR }, { x: d.x, y: d.y });
			g.strokeStyle = palette.road;
			g.lineWidth = 1.5 / k;
			g.beginPath();
			g.moveTo(q.a.x, q.a.y);
			g.quadraticCurveTo(q.c.x, q.c.y, q.b.x, q.b.y);
			g.stroke();
		}

		// Trails: every recent real wallet move, from the agent to where it landed.
		const t = Date.now();
		for (const e of S.events.slice(0, MAX_TRAILS)) {
			const d = district(districtForEvent(e.kind));
			if (!d) continue;
			const q = curve(eventOrigin(e), { x: d.x, y: d.y });
			const alpha = trailAlpha(t - Date.parse(e.ts));
			g.strokeStyle = `hsla(${d.hue}, 85%, 66%, ${alpha})`;
			g.lineWidth = Math.max(1 / k, 1.2);
			g.beginPath();
			g.moveTo(q.a.x, q.a.y);
			g.quadraticCurveTo(q.c.x, q.c.y, q.b.x, q.b.y);
			g.stroke();
		}

		// Agents: points of light far away, faces up close.
		const born = now;
		let animating = false;
		const tl = screenToWorld(cam, vw, vh, -40, -40);
		const br = screenToWorld(cam, vw, vh, vw + 40, vh + 40);
		const cap = shown();
		for (const a of S.agents) {
			if (a.i >= cap) break;
			const { x, y } = a.pos;
			if (x < tl.x || x > br.x || y < tl.y || y > br.y) continue;
			const fade = reduced ? 1 : Math.min(1, (born - a.born) / 700);
			if (fade < 1) animating = true;
			const r = a.size;
			const sr = r * k;
			const hot = hover === a;
			const img = sr >= 9 ? agentImg(a) : null;
			g.globalAlpha = fade;
			if (img) {
				const rr = Math.max(r, 9 / k) * 1.15;
				g.save();
				g.beginPath();
				g.arc(x, y, rr, 0, Math.PI * 2);
				g.clip();
				g.drawImage(img, x - rr, y - rr, rr * 2, rr * 2);
				g.restore();
				g.strokeStyle = hot ? '#fff' : `hsla(${a.hue}, 80%, 72%, 0.9)`;
				g.lineWidth = (hot ? 2.5 : 1.2) / k;
				g.beginPath();
				g.arc(x, y, rr, 0, Math.PI * 2);
				g.stroke();
			} else {
				const rr = Math.max(r * 0.55, 1.2 / k);
				const halo = g.createRadialGradient(x, y, 0, x, y, rr * 4);
				halo.addColorStop(0, `hsla(${a.hue}, 90%, 80%, ${hot ? 0.9 : 0.45})`);
				halo.addColorStop(1, `hsla(${a.hue}, 90%, 80%, 0)`);
				g.fillStyle = halo;
				g.beginPath();
				g.arc(x, y, rr * 4, 0, Math.PI * 2);
				g.fill();
				g.fillStyle = hot ? '#fff' : palette.star;
				g.beginPath();
				g.arc(x, y, rr, 0, Math.PI * 2);
				g.fill();
			}
		}
		g.globalAlpha = 1;

		// Comets: wallet moves that arrived while you were here.
		for (let i = comets.length - 1; i >= 0; i--) {
			const c = comets[i];
			const p = Math.min(1, (now - c.t0) / COMET_MS);
			const head = qAt(c.q, easeInOut(p));
			for (let j = 1; j <= 14; j++) {
				const tp = qAt(c.q, Math.max(0, easeInOut(p) - j * 0.018));
				g.fillStyle = `hsla(${c.hue}, 95%, 72%, ${0.5 * (1 - j / 14)})`;
				g.beginPath();
				g.arc(tp.x, tp.y, (5 - j * 0.25) / Math.max(k, 0.4), 0, Math.PI * 2);
				g.fill();
			}
			g.fillStyle = '#fff';
			g.beginPath();
			g.arc(head.x, head.y, 5 / Math.max(k, 0.4), 0, Math.PI * 2);
			g.fill();
			if (p >= 1) {
				comets.splice(i, 1);
				const el = dEls.get(c.id);
				if (el) {
					el.classList.remove('is-hit');
					void el.offsetWidth;
					el.classList.add('is-hit');
				}
			} else animating = true;
		}
		g.restore();
		if (animating) dirty();
	}

	// ---- data ----
	function addAgents(list) {
		const now = performance.now();
		for (const a of list) {
			if (!a?.id || S.agentIndex.has(a.id)) continue;
			const i = S.agents.length;
			const rec = { ...a, i, pos: agentPosition(i), size: agentSize(a.chat_count), hue: 230 + (hash32(a.id) % 90), born: now + Math.min(600, i * 3) };
			S.agents.push(rec);
			S.agentIndex.set(a.id, rec);
		}
		renderCore();
		renderDistrict('chat');
		renderDistrict('marketplace');
		updateFocus();
		dirty();
	}

	async function guard(key, fn, after) {
		try {
			S.err[key] = false;
			await fn();
		} catch (err) {
			if (err?.name === 'AbortError') return;
			S.err[key] = true;
			console.warn(`[field] ${key} feed failed`, err);
		}
		after?.();
		renderStatus();
	}

	const loaders = {
		stats: () => guard('stats', async () => (S.stats = await loadStats()), () => { renderCore(); renderDistrict('launcher'); renderDistrict('marketplace'); }),
		token: () => guard('token', async () => (S.token = await loadToken()), () => renderDistrict('trenches')),
		avatars: () => guard('avatars', async () => (S.avatars = await loadAvatars(8)), () => renderDistrict('gallery')),
		launches: () => guard('launches', async () => (S.launches = await loadLaunches(4)), () => renderDistrict('launcher')),
		agents: () => guard('agents', () => streamAgents(addAgents, { maxPages: 8 }), () => { S.agentsDone = true; }),
		pulse: () => guard('pulse', async () => {
			const r = await loadPulse({ limit: 50 });
			S.events = r.events;
			S.head = r.head || 'none';
		}, () => { renderDistrict('pulse'); dirty(); }),
		account: async () => {
			S.account = await loadAccount();
			renderAccount();
			renderDistrict('dashboard');
		},
		pages: async () => (S.pages = await loadPages()),
	};

	async function pollPulse() {
		if (document.hidden || S.err.pulse || !S.head || S.head === 'none') return;
		try {
			const r = await loadPulse({ since: S.head, limit: 20 });
			if (r.head) S.head = r.head;
			if (!r.events.length) return;
			const fresh = r.events.filter((e) => !S.events.some((x) => x.id === e.id));
			S.events = [...fresh, ...S.events].slice(0, 200);
			for (const e of fresh.slice(0, 6)) {
				const d = district(districtForEvent(e.kind));
				if (d) comets.push({ q: curve(eventOrigin(e), { x: d.x, y: d.y }), hue: d.hue, id: d.id, t0: performance.now() + comets.length * 260 });
			}
			renderDistrict('pulse');
			renderStatus();
			dirty();
		} catch (err) {
			console.warn('[field] pulse poll failed', err);
		}
	}

	// ---- surfaces: open a real page in place ----
	const sBody = surface.querySelector('.fd-surface-body');
	const sTitle = surface.querySelector('.fd-surface-title');
	const sPath = surface.querySelector('.fd-surface-path');
	const sTab = surface.querySelector('.fd-surface-tab');
	const sLoad = surface.querySelector('.fd-surface-load');
	let frame = null;
	let openFrom = null;

	/**
	 * Dive into a surface. Flies to `rect` first when given (the district card
	 * or an agent's light), then opens the page over the map.
	 */
	async function dive({ title, href, hue = 262, id = 'page', rect = null, push = true }) {
		closeResults();
		hideTip();
		openFrom = { cam: { ...cam }, rect };
		const f = document.createElement('iframe');
		f.className = 'fd-frame';
		// The name tells the framed page it is inside the shell, so it drops its own header (public/nav.js).
		f.name = `tws-os:${id}`;
		f.title = title;
		f.allow = 'clipboard-read; clipboard-write; fullscreen; microphone; camera; xr-spatial-tracking; web-share';
		f.src = href;
		f.addEventListener('load', () => onFrameLoad(f));
		if (frame) frame.remove();
		frame = f;
		sLoad.hidden = false;
		sLoad.querySelector('span').textContent = `Opening ${title}`;
		sBody.append(f);
		setSurfaceMeta(title, href, hue);
		if (rect) await flyTo(fitRect(rect, vw, vh, 0), { duration: reduced ? 0 : 520 });
		surface.hidden = false;
		root.classList.add('is-inside');
		requestAnimationFrame(() => surface.classList.add('is-open'));
		crumb.textContent = title;
		if (push) history.pushState({ fd: 'surface', href, title, id, hue }, '', `/?go=${encodeURIComponent(href)}`);
		surface.querySelector('.fd-back').focus({ preventScroll: true });
	}

	function setSurfaceMeta(title, href, hue) {
		sTitle.textContent = title;
		sPath.textContent = href;
		sTab.href = href;
		surface.style.setProperty('--hue', hue);
	}

	function onFrameLoad(f) {
		sLoad.hidden = true;
		try {
			const w = f.contentWindow;
			const path = w.location.pathname + w.location.search;
			if (path && path !== 'blank') {
				const title = (w.document.title || '').split(/\s[|:·-]\s|: /)[0].trim() || sTitle.textContent;
				setSurfaceMeta(title, path, surface.style.getPropertyValue('--hue') || 262);
				crumb.textContent = title;
				if (history.state?.fd === 'surface') history.replaceState({ ...history.state, href: path, title }, '', `/?go=${encodeURIComponent(path)}`);
			}
			// Esc inside the page returns to the map, unless the page is using Esc itself.
			w.addEventListener('keydown', (e) => {
				if (e.key === 'Escape' && !e.defaultPrevented && !w.document.querySelector('dialog[open], [aria-modal="true"]')) close();
			});
		} catch {
			// A cross-origin redirect inside the frame: keep the last known title.
		}
	}

	async function closeSurface({ pop = false } = {}) {
		if (surface.hidden) return;
		surface.classList.remove('is-open');
		root.classList.remove('is-inside');
		const done = () => {
			surface.hidden = true;
			frame?.remove();
			frame = null;
		};
		if (reduced) done();
		else setTimeout(done, 260);
		if (!pop && history.state?.fd === 'surface') history.back();
		const back = openFrom?.cam && openFrom.rect ? openFrom.cam : null;
		openFrom = null;
		updateFocus();
		if (back) await flyTo(back, { duration: reduced ? 0 : 560 });
		else crumb.textContent = 'Field';
	}
	function close() {
		closeSurface();
	}

	addEventListener('popstate', (e) => {
		const st = e.state;
		if (st?.fd === 'surface') dive({ ...st, push: false });
		else closeSurface({ pop: true });
	});
	surface.querySelector('.fd-back').addEventListener('click', close);

	function diveDistrict(id) {
		const d = district(id) || (id === CORE.id ? null : null);
		if (id === CORE.id || id === 'discover') return dive({ title: 'Agents', href: '/discover', hue: CORE.hue, id: 'discover', rect: coreRect() });
		if (!d) return;
		return dive({ title: d.title, href: d.href, hue: d.hue, id: d.id, rect: d.rect });
	}
	function coreRect() {
		const r = coreRadius(Math.max(shown(), 48));
		return { x: -r, y: -r, w: r * 2, h: r * 2 };
	}
	function diveAgent(a) {
		const r = Math.max(a.size, 10) * 3;
		return dive({ title: a.name, href: a.home_url || `/agents/${a.id}`, hue: a.hue, id: 'agent', rect: { x: a.pos.x - r, y: a.pos.y - r, w: r * 2, h: r * 2 } });
	}

	// Clicks inside the map: links dive in place; modifier clicks keep the browser default.
	root.addEventListener('click', (e) => {
		const retry = e.target.closest('[data-retry]');
		if (retry) {
			loaders[retry.dataset.retry]?.();
			return;
		}
		const copy = e.target.closest('[data-copy]');
		if (copy) {
			navigator.clipboard?.writeText(copy.dataset.copy).then(
				() => flash(copy, 'Copied'),
				() => flash(copy, 'Press Ctrl+C'),
			);
			return;
		}
		const tag = e.target.closest('.fd-d-tag');
		if (tag) {
			const d = district(tag.closest('.fd-d').dataset.id);
			if (d) flyTo(nearCam(d));
			return;
		}
		const a = e.target.closest('a[data-dive], a[data-dive-path], button[data-dive-path]');
		if (!a || e.metaKey || e.ctrlKey || e.shiftKey || e.button === 1) return;
		e.preventDefault();
		if (a.dataset.dive) return diveDistrict(a.dataset.dive);
		const dEl = a.closest('.fd-d');
		const d = dEl ? district(dEl.dataset.id) : null;
		dive({ title: a.dataset.title || a.textContent.trim(), href: a.dataset.divePath, hue: d?.hue ?? CORE.hue, id: d?.id || 'page', rect: d?.rect || (a.closest('.fd-core-tag') ? coreRect() : null) });
	});
	root.addEventListener('submit', (e) => {
		const form = e.target.closest('.fd-forge');
		if (!form) return;
		e.preventDefault();
		const prompt = String(new FormData(form).get('prompt') || '').trim();
		const d = district('forge');
		dive({ title: 'Forge', href: prompt ? `/forge?prompt=${encodeURIComponent(prompt)}` : '/forge', hue: d.hue, id: 'forge', rect: d.rect });
	});

	// ---- input: pan, zoom, pinch, hover, click ----
	const pointers = new Map();
	let drag = null;
	let pinch = null;
	const interactive = (t) => t.closest('a, button, input, textarea, select, form, .fd-d-card, .fd-surface, .fd-top, .fd-ask, .fd-zoom');

	root.addEventListener('pointerdown', (e) => {
		if (!surface.hidden || e.button > 0) return;
		const onCard = e.target.closest('.fd-d-card');
		if (interactive(e.target) && !(onCard && !e.target.closest('a, button, input, form'))) return;
		cancelFlight();
		root.setPointerCapture?.(e.pointerId);
		pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
		if (pointers.size === 1) drag = { x: e.clientX, y: e.clientY, cx: cam.x, cy: cam.y, moved: 0, t: performance.now(), vx: 0, vy: 0 };
		else if (pointers.size === 2) {
			const [p1, p2] = [...pointers.values()];
			pinch = { d: Math.hypot(p1.x - p2.x, p1.y - p2.y), k: cam.k, mx: (p1.x + p2.x) / 2, my: (p1.y + p2.y) / 2, cam: { ...cam } };
			drag = null;
		}
	});
	root.addEventListener('pointermove', (e) => {
		if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
		if (pinch && pointers.size === 2) {
			const [p1, p2] = [...pointers.values()];
			const d = Math.hypot(p1.x - p2.x, p1.y - p2.y);
			const mx = (p1.x + p2.x) / 2;
			const my = (p1.y + p2.y) / 2;
			const z = zoomAt(pinch.cam, vw, vh, pinch.mx, pinch.my, d / pinch.d);
			cam = { k: z.k, x: z.x - (mx - pinch.mx) / z.k, y: z.y - (my - pinch.my) / z.k };
			applyCam();
			return;
		}
		if (drag) {
			const dx = e.clientX - drag.x;
			const dy = e.clientY - drag.y;
			drag.moved = Math.max(drag.moved, Math.hypot(dx, dy));
			if (drag.moved > 3) {
				root.classList.add('is-dragging');
				const now = performance.now();
				const nx = drag.cx - dx / cam.k;
				const ny = drag.cy - dy / cam.k;
				const dt = Math.max(1, now - drag.t);
				drag.vx = ((nx - cam.x) / dt) * 16;
				drag.vy = ((ny - cam.y) / dt) * 16;
				drag.t = now;
				cam = { ...cam, x: nx, y: ny };
				applyCam();
				hideTip();
			}
			return;
		}
		if (e.pointerType === 'mouse' && surface.hidden) hoverAt(e.clientX, e.clientY);
	});
	function endPointer(e) {
		pointers.delete(e.pointerId);
		if (pinch && pointers.size < 2) pinch = null;
		if (!drag || pointers.size) return;
		const d = drag;
		drag = null;
		root.classList.remove('is-dragging');
		if (d.moved <= 3 && e.type === 'pointerup') {
			const a = agentAt(e.clientX, e.clientY);
			if (a) diveAgent(a);
			return;
		}
		// A flick keeps gliding.
		if (!reduced && Math.hypot(d.vx, d.vy) > 0.4) glide(d.vx, d.vy);
	}
	root.addEventListener('pointerup', endPointer);
	root.addEventListener('pointercancel', endPointer);
	root.addEventListener('pointerleave', (e) => e.pointerType === 'mouse' && hideTip());

	function glide(vx, vy) {
		const f = { raf: 0, resolve: () => {} };
		flight = f;
		const step = () => {
			vx *= 0.92;
			vy *= 0.92;
			cam = { ...cam, x: cam.x + vx, y: cam.y + vy };
			applyCam();
			if (Math.hypot(vx, vy) > 0.05 && flight === f) f.raf = requestAnimationFrame(step);
			else if (flight === f) flight = null;
		};
		f.raf = requestAnimationFrame(step);
	}

	root.addEventListener(
		'wheel',
		(e) => {
			if (!surface.hidden || e.target.closest('.fd-results, .fd-d-body .fd-list')) return;
			e.preventDefault();
			cancelFlight();
			hideTip();
			const px = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? vh : 1;
			const dy = e.deltaY * px;
			const dx = e.deltaX * px;
			// Pinch on a trackpad arrives as ctrl+wheel; a sideways two-finger swipe pans.
			if (!e.ctrlKey && Math.abs(dx) > Math.abs(dy)) {
				cam = { ...cam, x: cam.x + dx / cam.k, y: cam.y + dy / cam.k };
			} else {
				const factor = Math.exp(-dy * (e.ctrlKey ? 0.01 : 0.0018));
				cam = zoomAt(cam, vw, vh, e.clientX, e.clientY, factor);
			}
			applyCam();
		},
		{ passive: false },
	);
	root.addEventListener('dblclick', (e) => {
		if (interactive(e.target) || !surface.hidden) return;
		const target = zoomAt(cam, vw, vh, e.clientX, e.clientY, e.shiftKey ? 0.5 : 2.2);
		flyTo(target, { duration: 420 });
	});

	function agentAt(sx, sy) {
		if (!S.agents.length) return null;
		const p = screenToWorld(cam, vw, vh, sx, sy);
		let best = null;
		let bestD = Infinity;
		const cap = shown();
		for (const a of S.agents) {
			if (a.i >= cap) break;
			const d = Math.hypot(a.pos.x - p.x, a.pos.y - p.y);
			const reach = Math.max(a.size * 1.3, 9 / cam.k);
			if (d < reach && d < bestD) {
				best = a;
				bestD = d;
			}
		}
		return best;
	}
	function hoverAt(sx, sy) {
		const el = document.elementFromPoint(sx, sy);
		const a = el === sky || el === root || el === world ? agentAt(sx, sy) : null;
		if (a !== hover) {
			hover = a;
			root.classList.toggle('is-pointing', !!a);
			dirty();
		}
		if (!a) return hideTip();
		tip.hidden = false;
		tip.innerHTML = `${face(a.avatar_thumbnail, a.name)}<div><b>${esc(clip(a.name, 40))}</b><span>${esc(clip(a.description || 'three.ws agent', 80))}</span><em>${fmtCount(a.chat_count || 0)} chats · joined ${relTime(a.created_at)}${relTime(a.created_at) === 'now' ? '' : ' ago'}</em></div>`;
		const x = Math.min(vw - 300, sx + 16);
		const y = Math.min(vh - 110, sy + 16);
		tip.style.transform = `translate(${x}px, ${y}px)`;
	}
	function hideTip() {
		if (!tip.hidden) tip.hidden = true;
		if (hover) {
			hover = null;
			root.classList.remove('is-pointing');
			dirty();
		}
	}

	// ---- zoom controls ----
	root.querySelector('.fd-zoom').addEventListener('click', (e) => {
		const z = e.target.closest('[data-z]')?.dataset.z;
		if (z === 'home') flyTo(homeCam());
		else if (z) flyTo(zoomAt(cam, vw, vh, vw / 2, vh / 2, z === 'in' ? 1.8 : 1 / 1.8), { duration: 360 });
	});

	// ---- search ----
	let found = [];
	let sel = 0;
	function closeResults() {
		results.hidden = true;
		input.setAttribute('aria-expanded', 'false');
		input.removeAttribute('aria-activedescendant');
	}
	function showResults() {
		found = searchField(input.value, { districts: [CORE, ...districts], agents: S.agents, pages: S.pages }, 8);
		sel = 0;
		if (!found.length) {
			results.innerHTML = `<li class="fd-r-none" role="option" aria-disabled="true">Nothing on the map matches "${esc(clip(input.value, 40))}". Press Enter to search every agent.</li>`;
		} else {
			results.innerHTML = found
				.map((r, i) => `<li id="fd-r-${i}" role="option" class="fd-r" data-i="${i}" aria-selected="${i === sel}"><span class="fd-r-type">${r.type === 'district' ? 'Place' : r.type === 'agent' ? 'Agent' : 'Page'}</span><b>${esc(clip(r.title, 48))}</b><span class="fd-r-sub">${esc(clip(r.sub, 70))}</span></li>`)
				.join('');
		}
		results.hidden = false;
		input.setAttribute('aria-expanded', 'true');
		markSel();
	}
	function markSel() {
		results.querySelectorAll('.fd-r').forEach((li, i) => li.setAttribute('aria-selected', String(i === sel)));
		if (found.length) input.setAttribute('aria-activedescendant', `fd-r-${sel}`);
	}
	async function choose(r) {
		closeResults();
		input.value = '';
		input.blur();
		if (!r) return;
		if (r.type === 'district') {
			if (r.id === CORE.id) {
				await flyTo(fitRect(coreRect(), vw, vh, 40));
				return;
			}
			const d = district(r.id);
			if (d) await flyTo(nearCam(d));
			return;
		}
		if (r.type === 'agent') {
			const a = S.agentIndex.get(r.id);
			if (a) {
				const near = 46;
				await flyTo(fitRect({ x: a.pos.x - near, y: a.pos.y - near, w: near * 2, h: near * 2 }, vw, vh, 60));
				hover = a;
				dirty();
				return;
			}
		}
		dive({ title: r.title, href: r.href, hue: CORE.hue, id: 'page' });
	}
	input.addEventListener('input', showResults);
	input.addEventListener('focus', showResults);
	input.addEventListener('blur', () => setTimeout(closeResults, 120));
	input.addEventListener('keydown', (e) => {
		if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
			e.preventDefault();
			if (!found.length) return;
			sel = (sel + (e.key === 'ArrowDown' ? 1 : found.length - 1)) % found.length;
			markSel();
		} else if (e.key === 'Escape') {
			input.value = '';
			input.blur();
		}
	});
	ask.addEventListener('submit', (e) => {
		e.preventDefault();
		const q = input.value.trim();
		if (found[sel]) choose(found[sel]);
		else if (q) {
			closeResults();
			input.value = '';
			dive({ title: 'Agents', href: `/discover?q=${encodeURIComponent(q)}`, hue: CORE.hue, id: 'discover' });
		}
	});
	results.addEventListener('pointerdown', (e) => {
		const li = e.target.closest('.fd-r');
		if (!li) return;
		e.preventDefault();
		choose(found[Number(li.dataset.i)]);
	});

	// ---- keyboard ----
	addEventListener('keydown', (e) => {
		const typing = e.target.closest?.('input, textarea, select, [contenteditable="true"]');
		if (!surface.hidden) {
			if (e.key === 'Escape' && !typing) close();
			return;
		}
		if (typing) return;
		if (e.key === '/' || (e.key.length === 1 && /\S/.test(e.key) && !e.metaKey && !e.ctrlKey && !e.altKey && !'+-=0'.includes(e.key))) {
			e.preventDefault();
			input.focus();
			if (e.key !== '/') {
				input.value = e.key;
				showResults();
			}
			return;
		}
		const step = 120 / cam.k;
		const k = e.key;
		if (k === 'ArrowLeft') cam = { ...cam, x: cam.x - step };
		else if (k === 'ArrowRight') cam = { ...cam, x: cam.x + step };
		else if (k === 'ArrowUp') cam = { ...cam, y: cam.y - step };
		else if (k === 'ArrowDown') cam = { ...cam, y: cam.y + step };
		else if (k === '+' || k === '=') return flyTo(zoomAt(cam, vw, vh, vw / 2, vh / 2, 1.8), { duration: 320 });
		else if (k === '-') return flyTo(zoomAt(cam, vw, vh, vw / 2, vh / 2, 1 / 1.8), { duration: 320 });
		else if (k === '0' || k === 'Home') return flyTo(homeCam());
		else if (k === 'Escape') return flyTo(homeCam());
		else if (k === 'Enter' && focusId && !e.target.closest('a, button')) return diveDistrict(focusId);
		else return;
		e.preventDefault();
		cancelFlight();
		applyCam();
	});

	// Tabbing onto a district flies the camera to it, so keyboard users travel the map too.
	root.addEventListener('focusin', (e) => {
		const el = e.target.closest('.fd-d');
		if (!el || drag) return;
		const d = district(el.dataset.id);
		if (d && focusId !== d.id) flyTo(nearCam(d), { duration: 480 });
	});

	// ---- sizing ----
	function resize() {
		const ringBefore = ringFor(vw, vh);
		vw = innerWidth;
		vh = innerHeight;
		dpr = Math.min(2, devicePixelRatio || 1);
		sky.width = Math.round(vw * dpr);
		sky.height = Math.round(vh * dpr);
		sky.style.width = `${vw}px`;
		sky.style.height = `${vh}px`;
		const ringNow = ringFor(vw, vh);
		if (ringNow !== ringBefore) {
			districts = layoutDistricts(DISTRICTS, ringNow);
			buildDistricts();
			renderCore();
			cam = homeCam();
		}
		applyCam();
	}
	addEventListener('resize', resize);
	new MutationObserver(() => {
		palette = null;
		dirty();
	}).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

	// ---- start ----
	buildDistricts();
	renderCore();
	renderStatus();
	resize();
	Object.values(loaders).forEach((fn) => fn());
	setInterval(pollPulse, PULSE_POLL_MS);
	setInterval(() => !document.hidden && loaders.token(), TOKEN_POLL_MS);
	// Relative times ("3m") age while the page sits open.
	setInterval(() => {
		if (document.hidden) return;
		['pulse', 'launcher', 'gallery'].forEach(renderDistrict);
		renderStatus();
	}, 60_000);

	// Arrival: start pulled back past the whole map and settle onto it, unless a link asked for a surface.
	const link = deepLink(location.search, [CORE.id, ...districts.map((d) => d.id)]);
	if (link?.type === 'district') {
		history.replaceState(null, '', '/');
		diveDistrict(link.id);
	} else if (link?.type === 'page') {
		history.replaceState(null, '', '/');
		dive({ title: 'three.ws', href: link.href, hue: CORE.hue, id: 'page' });
	} else if (!reduced) {
		const home = homeCam();
		cam = { ...home, k: home.k * 0.45 };
		applyCam();
		flyTo(home, { duration: 1400 });
	}

	return { flyTo, dive, close };
}
