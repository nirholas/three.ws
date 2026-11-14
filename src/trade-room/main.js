/**
 * /trade-rooms and /trade-rooms/:agentId: live trade rooms.
 *
 * The lobby lists every public leader with a room, live ones first (real
 * fills from the sniper ledger, real spectator counts). A room stands the
 * leader's 3D avatar on a pedestal and streams their trades as they land from
 * /api/sniper/room-stream: the avatar reacts, the board and the ticker tape
 * update, and the accessible trade list below announces each fill through an
 * aria-live region, because a canvas is opaque to a screen reader.
 *
 * Every trade carries its receipt ("why"), its Solscan tx, its share card once
 * closed, and a one-tap Fork (src/fork-trade.js). The leader carries Ghost-copy
 * and Copy. A quiet room still shows the leader's recent real trades, when they
 * last traded, and which other rooms are live right now.
 *
 * The 3D scene (./scene.js, which pulls in three.js) is a lazy chunk. A device
 * without WebGL, a viewer who chose list only, or a device that cannot hold
 * the frame budget gets the same room without the canvas, and is told why.
 */

import {
	escapeHtml as esc, fmtSol, fmtUsd, fmtPct, pnlClass, identicon, verifiedBadge,
} from '../trader-format.js';
import { forkButton, mountForkLinks } from '../fork-trade.js';
import { receiptHTML, receiptSkeletonHTML, RECEIPT_CSS } from '../shared/trade-receipt-view.js';
import { emptyStateHTML, errorStateHTML, skeletonHTML } from '../shared/state-kit.js';
import { isWebGLAvailable } from '../webgl-support.js';
import { mountChat } from './chat.js';
import {
	STATE_LABEL, ago, backoffMs, coinLabel, lastTradedText, mergeTrade, newSessionId,
	roomIdFromLocation, roomState, signedPct, solAmount, toneOf, tradeLine,
} from './model.js';

const NETWORKS = new Set(['mainnet', 'devnet']);
const VIEW_PREF_KEY = 'tws-trade-room-view';
const MAX_TRADES = 40;
const LOBBY_REFRESH_MS = 30_000;
const OTHERS_REFRESH_MS = 60_000;
const CLOCK_MS = 30_000;
const HIDDEN_DISCONNECT_MS = 30_000;
const SNAPSHOT_DEBOUNCE_MS = 3_000;

const root = document.getElementById('tr-root');
const content = document.getElementById('tr-content');
const reducedMotion = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

const state = {
	id: '',
	network: 'mainnet',
	room: null,
	trades: [],
	open: [],
	spectators: null,
	scope: null,
	session: newSessionId(),
	es: null,
	attempt: 0,
	reconnectTimer: 0,
	hiddenTimer: 0,
	snapshotTimer: 0,
	scene: null,
	sceneMode: 'off',
	stageMsg: '',
	receipts: new Map(),
	latestWhyId: '',
	chat: null,
	streamOpened: false,
};

// ── small utilities ──────────────────────────────────────────────────────

function readPref() {
	try { return localStorage.getItem(VIEW_PREF_KEY) === 'list' ? 'list' : '3d'; } catch { return '3d'; }
}

function writePref(v) {
	try { localStorage.setItem(VIEW_PREF_KEY, v); } catch { /* private mode: the choice lasts this visit */ }
}

async function getJson(url) {
	const res = await fetch(url, { headers: { accept: 'application/json' } });
	if (!res.ok) {
		const err = new Error(`http_${res.status}`);
		err.status = res.status;
		throw err;
	}
	return res.json();
}

function qs(sel) { return content.querySelector(sel); }

function avatarImg(src, seed, cls, alt = '') {
	const fallback = identicon(seed || '?');
	return `<img class="${cls}" src="${esc(src || fallback)}" alt="${esc(alt)}" loading="lazy" decoding="async" data-fallback-src="${fallback}" />`;
}

function netQuery() {
	return state.network === 'mainnet' ? '' : `?network=${state.network}`;
}

function injectReceiptCss() {
	if (document.getElementById('tr-receipt-css')) return;
	const style = document.createElement('style');
	style.id = 'tr-receipt-css';
	style.textContent = RECEIPT_CSS;
	document.head.appendChild(style);
}

// Broken leader images fall back to their identicon instead of a broken glyph.
document.addEventListener('error', (e) => {
	const img = e.target;
	if (!(img instanceof HTMLImageElement) || !img.dataset.fallbackSrc) return;
	if (img.src === img.dataset.fallbackSrc) return;
	img.src = img.dataset.fallbackSrc;
}, true);

// ── lobby ────────────────────────────────────────────────────────────────

