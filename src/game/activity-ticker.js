// Activity ticker: a compact, low-key feed of what is happening in the world
// right now (joins, leaves, buys, wheel wins, purchases, quest completions,
// hype moments). Docs: docs/play-activity-ticker.md.
//
// Contract:
//  - Real events only. The ticker never invents a row; a quiet world is a quiet
//    ticker, with a designed empty state.
//  - Every string is rendered with textContent. Player names and coin metadata
//    are untrusted display text and can never become markup.
//  - Bounded: at most MAX_ROWS rows live in the DOM, rows expire after ROW_TTL_MS,
//    and bursts are coalesced into a single "+N more" row.
//  - Zero per-frame cost: there is no requestAnimationFrame loop. Work happens
//    only inside push(), from network/timer callbacks between frames, and DOM
//    writes never read layout.
//
// Subscription API for other features (a dance-off, a signature wall, ...):
//
//   const ticker = getActivityTicker();          // the live instance, or null
//   ticker?.push({ kind: 'dance', text: 'Mira won the dance-off' });
//   const off = ticker.subscribe((row) => ...);  // observe every accepted row
//
// push() fields: kind (string, styles the dot; unknown kinds get a neutral dot),
// text (required, plain text), tone ('up' | 'down' | 'hype' | undefined),
// highlight (bypass the burst limiter, accent the row), key (dedupe: a row with
// the same key within DEDUPE_MS is dropped), ts (ms epoch, default now).

import './activity-ticker.css';
import { cleanLabel } from './activity-feeds.js';

const MAX_ROWS = 40;
const ROW_TTL_MS = 120_000;
const SWEEP_MS = 10_000;
const BURST_LIMIT = 5;        // non-highlight rows per BURST_WINDOW_MS before coalescing
const BURST_WINDOW_MS = 2000;
const DEDUPE_MS = 10_000;
const MAX_TEXT = 90;
const LS_OPEN = 'cc-ticker-open';
const LS_SOUND = 'cc-ticker-sound';
const SMALL_SCREEN = '(max-width: 720px)';

let current = null;

/** The live ticker for the current world, or null outside a world. */
export function getActivityTicker() { return current; }

function lsGet(key) {
	try { return localStorage.getItem(key); } catch { return null; }
}
function lsSet(key, value) {
	try { localStorage.setItem(key, value); } catch { /* private mode: preference is per-session */ }
}

function el(tag, cls, text) {
	const n = document.createElement(tag);
	if (cls) n.className = cls;
	if (text != null) n.textContent = text;
	return n;
}

export class ActivityTicker {
	constructor({ parent = document.body } = {}) {
		this._rows = [];              // { node, ts, kind }
		this._subs = new Set();
		this._recent = [];            // timestamps of accepted non-highlight rows
		this._keys = new Map();       // dedupe key -> ts
		this._pendingMore = 0;
		this._moreTimer = null;
		this._sweepTimer = null;
		this._unread = 0;
		this._audio = null;
		this._disposed = false;

		const stored = lsGet(LS_OPEN);
		this._open = stored == null ? !matchMedia(SMALL_SCREEN).matches : stored === '1';
		this._sound = lsGet(LS_SOUND) === '1';

		const root = el('section', 'cc-ticker');
		root.id = 'cc-ticker';
		root.hidden = true;
		root.setAttribute('aria-label', 'Live activity');

		const head = el('div', 'cc-ticker-head');
		this._toggle = el('button', 'cc-ticker-toggle');
		this._toggle.type = 'button';
		this._toggle.setAttribute('aria-controls', 'cc-ticker-log');
		const live = el('span', 'cc-ticker-live');
		live.setAttribute('aria-hidden', 'true');
		this._title = el('span', 'cc-ticker-title', 'Activity');
		this._badge = el('span', 'cc-ticker-badge');
		this._badge.hidden = true;
		this._toggle.append(live, this._title, this._badge);
		this._toggle.addEventListener('click', () => this.setOpen(!this._open));

		this._soundBtn = el('button', 'cc-ticker-sound');
		this._soundBtn.type = 'button';
		this._soundBtn.addEventListener('click', () => this.setSound(!this._sound));
		head.append(this._toggle, this._soundBtn);

		this._log = el('ol', 'cc-ticker-log');
		this._log.id = 'cc-ticker-log';
		this._log.setAttribute('role', 'log');
		this._log.setAttribute('aria-live', 'off');
		this._log.setAttribute('aria-label', 'Recent world activity');
		this._empty = el('p', 'cc-ticker-empty', 'Quiet right now. Joins, buys and wins show up here live.');

		root.append(head, this._empty, this._log);
		parent.appendChild(root);
		this.root = root;
		this._applyOpen();
		this._applySound();
		current = this;
	}

	/** Reveal the ticker (it mounts hidden until the world HUD is up). */
	show() { if (!this._disposed) this.root.hidden = false; }

	setOpen(open) {
		this._open = !!open;
		lsSet(LS_OPEN, this._open ? '1' : '0');
		if (this._open) { this._unread = 0; this._renderBadge(); }
		this._applyOpen();
	}

	setSound(on) {
		this._sound = !!on;
		lsSet(LS_SOUND, this._sound ? '1' : '0');
		// The AudioContext is created inside this click, the user gesture browsers require.
		if (this._sound) this._ensureAudio();
		this._applySound();
	}

	_applyOpen() {
		this.root.classList.toggle('cc-ticker-collapsed', !this._open);
		this._toggle.setAttribute('aria-expanded', String(this._open));
		this._toggle.title = this._open ? 'Collapse activity feed' : 'Expand activity feed';
		this._syncEmpty();
	}

