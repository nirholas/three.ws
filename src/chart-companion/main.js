// Chart Companion: a live DEXTools chart with a 3D agent beside it that reacts
// to every real swap on the coin.
//
// Data path (all real, all keyless):
//   /api/coin/pair            pair address -> the token it trades (+ symbol)
//   /api/coin/pool            token -> its most liquid pool (the chart's pair)
//   /api/pump/price-history   15m candles -> 24h range, so "new high" is real
//   /api/pump/dex-trades      recent swaps, polled -> reactions (./reactor.js)
//
// Three modes from one URL:
//   (default)   the full page: chart, avatar, live reaction feed, share tools
//   ?embed=1    chart + avatar only, framable on any site
//   ?overlay=1  avatar + speech bubble on a transparent background, sized for
//               an OBS browser source over a streamer's own chart
//
// Addressed like /coin3d: ?pair=<DEXTools pair>, ?mint=<token>, or ?url=<a
// pasted DEXTools link>. With none, it watches $THREE.

import './chart-companion.css';
import { createReactor, fmtUsd, fmtPrice, fmtPct } from './reactor.js';
import { chartEmbedUrls } from '../shared/chart-embeds.js';
import { watchEmbed, embedFallbackNode } from '../shared/embed-guard.js';
import { dextoolsTokenUrl } from '../shared/trading-terminals.js';
import { parseTarget, SOL_RE } from './target.js';

const THREE_MINT = 'FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump';
const POLL_MS = 5000;
const FEED_MAX = 40;
const AGENT_SCRIPT = 'https://three.ws/agent-3d/latest/agent-3d.js';
const CLIP_MANIFEST = '/animations/manifest.json';

/** Humanoid bodies the shared clip library retargets cleanly. */
const AVATARS = {
	default: { label: 'Default', glb: '/avatars/default.glb' },
	michelle: { label: 'Michelle', glb: '/avatars/michelle.glb' },
	'realistic-female': { label: 'Realistic (F)', glb: '/avatars/realistic-female.glb' },
	'realistic-male': { label: 'Realistic (M)', glb: '/avatars/realistic-male.glb' },
	mannequin: { label: 'Mannequin', glb: '/avatars/mannequin.glb' },
};

const params = new URLSearchParams(location.search);
const MODE = params.get('overlay') === '1' ? 'overlay' : params.get('embed') === '1' ? 'embed' : 'page';
const AGENT_ID = (params.get('agent') || '').trim();
const AVATAR_KEY = AVATARS[params.get('avatar')] ? params.get('avatar') : 'default';
const REDUCED_MOTION = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const $ = (sel, root = document) => root.querySelector(sel);

function el(tag, attrs = {}, children = []) {
	const n = document.createElement(tag);
	for (const [k, v] of Object.entries(attrs)) {
		if (v == null || v === false) continue;
		if (k === 'text') n.textContent = v;
		else if (k === 'class') n.className = v;
		else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
		else n.setAttribute(k, v === true ? '' : v);
	}
	for (const c of [].concat(children)) if (c != null) n.append(c);
	return n;
}

const short = (a) => (a && a.length > 10 ? `${a.slice(0, 4)}…${a.slice(-4)}` : a || '');

async function getJson(url) {
	const r = await fetch(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(12_000) });
	if (r.status === 404) return null;
	if (!r.ok) throw Object.assign(new Error(`${url.split('?')[0]} answered ${r.status}`), { status: r.status });
	return r.json();
}

const pairInfo = (pair) => getJson(`/api/coin/pair?address=${encodeURIComponent(pair)}&network=solana`);
const topPool = async (mint) => (await getJson(`/api/coin/pool?address=${encodeURIComponent(mint)}&network=solana`))?.pool || null;

/**
 * @returns {Promise<{ mint: string, pair: string|null, symbol: string, name: string, pairName: string }>}
 */
async function resolveMarket(target) {
	if (target.pair || target.address) {
		const info = await pairInfo(target.pair || target.address);
		if (info?.token?.address) {
			return {
				mint: info.token.address,
				pair: info.pair || target.pair || target.address,
				symbol: info.token.symbol || '',
				name: info.token.name || '',
				pairName: info.pairName || '',
			};
		}
		if (target.pair) throw new Error('No indexed market for that pair yet. A brand-new pair can take a few minutes to appear.');
	}
	const mint = target.mint || target.address;
	const pair = await topPool(mint);
	const info = pair ? await pairInfo(pair).catch(() => null) : null;
	return {
		mint,
		pair,
		symbol: info?.token?.symbol || '',
		name: info?.token?.name || '',
		pairName: info?.pairName || '',
	};
}