function roomCard(r, { compact = false } = {}) {
	const watching = r.spectators > 0 ? `<span class="tr-watch" title="People with this room open right now">${r.spectators} watching</span>` : '';
	const pnlLine = r.closed_7d > 0
		? `<span class="${pnlClass(r.pnl_7d_sol)}">${fmtSol(r.pnl_7d_sol)}</span> <span class="tr-dim">7d</span>`
		: '<span class="tr-dim">No closes in 7d</span>';
	const wr = r.win_rate_7d != null ? `${fmtPct(r.win_rate_7d * 100, { dp: 0 })} win` : '';
	const label = `Enter ${r.name}'s room: ${STATE_LABEL[r.state]}, ${lastTradedText(r.last_trade_at).toLowerCase()}${r.spectators ? `, ${r.spectators} watching` : ''}`;
	return `
		<a class="tr-card tr-card--${esc(r.state)}${compact ? ' tr-card--compact' : ''}" href="${esc(r.url)}${netQuery()}" aria-label="${esc(label)}">
			<div class="tr-card-top">
				${avatarImg(r.image, r.agent_id, 'tr-card-av')}
				<div class="tr-card-id">
					<span class="tr-card-name">${esc(r.name)}</span>
					<span class="tr-state tr-state--${esc(r.state)}"><span class="tr-state-dot" aria-hidden="true"></span>${esc(STATE_LABEL[r.state])}</span>
				</div>
			</div>
			<div class="tr-card-stats">
				<span>${esc(lastTradedText(r.last_trade_at))}</span>
				${compact ? '' : `<span>${r.fills_24h} fills in 24h</span>`}
				<span>${pnlLine}</span>
				${wr && !compact ? `<span>${esc(wr)}</span>` : ''}
			</div>
			<div class="tr-card-foot">${watching}<span class="tr-card-cta">Enter room →</span></div>
		</a>`;
}

function renderLobbyShell() {
	document.title = 'Live trade rooms · three.ws';
	content.innerHTML = `
		<section class="tr-hero">
			<p class="tr-kicker"><span class="tr-live-dot" aria-hidden="true"></span>Live trade rooms</p>
			<h1 class="tr-title">Watch traders trade live</h1>
			<p class="tr-sub">Step into a trader's room: their avatar is on the floor, their real pump.fun buys and sells
			land on the board the moment they fill, each with the receipt for why. Fork a trade or copy the trader in one tap.
			Every number traces to an on-chain transaction.</p>
		</section>
		<section class="tr-lobby" aria-labelledby="tr-lobby-h">
			<div class="tr-lobby-head">
				<h2 id="tr-lobby-h">Rooms</h2>
				<span class="tr-lobby-links"><a class="lb-btn" href="/duels">Trader duels</a><a class="lb-btn" href="/leaderboard">Trader leaderboard</a></span>
			</div>
			<div id="tr-lobby-grid" class="tr-grid" aria-live="polite" aria-busy="true">${skeletonHTML(6, 'card')}</div>
		</section>`;
}

async function loadLobby() {
	const grid = qs('#tr-lobby-grid');
	if (!grid) return;
	try {
		const data = await getJson(`/api/sniper/rooms?limit=24${state.network === 'mainnet' ? '' : `&network=${state.network}`}`);
		const rooms = data.rooms || [];
		grid.setAttribute('aria-busy', 'false');
		if (!rooms.length) {
			grid.innerHTML = emptyStateHTML({
				title: 'No trade rooms open yet',
				body: 'A room opens for every public trader the moment they make a real trade. Launch an agent that trades, or browse the traders already ranked.',
				actions: [
					{ label: 'Launch a trader', href: '/create-agent', primary: true },
					{ label: 'Trader leaderboard', href: '/leaderboard' },
				],
			});
			return;
		}
		const live = rooms.filter((r) => r.state === 'live').length;
		grid.innerHTML = `${live ? '' : `<p class="tr-lobby-note">No trader has a position open or has filled in the last 15 minutes. Every room below still shows its trader's real recent trades, and lights up the moment they trade.</p>`}${rooms.map((r) => roomCard(r)).join('')}`;
	} catch {
		grid.setAttribute('aria-busy', 'false');
		grid.innerHTML = errorStateHTML({
			title: 'Could not load the trade rooms',
			body: 'The trade ledger did not answer. Check your connection and retry; nothing is lost.',
		});
		grid.querySelector('[data-sk-retry]')?.addEventListener('click', () => {
			grid.innerHTML = skeletonHTML(6, 'card');
			grid.setAttribute('aria-busy', 'true');
			loadLobby();
		});
	}
}

function startLobby() {
	renderLobbyShell();
	root.setAttribute('aria-busy', 'false');
	loadLobby();
	setInterval(() => { if (!document.hidden) loadLobby(); }, LOBBY_REFRESH_MS);
}

// ── room: rendering ──────────────────────────────────────────────────────

function renderNotFound(message) {
	document.title = 'Trade room not found · three.ws';
	root.setAttribute('aria-busy', 'false');
	content.innerHTML = `
		<nav class="tr-crumbs" aria-label="Breadcrumb"><a href="/trade-rooms">← All trade rooms</a></nav>
		${emptyStateHTML({
			title: 'This trade room does not exist',
			body: esc(message),
			actions: [
				{ label: 'Browse live rooms', href: '/trade-rooms', primary: true },
				{ label: 'Trader leaderboard', href: '/leaderboard' },
			],
		})}`;
}

