/**
 * The Net-Worth-Reactive Avatar — visual layer.
 *
 * Renders a tasteful, real-data-driven treatment AROUND an agent's 3D avatar so
 * a funded agent visibly *looks* funded. The look is a pure function of the
 * agent's real wallet state (see wallet-networth.js): a tiered aura/rim-glow, an
 * accent palette informed by the real asset mix, an optional GPU-cheap particle
 * field, and a one-shot flourish fired only by a REAL confirmed on-chain inflow.
 *
 * Why only three.ws can do this: the glow is welded to a real, self-custodial
 * wallet bound to a rigged, ownable 3D agent. Change the wallet, the body
 * changes — no random, no timer-driven decoration.
 *
 * Craft:
 *   - The aura wraps the avatar container (works over <model-viewer> and the
 *     galaxy alike) without touching the GLB, so it is consistent on every
 *     surface and never blocks model interaction (pointer-events: none).
 *   - LOD: `card` is CSS-only (cheap for dense grids); `full` adds a capped,
 *     visibility-gated canvas particle field. Off-screen auras pause their rAF.
 *   - `prefers-reduced-motion`: a static, richer treatment instead of animation.
 *   - Whale balances are capped upstream so the effect never eye-sears.
 */

import {
	fetchWalletState, computeWalletVisual, formatNetWorth,
} from './wallet-networth.js';
import { fetchNetWorth } from './agent-networth.js';
import { fetchWealthState, computeWealthDynamics } from './agent-wealth-state.js';
import { trackLevelUp, installLevelUpCelebrations } from './wealth-levelup.js';

const STYLE_ID = 'tws-wallet-aura-styles';
const REDUCED_MOTION =
	typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