function initialTarget() {
	if (params.get('url')) return parseTarget(params.get('url'));
	if (params.get('pair')) {
		const t = parseTarget(params.get('pair'));
		return t.address ? { pair: t.address } : t;
	}
	if (params.get('mint')) return SOL_RE.test(params.get('mint').trim()) ? { mint: params.get('mint').trim() } : { error: 'That mint is not a valid Solana address.' };
	return { mint: THREE_MINT };
}

// ── URLs for sharing ────────────────────────────────────────────────────────

function companionUrl(market, extra = {}) {
	const q = new URLSearchParams();
	if (market.pair) q.set('pair', market.pair);
	else q.set('mint', market.mint);
	if (AGENT_ID) q.set('agent', AGENT_ID);
	else if (AVATAR_KEY !== 'default') q.set('avatar', AVATAR_KEY);
	for (const [k, v] of Object.entries(extra)) q.set(k, v);
	return `${location.origin}/chart-companion?${q}`;
}

// ── the avatar ──────────────────────────────────────────────────────────────

let agentScript = null;
function loadAgentElement() {
	if (customElements.get('agent-3d')) return Promise.resolve();
	agentScript ||= new Promise((resolve, reject) => {
		const s = el('script', { type: 'module', src: AGENT_SCRIPT });
		s.addEventListener('load', resolve);
		s.addEventListener('error', () => reject(new Error('The 3D runtime did not load.')));
		document.head.append(s);
	}).then(() => customElements.whenDefined('agent-3d'));
	return agentScript;
}

async function clipDurations() {
	try {
		const list = await getJson(CLIP_MANIFEST);
		return new Map((list || []).map((c) => [c.name, { ms: (Number(c.duration) || 2) * 1000, loop: !!c.loop }]));
	} catch {
		return new Map();
	}
}

/**
 * Plays reactions on the avatar without letting a burst of trades thrash it:
 * a reaction interrupts only a lower-priority one, and looping clips are
 * ended by hand and settled back to idle.
 */
function createPerformer(host, bubble, { onSpeak }) {
	let agent = null;
	let ready = false;
	let busyUntil = 0;
	let busyPriority = 0;
	let settleTimer = null;
	let bubbleTimer = null;
	let durations = new Map();

	async function mount() {
		host.classList.remove('is-error');
		host.classList.add('is-loading');
		durations = await clipDurations();
		try {
			await loadAgentElement();
		} catch (err) {
			fail(err.message);
			return;
		}
		agent = document.createElement('agent-3d');
		if (AGENT_ID) agent.setAttribute('agent-id', AGENT_ID);
		else agent.setAttribute('body', AVATARS[AVATAR_KEY].glb);
		agent.setAttribute('background', 'transparent');
		agent.setAttribute('eager', '');
		agent.setAttribute('mode', 'inline');
		agent.setAttribute('height', '100%');
		agent.setAttribute('responsive', 'false');
		agent.setAttribute('kiosk', '');
		agent.addEventListener('agent:ready', () => {
			ready = true;
			host.classList.remove('is-loading');
			host.classList.add('is-ready');
		});
		agent.addEventListener('agent:error', () => fail('This avatar could not load. Try another one from the picker.'));
		host.querySelector('.cc-stage-slot').replaceChildren(agent);
	}

	function fail(msg) {
		host.classList.remove('is-loading');
		host.classList.add('is-error');
		$('.cc-stage-error-msg', host).textContent = msg;
	}

	function say(line) {
		bubble.textContent = line;
		bubble.classList.remove('is-on');
		void bubble.offsetWidth; // restart the entrance transition
		bubble.classList.add('is-on');
		clearTimeout(bubbleTimer);
		bubbleTimer = setTimeout(() => bubble.classList.remove('is-on'), 6500);
	}

	/** @returns {boolean} whether the reaction was performed (vs. dropped as noise) */
	function perform(reaction) {
		const now = Date.now();
		if (now < busyUntil && reaction.priority <= busyPriority) return false;
		const d = durations.get(reaction.clip);
		const ms = reaction.holdMs || d?.ms || 2500;
		busyUntil = now + Math.min(ms, 7000);
		busyPriority = reaction.priority;
		say(reaction.line);
		onSpeak(reaction.line);
		if (ready && agent) {
			clearTimeout(settleTimer);
			try {
				agent.playClip(reaction.clip, { fade_ms: 250 });
				if (reaction.emotion) agent.expressEmotion(reaction.emotion[0], reaction.emotion[1]);
				if (reaction.holdMs || d?.loop) settleTimer = setTimeout(() => agent.playClip('idle', { fade_ms: 500 }), ms);
			} catch {
				// A clip the rig cannot take still leaves the line on screen.
			}
		}
		return true;
	}

	function swap(key) {
		const url = new URL(location.href);
		url.searchParams.delete('agent');
		if (key === 'default') url.searchParams.delete('avatar');
		else url.searchParams.set('avatar', key);
		location.assign(url);
	}

	return { mount, perform, swap, get ready() { return ready; } };
}