function renderRoomSkeleton() {
	content.innerHTML = `
		<nav class="tr-crumbs" aria-label="Breadcrumb"><a href="/trade-rooms">← All trade rooms</a></nav>
		<div class="tr-room">
			<div class="tr-stage tr-stage--loading" aria-hidden="true"><div class="tr-stage-shimmer"></div></div>
			<div class="tr-side">${skeletonHTML(4, 'row')}</div>
		</div>`;
}

function renderRoomError() {
	root.setAttribute('aria-busy', 'false');
	content.innerHTML = `
		<nav class="tr-crumbs" aria-label="Breadcrumb"><a href="/trade-rooms">← All trade rooms</a></nav>
		${errorStateHTML({
			title: 'Could not open this trade room',
			body: 'The trade ledger did not answer. Check your connection and retry.',
		})}`;
	content.querySelector('[data-sk-retry]')?.addEventListener('click', () => openRoom());
}

function statCell(label, value, cls = '') {
	return `<div class="tr-stat"><dt>${esc(label)}</dt><dd class="${cls}">${value}</dd></div>`;
}

function renderRoom(data) {
	const L = data.leader;
	const s = data.stats;
	document.title = `${L.name} · live trade room · three.ws`;
	const traderHref = `/trader/${encodeURIComponent(L.id)}${netQuery()}`;
	const usd = s.realized_pnl_usd != null ? ` <span class="tr-dim">${esc(fmtUsd(s.realized_pnl_usd))}</span>` : '';
	content.innerHTML = `
		<nav class="tr-crumbs" aria-label="Breadcrumb"><a href="/trade-rooms">← All trade rooms</a></nav>
		<div class="tr-room">
			<section class="tr-stage" id="tr-stage" aria-labelledby="tr-leader-name" aria-describedby="tr-stage-desc">
				<p id="tr-stage-desc" class="tr-sr-only">A 3D room where ${esc(L.name)}'s avatar reacts to each trade. Every trade shown in the room is also in the trade list on this page.</p>
				<div class="tr-canvas-host" id="tr-canvas-host"></div>
				<div class="tr-hud">
					<a class="tr-leader-chip" href="${traderHref}">
						${avatarImg(L.image, L.id, 'tr-leader-av')}
						<span class="tr-leader-meta">
							<span class="tr-leader-name" id="tr-leader-name">${esc(L.name)}${verifiedBadge(s.verified)}</span>
							<span class="tr-leader-sub">Score ${s.score} · track record →</span>
						</span>
					</a>
					<div class="tr-pills">
						<span class="tr-state" id="tr-state"></span>
						<span class="tr-watch" id="tr-watch" hidden></span>
						<span class="tr-conn" id="tr-conn" data-state="connecting">Connecting</span>
					</div>
				</div>
				<div class="tr-flash" id="tr-flash" aria-hidden="true"></div>
				<div class="tr-stage-foot">
					<p class="tr-stage-note" id="tr-stage-note" role="status"></p>
					<button type="button" class="tr-tool" id="tr-view-toggle"></button>
				</div>
				<div class="tr-stage-panel" id="tr-stage-panel" hidden></div>
			</section>

			<aside class="tr-side" aria-label="${esc(L.name)}'s trading">
				<section class="tr-leader-card">
					<p class="tr-last" id="tr-last"></p>
					<dl class="tr-stats">
						${statCell('Win rate · 30d', s.closed_count ? fmtPct(s.win_rate * 100) : 'None yet')}
						${statCell('Realized · 30d', `${fmtSol(s.realized_pnl_sol)}${usd}`, pnlClass(s.realized_pnl_sol))}
						${statCell('Closed trades · 30d', String(s.closed_count))}
						${statCell('Best trade · 30d', s.best_pnl_pct != null ? signedPct(s.best_pnl_pct) : 'None yet', pnlClass(s.best_pnl_pct))}
					</dl>
					<div class="tr-actions">
						<a class="lb-btn lb-btn-primary" href="/ghost-copy?leader=${encodeURIComponent(L.id)}&window=30d">Ghost-copy</a>
						<a class="lb-btn" href="${traderHref}#tp-copy-panel">Copy trades</a>
						<button type="button" class="lb-btn" id="tr-share">Share room</button>
						<a class="lb-btn" href="/duels?agent=${encodeURIComponent(L.id)}">Call a duel</a>
					</div>
					${L.copiers ? `<p class="tr-dim tr-copiers">${L.copiers} ${L.copiers === 1 ? 'person copies' : 'people copy'} this trader</p>` : ''}
				</section>

				<section class="trc" id="trc" aria-labelledby="trc-title"></section>

				<section class="tr-why" id="tr-why" aria-labelledby="tr-why-h" hidden>
					<h2 id="tr-why-h" class="tr-h">Why the latest trade</h2>
					<div id="tr-why-body"></div>
				</section>

				<section class="tr-open" id="tr-open" aria-labelledby="tr-open-h" hidden>
					<h2 id="tr-open-h" class="tr-h">Open now</h2>
					<ul class="tr-open-list" id="tr-open-list"></ul>
				</section>

				<section class="tr-feed" aria-labelledby="tr-feed-h">
					<h2 id="tr-feed-h" class="tr-h">Trades, newest first</h2>
					<ol class="tr-list" id="tr-list" aria-labelledby="tr-feed-h"></ol>
				</section>
			</aside>
		</div>

		<section class="tr-others" aria-labelledby="tr-others-h">
			<div class="tr-lobby-head">
				<h2 id="tr-others-h">Other rooms</h2>
				<a class="lb-btn" href="/trade-rooms">All rooms</a>
			</div>
			<div class="tr-grid tr-grid--compact" id="tr-others">${skeletonHTML(3, 'card')}</div>
		</section>
		<div class="tr-sr-only" id="tr-announce" role="status" aria-live="polite" aria-atomic="true"></div>`;

	mountForkLinks(content);
	content.querySelector('#tr-share').addEventListener('click', (e) => shareRoom(e.currentTarget));
	content.querySelector('#tr-view-toggle').addEventListener('click', toggleView);
	content.querySelector('#tr-list').addEventListener('click', onListClick);
	content.querySelector('#tr-why-body').addEventListener('click', onListClick);
	state.chat?.destroy();
	state.chat = mountChat({
		host: content.querySelector('#trc'),
		agentId: L.id,
		leaderName: L.name,
		roomState: () => state.room?.room?.state || 'quiet',
	});
}

