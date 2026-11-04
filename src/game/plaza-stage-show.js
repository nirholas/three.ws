// The Plaza Stage show client, the half of F17 that only exists for attendees.
//
// src/game/plaza-stage.js is the always-mounted landmark (geometry, marquee, one
// distance check per frame). The first time the player walks inside the attend
// ring it dynamically imports THIS module and constructs a PlazaStageShow; when
// they walk away it calls dispose(). Everything with a cost lives here: the
// stage_world socket, the host avatar, TTS + lip-sync, the seat markers, the
// panel, the tip flow. A player who never approaches opens none of it.
//
// It renders the same show the /stage page renders, from the same broadcast:
//   • StageNet (src/stage-net.js) joins `stage_world` filtered by stageId and
//     relays host / utterance / audience / tip / leaderboard.
//   • StageVoice (src/shared/stage-voice.js) turns an utterance into spatial
//     audio on the host's head plus lip-sync, and stops cleanly when the next
//     beat (a tip shout-out, say) pre-empts the line.
//   • The tip uses the shared flow in src/shared/stage-tip.js. It is an on-chain
//     $THREE spend, so nothing signs until the player has seen recipient, amount
//     and token in an explicit confirm step and pressed Confirm.
//
// All dependencies that touch the network, audio or a wallet are injectable
// (`deps`) so the lifecycle can be proven in tests without a socket.

import {
	AudioListener, PositionalAudio, Group, Mesh, RingGeometry, CircleGeometry, CapsuleGeometry, SphereGeometry,
	MeshBasicMaterial, MeshStandardMaterial, DoubleSide,
} from 'three';
import { StageNet } from '../stage-net.js';
import { StageVoice, MouthTarget, findHead } from '../shared/stage-voice.js';
import {
	TIP_PRESETS, MAX_TIP_MESSAGE, tipStageLabel, describeTipError, settleStageTip,
} from '../shared/stage-tip.js';
import { t } from './i18n-play.js';
import { log } from '../shared/log.js';

const MAX_SEATS = 40;
const MAX_SEATS_SAVER = 16;
const MAX_TICKER = 4;
const HOST_HEIGHT_M = 1.7;

