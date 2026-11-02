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
		<div class="os-boot-bg" aria-hidden="true">
			<div class="os-boot-glow"></div>
			<div class="os-boot-grid"></div>
		</div>
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
			<div class="os-lock-scrim" aria-hidden="true"></div>
			<div class="os-lock-top">
				<div class="os-lock-date"></div>
				<time class="os-lock-clock"></time>
			</div>
			<div class="os-lock-card">
				<div class="os-lock-main">
					<div class="os-lock-id">
						<span class="os-lock-avatar" aria-hidden="true"></span>
						<div class="os-lock-who">
							<h2 class="os-lock-greet"></h2>
							<p class="os-lock-status"><i class="os-lock-dot"></i><span></span></p>
						</div>
					</div>
					<div class="os-lock-actions">
						<button type="button" class="os-lock-enter"></button>
						<button type="button" class="os-lock-skip"></button>
						<button type="button" class="os-lock-classic">Classic site</button>
					</div>
					<p class="os-lock-hint"></p>
				</div>
				<nav class="os-lock-places" aria-labelledby="os-lock-places-h" hidden>
					<h3 id="os-lock-places-h">Or arrive at</h3>
					<div class="os-lock-places-list"></div>
				</nav>
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
		// The time in display type, the AM/PM marker set small beside it.
		const parts = new Intl.DateTimeFormat([], { hour: clock24 ? '2-digit' : 'numeric', minute: '2-digit', hour12: !clock24 }).formatToParts(d);
		const time = parts.filter((p) => p.type !== 'dayPeriod').map((p) => p.value).join('').trim();
		const period = parts.find((p) => p.type === 'dayPeriod')?.value || '';
		const label = period ? `${time} ${period}` : time;
		if (clock.getAttribute('aria-label') !== label) {
			clock.innerHTML = `<span>${esc(time)}</span>${period ? `<small>${esc(period)}</small>` : ''}`;
			clock.setAttribute('aria-label', label);
		}
		clock.dateTime = d.toISOString();
		date.textContent = d.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });
	}

	/**
	 * Switch to the lock screen and resolve with where the visitor goes on their
	 * gesture: `{ to: 'world' | 'desktop' | 'classic', at?: placeId }`. `at` is set
	 * when they picked a campus destination, so the world spawns them at its door.
	 *
	 * The lock is translucent: the boot backdrop fades out and the visitor's own
	 * wallpaper (already painted by the shell underneath) shows through, like any
	 * OS lock screen. The rest of the desktop stays hidden until dismiss().
	 * @param {{ name?: string, returning?: boolean, mode: 'world'|'desktop', snap: object, labels: object,
	 *   chips?: Array<{label:string,value:string,tone?:'up'|'down'}>, clock24?: boolean, hue?: number, initials?: string,
	 *   portrait?: string, accent?: string, places?: Array<{id:string,title:string,sub:string,hue:number,glyph?:string}> }} o
	 */
	function toLock(o) {
		clock24 = !!o.clock24;
		tick();
		clockTimer = setInterval(tick, 1000);
		if (o.accent) el.style.setProperty('--lock-accent', o.accent);
		lock.querySelector('.os-lock-greet').textContent = greeting(new Date().getHours(), o.name, o.returning);
		const lockStatus = lock.querySelector('.os-lock-status');
		lockStatus.dataset.ok = String(!o.snap?.failed?.length);
		lockStatus.lastElementChild.textContent = bootSummary(o.snap, o.labels);

		const av = lock.querySelector('.os-lock-avatar');
		av.style.setProperty('--hue', String(o.hue ?? 262));
		av.replaceChildren();
		if (o.portrait) {
			// The body the visitor walks in as, framed head and shoulders.
			av.classList.add('has-portrait');
			const img = new Image();
			img.alt = '';
			img.decoding = 'async';
			img.src = o.portrait;
			img.addEventListener('error', () => {
				img.remove();
				av.classList.remove('has-portrait');
				av.textContent = o.initials && o.initials !== '?' ? o.initials : '';
			});
			av.append(img);
		} else if (o.initials && o.initials !== '?') {
			av.textContent = o.initials;
		}

		const enter = lock.querySelector('.os-lock-enter');
		const skip = lock.querySelector('.os-lock-skip');
		const classic = lock.querySelector('.os-lock-classic');
		const hint = lock.querySelector('.os-lock-hint');
		if (o.mode === 'world') {
			enter.textContent = 'Walk in';
			skip.textContent = 'Straight to the desktop';
			hint.textContent = 'You arrive at the campus gate as your avatar. Sit down at your desk to open the desktop.';
		} else {
			enter.textContent = 'Continue';
			skip.textContent = 'Walk in as your avatar';
			hint.textContent = 'Press any key or click to continue.';
		}

		const placesNav = lock.querySelector('.os-lock-places');
		const placesList = placesNav.querySelector('.os-lock-places-list');
		placesList.replaceChildren();
		for (const p of o.places || []) {
			const b = document.createElement('button');
			b.type = 'button';
			b.className = 'os-lock-place';
			b.dataset.place = p.id;
			b.title = p.sub;
			b.style.setProperty('--h', String(p.hue ?? 262));
			// `glyph` is trusted SVG markup from icons.js; every text field is escaped.
			b.innerHTML = `<i aria-hidden="true">${p.glyph || ''}</i><span><b>${esc(p.title)}</b><small>${esc(p.sub)}</small></span><svg class="os-lock-go" viewBox="0 0 16 16" aria-hidden="true"><path d="M6 3l5 5-5 5"/></svg>`;
			placesList.append(b);
		}
		placesNav.hidden = !placesList.childElementCount;
		lock.querySelector('.os-lock-card').classList.toggle('has-places', !placesNav.hidden);

		const chips = lock.querySelector('.os-lock-chips');
		chips.replaceChildren();
		for (const c of o.chips || []) {
			const span = document.createElement('span');
			span.className = 'os-lock-chip';
			if (c.tone) span.dataset.tone = c.tone;
			span.innerHTML = `<small>${esc(c.label)}</small><b>${esc(c.value)}</b>`;
			chips.append(span);
		}
		stage.dataset.phase = 'lock';
		el.classList.add('is-locked');
		document.documentElement.classList.add('os-lock-up');
		lock.hidden = false;
		enter.focus({ preventScroll: true });

		return new Promise((resolve) => {
			let settled = false;
			const finish = (to, at) => {
				if (settled) return;
				settled = true;
				removeEventListener('keydown', onKey, true);
				resolve(at ? { to, at } : { to });
			};
			const primary = o.mode;
			const alternate = o.mode === 'world' ? 'desktop' : 'world';
			enter.addEventListener('click', () => finish(primary));
			skip.addEventListener('click', () => finish(alternate));
			classic.addEventListener('click', () => finish('classic'));
			placesList.addEventListener('click', (e) => {
				const b = e.target.closest('.os-lock-place');
				if (b) finish('world', b.dataset.place);
			});
			function onKey(e) {
				if (e.key === 'Tab' || e.altKey || e.metaKey || e.ctrlKey) return;
				// A focused button keeps its own Enter/Space; any other key unlocks.
				if ((e.key === 'Enter' || e.key === ' ') && e.target !== enter && e.target.closest?.('.os-lock button')) return;
				e.preventDefault();
				finish(primary);
			}
			addEventListener('keydown', onKey, true);
			lock.addEventListener('click', (e) => {
				// A near miss between destination tiles should not walk the visitor in.
				if (e.target.closest('button, .os-lock-places')) return;
				finish(primary);
			});
		});
	}

	/** Fade out and remove. Resolves when the transition ends. */
	function dismiss() {
		clearInterval(clockTimer);
		document.documentElement.classList.remove('os-lock-up');
		el.classList.add('is-leaving');
		return new Promise((resolve) => {
			let gone = false;
			const done = () => {
				if (gone) return;
				gone = true;
				el.remove();
				resolve();
			};
			if (reducedMotion) return done();
			// Children animate too (the backdrop fade, the card rise) and their
			// events bubble here; only the overlay's own fade means it is gone.
			el.addEventListener('transitionend', (e) => e.target === el && done());
			// A hidden tab may never fire transitionend: leave once the fade's own
			// duration has passed regardless.
			const secs = Math.max(0, ...getComputedStyle(el).transitionDuration.split(',').map((t) => parseFloat(t) || 0));
			setTimeout(done, secs * 1000 + 120);
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