function ensureStyles() {
	if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return;
	const style = document.createElement('style');
	style.id = STYLE_ID;
	style.textContent = `
.wa-layer{position:absolute;inset:0;pointer-events:none;z-index:1;border-radius:inherit;overflow:hidden;
	opacity:0;transition:opacity var(--duration-base,.4s) var(--ease-standard,cubic-bezier(.4,0,.2,1));
	--wa-accent:var(--wallet-accent,#c4b5fd);--wa-glow:var(--wallet-glow,rgba(139,92,246,.45));--wa-i:0;}
.wa-layer[data-ready="true"]{opacity:1;}
/* A halo bloom AROUND the avatar — a transparent core means the figure is never
   washed out; the screen blend adds light only, so the body reads as emitting it.
   Intensity scales with real net worth. */
.wa-bloom{position:absolute;inset:-12%;border-radius:50%;mix-blend-mode:screen;
	background:radial-gradient(circle at 50% 60%,transparent 26%,var(--wa-glow) 48%,transparent 74%);
	opacity:calc(.25 + var(--wa-i) * .75);
	/* --wa-warm (−1..1, real 24h momentum): inflow warms the halo toward the
	   magenta-gold $THREE family, outflow cools it — a small, honest tilt. */
	filter:blur(calc(8px + var(--wa-i) * 22px)) hue-rotate(calc(var(--wa-warm,0) * 22deg)) saturate(calc(1 + var(--wa-warm,0) * .2));
	transform:scale(calc(.78 + var(--wa-i) * .4));
	transition:opacity .5s var(--ease-standard,ease),transform .6s var(--ease-standard,ease),filter .5s ease;
	will-change:transform,opacity;}
/* A crisp rim ring that reads even at card size. */
.wa-rim{position:absolute;inset:6%;border-radius:50%;
	box-shadow:0 0 0 1px var(--wa-accent), 0 0 calc(10px + var(--wa-i) * 40px) var(--wa-glow);
	opacity:calc(.18 + var(--wa-i) * .62);
	transition:opacity .5s var(--ease-standard,ease),box-shadow .5s ease;}
/* Slow conic shimmer, only at higher tiers and only when motion is allowed. */
.wa-shimmer{position:absolute;inset:-30%;border-radius:50%;mix-blend-mode:screen;opacity:0;
	background:conic-gradient(from 0deg,transparent 0deg,var(--wa-glow) 40deg,transparent 120deg,
		transparent 240deg,var(--wa-glow) 300deg,transparent 360deg);
	will-change:transform;}
.wa-layer[data-motion="true"][data-level-hi="true"] .wa-shimmer{opacity:calc(var(--wa-i) * .5);
	animation:wa-spin 14s linear infinite;}
@keyframes wa-spin{to{transform:rotate(360deg);}}
.wa-canvas{position:absolute;inset:0;width:100%;height:100%;pointer-events:none;}
/* One-shot flourish ring on a real confirmed inflow. */
.wa-flourish{position:absolute;left:50%;top:60%;width:30%;padding-bottom:30%;border-radius:50%;
	transform:translate(-50%,-50%) scale(.2);opacity:0;border:2px solid var(--wa-accent);
	box-shadow:0 0 30px var(--wa-glow);}
.wa-layer[data-motion="true"] .wa-flourish.wa-go{animation:wa-burst 1.1s var(--ease-standard,ease) forwards;}
@keyframes wa-burst{0%{transform:translate(-50%,-50%) scale(.2);opacity:0;}
	12%{opacity:.95;}100%{transform:translate(-50%,-50%) scale(2.4);opacity:0;}}
/* Drawdown reads honestly: a brief, non-punitive cool dim — no strobing. */
.wa-layer.wa-draw .wa-bloom{filter:grayscale(.4) blur(20px);opacity:.2;}
/* Reduced-motion static-but-richer: stronger steady bloom, no shimmer/particles. */
@media (prefers-reduced-motion: reduce){
	.wa-bloom,.wa-rim{transition:none;}
	.wa-layer .wa-shimmer{animation:none!important;}
	.wa-layer .wa-flourish{display:none;}
}
/* Optional net-worth tier badge a surface can opt into. */
.wa-badge{display:inline-flex;align-items:center;gap:6px;padding:3px 9px;border-radius:var(--radius-pill,999px);
	font:700 10px/1 var(--font-mono,ui-monospace,monospace);letter-spacing:.04em;text-transform:uppercase;
	color:var(--wa-accent);background:var(--wa-glow);border:1px solid var(--wa-accent);white-space:nowrap;}
/* Light theme: tier accents are pale glows tuned for a dark canvas (the dormant
   tier measured 2.1:1). Mixing a third of the accent into the ink keeps the tier
   hue readable at AA on the light badge fill. */
:root[data-theme='light'] .wa-badge{color:color-mix(in srgb,var(--wa-accent) 35%,var(--ink,#1d212b));}
.wa-badge .wa-badge-dot{width:6px;height:6px;border-radius:50%;background:var(--wa-accent);
	box-shadow:0 0 6px var(--wa-accent);}
/* ── Embodied-finance dynamics: live modifiers on top of the static tier ────── */
/* Streaming now: a slow, gentle "earning" breath on the rim — calm, never a slot
   machine — that plays only while a real money stream is crediting the agent. */
.wa-layer[data-streaming="true"][data-motion="true"] .wa-rim{animation:wa-breathe 3.4s var(--ease-standard,ease) infinite;}
@keyframes wa-breathe{0%,100%{opacity:calc(.18 + var(--wa-i) * .62);}50%{opacity:calc(.40 + var(--wa-i) * .60);}}
/* A drawdown day reads honestly: a slightly calmer, cooler bloom (no strobe). */
.wa-layer[data-trend="down"] .wa-bloom{opacity:calc(.18 + var(--wa-i) * .55);}
/* A just-landed tip leaves a brief steadier halo after the burst (recency). */
.wa-layer[data-recent-tip="true"] .wa-rim{box-shadow:0 0 0 1px var(--wa-accent),0 0 calc(16px + var(--wa-i) * 48px) var(--wa-glow);}
@media (prefers-reduced-motion: reduce){
	.wa-layer[data-streaming="true"] .wa-rim{animation:none;opacity:calc(.32 + var(--wa-i) * .6);}
}
`;
	(document.head || document.documentElement).appendChild(style);
}

/**
 * Mount the aura layer into a container that holds an avatar (a <model-viewer>
 * stage, a card thumb, etc.). The container is made position:relative if static.
 *
 * @param {HTMLElement} container
 * @param {object} [opts]
 * @param {'full'|'card'|'auto'} [opts.lod='auto']
 * @returns {{ applyVisual(v), update(state), flourish(kind), destroy(), el }}
 */