const prefersReducedMotion = () => {
	try { return !!globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
};

const shortWallet = (w) => (w && w.length > 12 ? `${w.slice(0, 5)}…${w.slice(-5)}` : (w || ''));
const fmtAmount = (n) => Number(n).toLocaleString('en-US');
const fmtThreeAtomic = (atomic) => fmtAmount(Math.round(Number(atomic || 0) / 1e6));

/**
 * The plaza passes its own marquee state as `detail`; setStageDetail receives
 * the raw /api/stage payload. Both reduce to this shape.
 */
export function normalizeDetail(d) {
	if (!d) return { live: false, claimed: false, title: '', host: '', nextShowAt: 0, hostAvatar: '', hostWallet: null, voice: 'nova' };
	if (d.stage !== undefined) {
		const s = d.stage;
		return {
			live: !!d.live && !!s,
			claimed: !!s,
			title: s?.title || '',
			host: s?.host_name || '',
			nextShowAt: Number(s?.next_show_at) || 0,
			hostAvatar: s?.host_avatar || '',
			hostWallet: d.hostWallet || null,
			voice: s?.voice || 'nova',
		};
	}
	return {
		live: d.phase === 'live',
		claimed: d.phase !== 'unclaimed',
		title: d.title || '',
		host: d.host || '',
		nextShowAt: Number(d.nextShowAt) || 0,
		hostAvatar: d.hostAvatar || '',
		hostWallet: d.hostWallet || null,
		voice: d.hostVoice || 'nova',
	};
}

let cssInjected = false;
function injectCss() {
	if (cssInjected || typeof document === 'undefined') return;
	cssInjected = true;
	const st = document.createElement('style');
	st.setAttribute('data-pss-style', '');
	st.textContent = `
.pss{position:fixed;left:0;right:0;bottom:calc(env(safe-area-inset-bottom,0px) + 84px);z-index:60;display:flex;flex-direction:column;align-items:center;gap:10px;padding:0 16px;pointer-events:none;font:14px/1.45 system-ui,sans-serif;color:#f5f5f6}
.pss > *{pointer-events:auto}
.pss-caption{max-width:min(640px,100%);padding:10px 16px;border-radius:14px;background:rgba(10,10,12,.82);border:1px solid rgba(155,107,255,.35);backdrop-filter:blur(8px);text-align:center}
.pss-caption[data-speaking="true"]{border-color:#ff5db1}
.pss-caption small{display:block;color:#9d97ad;font-size:11px;letter-spacing:.06em;text-transform:uppercase}
.pss-panel{width:min(420px,100%);max-height:min(62vh,520px);overflow:auto;padding:14px;border-radius:16px;background:rgba(14,12,22,.94);border:1px solid rgba(155,107,255,.4);box-shadow:0 12px 40px rgba(0,0,0,.5)}
.pss-head{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:10px}
.pss-head h2{margin:0;font-size:15px;font-weight:650}
.pss-sub{color:#9d97ad;font-size:12px}
.pss h3{margin:14px 0 6px;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#9d97ad;font-weight:600}
.pss button{font:inherit;color:inherit;cursor:pointer;border:1px solid rgba(255,255,255,.18);background:rgba(255,255,255,.06);border-radius:10px;padding:7px 12px;transition:background .12s,border-color .12s,transform .06s}
.pss button:hover{background:rgba(155,107,255,.22);border-color:rgba(155,107,255,.7)}
.pss button:active{transform:translateY(1px);background:rgba(155,107,255,.34)}
.pss button:focus-visible,.pss input:focus-visible,.pss a:focus-visible{outline:2px solid #ffd24a;outline-offset:2px}
.pss button[disabled]{opacity:.5;cursor:not-allowed}
.pss button.pss-primary{background:#6b3fe0;border-color:#9b6bff;font-weight:600}
.pss button.pss-primary:hover{background:#7d55ea}
.pss button[aria-pressed="true"]{background:rgba(155,107,255,.38);border-color:#9b6bff}
.pss input{width:100%;box-sizing:border-box;font:inherit;color:inherit;padding:8px 10px;border-radius:10px;border:1px solid rgba(255,255,255,.2);background:rgba(0,0,0,.35)}
.pss-row{display:flex;gap:8px;flex-wrap:wrap}
.pss-row > input{flex:1 1 160px;width:auto}
.pss-skel{height:12px;border-radius:6px;background:linear-gradient(90deg,rgba(255,255,255,.06),rgba(255,255,255,.16),rgba(255,255,255,.06));background-size:200% 100%;animation:pss-shimmer 1.4s linear infinite;margin:8px 0}
@keyframes pss-shimmer{to{background-position:-200% 0}}
.pss-note{padding:10px 12px;border-radius:10px;background:rgba(255,255,255,.05);color:#d8d4e6}
.pss-note.bad{background:rgba(255,93,93,.12);color:#ffb3b3}
.pss-note.warn{background:rgba(255,210,74,.1);color:#ffe29a}
.pss-note.ok{background:rgba(95,208,138,.12);color:#a7efc3}
.pss-note a{color:#ffd24a}
.pss-confirm{border:1px solid #ffd24a;border-radius:12px;padding:12px;background:rgba(255,210,74,.07)}
.pss-confirm dl{margin:0 0 10px;display:grid;grid-template-columns:auto 1fr;gap:4px 12px}
.pss-confirm dt{color:#9d97ad}
.pss-confirm dd{margin:0;overflow-wrap:anywhere}
.pss ol,.pss ul{margin:0;padding:0;list-style:none}
.pss li{display:flex;justify-content:space-between;gap:10px;padding:4px 0;border-bottom:1px solid rgba(255,255,255,.06)}
@media (prefers-reduced-motion:reduce){.pss-skel{animation:none}.pss button{transition:none}}
`;
	document.head.appendChild(st);
}

const el = (tag, props = {}, ...kids) => {
	const n = document.createElement(tag);
	for (const [k, v] of Object.entries(props)) {
		if (v == null) continue;
		if (k === 'class') n.className = v;
		else if (k === 'text') n.textContent = v;
		else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
		else n.setAttribute(k, v);
	}
	for (const kid of kids) if (kid) n.append(kid);
	return n;
};

export class PlazaStageShow {
	/**
	 * @param {object} opts
	 * @param {string} opts.stageId
	 * @param {object} opts.coin
	 * @param {import('three').Camera} opts.camera  carries the audio listener
	 * @param {import('three').Group} opts.hostAnchor
	 * @param {import('three').Group} opts.audienceAnchor
	 * @param {object} opts.ui  CommunityUI (toasts)
	 * @param {object|null} opts.detail  the plaza's marquee state
	 * @param {(patch:object) => void} opts.onShowState
	 * @param {() => boolean} [opts.isPowerSaver]
	 * @param {object} [opts.deps]  injectable collaborators (tests)
	 */
	constructor({ stageId, coin, camera, hostAnchor, audienceAnchor, ui, detail, onShowState, isPowerSaver, deps = {} }) {
		this.stageId = stageId;
		this.coin = coin || {};
		this.camera = camera;
		this.hostAnchor = hostAnchor;
		this.audienceAnchor = audienceAnchor;
		this.ui = ui;
		this.onShowState = onShowState || (() => {});
		this.isPowerSaver = isPowerSaver || (() => false);
		this.deps = deps;
		this.detail = normalizeDetail(detail);
		this.reduced = prefersReducedMotion();

		this.net = null;
		this.voice = null;
		this._unsubs = [];
		this._disposed = false;
		this._started = false;
		this._speaking = false;
		this._open = false;
		this._tipPending = null; // { amount } while the confirm step is showing
		this._tipping = false;
		this._tipAmount = TIP_PRESETS[1];
		this._seenTips = new Set();
		this._ticker = [];
		this._board = [];
		this._audience = { count: 0, selfId: null };
		this._seats = new Map();
		this._seatGeo = null;
		this._seatMats = null;
		this._seatGroup = null;
		this._caption = { text: '', speaking: false };
		this._net = 'connecting';
		this._notice = null; // { text, kind, action? }

		this._host = null; // { rig, anim, release }
		this._listener = null;
		this._positional = null;
		this._mouth = null;
		this._hostPlaceholder = null;

		this.root = null;
	}

	// ── lifecycle ─────────────────────────────────────────────────────────────
	async start() {
		if (this._started || this._disposed) return;
		this._started = true;
		injectCss();
		this._buildDom();
		this._buildSeats();
		this._render();

		const net = this.deps.createNet
			? this.deps.createNet({ stageId: this.stageId })
			: new StageNet({ stageId: this.stageId, name: this._playerName(), avatar: '' });
		this.net = net;

		this._unsubs.push(
			net.on('status', ({ status }) => { this._net = status; this._render(); this._publish(); }),
			net.on('host', (h) => this._onHost(h)),
			net.on('utterance', (u) => this._onUtterance(u)),
			net.on('audience', (a) => this._onAudience(a)),
			net.on('tip', (tip) => this._onTip(tip)),
			net.on('leaderboard', (lb) => this._onLeaderboard(lb)),
			net.on('reaction', (r) => { if (r?.ack) this._flash(t('play.stage_question_ack', 'Your question is in the host queue.')); }),
		);

		this._mountHost();
		await net.connect();
	}

	dispose() {
		if (this._disposed) return;
		this._disposed = true;
		for (const off of this._unsubs) { try { off(); } catch {} }
		this._unsubs = [];
		try { this.net?.destroy(); } catch {}
		this.net = null;
		try { this.voice?.dispose(); } catch {}
		this.voice = null;
		this._mouth?.dispose?.();
		this._mouth = null;
		if (this._positional) {
			try { this._positional.stop?.(); } catch {}
			this._positional.parent?.remove(this._positional);
			try { this._positional.disconnect?.(); } catch {}
			this._positional = null;
		}
		if (this._listener) {
			this.camera?.remove?.(this._listener);
			this._listener = null;
		}
		this._unmountHost();
		if (this._seatGroup) {
			this.audienceAnchor.remove(this._seatGroup);
			this._seatGroup = null;
		}
		this._seatGeo?.ring?.dispose();
		this._seatGeo?.dot?.dispose();
		for (const m of Object.values(this._seatMats || {})) m.dispose();
		this._seatGeo = null;
		this._seatMats = null;
		this._seats.clear();
		this._returnFocus = null;
		this.root?.remove();
		this.root = null;
	}

	_playerName() {
		try { return localStorage.getItem('cc-name') || ''; } catch { return ''; }
	}

	// ── interface the landmark calls ──────────────────────────────────────────
	setStageDetail(data) {
		this.detail = normalizeDetail(data);
		this._render();
	}

	togglePanel() {
		if (this._disposed || !this.root) return;
		this._open = !this._open;
		this._render();
		if (this._open) {
			this._returnFocus = document.activeElement;
			this.panelClose?.focus();
		} else {
			this._returnFocus?.focus?.();
		}
	}

	panelOpen() { return this._open; }
	isSpeaking() { return this._speaking; }

	tick(dt) {
		if (this._disposed) return;
		this._host?.anim?.update?.(dt);
	}

	/**
	 * A question for the host, from the panel or the in-world chat bar.
	 * @returns {'sent'|'offline'|'empty'}
	 */
	ask(text) {
		const q = String(text || '').trim().slice(0, 280);
		if (!q) return 'empty';
		const ok = this.net?.ask(q);
		this._flash(ok
			? t('play.stage_question_sent', 'Question sent. The host picks from the queue.')
			: t('play.stage_question_offline', 'The live feed is offline. Retry the feed, then ask again.'), ok ? 'ok' : 'bad');
		return ok ? 'sent' : 'offline';
	}

	// ── tips: an on-chain $THREE spend, gated by an explicit confirm ──────────
	/** Stage 1: show recipient, amount and token. Nothing is signed. */
	requestTip(amount) {
		const n = Number(amount);
		if (!TIP_PRESETS.includes(n)) return false;
		if (!this.detail.hostWallet) {
			this._notice = { text: t('play.stage_tip_nowallet', 'This host has no wallet to tip yet.'), kind: 'bad' };
			this._render();
			return false;
		}
		if (!this.detail.live) {
			this._notice = { text: t('play.stage_tip_notlive', 'Tips open when the host goes live.'), kind: 'warn' };
			this._render();
			return false;
		}
		this._tipAmount = n;
		this._tipPending = { amount: n };
		this._notice = null;
		this._render();
		return true;
	}

	cancelTip() {
		this._tipPending = null;
		this._notice = null;
		this._render();
	}

	/** Stage 2: the only path that signs. A no-op without a pending confirm. */
	async confirmTip() {
		const pending = this._tipPending;
		if (!pending || this._tipping || this._disposed) return null;
		this._tipPending = null;
		this._tipping = true;
		const message = this.els?.tipMsg?.value || '';
		this._notice = { text: tipStageLabel('connecting'), kind: 'warn' };
		this._render();
		try {
			const tipAgent = this.deps.tipAgent || (await import('../shared/agent-tip.js')).tipAgent;
			const res = await settleStageTip({
				stageId: this.stageId,
				hostWallet: this.detail.hostWallet,
				amount: pending.amount,
				message,
				sessionId: this.net?.sessionId || null,
				tipAgent,
				apiFetch: this.deps.apiFetch,
				sleep: this.deps.sleep,
				onStage: (s) => { this._notice = { text: tipStageLabel(s), kind: 'warn' }; this._render(); },
			});
			if (this._disposed) return res;
			this._notice = res.pending
				? { text: t('play.stage_tip_pending', 'Sent. It appears on the leaderboard once the network confirms it.'), kind: 'warn' }
				: { text: t('play.stage_tip_ok', 'Tipped {{amount}} $THREE. Thank you!', { amount: fmtAmount(pending.amount) }), kind: 'ok' };
			if (this.els?.tipMsg) this.els.tipMsg.value = '';
			return res;
		} catch (err) {
			if (this._disposed) return null;
			this._notice = describeTipError(err);
			return null;
		} finally {
			this._tipping = false;
			if (!this._disposed) this._render();
		}
	}

	// ── net events ────────────────────────────────────────────────────────────
	_onHost(h) {
		if (!h) return;
		this._caption = { text: h.caption || '', speaking: !!h.speaking };
		if (h.caption || h.speaking) this.detail = { ...this.detail, live: true, host: h.name || this.detail.host };
		this._render();
		this._publish();
	}

	_onUtterance(u) {
		if (!u?.text || this._disposed) return;
		this._voiceFor().speak(u.text, u.voice || this.detail.voice).catch((err) => {
			log.warn('[plaza-stage-show] speak failed:', err?.message || err);
		});
	}

	_onAudience(a) {
		this._audience = { count: a.count, selfId: a.selfId };
		this._syncSeats(a.members || [], a.selfId);
		this._render();
		this._publish();
	}

	_onLeaderboard(lb) {
		this._board = lb.rows || [];
		this._totals = { atomic: lb.totalTipsAtomic, count: lb.tipCount };
		this._render();
		this._publish();
	}

	// A tip event can be replayed (reconnect, bridge retry). The key is the
	// settlement link when the server sent one, else the row's own identity, so
	// the same settlement shows once.
	_onTip(tip) {
		if (!tip) return;
		const key = tip.explorer || `${tip.ts}:${tip.label}:${tip.amount}`;
		if (this._seenTips.has(key)) return;
		this._seenTips.add(key);
		const line = `${tip.label || 'Someone'} tipped ${fmtThreeAtomic(tip.amount)} $THREE`;
		this._ticker = [{ line, message: tip.message || '' }, ...this._ticker].slice(0, MAX_TICKER);
		this._render();
	}

	_publish() {
		this.onShowState({
			audience: this._audience.count,
			leaderboard: this._board.map((r) => ({ label: r.label, total: r.total, count: r.count })),
			totalTipsAtomic: this._totals?.atomic ?? 0,
			tipCount: this._totals?.count ?? 0,
			lastLine: this._caption.text,
			...(this._net === 'online' && this.detail.live ? { phase: 'live' } : {}),
		});
	}

	// ── the host body ─────────────────────────────────────────────────────────
	_voiceFor() {
		if (this.voice) return this.voice;
		this.voice = this.deps.createVoice
			? this.deps.createVoice({ getPositionalAudio: () => this._positional, getMouthTarget: () => this._mouth })
			: new StageVoice({
				getPositionalAudio: () => this._positional,
				getMouthTarget: () => this._mouth,
				onSpeaking: (s) => { this._speaking = s; },
				onAutoplayBlocked: () => this._flash(t('play.stage_tap_audio', 'Tap anywhere to hear the host.'), 'warn'),
			});
		return this.voice;
	}

	_mountHost() {
		// The designed placeholder goes up at once and stays if the GLB is blocked,
		// so the host is never invisible and never a T-pose.
		this._hostPlaceholder = this.deps.makePlaceholder ? this.deps.makePlaceholder() : makePlaceholderBody();
		this.hostAnchor.add(this._hostPlaceholder);
		if (this.isPowerSaver() && !this.deps.loadHost) return;
		const load = this.deps.loadHost || defaultLoadHost;
		load(this.detail.hostAvatar, this.hostAnchor).then((host) => {
			if (!host) return;
			if (this._disposed) { host.release?.(); return; }
			this._host = host;
			if (this._hostPlaceholder) {
				this.hostAnchor.remove(this._hostPlaceholder);
				disposeTree(this._hostPlaceholder);
				this._hostPlaceholder = null;
			}
			this._attachAudio(host.rig);
		}).catch((err) => log.warn('[plaza-stage-show] host avatar blocked, keeping the placeholder:', err?.message || err));
	}

	_attachAudio(rig) {
		this._mouth = new MouthTarget(rig);
		if (!this.camera) return;
		this._listener = this.deps.makeListener ? this.deps.makeListener() : new AudioListener();
		this.camera.add(this._listener);
		this._positional = this.deps.makePositional ? this.deps.makePositional(this._listener) : new PositionalAudio(this._listener);
		this._positional.setRefDistance?.(2.4);
		this._positional.setRolloffFactor?.(1.1);
		this._positional.setDistanceModel?.('inverse');
		(findHead(rig) || rig).add(this._positional);
	}

	_unmountHost() {
		if (this._hostPlaceholder) {
			this.hostAnchor.remove(this._hostPlaceholder);
			disposeTree(this._hostPlaceholder);
			this._hostPlaceholder = null;
		}
		if (this._host) {
			this.hostAnchor.remove(this._host.rig);
			try { this._host.anim?.dispose?.(); } catch {}
			try { this._host.release?.(); } catch {}
			this._host = null;
		}
	}

	// ── seats ─────────────────────────────────────────────────────────────────
	_buildSeats() {
		this._seatGroup = new Group();
		this._seatGroup.name = 'plaza-stage-seats';
		this.audienceAnchor.add(this._seatGroup);
		this._seatGeo = { ring: new RingGeometry(0.28, 0.4, 24), dot: new CircleGeometry(0.2, 16) };
		const mat = (color) => new MeshBasicMaterial({ color, transparent: true, opacity: 0.85, side: DoubleSide });
		this._seatMats = { guest: mat(0x6f5fb0), self: mat(0x32d6ff), vip: mat(0xffb020) };
	}

	_syncSeats(members, selfId) {
		if (!this._seatGroup) return;
		const cap = this.isPowerSaver() ? MAX_SEATS_SAVER : MAX_SEATS;
		const shown = members.slice(0, cap);
		const live = new Set();
		for (const m of shown) {
			live.add(m.id);
			const kind = m.id === selfId ? 'self' : (m.vip ? 'vip' : 'guest');
			let seat = this._seats.get(m.id);
			if (!seat) {
				seat = new Group();
				const ring = new Mesh(this._seatGeo.ring, this._seatMats[kind]);
				const dot = new Mesh(this._seatGeo.dot, this._seatMats[kind]);
				ring.rotation.x = dot.rotation.x = -Math.PI / 2;
				seat.add(ring, dot);
				seat.userData = { kind, ring, dot };
				this._seatGroup.add(seat);
				this._seats.set(m.id, seat);
			} else if (seat.userData.kind !== kind) {
				seat.userData.kind = kind;
				seat.userData.ring.material = seat.userData.dot.material = this._seatMats[kind];
			}
			seat.position.set(m.x, 0.06, m.z);
			seat.scale.setScalar(kind === 'self' ? 1.25 : 1);
		}
		for (const [id, seat] of this._seats) {
			if (!live.has(id)) { this._seatGroup.remove(seat); this._seats.delete(id); }
		}
	}

	// ── the panel ─────────────────────────────────────────────────────────────
	_buildDom() {
		this.els = {};
		this.root = el('div', { class: 'pss', 'data-plaza-stage-show': '' });
		this.els.caption = el('div', { class: 'pss-caption', role: 'status', 'aria-live': 'polite', hidden: '' });
		this.els.panel = el('section', {
			class: 'pss-panel', role: 'dialog', 'aria-label': t('play.stage_panel_label', 'Plaza stage'), hidden: '',
		});
		this.root.append(this.els.caption, this.els.panel);
		this.root.addEventListener('keydown', (e) => {
			if (e.key === 'Escape' && this._open) { e.stopPropagation(); this.togglePanel(); }
		});
		document.body.appendChild(this.root);
	}

	_flash(text, kind = 'ok') {
		this._notice = { text, kind };
		this._render();
	}

	_render() {
		if (!this.root || this._disposed) return;
		const { caption, panel } = this.els;

		// Live caption, readable with the panel closed.
		const cap = this._caption;
		caption.hidden = !(cap.text && this.detail.live !== false);
		caption.dataset.speaking = String(!!cap.speaking);
		if (!caption.hidden) {
			caption.replaceChildren(
				el('small', { text: this.detail.host || t('play.stage_host', 'Host') }),
				document.createTextNode(cap.text),
			);
		}

		panel.hidden = !this._open;
		if (!this._open) return;
		// Keep a half-typed question and tip note across re-renders.
		const keepAsk = this.els.askInput?.value || '';
		const keepMsg = this.els.tipMsg?.value || '';
		const hadFocus = panel.contains(document.activeElement) ? document.activeElement?.dataset?.focusKey : null;
		panel.replaceChildren(...this._panelBody(keepAsk, keepMsg));
		if (hadFocus) panel.querySelector(`[data-focus-key="${hadFocus}"]`)?.focus();
	}

	_panelBody(keepAsk, keepMsg) {
		const d = this.detail;
		const out = [];
		const live = d.live && this._net === 'online';

		this.panelClose = el('button', {
			type: 'button', 'aria-label': t('play.stage_close', 'Close the stage panel'), 'data-focus-key': 'close',
			onclick: () => this.togglePanel(),
		}, document.createTextNode('✕'));
		out.push(el('div', { class: 'pss-head' },
			el('div', {},
				el('h2', { text: d.title || t('play.stage_title', 'The Plaza Stage') }),
				el('div', { class: 'pss-sub', text: this._subline() })),
			this.panelClose));

		// Loading, error and empty are each their own designed state.
		if (this._net === 'connecting' || this._net === 'idle') {
			out.push(el('div', { 'aria-busy': 'true', 'aria-label': t('play.stage_loading', 'Connecting to the show') },
				el('div', { class: 'pss-skel' }), el('div', { class: 'pss-skel', style: 'width:70%' }), el('div', { class: 'pss-skel', style: 'width:85%' })));
			return out;
		}
		if (this._net === 'offline' || this._net === 'failed' || this._net === 'unavailable') {
			out.push(el('div', { class: 'pss-note bad' },
				el('div', { text: t('play.stage_feed_offline', 'The performance feed is offline. Captions, tips and questions need it.') }),
				el('button', {
					type: 'button', 'data-focus-key': 'retry', style: 'margin-top:8px',
					onclick: () => { this.net?.retry(); },
				}, document.createTextNode(t('play.stage_retry', 'Retry the feed')))));
			return out;
		}
		if (!live) {
			out.push(el('div', { class: 'pss-note' }, document.createTextNode(this._emptyCopy())));
		}

		if (this._notice) {
			const n = el('div', { class: `pss-note ${this._notice.kind || ''}`, role: 'status' }, document.createTextNode(this._notice.text));
			if (this._notice.action) {
				n.append(' ', el('a', { href: this._notice.action.href, target: '_blank', rel: 'noopener noreferrer', text: this._notice.action.label }));
			}
			out.push(n);
		}

		// Leaderboard.
		out.push(el('h3', { text: t('play.stage_board', 'Top tippers') }));
		if (this._board.length) {
			out.push(el('ol', {}, ...this._board.slice(0, 5).map((r, i) =>
				el('li', {}, el('span', { text: `${i + 1}. ${r.label}` }), el('span', { text: `${fmtThreeAtomic(r.total)} $THREE` })))));
		} else {
			out.push(el('div', { class: 'pss-sub', text: t('play.stage_board_empty', 'No tips yet. Be the first on the board.') }));
		}
		if (this._ticker.length) {
			out.push(el('ul', { 'aria-label': t('play.stage_recent', 'Recent tips') },
				...this._ticker.map((x) => el('li', {}, el('span', { text: x.line + (x.message ? `: ${x.message}` : '') })))));
		}

		// Tip.
		out.push(el('h3', { text: t('play.stage_tip', 'Tip the host in $THREE') }));
		if (this._tipPending) out.push(this._confirmCard());
		else out.push(this._tipForm(keepMsg, live));

		// Ask.
		out.push(el('h3', { text: t('play.stage_ask', 'Ask the host') }));
		const input = el('input', {
			type: 'text', maxlength: '280', 'data-focus-key': 'ask',
			placeholder: t('play.stage_ask_ph', 'Your question'), 'aria-label': t('play.stage_ask', 'Ask the host'),
		});
		input.value = keepAsk;
		this.els.askInput = input;
		const send = () => { if (this.ask(input.value) === 'sent') input.value = ''; };
		input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.stopPropagation(); send(); } });
		out.push(el('div', { class: 'pss-row' }, input,
			el('button', { type: 'button', onclick: send }, document.createTextNode(t('play.stage_ask_send', 'Send')))));

		return out;
	}

	_tipForm(keepMsg, live) {
		const wrap = el('div', {});
		const row = el('div', { class: 'pss-row', role: 'group', 'aria-label': t('play.stage_amount', 'Tip amount in $THREE') });
		for (const amt of TIP_PRESETS) {
			row.append(el('button', {
				type: 'button', 'aria-pressed': String(this._tipAmount === amt), 'data-focus-key': `preset-${amt}`,
				disabled: this._tipping || !live ? '' : null,
				onclick: () => { this._tipAmount = amt; this.requestTip(amt); },
			}, document.createTextNode(fmtAmount(amt))));
		}
		const msg = el('input', {
			type: 'text', maxlength: String(MAX_TIP_MESSAGE), 'data-focus-key': 'tipmsg', style: 'margin-top:8px',
			placeholder: t('play.stage_tip_msg', 'Add a note (optional)'), 'aria-label': t('play.stage_tip_msg', 'Add a note (optional)'),
		});
		msg.value = keepMsg;
		this.els.tipMsg = msg;
		wrap.append(row, msg);
		return wrap;
	}

	// The gate. Recipient, amount and token are on screen before anything signs.
	_confirmCard() {
		const amt = this._tipPending.amount;
		const dl = el('dl', {},
			el('dt', { text: t('play.stage_to', 'To') }), el('dd', { text: this.detail.hostWallet, title: this.detail.hostWallet }),
			el('dt', { text: t('play.stage_amount_l', 'Amount') }), el('dd', { text: `${fmtAmount(amt)} $THREE` }),
			el('dt', { text: t('play.stage_chain', 'Network') }), el('dd', { text: 'Solana' }));
		return el('div', { class: 'pss-confirm', role: 'group', 'aria-label': t('play.stage_confirm', 'Confirm your tip') },
			el('div', { text: t('play.stage_confirm_text', 'Your wallet will ask you to sign this transfer. It cannot be undone.') }),
			dl,
			el('div', { class: 'pss-row' },
				el('button', { type: 'button', class: 'pss-primary', 'data-focus-key': 'confirm', onclick: () => this.confirmTip() },
					document.createTextNode(t('play.stage_confirm_go', 'Confirm and sign'))),
				el('button', { type: 'button', 'data-focus-key': 'cancel', onclick: () => this.cancelTip() },
					document.createTextNode(t('play.stage_cancel', 'Cancel')))));
	}

	_subline() {
		const d = this.detail;
		const bits = [];
		if (d.host) bits.push(d.host);
		if (this._audience.count) bits.push(t('play.stage_watching', '{{n}} watching', { n: this._audience.count }));
		if (d.hostWallet) bits.push(shortWallet(d.hostWallet));
		return bits.join(' · ');
	}

	_emptyCopy() {
		const d = this.detail;
		if (!d.claimed) return t('play.stage_unclaimed', 'No host has claimed this stage. Put an agent on it from /stage.');
		if (d.nextShowAt > Date.now()) {
			return t('play.stage_next', 'No show right now. Next show: {{when}}.', { when: new Date(d.nextShowAt).toLocaleString() });
		}
		return t('play.stage_dark', 'The stage is dark. The host has no show scheduled; check back soon.');
	}
}

