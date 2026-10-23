// The desktop's boot and lock screens. The boot log is driven by real promises
// (graphics probe, catalog, account, fonts, avatar, market feed, gem ledger,
// shell); each line settles when its request does. The lock screen then holds
// until the visitor's first gesture, which is also what lets the chime play.

import { formatMs, greeting, bootSummary } from './boot-logic.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const STATE_TAG = { pending: '    ', running: ' .. ', ok: ' OK ', skip: 'SKIP', fail: 'FAIL' };

/**
 * @param {{ host?: HTMLElement, reducedMotion?: boolean }} [opts]
 */
export function createBootScreen({ host = document.body, reducedMotion = false } = {}) {
	const el = document.createElement('div');
	el.className = 'os-boot';
	el.setAttribute('role', 'dialog');
	el.setAttribute('aria-label', 'three.ws is starting');
	el.setAttribute('aria-live', 'polite');
	if (reducedMotion) el.classList.add('reduced');
	el.innerHTML = `
		<div class="os-boot-glow" aria-hidden="true"></div>
		<div class="os-boot-grid" aria-hidden="true"></div>
		<section class="os-boot-stage" data-phase="boot">
			<div class="os-boot-brand">
				<span class="os-boot-eyebrow">three.ws OS</span>
				<h1 class="os-boot-h">The 3D agent layer <em>of the internet.</em></h1>
				<p class="os-boot-sub">Starting your workstation.</p>
			</div>
			<ol class="os-boot-log" aria-label="Startup checks"></ol>
			<div class="os-boot-bar" role="progressbar" aria-label="Starting the desktop" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><i></i></div>
			<p class="os-boot-foot"><span class="os-boot-count">0 / 0</span><span class="os-boot-status">Probing</span></p>
		</section>
		<section class="os-lock" hidden>
			<div class="os-lock-top">
				<time class="os-lock-clock"></time>
				<div class="os-lock-date"></div>
			</div>
			<div class="os-lock-card">
				<i class="os-lock-avatar" aria-hidden="true"></i>
				<h2 class="os-lock-greet"></h2>
				<p class="os-lock-status"></p>
				<div class="os-lock-actions">
					<button type="button" class="os-lock-enter"></button>
					<button type="button" class="os-lock-skip"></button>
				</div>
				<p class="os-lock-hint"></p>
			</div>
			<div class="os-lock-chips"></div>
		</section>`;
	host.append(el);

	const log = el.querySelector('.os-boot-log');
	const bar = el.querySelector('.os-boot-bar');
	const count = el.querySelector('.os-boot-count');
	const status = el.querySelector('.os-boot-status');
	const lines = new Map();

	function update(snap) {
		for (const s of snap.steps) {
			let li = lines.get(s.id);
			if (!li) {
				li = document.createElement('li');
				li.dataset.state = s.state;
				li.innerHTML = `<b></b><span class="os-boot-label">${esc(s.label)}</span><span class="os-boot-detail"></span><span class="os-boot-ms"></span>`;
				log.append(li);
				lines.set(s.id, li);
			}
			li.dataset.state = s.state;
			li.querySelector('b').textContent = `[${STATE_TAG[s.state] || '    '}]`;
			li.querySelector('.os-boot-detail').textContent = s.detail || (s.state === 'running' ? 'waiting' : '');
			li.querySelector('.os-boot-ms').textContent = s.ms ? formatMs(s.ms) : '';
		}
		const pct = Math.round(snap.progress * 100);
		bar.setAttribute('aria-valuenow', String(pct));
		bar.firstElementChild.style.width = `${pct}%`;
		count.textContent = `${snap.done} / ${snap.total}`;
		status.textContent = snap.complete ? (snap.failed.length ? 'Ready, with warnings' : 'Ready') : 'Starting';
		log.scrollTop = log.scrollHeight;
	}

	// ---- lock screen ----
	const lock = el.querySelector('.os-lock');
	const stage = el.querySelector('.os-boot-stage');
	const clock = lock.querySelector('.os-lock-clock');
	const date = lock.querySelector('.os-lock-date');
	let clockTimer = 0;
	let clock24 = false;
	function tick() {
		const d = new Date();
		clock.textContent = d.toLocaleTimeString([], { hour: clock24 ? '2-digit' : 'numeric', minute: '2-digit', hour12: !clock24 });
		clock.dateTime = d.toISOString();
		date.textContent = d.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });
	}

	/**
	 * Switch to the lock screen and resolve with 'world' | 'desktop' on the
	 * visitor's gesture.
	 * @param {{ name?: string, returning?: boolean, mode: 'world'|'desktop', snap: object, labels: object, chips?: Array<{label:string,value:string}>, clock24?: boolean, hue?: number, initials?: string }} o
	 */
	function toLock(o) {
		clock24 = !!o.clock24;
		tick();
		clockTimer = setInterval(tick, 1000);
		lock.querySelector('.os-lock-greet').textContent = greeting(new Date().getHours(), o.name, o.returning);
		lock.querySelector('.os-lock-status').textContent = bootSummary(o.snap, o.labels);
		const av = lock.querySelector('.os-lock-avatar');
		av.textContent = o.initials || '';
		av.style.setProperty('--hue', String(o.hue ?? 262));
		const enter = lock.querySelector('.os-lock-enter');
		const skip = lock.querySelector('.os-lock-skip');
		const hint = lock.querySelector('.os-lock-hint');
		if (o.mode === 'world') {
			enter.textContent = 'Walk in';
			skip.textContent = 'Straight to the desktop';
			hint.textContent = 'You arrive as your avatar. Walk to your desk and sit down to open the desktop, or explore the exchange, the launchpad and the mine first.';
		} else {
			enter.textContent = 'Enter';
			skip.textContent = 'Walk in as your avatar';
			hint.textContent = 'Press any key or click to continue.';
		}
		const chips = lock.querySelector('.os-lock-chips');
		chips.replaceChildren();
		for (const c of o.chips || []) {
			const span = document.createElement('span');
			span.className = 'os-lock-chip';
			span.innerHTML = `<small>${esc(c.label)}</small><b>${esc(c.value)}</b>`;
			chips.append(span);
		}
		stage.dataset.phase = 'lock';
		lock.hidden = false;
		enter.focus({ preventScroll: true });

		return new Promise((resolve) => {
			let settled = false;
			const finish = (choice) => {
				if (settled) return;
				settled = true;
				removeEventListener('keydown', onKey, true);
				resolve(choice);
			};
			const primary = o.mode;
			const alternate = o.mode === 'world' ? 'desktop' : 'world';
			enter.addEventListener('click', () => finish(primary));
			skip.addEventListener('click', () => finish(alternate));
			function onKey(e) {
				if (e.key === 'Tab' || e.altKey || e.metaKey || e.ctrlKey) return;
				if (e.target === skip && (e.key === 'Enter' || e.key === ' ')) return finish(alternate);
				e.preventDefault();
				finish(primary);
			}
			addEventListener('keydown', onKey, true);
			lock.addEventListener('click', (e) => {
				if (e.target.closest('button')) return;
				finish(primary);
			});
		});
	}

	/** Fade out and remove. Resolves when the transition ends. */
	function dismiss() {
		clearInterval(clockTimer);
		el.classList.add('is-leaving');
		return new Promise((resolve) => {
			const done = () => {
				el.remove();
				resolve();
			};
			if (reducedMotion) return done();
			el.addEventListener('transitionend', done, { once: true });
			// A browser that never fires transitionend (hidden tab) still gets out.
			el.addEventListener('animationend', done, { once: true });
		});
	}

	return { el, update, toLock, dismiss };
}