// ── voice ───────────────────────────────────────────────────────────────────

function createVoice() {
	const supported = 'speechSynthesis' in window;
	let on = supported && params.get('voice') === '1';
	return {
		supported,
		get on() { return on; },
		toggle() {
			on = supported && !on;
			if (!on) speechSynthesis.cancel();
			return on;
		},
		speak(line) {
			if (!on) return;
			speechSynthesis.cancel();
			const u = new SpeechSynthesisUtterance(line);
			u.rate = 1.08;
			u.pitch = 1.05;
			speechSynthesis.speak(u);
		},
	};
}

// ── the DEXTools chart ──────────────────────────────────────────────────────

function mountChart(host, market) {
	const theme = document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
	const urls = market.pair && chartEmbedUrls('dextools', { chain: 'solana', token: market.mint, pool: market.pair, theme });
	const openHref = dextoolsTokenUrl(market.mint, { from: 'chart-companion' });
	let cancel = () => {};
	const fail = () => {
		cancel();
		host.classList.remove('is-ready');
		host.replaceChildren(embedFallbackNode({
			name: 'The DEXTools chart',
			href: openHref,
			label: 'Open the chart on DEXTools',
			onRetry: () => mountChart(host, market),
			className: 'cc-chart-state',
			buttonClassName: 'cc-btn',
		}));
	};
	if (!urls) {
		host.replaceChildren(el('div', { class: 'cc-chart-state', role: 'status' }, [
			el('p', { text: 'This coin has no pool to chart yet. The companion still reacts to its swaps as they land.' }),
			el('a', { class: 'cc-btn', href: openHref, target: '_blank', rel: 'noopener', text: 'Check DEXTools ↗' }),
		]));
		return;
	}
	const frame = el('iframe', {
		class: 'cc-chart-frame',
		src: urls.embed,
		title: `${market.symbol ? `$${market.symbol.toUpperCase()}` : 'Token'} live chart by DEXTools`,
		allow: 'clipboard-write; fullscreen',
	});
	// DEXTools' edge refuses a loopback Referer; every deployed origin sends its own.
	frame.referrerPolicy = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname) ? 'no-referrer' : 'strict-origin-when-cross-origin';
	frame.addEventListener('load', () => { cancel(); host.classList.add('is-ready'); });
	frame.addEventListener('error', fail);
	host.replaceChildren(el('div', { class: 'cc-skel cc-chart-skel' }), frame);
	cancel = watchEmbed(host, { onTimeout: fail });
}

// ── feed + stats ────────────────────────────────────────────────────────────

const KIND_TONE = {
	whaleBuy: 'up', bigBuy: 'up', buyStreak: 'up', newHigh: 'up',
	whaleSell: 'down', bigSell: 'down', sellStreak: 'down',
	greeting: 'neutral', quiet: 'neutral',
};

function timeAgo(ms) {
	const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
	if (s < 60) return `${s}s ago`;
	const m = Math.round(s / 60);
	return m < 60 ? `${m}m ago` : `${Math.round(m / 60)}h ago`;
}

function feedItem(r) {
	const sig = r.trade?.signature;
	return el('li', { class: `cc-feed-item tone-${KIND_TONE[r.kind] || 'neutral'}`, 'data-at': String(r.at) }, [
		el('span', { class: 'cc-feed-dot', 'aria-hidden': 'true' }),
		el('span', { class: 'cc-feed-line', text: r.line }),
		el('span', { class: 'cc-feed-meta' }, [
			el('time', { class: 'cc-feed-time', text: timeAgo(r.at) }),
			sig ? el('a', { class: 'cc-feed-proof', href: `https://solscan.io/tx/${encodeURIComponent(sig)}`, target: '_blank', rel: 'noopener', title: 'See this swap on-chain', text: 'tx ↗' }) : null,
		]),
	]);
}