function tradeRow(t) {
	const tone = toneOf(t);
	const sideLabel = t.kind === 'buy' ? 'Buy' : 'Sell';
	const pct = t.kind === 'sell' ? `<span class="tr-pnl ${pnlClass(t.pnl_pct)}">${esc(signedPct(t.pnl_pct))}</span>` : '';
	const meta = [
		`<time datetime="${esc(t.at)}" data-ago>${esc(ago(t.at))}</time>`,
		t.kind === 'sell' && t.exit_label ? esc(t.exit_label) : '',
		t.kind === 'sell' && t.hold_seconds != null ? `held ${esc(holdLabel(t.hold_seconds))}` : '',
		t.paper ? '<span class="tr-paper" title="Simulated fill, no on-chain transaction">paper</span>' : '',
	].filter(Boolean).join(' · ');
	const whyId = `tr-why-${t.id.replace(/[^a-z0-9]/gi, '')}`;
	return `
		<li class="tr-row tr-row--${tone}" data-id="${esc(t.id)}">
			<span class="tr-badge tr-badge--${tone}">${sideLabel}</span>
			<div class="tr-row-main">
				<p class="tr-row-line"><span class="tr-sr-only">${esc(tradeLine(t))}. </span><span aria-hidden="true"><strong>${esc(coinLabel(t))}</strong> <span class="tr-mono">${esc(solAmount(t.size_sol))}</span> ${pct}</span></p>
				<p class="tr-row-meta">${meta}</p>
			</div>
			<div class="tr-row-acts">
				<button type="button" class="tr-mini" data-why="${esc(t.position_id)}" data-why-target="${whyId}" aria-expanded="false" aria-controls="${whyId}">Why</button>
				${forkButton({ mint: t.mint, symbol: t.symbol, name: t.name, size: t.entry_sol }, { className: 'tr-mini tr-mini--fork', label: 'Fork' })}
				${t.share_url ? `<a class="tr-mini" href="${esc(t.share_url)}" aria-label="Trade card for ${esc(coinLabel(t))}">Card</a>` : ''}
				${t.tx_url ? `<a class="tr-mini" href="${esc(t.tx_url)}" target="_blank" rel="noopener" aria-label="${sideLabel} transaction on Solscan (opens in a new tab)">tx ↗</a>` : ''}
			</div>
			<div class="tr-receipt" id="${whyId}" hidden></div>
		</li>`;
}

function holdLabel(sec) {
	if (sec < 60) return `${sec}s`;
	if (sec < 3600) return `${Math.round(sec / 60)}m`;
	if (sec < 86400) return `${(sec / 3600).toFixed(1)}h`;
	return `${(sec / 86400).toFixed(1)}d`;
}

function renderTrades({ freshId = '' } = {}) {
	const list = qs('#tr-list');
	if (!list) return;
	if (!state.trades.length) {
		list.innerHTML = `<li class="tr-list-empty">${emptyStateHTML({
			compact: true,
			title: 'No trades yet',
			body: `${esc(state.room.leader.name)} has not made a real trade on this network yet. This list fills the moment they do, and you will hear about it here.`,
			actions: [{ label: 'Browse live rooms', href: '/trade-rooms' }],
		})}</li>`;
		return;
	}
	// Keep any receipt a viewer has open across re-renders.
	const openWhy = [...list.querySelectorAll('.tr-receipt:not([hidden])')].map((el) => el.id);
	list.innerHTML = state.trades.map(tradeRow).join('');
	for (const id of openWhy) {
		const btn = list.querySelector(`[data-why-target="${id}"]`);
		if (btn) toggleReceipt(btn, true);
	}
	if (freshId && !reducedMotion) list.querySelector(`[data-id="${CSS.escape(freshId)}"]`)?.classList.add('is-fresh');
}