// ── helpers ──────────────────────────────────────────────────────────────────

/** Designed stand-in so the stage always has a body: a lit stylised host, never a T-pose. */
function makePlaceholderBody() {
	const g = new Group();
	const skin = new MeshStandardMaterial({ color: 0x6b4bd6, emissive: 0x3a1f7a, emissiveIntensity: 0.7, roughness: 0.4 });
	const torso = new Mesh(new CapsuleGeometry(0.3, 0.8, 4, 12), skin);
	torso.position.y = 0.75;
	const head = new Mesh(new SphereGeometry(0.22, 16, 12), skin);
	head.position.y = 1.45;
	g.add(torso, head);
	g.name = 'plaza-stage-host-placeholder';
	return g;
}

async function defaultLoadHost(url, anchor) {
	const { resolveAvatarUrl, buildAvatar, releaseAvatar, newAnim } = await import('./avatar-rig.js');
	const rig = new Group();
	const anim = newAnim();
	const resolved = await resolveAvatarUrl(url || undefined);
	const res = await buildAvatar(rig, resolved, anim, { clips: 'locomotion' });
	const scale = res.height > 0 ? HOST_HEIGHT_M / res.height : 1;
	rig.scale.setScalar(scale);
	anchor.add(rig);
	return { rig, anim, release: () => releaseAvatar(rig) };
}

function disposeTree(root) {
	root.traverse((n) => {
		if (!n.isMesh) return;
		n.geometry?.dispose?.();
		for (const m of Array.isArray(n.material) ? n.material : [n.material]) m?.dispose?.();
	});
}