function renderStats(stats) {
	const set = (key, val, tone) => {
		for (const n of document.querySelectorAll(`[data-stat="${key}"]`)) {
			if (n.textContent !== val) {
				n.textContent = val;
				n.classList.remove('flash');
				void n.offsetWidth;
				n.classList.add('flash');
			}
			if (tone !== undefined) n.dataset.tone = tone;
		}
	};
	set('price', stats.lastPrice ? fmtPrice(stats.lastPrice) : '-');
	set('change', stats.change24 == null ? '-' : fmtPct(stats.change24), stats.change24 == null ? '' : stats.change24 >= 0 ? 'up' : 'down');
	set('trades', `${stats.buys} / ${stats.sells}`);
	const net = stats.buyUsd - stats.sellUsd;
	set('net', `${net >= 0 ? '+' : '-'}${fmtUsd(net)}`, net >= 0 ? 'up' : 'down');
	set('biggest', stats.biggest ? `${fmtUsd(stats.biggest.sol_value_usd)} ${stats.biggest.is_buy ? 'buy' : 'sell'}` : '-');
}

// ── page shell ──────────────────────────────────────────────────────────────

async function copy(text, btn) {
	const label = btn.textContent;
	try {
		await navigator.clipboard.writeText(text);
		btn.textContent = 'Copied';
	} catch {
		btn.textContent = 'Copy failed';
	}
	setTimeout(() => { btn.textContent = label; }, 1500);
}

function wireControls(market, voice, performer) {
	const form = $('#cc-form');
	form?.addEventListener('submit', (e) => {
		e.preventDefault();
		const input = $('#cc-input');
		const t = parseTarget(input.value);
		const msg = $('#cc-form-msg');
		if (t.error) {
			msg.textContent = t.error;
			input.setAttribute('aria-invalid', 'true');
			input.focus();
			return;
		}
		const q = new URLSearchParams();
		if (t.pair) q.set('pair', t.pair);
		else q.set('mint', t.address);
		if (params.get('avatar')) q.set('avatar', params.get('avatar'));
		if (AGENT_ID) q.set('agent', AGENT_ID);
		location.assign(`/chart-companion?${q}`);
	});
	$('#cc-input')?.addEventListener('input', (e) => {
		e.target.removeAttribute('aria-invalid');
		$('#cc-form-msg').textContent = '';
	});

	const voiceBtn = $('#cc-voice');
	if (voiceBtn) {
		if (!voice.supported) voiceBtn.hidden = true;
		const paint = () => {
			voiceBtn.setAttribute('aria-pressed', String(voice.on));
			voiceBtn.textContent = voice.on ? 'Voice on' : 'Voice off';
		};
		paint();
		voiceBtn.addEventListener('click', () => { voice.toggle(); paint(); if (voice.on) voice.speak('Voice on. I will call out the big trades.'); });
	}

	const pick = $('#cc-avatar');
	if (pick) {
		for (const [key, a] of Object.entries(AVATARS)) pick.append(el('option', { value: key, text: a.label, selected: !AGENT_ID && key === AVATAR_KEY }));
		if (AGENT_ID) pick.prepend(el('option', { value: '', text: 'Your agent', selected: true }));
		pick.addEventListener('change', () => pick.value && performer.swap(pick.value));
	}

	const dt = $('#cc-dextools');
	if (dt) dt.href = dextoolsTokenUrl(market.mint, { from: 'chart-companion' });

	$('#cc-copy-link')?.addEventListener('click', (e) => copy(companionUrl(market), e.currentTarget));
	$('#cc-copy-overlay')?.addEventListener('click', (e) => copy(companionUrl(market, { overlay: '1' }), e.currentTarget));
	$('#cc-copy-embed')?.addEventListener('click', (e) => copy(
		`<iframe src="${companionUrl(market, { embed: '1' })}" width="960" height="540" style="border:0;border-radius:12px" loading="lazy" allow="clipboard-write; fullscreen" title="Live chart companion by three.ws"></iframe>`,
		e.currentTarget,
	));
}

function paintIdentity(market) {
	const sym = market.symbol ? `$${market.symbol.toUpperCase()}` : short(market.mint);
	document.title = `${sym} Chart Companion · three.ws`;
	for (const n of document.querySelectorAll('[data-symbol]')) n.textContent = sym;
	const sub = $('#cc-sub');
	if (sub) sub.textContent = [market.name, market.pairName].filter(Boolean).join(' · ') || short(market.mint);
	const input = $('#cc-input');
	if (input && !input.value) input.placeholder = 'Paste a DEXTools link, pair, or mint';
	const full = $('#cc-full');
	if (full) full.href = companionUrl(market);
}