	_applySound() {
		this._soundBtn.setAttribute('aria-pressed', String(this._sound));
		this._soundBtn.textContent = this._sound ? 'Sound on' : 'Sound off';
		this._soundBtn.title = this._sound ? 'Mute hype chimes' : 'Play a chime on big buys';
	}

	_renderBadge() {
		this._badge.hidden = this._open || this._unread === 0;
		this._badge.textContent = this._unread > 99 ? '99+' : String(this._unread);
	}

	_syncEmpty() {
		this._empty.hidden = !this._open || this._rows.length > 0;
	}

	/**
	 * Add one row. Returns true when the row was accepted (not deduped, not
	 * folded into a "+N more" summary).
	 * @param {{kind?: string, text: string, tone?: string, highlight?: boolean, key?: string, ts?: number}} row
	 */
	push(row) {
		if (this._disposed || !row) return false;
		const text = cleanLabel(row.text, MAX_TEXT);
		if (!text) return false;
		const now = Date.now();

		if (row.key) {
			const seen = this._keys.get(row.key);
			if (seen != null && now - seen < DEDUPE_MS) return false;
			this._keys.set(row.key, now);
			if (this._keys.size > 200) {
				for (const [k, t] of this._keys) if (now - t >= DEDUPE_MS) this._keys.delete(k);
			}
		}

		if (!row.highlight) {
			this._recent = this._recent.filter((t) => now - t < BURST_WINDOW_MS);
			if (this._recent.length >= BURST_LIMIT) { this._foldMore(); return false; }
			this._recent.push(now);
		}

		this._append({
			kind: String(row.kind || 'event').toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 24) || 'event',
			text,
			tone: row.tone === 'up' || row.tone === 'down' || row.tone === 'hype' ? row.tone : '',
			highlight: !!row.highlight,
			ts: Number.isFinite(row.ts) ? row.ts : now,
		});
		return true;
	}

	subscribe(fn) {
		this._subs.add(fn);
		return () => this._subs.delete(fn);
	}

	// Coalesce a burst: rows the limiter turned away are counted and surfaced as one
	// summary row a moment later, so a flood of events is visible but never a wall.
	_foldMore() {
		this._pendingMore++;
		if (this._moreTimer) return;
		this._moreTimer = setTimeout(() => {
			this._moreTimer = null;
			const n = this._pendingMore;
			this._pendingMore = 0;
			if (n > 0 && !this._disposed) this._append({ kind: 'more', text: `+${n} more event${n === 1 ? '' : 's'}`, tone: '', highlight: false, ts: Date.now() });
		}, BURST_WINDOW_MS);
	}

	_append(r) {
		const li = el('li', `cc-ticker-row cc-ticker-${r.kind}`);
		if (r.tone) li.classList.add(`cc-tone-${r.tone}`);
		if (r.highlight) li.classList.add('cc-ticker-hl');
		const dot = el('span', 'cc-ticker-dot');
		dot.setAttribute('aria-hidden', 'true');
		const txt = el('span', 'cc-ticker-text', r.text);
		const time = el('time', 'cc-ticker-time', new Date(r.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
		time.dateTime = new Date(r.ts).toISOString();
		li.append(dot, txt, time);
		this._log.appendChild(li);
		this._rows.push({ node: li, ts: r.ts });
		while (this._rows.length > MAX_ROWS) this._rows.shift().node.remove();

		if (!this._open) { this._unread++; this._renderBadge(); }
		this._syncEmpty();
		this._armSweep();
		for (const fn of this._subs) {
			try { fn({ kind: r.kind, text: r.text, tone: r.tone, ts: r.ts }); } catch { /* a subscriber must not break the feed */ }
		}
	}

	_armSweep() {
		if (this._sweepTimer) return;
		this._sweepTimer = setInterval(() => {
			const cutoff = Date.now() - ROW_TTL_MS;
			while (this._rows.length && this._rows[0].ts < cutoff) this._rows.shift().node.remove();
			this._syncEmpty();
			if (!this._rows.length) { clearInterval(this._sweepTimer); this._sweepTimer = null; }
		}, SWEEP_MS);
	}

	_ensureAudio() {
		if (this._audio) { this._audio.resume?.().catch(() => {}); return this._audio; }
		const Ctx = window.AudioContext || window.webkitAudioContext;
		if (!Ctx) return null;
		try { this._audio = new Ctx(); } catch { this._audio = null; }
		return this._audio;
	}

	/** A short rising two-note chime, only when the player has turned sound on. */
	chime() {
		if (!this._sound || this._disposed) return;
		const ctx = this._ensureAudio();
		if (!ctx || ctx.state === 'closed') return;
		const t0 = ctx.currentTime + 0.02;
		[659.25, 987.77].forEach((freq, i) => {
			const osc = ctx.createOscillator();
			const gain = ctx.createGain();
			osc.type = 'sine';
			osc.frequency.value = freq;
			const s = t0 + i * 0.13;
			gain.gain.setValueAtTime(0.0001, s);
			gain.gain.exponentialRampToValueAtTime(0.12, s + 0.02);
			gain.gain.exponentialRampToValueAtTime(0.0001, s + 0.55);
			osc.connect(gain).connect(ctx.destination);
			osc.start(s);
			osc.stop(s + 0.6);
		});
	}

	/** Test/diagnostic hook: how many rows are currently mounted. */
	get rowCount() { return this._rows.length; }

	dispose() {
		if (this._disposed) return;
		this._disposed = true;
		clearTimeout(this._moreTimer);
		clearInterval(this._sweepTimer);
		this._subs.clear();
		this._audio?.close?.().catch(() => {});
		this.root.remove();
		if (current === this) current = null;
	}
}