export function mountWalletAura(container, opts = {}) {
	if (!container) return null;
	ensureStyles();

	const cs = getComputedStyle(container);
	if (cs.position === 'static') container.style.position = 'relative';

	let lod = opts.lod || 'auto';
	if (lod === 'auto') {
		const w = container.clientWidth || 0;
		lod = w >= 340 ? 'full' : 'card';
	}

	const layer = document.createElement('div');
	layer.className = 'wa-layer';
	layer.setAttribute('aria-hidden', 'true');
	layer.dataset.motion = REDUCED_MOTION ? 'false' : 'true';
	layer.innerHTML =
		'<div class="wa-bloom"></div><div class="wa-shimmer"></div><div class="wa-rim"></div>' +
		'<div class="wa-flourish"></div>';

	const canvas = lod === 'full' && !REDUCED_MOTION ? document.createElement('canvas') : null;
	if (canvas) { canvas.className = 'wa-canvas'; layer.appendChild(canvas); }

	// Insert as the first child so it sits behind the model content.
	container.insertBefore(layer, container.firstChild);

	const particles = new ParticleField(canvas);
	let visual = null;
	let visible = true;
	// The owner's reactivity preference (persisted server-side, fetched by the
	// presence panel and pushed in via setPrefs). Until known, the aura renders at
	// full strength; once known, a muted aura or 'off' reactivity dampens it to a
	// quiet presence floor, and 'events: false' suppresses the live flourish — so a
	// visitor always sees the agent exactly as its owner configured it. null = not
	// yet known → full default.
	let prefs = null;
	// The static tier intensity from the last applyVisual, and the live flow
	// dynamics (momentum/streaming/recency) layered on top of it. Kept separate so
	// a balance refresh and a momentum tick can each re-render without the other.
	let baseIntensity = 0;
	let dynamics = null;

	const auraMuted = () => !!prefs && (prefs.reactivity === 'off' || prefs.signals?.aura === false);
	const eventsMuted = () => !!prefs && (prefs.reactivity === 'off' || prefs.signals?.events === false);

	// Pause the particle rAF when the avatar scrolls off-screen — dense lists and
	// the galaxy must not pay for auras nobody is looking at.
	let io = null;
	if (canvas && typeof IntersectionObserver === 'function') {
		io = new IntersectionObserver((entries) => {
			visible = entries.some((e) => e.isIntersecting);
			if (visible) particles.start(); else particles.stop();
		}, { threshold: 0.01 });
		io.observe(container);
	}

	function applyVisual(v) {
		visual = v;
		// When the owner has muted the wealth aura (or turned reactivity off), keep a
		// flat minimal presence floor — the agent still reads as itself, just calm.
		const muted = auraMuted();
		const intensity = muted ? 0.04 : v.intensity;
		layer.style.setProperty('--wa-accent', v.accent);
		layer.style.setProperty('--wa-glow', v.glow);
		layer.style.setProperty('--wa-i', intensity.toFixed(3));
		layer.dataset.level = String(muted ? 0 : v.level);
		layer.dataset.levelHi = !muted && v.level >= 3 ? 'true' : 'false';
		layer.dataset.tier = v.tier;
		layer.dataset.muted = muted ? 'true' : 'false';
		// The layer is always present (it fades in on ready); a dormant wallet just
		// renders a whisper-quiet baseline, never absent and never broken.
		layer.dataset.ready = 'true';
		if (v.dormant && !muted) layer.style.setProperty('--wa-i', '0.04');
		// A muted aura runs no particle field — it's a still presence, not a glow.
		particles.configure(muted ? { ...v, dormant: true, particleDensity: 0 } : v);
		if (visible) particles.start();
		// Remember the tier floor so live dynamics layer on without losing it.
		baseIntensity = muted ? 0.04 : (v.dormant ? 0.04 : intensity);
		applyDynamics();
	}

	/**
	 * Layer the live flow dynamics (real 24h momentum, active streams, tip
	 * recency — see agent-wealth-state.computeWealthDynamics) on top of the static
	 * tier. Bounded: momentum only nudges intensity within a small band and the
	 * warmth tilt stays inside the wallet-violet family, so the tier always
	 * dominates and an earning agent never eye-sears. A muted/dormant aura ignores
	 * dynamics entirely — it stays a quiet presence.
	 */
	function applyDynamics() {
		const muted = auraMuted();
		const d = (!muted && !eventsMuted()) ? dynamics : null;
		if (!d) {
			layer.style.setProperty('--wa-warm', '0');
			layer.dataset.trend = 'flat';
			layer.dataset.streaming = 'false';
			layer.dataset.recentTip = 'false';
			layer.style.setProperty('--wa-i', baseIntensity.toFixed(3));
			return;
		}
		const i = Math.max(0, Math.min(1, baseIntensity + (Number(d.intensityDelta) || 0)));
		layer.style.setProperty('--wa-i', i.toFixed(3));
		layer.style.setProperty('--wa-warm', (Number(d.warmth) || 0).toFixed(3));
		layer.dataset.trend = d.trend || 'flat';
		layer.dataset.streaming = d.streaming ? 'true' : 'false';
		layer.dataset.recentTip = d.recentTip ? 'true' : 'false';
	}

	/**
	 * Push the latest real wealth dynamics. Idempotent and cheap — call it on
	 * every poll. Pass null to clear (e.g. RPC outage → fall back to the static
	 * tier rather than a stale trend).
	 */
	function setDynamics(d) {
		dynamics = d && typeof d === 'object' ? d : null;
		applyDynamics();
	}

	/**
	 * Apply the owner's saved reactivity prefs. Re-renders the current visual gated
	 * by the new prefs so the change is immediate (the presence panel calls this on
	 * the owner's first read and after every toggle). Safe to call before any data.
	 */
	function setPrefs(p) {
		prefs = p && typeof p === 'object' ? p : null;
		if (visual) applyVisual(visual);
	}

	async function update(stateOrAgent) {
		const state = stateOrAgent && stateOrAgent.usdTotal !== undefined
			? stateOrAgent
			: await fetchWalletState(stateOrAgent, { network: opts.network });
		applyVisual(computeWalletVisual(state));
		layer.__state = state;
		return state;
	}

	function flourish(kind = 'inflow') {
		if (REDUCED_MOTION) return;
		// The owner can mute live reactions while keeping the steady aura.
		if (eventsMuted()) return;
		if (kind === 'drawdown') {
			layer.classList.add('wa-draw');
			setTimeout(() => layer.classList.remove('wa-draw'), 900);
			return;
		}
		const ring = layer.querySelector('.wa-flourish');
		if (ring) {
			ring.classList.remove('wa-go');
			// reflow to restart the animation
			void ring.offsetWidth;
			ring.classList.add('wa-go');
		}
		particles.burst();
	}

	function destroy() {
		try { io?.disconnect(); } catch { /* noop */ }
		particles.destroy();
		layer.remove();
	}

	return { applyVisual, update, flourish, setPrefs, setDynamics, destroy, el: layer, get state() { return layer.__state; } };
}