function renderOpen() {
	const wrap = qs('#tr-open');
	const list = qs('#tr-open-list');
	if (!wrap || !list) return;
	wrap.hidden = !state.open.length;
	list.innerHTML = state.open.map((o) => `
		<li class="tr-open-row" data-pos="${esc(o.id)}">
			<strong>${esc(coinLabel(o))}</strong>
			<span class="tr-mono">${esc(solAmount(o.entry_sol))} in</span>
			<span class="tr-pnl ${pnlClass(o.unrealized_pct)}" data-unrealized>${esc(signedPct(o.unrealized_pct))}</span>
			<span class="tr-dim">opened <time datetime="${esc(o.opened_at)}" data-ago>${esc(ago(o.opened_at))}</time></span>
		</li>`).join('');
}

function renderRoomState() {
	const room = state.room?.room;
	if (!room) return;
	const pill = qs('#tr-state');
	if (pill) {
		pill.className = `tr-state tr-state--${room.state}`;
		pill.innerHTML = `<span class="tr-state-dot" aria-hidden="true"></span>${esc(STATE_LABEL[room.state])}`;
	}
	const last = qs('#tr-last');
	if (last) {
		last.textContent = state.trades.length
			? `${lastTradedText(room.last_trade_at)}. ${room.state === 'live' ? 'Trades land here live.' : 'This room lights up the moment they trade again.'}`
			: 'No trades yet. This room lights up the moment they make one.';
	}
	renderStageNote();
	state.chat?.onRoomState();
}

function renderSpectators() {
	const el = qs('#tr-watch');
	if (!el) return;
	if (state.spectators == null) { el.hidden = true; return; }
	el.hidden = false;
	const n = state.spectators;
	el.textContent = n <= 1 ? 'Just you here' : `${n} watching`;
	el.title = state.scope === 'instance'
		? 'People with this room open on this server. The full count can be higher.'
		: 'People with this room open right now.';
	state.scene?.setSpectators(n);
}

function setConn(s) {
	const el = qs('#tr-conn');
	if (!el) return;
	el.dataset.state = s;
	el.textContent = s === 'live' ? 'Streaming' : s === 'reconnecting' ? 'Reconnecting' : s === 'paused' ? 'Paused' : 'Connecting';
}

function tickClocks() {
	for (const el of content.querySelectorAll('time[data-ago]')) el.textContent = ago(el.getAttribute('datetime'));
	if (state.room) {
		// A room that was live cools to warm when its last fill ages past the window.
		const room = state.room.room;
		room.state = roomState({ lastTradeAt: room.last_trade_at, openCount: state.open.length });
		renderRoomState();
	}
}

function flash(t) {
	const el = qs('#tr-flash');
	if (!el || reducedMotion) return;
	el.className = `tr-flash tr-flash--${toneOf(t)}`;
	el.textContent = tradeLine(t);
	void el.offsetWidth;
	el.classList.add('is-on');
}

// ── receipts ("why") ─────────────────────────────────────────────────────

async function loadReceipt(positionId) {
	if (state.receipts.has(positionId)) return state.receipts.get(positionId);
	const p = getJson(`/api/sniper/receipt?id=${encodeURIComponent(positionId)}`);
	state.receipts.set(positionId, p);
	p.catch(() => state.receipts.delete(positionId));
	return p;
}

async function toggleReceipt(btn, forceOpen = false) {
	const panel = document.getElementById(btn.dataset.whyTarget);
	if (!panel) return;
	const open = forceOpen || panel.hidden;
	panel.hidden = !open;
	btn.setAttribute('aria-expanded', String(open));
	if (!open) return;
	injectReceiptCss();
	panel.innerHTML = receiptSkeletonHTML();
	try {
		panel.innerHTML = receiptHTML(await loadReceipt(btn.dataset.why));
	} catch (err) {
		panel.innerHTML = `<p class="tr-receipt-err">${err?.status === 404
			? 'This trade has no receipt: the position never filled, or its agent is private.'
			: 'The receipt could not load.'} <button type="button" class="tr-mini" data-why-retry>Retry</button></p>`;
		panel.querySelector('[data-why-retry]')?.addEventListener('click', () => toggleReceipt(btn, true));
	}
}

function onListClick(e) {
	const btn = e.target instanceof Element ? e.target.closest('[data-why]') : null;
	if (btn) toggleReceipt(btn);
}