/**
 * The startup chime: two short sine partials, synthesised so nothing loads
 * and it works offline. Must run inside a user gesture; returns false when the
 * browser refused to start audio.
 */
export function playChime() {
	try {
		const Ctx = globalThis.AudioContext || globalThis.webkitAudioContext;
		if (!Ctx) return false;
		const ctx = new Ctx();
		const t = ctx.currentTime;
		const master = ctx.createGain();
		master.gain.value = 0.0001;
		master.connect(ctx.destination);
		master.gain.exponentialRampToValueAtTime(0.22, t + 0.02);
		master.gain.exponentialRampToValueAtTime(0.0001, t + 1.6);
		[[440, 0], [659.25, 0.12], [880, 0.26]].forEach(([f, dt]) => {
			const o = ctx.createOscillator();
			o.type = 'sine';
			o.frequency.value = f;
			const g = ctx.createGain();
			g.gain.value = 0.0001;
			g.gain.exponentialRampToValueAtTime(0.6, t + dt + 0.03);
			g.gain.exponentialRampToValueAtTime(0.0001, t + dt + 1.2);
			o.connect(g).connect(master);
			o.start(t + dt);
			o.stop(t + dt + 1.3);
		});
		setTimeout(() => ctx.close().catch(() => {}), 2000);
		return true;
	} catch {
		return false;
	}
}