/**
 * A capped, additive-blended orbiting particle field on a 2D canvas. Cheap: a
 * few dozen points, no per-frame allocation, paused when off-screen. The count
 * and speed are a function of the real net-worth tier, so a richer wallet has a
 * denser, livelier field — still bounded so it never tanks frame rate.
 */
class ParticleField {
	constructor(canvas) {
		this.canvas = canvas;
		this.ctx = canvas ? canvas.getContext('2d') : null;
		this.points = [];
		this.target = 0;
		this.hue = 258;
		this.speed = 1;
		this.raf = 0;
		this.running = false;
		this.dpr = Math.min(devicePixelRatio || 1, 2);
		this._tick = this._tick.bind(this);
		if (canvas) {
			this._ro = new ResizeObserver(() => this._resize());
			this._ro.observe(canvas);
		}
	}

	configure(v) {
		if (!this.ctx) return;
		this.target = v.dormant ? 0 : v.particleDensity;
		this.hue = v.rimHue;
		this.speed = 0.35 + v.intensity * 0.9;
		this.intensity = v.intensity;
	}

	_resize() {
		if (!this.canvas) return;
		const w = this.canvas.clientWidth || 1;
		const h = this.canvas.clientHeight || 1;
		this.canvas.width = Math.round(w * this.dpr);
		this.canvas.height = Math.round(h * this.dpr);
	}