async function renderLatestWhy() {
	const wrap = qs('#tr-why');
	const body = qs('#tr-why-body');
	const latest = state.trades[0];
	if (!wrap || !body || !latest) return;
	if (state.latestWhyId === latest.position_id) return;
	state.latestWhyId = latest.position_id;
	wrap.hidden = false;
	body.innerHTML = '<p class="tr-why-line tr-skel-line" aria-busy="true">Reading the receipt</p>';
	try {
		const r = await loadReceipt(latest.position_id);
		if (state.latestWhyId !== latest.position_id) return;
		const whyTarget = 'tr-why-latest-full';
		body.innerHTML = `
			<p class="tr-why-line">${esc(r.summary)}</p>
			<button type="button" class="tr-mini" data-why="${esc(latest.position_id)}" data-why-target="${whyTarget}" aria-expanded="false" aria-controls="${whyTarget}">Full receipt</button>
			<div class="tr-receipt" id="${whyTarget}" hidden></div>`;
	} catch {
		if (state.latestWhyId !== latest.position_id) return;
		body.innerHTML = `<p class="tr-why-line tr-dim">No receipt is on record for ${esc(coinLabel(latest))} yet. It appears once the trade's evidence is written.</p>`;
	}
}

// ── 3D stage ─────────────────────────────────────────────────────────────

function renderStageNote(extra = '') {
	const note = qs('#tr-stage-note');
	const toggle = qs('#tr-view-toggle');
	if (!note || !toggle) return;
	const L = state.room?.leader;
	let msg = extra || state.stageMsg || '';
	if (!msg && state.room && state.room.room.state !== 'live' && state.sceneMode === 'on') {
		msg = state.trades.length
			? `${L.name} is between trades. ${lastTradedText(state.room.room.last_trade_at)}; the board shows their latest fills.`
			: `${L.name} has not traded yet. The board fills the moment they do.`;
	}
	note.textContent = msg;
	note.hidden = !msg;
	toggle.hidden = state.sceneMode === 'unsupported';
	toggle.textContent = state.sceneMode === 'on' || state.sceneMode === 'loading' ? 'List only' : 'Show 3D room';
	toggle.setAttribute('aria-pressed', String(state.sceneMode !== 'on' && state.sceneMode !== 'loading'));
}

function showStagePanel(title, body, { retry = false } = {}) {
	const panel = qs('#tr-stage-panel');
	const stage = qs('#tr-stage');
	if (!panel || !stage) return;
	stage.classList.add('tr-stage--flat');
	panel.hidden = false;
	panel.innerHTML = `
		<div class="tr-panel-inner">
			<p class="tr-panel-title">${esc(title)}</p>
			<p class="tr-panel-body">${esc(body)}</p>
			${retry ? '<button type="button" class="lb-btn" data-stage-retry>Try the 3D room again</button>' : ''}
		</div>`;
	panel.querySelector('[data-stage-retry]')?.addEventListener('click', () => { writePref('3d'); startScene(); });
}

function hideStagePanel() {
	const panel = qs('#tr-stage-panel');
	qs('#tr-stage')?.classList.remove('tr-stage--flat');
	if (panel) { panel.hidden = true; panel.innerHTML = ''; }
}

function stopScene() {
	state.scene?.dispose();
	state.scene = null;
}

async function startScene() {
	stopScene();
	state.stageMsg = '';
	const host = qs('#tr-canvas-host');
	if (!host || !state.room) return;
	if (!isWebGLAvailable()) {
		state.sceneMode = 'unsupported';
		showStagePanel('3D is not available on this device', 'This browser could not start WebGL, so the room runs as the live list below. Every trade still lands there in real time.');
		renderStageNote();
		return;
	}
	if (readPref() === 'list') {
		state.sceneMode = 'list';
		showStagePanel('3D room is off', 'You chose the list view. Trades keep landing live in the list below.', { retry: true });
		renderStageNote();
		return;
	}
	hideStagePanel();
	state.sceneMode = 'loading';
	qs('#tr-stage')?.classList.add('tr-stage--loading');
	renderStageNote('Setting up the room');
	let scene;
	try {
		const { TradeRoomScene } = await import('./scene.js');
		scene = new TradeRoomScene(host, { reducedMotion, onFallback: () => fallbackToList() });
		scene.init();
	} catch {
		state.sceneMode = 'unsupported';
		qs('#tr-stage')?.classList.remove('tr-stage--loading');
		showStagePanel('3D could not start here', 'The room could not open a 3D view on this device, so it runs as the live list below. Trades still land there in real time.');
		renderStageNote();
		return;
	}
	state.scene = scene;
	scene.setTrades(state.trades);
	if (state.spectators != null) scene.setSpectators(state.spectators);
	const L = state.room.leader;
	const shown = await scene.setLeader({ modelUrl: L.model_url, name: L.name });
	if (state.scene !== scene) return;
	qs('#tr-stage')?.classList.remove('tr-stage--loading');
	state.sceneMode = 'on';
	if (shown.failed) state.stageMsg = `${L.name}'s 3D body could not load on this device, so the default avatar is standing in.`;
	else if (!L.model_url) state.stageMsg = `${L.name} has no public 3D body yet, so the default avatar is standing in.`;
	renderStageNote();
	if (state.stageMsg) setTimeout(() => { state.stageMsg = ''; renderStageNote(); }, 9000);
}

function fallbackToList() {
	stopScene();
	state.sceneMode = 'fallback';
	showStagePanel(
		'3D paused to keep this page smooth',
		'This device could not hold the room\'s frame rate, so the live trade list below carries on without the 3D view.',
		{ retry: true },
	);
	renderStageNote();
}