function showFatal(message) {
	document.body.classList.add('is-fatal');
	for (const n of document.querySelectorAll('h1[data-symbol]')) n.textContent = 'Chart Companion';
	$('#cc-sub').textContent = 'A 3D agent that reacts to every real swap';
	$('#cc-live').hidden = true;
	$('#cc-fatal-msg').textContent = message;
	$('#cc-fatal').hidden = false;
	$('#cc-input')?.focus();
}

// ── run ─────────────────────────────────────────────────────────────────────

async function run() {
	document.body.dataset.mode = MODE;
	if (MODE === 'page') {
		const nav = el('script', { src: '/nav.js' });
		document.body.append(nav);
	}

	const target = initialTarget();
	if (target.error) return showFatal(target.error);

	let market;
	try {
		market = await resolveMarket(target);
	} catch (err) {
		return showFatal(err.status === 429
			? 'Market data is busy right now. Give it a few seconds and reload.'
			: err.message || 'Could not find a market for that address.');
	}
	paintIdentity(market);

	const voice = createVoice();
	const performer = createPerformer($('#cc-stage'), $('#cc-bubble'), { onSpeak: (line) => voice.speak(line) });
	wireControls(market, voice, performer);
	$('#cc-stage-retry')?.addEventListener('click', () => performer.mount());
	if (MODE !== 'overlay') mountChart($('#cc-chart'), market);
	performer.mount();

	const reactor = createReactor({ symbol: market.symbol, now: () => Date.now() });
	const feed = $('#cc-feed');
	const seen = new Set();
	let primed = false;

	const post = (reactions) => {
		for (const r of reactions) {
			if (feed) {
				$('#cc-feed-empty')?.remove();
				feed.prepend(feedItem(r));
				while (feed.children.length > FEED_MAX) feed.lastElementChild.remove();
			}
		}
		const top = reactions[0];
		if (top) performer.perform(top);
	};

	try {
		const hist = await getJson(`/api/pump/price-history?mint=${encodeURIComponent(market.mint)}&interval=15m`);
		reactor.ingestCandles(hist?.data);
	} catch {
		// No candles just means no 24h baseline: the greeting skips the change
		// and "new high" waits for one. Reactions to swaps are unaffected.
	}
	renderStats(reactor.stats);

	const live = $('#cc-live');
	let misses = 0;
	async function poll() {
		try {
			const body = await getJson(`/api/pump/dex-trades?mint=${encodeURIComponent(market.mint)}&limit=40`);
			misses = 0;
			const trades = (body?.trades || []).filter((t) => t.signature && !seen.has(t.signature));
			for (const t of trades) seen.add(t.signature);
			if (seen.size > 4000) {
				const keep = [...seen].slice(-2000);
				seen.clear();
				keep.forEach((s) => seen.add(s));
			}
			if (!primed) {
				// The backlog sizes the tape; it does not get cheered.
				reactor.prime(trades);
				primed = true;
				post([reactor.greeting()]);
			} else if (trades.length) {
				post(reactor.ingestTrades(trades));
			} else {
				const q = reactor.tick();
				if (q) post([q]);
			}
			live?.classList.toggle('is-stale', body?.stale === true);
			renderStats(reactor.stats);
		} catch {
			misses += 1;
			live?.classList.add('is-stale');
			if (misses === 3 && feed && !feed.children.length) {
				feed.replaceChildren(el('li', { class: 'cc-feed-empty', id: 'cc-feed-empty', text: 'Live swaps are unavailable right now. Retrying every few seconds.' }));
			}
		}
	}

	let timer = null;
	const start = () => { if (!timer) { poll(); timer = setInterval(poll, POLL_MS); } };
	const stop = () => { clearInterval(timer); timer = null; };
	document.addEventListener('visibilitychange', () => (document.hidden && MODE !== 'overlay' ? stop() : start()));
	start();

	// Keep "12s ago" honest without re-rendering the feed.
	setInterval(() => {
		for (const n of document.querySelectorAll('.cc-feed-item')) {
			const t = $('.cc-feed-time', n);
			if (t) t.textContent = timeAgo(Number(n.dataset.at));
		}
	}, 15_000);

	if (REDUCED_MOTION) document.body.classList.add('cc-reduced');
}

run();