	_spawn() {
		const a = Math.random() * Math.PI * 2;
		const r = 0.28 + Math.random() * 0.22;
		return {
			a, r,
			rad: 0.6 + Math.random() * 1.8,
			drift: (Math.random() - 0.5) * 0.0015,
			ar: 0.002 + Math.random() * 0.004,
			life: Math.random(),
		};
	}

	start() {
		if (!this.ctx || this.running) return;
		this.running = true;
		this._resize();
		this.raf = requestAnimationFrame(this._tick);
	}

	stop() {
		this.running = false;
		if (this.raf) cancelAnimationFrame(this.raf);
		this.raf = 0;
	}

	burst() {
		if (!this.ctx) return;
		for (let i = 0; i < 14; i++) {
			const p = this._spawn();
			p.r = 0.12;
			p.rad = 1.2 + Math.random() * 2.2;
			p.burst = 1;
			this.points.push(p);
		}
		this.start();
	}

	_tick() {
		if (!this.running) return;
		const { ctx, canvas } = this;
		const w = canvas.width, h = canvas.height;
		ctx.clearRect(0, 0, w, h);

		// Grow/shrink the steady population toward the tier target.
		if (this.points.filter((p) => !p.burst).length < this.target) this.points.push(this._spawn());
		else if (this.points.filter((p) => !p.burst).length > this.target) {
			const i = this.points.findIndex((p) => !p.burst);
			if (i >= 0) this.points.splice(i, 1);
		}

		const cx = w * 0.5, cy = h * 0.58;
		const base = Math.min(w, h);
		ctx.globalCompositeOperation = 'lighter';
		for (let i = this.points.length - 1; i >= 0; i--) {
			const p = this.points[i];
			p.a += p.ar * this.speed;
			p.r += p.drift + (p.burst ? 0.004 * this.speed : 0);
			p.life += 0.004 * this.speed;
			const x = cx + Math.cos(p.a) * p.r * base;
			const y = cy + Math.sin(p.a) * p.r * base * 0.78;
			const tw = 0.5 + 0.5 * Math.sin(p.life * 6.28);
			const alpha = (p.burst ? Math.max(0, 1 - (p.r - 0.12) * 2.2) : 0.5 + this.intensity * 0.4) * tw;
			if (p.burst && (p.r > 0.6 || alpha <= 0.02)) { this.points.splice(i, 1); continue; }
			ctx.beginPath();
			ctx.fillStyle = `hsla(${this.hue} 90% 78% / ${alpha.toFixed(3)})`;
			ctx.arc(x, y, p.rad * this.dpr, 0, Math.PI * 2);
			ctx.fill();
		}
		ctx.globalCompositeOperation = 'source-over';
		this.raf = requestAnimationFrame(this._tick);
	}

	destroy() {
		this.stop();
		try { this._ro?.disconnect(); } catch { /* noop */ }
		this.points = [];
	}
}

/**
 * Watch an agent's wallet for a REAL confirmed inflow and fire the avatar's
 * one-shot flourish. The trigger is the real on-chain balance delta, sampled by
 * a visibility-gated poll of the public balance endpoint (cached 60s server-
 * side) — the animation only ever plays because lamports actually changed on
 * chain, never on a bare timer. A real drawdown reads honestly (a brief dim).
 *
 * @param {string} agentId
 * @param {{flourish(kind):void, update(s):any, el:HTMLElement}} controller
 * @param {object} [opts] { network, intervalMs }
 * @returns {() => void} stop fn
 */