function toggleView() {
	if (state.sceneMode === 'on' || state.sceneMode === 'loading') {
		writePref('list');
		stopScene();
		state.sceneMode = 'list';
		showStagePanel('3D room is off', 'You chose the list view. Trades keep landing live in the list below.', { retry: true });
		renderStageNote();
		return;
	}
	writePref('3d');
	startScene();
}

// ── live stream ──────────────────────────────────────────────────────────

function onTrade(t) {
	const known = state.trades.some((x) => x.id === t.id);
	state.trades = mergeTrade(state.trades, t, MAX_TRADES);
	if (known) return;
	applyFillToOpen(t);
	// A sell completes its position's receipt (exit leg, P&L); drop the cached open one.
	if (t.kind === 'sell') {
		state.receipts.delete(t.position_id);
		if (state.latestWhyId === t.position_id) state.latestWhyId = '';
	}
	const room = state.room.room;
	if (!room.last_trade_at || new Date(t.at) > new Date(room.last_trade_at)) room.last_trade_at = t.at;
	room.state = roomState({ lastTradeAt: room.last_trade_at, openCount: state.open.length });
	renderTrades({ freshId: t.id });
	renderRoomState();
	const announce = qs('#tr-announce');
	if (announce) announce.textContent = `${tradeLine(t, state.room.leader.name)}.`;
	flash(t);
	state.scene?.setTrades(state.trades);
	state.scene?.react(t);
	renderLatestWhy();
	// Stats and open positions move with every fill; re-read them from the ledger.
	clearTimeout(state.snapshotTimer);
	state.snapshotTimer = setTimeout(refreshSnapshot, SNAPSHOT_DEBOUNCE_MS);
}

/** Keep "Open now" honest between snapshots: a buy opens a row, a sell closes it. */
function applyFillToOpen(t) {
	if (t.kind === 'sell') {
		state.open = state.open.filter((o) => o.id !== t.position_id);
	} else if (t.status !== 'closed' && !state.open.some((o) => o.id === t.position_id)) {
		state.open = [{
			id: t.position_id, mint: t.mint, symbol: t.symbol, name: t.name,
			entry_sol: t.entry_sol, current_sol: t.entry_sol, unrealized_pct: 0, opened_at: t.at,
		}, ...state.open];
	}
	renderOpen();
}

function onQuote(q) {
	const o = state.open.find((x) => x.id === q.position_id);
	if (!o) return;
	o.current_sol = q.current_sol;
	o.unrealized_pct = q.unrealized_pct;
	const cell = content.querySelector(`[data-pos="${CSS.escape(q.position_id)}"] [data-unrealized]`);
	if (cell) {
		cell.textContent = signedPct(q.unrealized_pct);
		cell.className = `tr-pnl ${pnlClass(q.unrealized_pct)}`;
	}
}

function disconnect() {
	clearTimeout(state.reconnectTimer);
	state.es?.close();
	state.es = null;
}

function connect() {
	disconnect();
	if (!state.room) return;
	const since = state.trades[0]?.at || new Date(state.room.t).toISOString();
	const q = new URLSearchParams({ agent_id: state.id, network: state.network, since, session: state.session });
	if (state.chat) q.set('chat_since', state.chat.sinceIso());
	const es = new EventSource(`/api/sniper/room-stream?${q}`);
	state.es = es;
	const alive = () => { state.attempt = 0; setConn('live'); };
	const parse = (e) => { try { return JSON.parse(e.data); } catch { return null; } };
	es.addEventListener('open', (e) => {
		if (!e.data) return;
		const d = parse(e);
		alive();
		// A re-open means the stream dropped for a while: re-read the chat so a
		// message hidden or sent in the gap is not missed.
		if (state.streamOpened) state.chat?.reconnected();
		state.streamOpened = true;
		if (d && d.spectators != null) { state.spectators = d.spectators; state.scope = d.presence_scope; renderSpectators(); }
	});
	es.addEventListener('trade', (e) => { alive(); const t = parse(e); if (t) onTrade(t); });
	es.addEventListener('chat', (e) => { alive(); const m = parse(e); if (m) state.chat?.onChat(m); });
	es.addEventListener('chat_hidden', (e) => { alive(); const d = parse(e); if (d?.id) state.chat?.onHidden(d.id); });
	es.addEventListener('quote', (e) => { alive(); const d = parse(e); if (d) onQuote(d); });
	es.addEventListener('presence', (e) => {
		alive();
		const d = parse(e);
		if (d) { state.spectators = d.spectators; state.scope = d.presence_scope; renderSpectators(); }
	});
	es.addEventListener('ping', alive);
	es.addEventListener('close', () => { es.close(); if (state.es === es) connect(); });
	es.onerror = () => {
		if (state.es !== es) return;
		es.close();
		state.es = null;
		setConn('reconnecting');
		state.reconnectTimer = setTimeout(connect, backoffMs(state.attempt++));
	};
}

async function refreshSnapshot() {
	try {
		const data = await getJson(`/api/sniper/room?agent_id=${encodeURIComponent(state.id)}&network=${state.network}`);
		applySnapshot(data, { rerender: false });
	} catch {
		/* the stream keeps the list live; the stats catch up on the next fill */
	}
}

function applySnapshot(data, { rerender }) {
	state.room = data;
	for (const t of data.trades || []) state.trades = mergeTrade(state.trades, t, MAX_TRADES);
	state.open = data.open || [];
	if (data.room.spectators != null) { state.spectators = data.room.spectators; state.scope = data.room.presence_scope; }
	if (rerender) renderRoom(data);
	else updateStats(data);
	renderTrades();
	renderOpen();
	renderRoomState();
	renderSpectators();
	renderLatestWhy();
	state.scene?.setTrades(state.trades);
}

function updateStats(data) {
	const s = data.stats;
	const cells = content.querySelectorAll('.tr-stats dd');
	if (cells.length !== 4) return;
	cells[0].textContent = s.closed_count ? fmtPct(s.win_rate * 100) : 'None yet';
	cells[1].className = pnlClass(s.realized_pnl_sol);
	cells[1].innerHTML = `${fmtSol(s.realized_pnl_sol)}${s.realized_pnl_usd != null ? ` <span class="tr-dim">${esc(fmtUsd(s.realized_pnl_usd))}</span>` : ''}`;
	cells[2].textContent = String(s.closed_count);
	cells[3].className = pnlClass(s.best_pnl_pct);
	cells[3].textContent = s.best_pnl_pct != null ? signedPct(s.best_pnl_pct) : 'None yet';
}

// ── other rooms ──────────────────────────────────────────────────────────

async function loadOthers() {
	const grid = qs('#tr-others');
	if (!grid) return;
	try {
		const data = await getJson(`/api/sniper/rooms?limit=12${state.network === 'mainnet' ? '' : `&network=${state.network}`}`);
		const others = (data.rooms || []).filter((r) => r.agent_id !== state.id).slice(0, 6);
		grid.innerHTML = others.length
			? others.map((r) => roomCard(r, { compact: true })).join('')
			: emptyStateHTML({
				compact: true,
				title: 'This is the only room open',
				body: 'No other trader has a room yet. Find the next one on the leaderboard.',
				actions: [{ label: 'Trader leaderboard', href: '/leaderboard' }],
			});
	} catch {
		grid.innerHTML = errorStateHTML({ title: 'Could not load other rooms', body: 'Retry in a moment.' });
		grid.querySelector('[data-sk-retry]')?.addEventListener('click', loadOthers);
	}
}

async function shareRoom(btn) {
	const L = state.room.leader;
	const url = `${location.origin}/trade-rooms/${encodeURIComponent(L.id)}${netQuery()}`;
	const { showSharePanel } = await import('../shared/share.js');
	showSharePanel({
		kind: 'trade-room',
		id: L.id,
		title: `${L.name}'s live trade room`,
		description: 'Watch every real buy and sell land live, with the receipt for why. Fork any trade in one tap.',
		shareText: `Watching ${L.name} trade live on three.ws`,
		shareUrl: url,
	}, btn);
}

// ── lifecycle ────────────────────────────────────────────────────────────

async function openRoom() {
	renderRoomSkeleton();
	root.setAttribute('aria-busy', 'true');
	let data;
	try {
		data = await getJson(`/api/sniper/room?agent_id=${encodeURIComponent(state.id)}&network=${state.network}`);
	} catch (err) {
		if (err.status === 404) return renderNotFound('No public trader has this id. The trader may be private, or the link may be mistyped.');
		return renderRoomError();
	}
	root.setAttribute('aria-busy', 'false');
	state.trades = [];
	applySnapshot(data, { rerender: true });
	connect();
	startScene();
	loadOthers();
	setInterval(tickClocks, CLOCK_MS);
	setInterval(() => { if (!document.hidden) loadOthers(); }, OTHERS_REFRESH_MS);
	document.addEventListener('visibilitychange', onVisibility);
	window.addEventListener('pagehide', () => { disconnect(); stopScene(); });
}

// A hidden tab stops counting as a spectator and stops polling; coming back
// re-reads the snapshot so nothing that landed meanwhile is missed.
function onVisibility() {
	if (document.hidden) {
		state.hiddenTimer = setTimeout(() => { disconnect(); setConn('paused'); }, HIDDEN_DISCONNECT_MS);
		return;
	}
	clearTimeout(state.hiddenTimer);
	if (!state.es) {
		refreshSnapshot().finally(connect);
	}
}

function boot() {
	const q = new URLSearchParams(location.search);
	if (NETWORKS.has(q.get('network'))) state.network = q.get('network');
	const { id, invalid } = roomIdFromLocation(location.pathname, location.search);
	if (invalid) return renderNotFound('Room links look like /trade-rooms/ followed by a trader id. This one is not a valid trader id.');
	if (!id) return startLobby();
	state.id = id;
	openRoom();
}

boot();