export function startWalletLiveReaction(agentId, controller, opts = {}) {
	if (!agentId || !controller) return () => {};
	const network = opts.network === 'devnet' ? 'devnet' : 'mainnet';
	const intervalMs = Math.max(15_000, opts.intervalMs || 30_000);
	let lastLamports = null;
	let timer = 0;
	let stopped = false;
	let visible = true;

	const io = controller.el && typeof IntersectionObserver === 'function'
		? new IntersectionObserver((es) => { visible = es.some((e) => e.isIntersecting); }, { threshold: 0.01 })
		: null;
	if (io) io.observe(controller.el);

	async function poll() {
		if (stopped) return;
		if (!visible) { schedule(); return; }
		try {
			const r = await fetch(`/api/agents/${encodeURIComponent(agentId)}/solana?network=${network}`, {
				headers: { accept: 'application/json' },
			});
			const body = await r.json().catch(() => ({}));
			const lamports = body?.data?.lamports;
			if (typeof lamports === 'number') {
				if (lastLamports != null && lamports !== lastLamports) {
					// A real confirmed delta. Refresh the full priced state (so tier +
					// palette re-derive from real holdings) and play the matching flourish.
					controller.update(agentId).catch(() => {});
					controller.flourish(lamports > lastLamports ? 'inflow' : 'drawdown');
				}
				lastLamports = lamports;
			}
		} catch {
			/* transient network/RPC hiccup — keep polling, never surface a fake delta */
		}
		schedule();
	}
	function schedule() { if (!stopped) timer = setTimeout(poll, intervalMs); }

	// Prime the baseline immediately, then poll on the interval.
	poll();

	return function stop() {
		stopped = true;
		if (timer) clearTimeout(timer);
		try { io?.disconnect(); } catch { /* noop */ }
	};
}

/**
 * The embodied-finance DYNAMICS reaction: poll the agent's real wealth state
 * (the custody-backed /solana/networth `flow` block, cached 60s server-side) on
 * a visibility-gated interval, push the live momentum/streaming/recency dynamics
 * into the aura, and fire a one-shot celebratory flourish the moment a REAL new
 * tip lands or a money stream opens. The flourish only ever plays because a real
 * custody row appeared (lastTipAt advanced / a stream went active) — never a
 * bare timer. Complements startWalletLiveReaction (which watches the raw balance
 * delta); a surface uses one or the other, not both.
 *
 * @param {string} agentId
 * @param {{flourish(kind):void, setDynamics(d):void, update(s):any, el:HTMLElement}} controller
 * @param {object} [opts] { network, intervalMs }
 * @returns {() => void} stop fn
 */
export function startWealthLiveReaction(agentId, controller, opts = {}) {
	if (!agentId || !controller) return () => {};
	const network = opts.network === 'devnet' ? 'devnet' : 'mainnet';
	const intervalMs = Math.max(15_000, opts.intervalMs || 30_000);
	let lastTipAt = null;
	let lastStreaming = 0;
	let lastLevel = null; // null = unprimed; tracked for the tier level-up moment
	let primed = false;
	let timer = 0;
	let stopped = false;
	let visible = true;

	const io = controller.el && typeof IntersectionObserver === 'function'
		? new IntersectionObserver((es) => { visible = es.some((e) => e.isIntersecting); }, { threshold: 0.01 })
		: null;
	if (io) io.observe(controller.el);

	async function poll() {
		if (stopped) return;
		if (!visible) { schedule(); return; }
		try {
			const state = await fetchWealthState(agentId, { network, fresh: true });
			if (state.ok) {
				const dyn = computeWealthDynamics(state);
				controller.setDynamics(dyn);
				// Refresh the tier/palette from the same real read so balance moves are
				// reflected too (cheap — fetchWalletState shares the 60s server cache).
				controller.update(agentId).catch(() => {});
				const tipAdvanced = state.lastTipAt && state.lastTipAt !== lastTipAt;
				const streamOpened = state.streamingNow > lastStreaming;
				// Only celebrate genuinely NEW events after the first (priming) read, so
				// landing on the page doesn't replay an old tip.
				if (primed && (tipAdvanced || streamOpened)) controller.flourish('inflow');
				else if (primed && state.momentum < -0.2 && dyn.trend === 'down') {
					/* a real net-outflow day reads honestly — handled by the cool dim,
					   no celebratory burst */
				}
				// A real wealth-tier crossing → the owner-only level-up card.
				// trackLevelUp dedupes across reloads and never double-fires.
				if (opts.celebrateLevelUp !== false) lastLevel = trackLevelUp(agentId, lastLevel, state);
				lastTipAt = state.lastTipAt;
				lastStreaming = state.streamingNow;
				primed = true;
			}
		} catch {
			/* transient — keep the last real dynamics, never invent a trend */
		}
		schedule();
	}
	function schedule() { if (!stopped) timer = setTimeout(poll, intervalMs); }

	poll();

	return function stop() {
		stopped = true;
		if (timer) clearTimeout(timer);
		try { io?.disconnect(); } catch { /* noop */ }
	};
}

/**
 * High-level convenience: mount the aura on a container, fetch + apply the real
 * wallet state, and (optionally) start the live inflow reaction. Returns a
 * controller with a combined `destroy()`. Safe to call with no wallet — the
 * agent simply renders the clean dormant baseline.
 *
 * Pass `opts.wealth: true` to additionally drive the embodied-finance dynamics
 * (momentum/streaming/recency) from the real custody flow — the richer reaction
 * used by the avatar hero and IRL. It supersedes the plain balance-delta watcher.
 */
export async function hydrateAvatarWallet(container, agent, opts = {}) {
	const controller = mountWalletAura(container, opts);
	if (!controller) return null;
	const agentId = typeof agent === 'string'
		? agent
		: (agent?.agent_id || agent?.agentId || agent?.id || null);
	let stopLive = () => {};
	// An owner reactivity pref known up front (e.g. passed by the page) gates the
	// look before the first paint so a muted agent never flashes a full aura first.
	if (opts.prefs) controller.setPrefs(opts.prefs);
	// Otherwise fetch the owner's saved reactivity prefs so EVERY surface — not just
	// the ones that mount the presence panel — honours how the owner configured the
	// agent. Surfaces that already mount the panel pass `fetchPrefs:false` to avoid a
	// duplicate read (the panel pushes prefs in via setPrefs itself).
	else if (opts.fetchPrefs !== false && agentId) {
		fetchNetWorth(agentId)
			.then((nw) => { if (nw?.prefs) controller.setPrefs(nw.prefs); })
			.catch(() => { /* read failed — aura stays at its real, un-muted look */ });
	}
	try {
		await controller.update(agent);
		if (opts.live !== false && agentId) {
			// The richer wealth reaction (momentum/streaming/recency + tip pulse)
			// supersedes the plain balance-delta watcher when opted in.
			stopLive = opts.wealth
				? startWealthLiveReaction(agentId, controller, opts)
				: startWalletLiveReaction(agentId, controller, opts);
			// The wealth reaction can detect a real tier crossing; make sure the
			// global celebration card is listening (idempotent, owner-gated).
			if (opts.wealth && opts.celebrateLevelUp !== false) installLevelUpCelebrations();
		}
	} catch {
		/* leave the dormant baseline in place */
	}
	const destroy = controller.destroy;
	controller.destroy = () => { stopLive(); destroy(); };
	return controller;
}

/**
 * Render a small net-worth tier badge element a surface can place near the
 * avatar (e.g. the viewer toolbar). Pure presentation of the same visual.
 */
export function walletTierBadge(state) {
	ensureStyles();
	const v = computeWalletVisual(state);
	const el = document.createElement('span');
	el.className = 'wa-badge';
	el.style.setProperty('--wa-accent', v.accent);
	el.style.setProperty('--wa-glow', v.glow);
	el.innerHTML = `<span class="wa-badge-dot"></span><span>${v.tierLabel}</span><span>${formatNetWorth(state)}</span>`;
	el.title = v.dormant
		? 'Dormant wallet — fund this agent to light it up'
		: `Net worth ${formatNetWorth(state)} · ${v.tierLabel} tier`;
	return el;
}

/**
 * Auto-hydrate every `[data-wallet-aura]` element under `root`. Each element
 * must carry `data-agent-id` (and optionally `data-network`/`data-lod`). Card
 * LOD by default, no live polling (dense grids stay cheap). Idempotent.
 */
export function hydrateWalletAuras(root = document) {
	if (!root || typeof root.querySelectorAll !== 'function') return [];
	const out = [];
	for (const el of root.querySelectorAll('[data-wallet-aura]')) {
		if (el.__waMounted) continue;
		el.__waMounted = true;
		const agentId = el.getAttribute('data-agent-id');
		if (!agentId) continue;
		const c = mountWalletAura(el, {
			lod: el.getAttribute('data-lod') || 'card',
			network: el.getAttribute('data-network') || 'mainnet',
		});
		if (c) { c.update(agentId).catch(() => {}); out.push(c); }
	}
	return out;
}

if (typeof window !== 'undefined') {
	window.twsWalletAura = {
		mountWalletAura, hydrateAvatarWallet, startWalletLiveReaction,
		startWealthLiveReaction, walletTierBadge, hydrateWalletAuras,
	};
}
