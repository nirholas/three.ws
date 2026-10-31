/* three.ws seasonal decorations — self-contained and date-gated.
 *
 * Include with `<script src="/seasonal.js" defer></script>` on any page.
 * Outside its active window the script is a no-op, so it can stay wired
 * year-round and retire itself automatically.
 *
 * Currently: Halloween Weekend 2026 (Oct 30 10:00 UTC to Nov 2 12:00 UTC, the
 * second IIFE below) and Independence Day (July 1-5, viewer's local time).
 *  - a soft red/white/blue ribbon glow across the very top of the viewport
 *  - real launch-and-burst fireworks on a lightweight canvas confined to the
 *    page's `.hero`. Rockets rise, then explode in a strictly red/white/blue
 *    palette. Every rocket picks a random effect (peony, ring, willow,
 *    chrysanthemum, crackle, or comet), a random size, and a random color
 *    scheme, so no two bursts look alike. The streaky trails come from the
 *    canvas's own fading afterglow — natural motion blur, not drawn lines,
 *    which reads far more like a real firework than radial spokes.
 *  - user-launched fireworks: clicking open hero space fires a rocket that
 *    bursts right where you clicked, and a "🎆 Fireworks" chip injected into
 *    the hero's animation-chip row makes the hero avatar light a torch
 *    (the torch-light clip) and fires a volley timed to the lighting. User
 *    bursts get a quiet procedural WebAudio boom (mutable via the 🔊 chip,
 *    preference persisted). The chips are real buttons (keyboard + screen-
 *    reader reachable) and retire with the rest of the decorations, so no
 *    dead control ships out of season.
 *
 * Every passive layer is aria-hidden, pointer-events:none, and theme-aware.
 * Reduced motion suppresses the ambient show but honors explicit gestures —
 * clicks still fire (the platform-wide userInitiated convention). The render
 * loop parks whenever the tab is hidden, the hero is scrolled out of view,
 * or (under reduced motion) the sky is clear.
 */
(() => {
	const now = new Date();
	if (now.getMonth() !== 6 || now.getDate() > 5) return; // July 1–5 only
	if (document.getElementById('seasonal-ribbon')) return;

	// Live-tracked so flipping the OS setting mid-visit is honored immediately.
	// Matches the platform convention (see element.js playClip): an explicit
	// user gesture may animate; only ambient autoplay is suppressed.
	const reducedMotionMq = window.matchMedia('(prefers-reduced-motion: reduce)');
	let reducedMotion = reducedMotionMq.matches;

	const style = document.createElement('style');
	style.textContent = `
		:root {
			--fw-red:  #ff5a5f;
			--fw-mid:  #f4f6ff;
			--fw-blue: #6f8cff;
		}
		:root[data-theme='light'] {
			--fw-red:  #d4373c;
			--fw-mid:  #8b97d8;
			--fw-blue: #3452c7;
		}
		#seasonal-ribbon {
			position: fixed; top: 0; left: 0; right: 0; height: 3px;
			z-index: 120; pointer-events: none;
			background: linear-gradient(90deg,
				transparent, var(--fw-red) 16%, var(--fw-red) 32%,
				var(--fw-mid) 46%, var(--fw-mid) 54%,
				var(--fw-blue) 68%, var(--fw-blue) 84%, transparent);
			opacity: .62;
		}
		#seasonal-ribbon::after {
			content: ''; position: absolute; inset: -14px 0 auto 0; height: 40px;
			background: linear-gradient(90deg,
				transparent, color-mix(in srgb, var(--fw-red) 40%, transparent) 24%,
				color-mix(in srgb, var(--fw-mid) 40%, transparent) 50%,
				color-mix(in srgb, var(--fw-blue) 40%, transparent) 76%, transparent);
			filter: blur(10px); opacity: .5;
		}
		.seasonal-fireworks {
			position: absolute; inset: 0; overflow: hidden;
			pointer-events: none; z-index: 1;
		}
		.seasonal-fireworks canvas { width: 100%; height: 100%; display: block; }
	`;
	document.head.appendChild(style);

	const ribbon = document.createElement('div');
	ribbon.id = 'seasonal-ribbon';
	ribbon.setAttribute('aria-hidden', 'true');
	document.body.appendChild(ribbon);

	// Reduced motion does NOT bail here: the canvas and controls are still
	// created so user-initiated fireworks work — only the ambient auto-launch
	// schedule (in frame()) is suppressed while the preference is on.
	const hero = document.querySelector('.hero');
	if (!hero) return;

	const layer = document.createElement('div');
	layer.className = 'seasonal-fireworks';
	layer.setAttribute('aria-hidden', 'true');
	const canvas = document.createElement('canvas');
	layer.appendChild(canvas);
	if (getComputedStyle(hero).position === 'static') hero.style.position = 'relative';
	hero.appendChild(layer);

	const ctx = canvas.getContext('2d');

	// Strictly red / white / blue. Theme-aware so it reads on light or dark.
	// On a light backdrop we draw normally (source-over); on dark we add light
	// (lighter) so overlapping sparks glow. Colors re-read on a theme flip.
	function colors() {
		const light = document.documentElement.getAttribute('data-theme') === 'light';
		return light
			? { red: ['#c62828', '#e14b4b'], white: ['#7c86c4', '#9aa3d6'], blue: ['#2740b8', '#3f5ad6'], comp: 'source-over' }
			: { red: ['#ff3b3b', '#ff6b6e'], white: ['#ffffff', '#eaeeff'], blue: ['#4d6bff', '#8aa2ff'], comp: 'lighter' };
	}
	let C = colors();
	const themeObserver = new MutationObserver(() => { C = colors(); });
	themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

	// A color scheme is a weighted bag of channels; each spark draws one.
	const SCHEMES = [
		['red', 'white', 'blue'],           // full patriotic mix
		['red', 'red', 'white'],            // red-forward with white sparkle
		['blue', 'blue', 'white'],          // blue-forward with white sparkle
		['white', 'white', 'red', 'blue'],  // silver shell, colored flecks
		['red', 'white', 'blue', 'blue'],
	];
	const rand = (a, b) => a + Math.random() * (b - a);
	const pick = (arr) => arr[(Math.random() * arr.length) | 0];
	function channelColor(ch) { const pair = C[ch] || C.white; return pair[(Math.random() * pair.length) | 0]; }

	let dpr = Math.min(window.devicePixelRatio || 1, 2);
	let W = 0, H = 0;
	function resize() {
		W = hero.clientWidth; H = hero.clientHeight;
		dpr = Math.min(window.devicePixelRatio || 1, 2);
		canvas.width = Math.max(1, Math.round(W * dpr));
		canvas.height = Math.max(1, Math.round(H * dpr));
		ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
	}
	resize();
	const ro = new ResizeObserver(resize);
	ro.observe(hero);

	// The render loop only runs while it can actually be seen: tab visible and
	// the hero in the viewport. Under reduced motion it additionally requires
	// live particles (a user just fired) — no ambient idle spinning.
	let heroInView = true;
	const io = new IntersectionObserver((entries) => {
		heroInView = entries[0].isIntersecting;
		updateRunning();
	}, { threshold: 0.05 });
	io.observe(hero);

	function shouldRun() {
		if (document.hidden || !heroInView) return false;
		if (!reducedMotion) return true;
		return rockets.length > 0 || sparks.length > 0;
	}
	function updateRunning() { if (shouldRun()) start(); else stop(); }

	// ── Sound — user-launched bursts only ───────────────────────────
	// A tiny procedural boom (filtered-noise thump with a crackle tail),
	// synthesized with WebAudio per burst — no audio files. Ambient rockets
	// stay silent; only fireworks a person set off get sound, and the context
	// is created inside their click gesture so autoplay policy never blocks it.
	const SOUND_KEY = 'threews-fireworks-sound';
	const storage = {
		get() { try { return localStorage.getItem(SOUND_KEY); } catch (_) { return null; } },
		set(v) { try { localStorage.setItem(SOUND_KEY, v); } catch (_) { /* private mode */ } },
	};
	let soundOn = storage.get() !== 'off';
	let ac = null;
	function audioCtx() {
		if (!ac) {
			const AC = window.AudioContext || window.webkitAudioContext;
			if (AC) ac = new AC();
		}
		if (ac && ac.state === 'suspended') ac.resume();
		return ac;
	}
	function boom(size) {
		const a = soundOn ? audioCtx() : null;
		if (!a) return;
		const dur = 0.6 + size * 0.25;
		const buf = a.createBuffer(1, Math.ceil(a.sampleRate * dur), a.sampleRate);
		const d = buf.getChannelData(0);
		for (let i = 0; i < d.length; i++) {
			const t = i / d.length;
			// Cubic-decay thump; sparse spikes on the tail read as crackle.
			d[i] = (Math.random() * 2 - 1) * ((1 - t) ** 3 + (Math.random() < 0.015 ? (1 - t) * 0.8 : 0));
		}
		const src = a.createBufferSource();
		src.buffer = buf;
		const lp = a.createBiquadFilter();
		lp.type = 'lowpass';
		lp.frequency.setValueAtTime(Math.min(1400, 800 * size), a.currentTime);
		lp.frequency.exponentialRampToValueAtTime(160, a.currentTime + dur);
		const gain = a.createGain();
		gain.gain.setValueAtTime(Math.min(0.2, 0.12 * size), a.currentTime);
		gain.gain.exponentialRampToValueAtTime(0.001, a.currentTime + dur);
		src.connect(lp);
		lp.connect(gain);
		gain.connect(a.destination);
		src.start();
	}

	const rockets = [];   // rising trails
	const sparks = [];    // exploded particles
	// Scale the show to the device: few cores, little memory, or a coarse (touch)
	// pointer get a lighter budget so weak hardware holds 60fps.
	const LITE = (navigator.hardwareConcurrency || 8) <= 4
		|| (navigator.deviceMemory || 8) <= 4
		|| window.matchMedia('(pointer: coarse)').matches;
	const COUNT = LITE ? 0.6 : 1;                 // per-burst particle multiplier
	const MAX_SPARKS = LITE ? 500 : 900;
	const MAX_ROCKETS = LITE ? 10 : 16;
	const scaleN = (n) => Math.max(6, (n * COUNT) | 0);

	// Ambient launches pick their own spot; user launches pass an aim point and
	// the rocket's velocity is solved so its apex (the burst) lands there.
	// `user` marks rockets fired by a person — their bursts get sound, and they
	// may fly under reduced motion (explicit gesture), so they restart the loop.
	function launch(aimX, aimY, user = aimY != null) {
		if (W === 0 || H === 0) return;
		if (document.hidden || !heroInView) return; // don't queue an unseen show
		if (rockets.length >= MAX_ROCKETS) return;
		const targetY = aimY != null ? aimY : H * rand(0.10, 0.46);
		const x = aimX != null ? aimX + rand(-8, 8) : W * rand(0.12, 0.88);
		const g = 0.05;
		rockets.push({
			x, y: H + 4,
			vx: rand(-0.25, 0.25),
			// Aimed rockets get far less overshoot so the burst stays on the click.
			vy: -(Math.sqrt(2 * g * (H - targetY)) + (aimY != null ? rand(0.05, 0.2) : rand(0.3, 0.9))),
			g,
			user,
			color: channelColor(pick(['red', 'white', 'blue'])),
			trail: [],
		});
		start();
	}

	// Effect presets. `size` is a per-firework multiplier that adds variety and
	// makes some bursts noticeably bigger. Sparks are round dots; their streaks
	// come from the global afterglow fade, so no effect draws long lines.
	function burst(x, y, user) {
		const effect = pick(['peony', 'ring', 'willow', 'chrysanthemum', 'crackle', 'comet']);
		const scheme = pick(SCHEMES);
		const size = rand(0.85, 1.8);
		if (user) boom(size);
		const emit = (opts) => {
			sparks.push(Object.assign({
				x, y, life: 1, twinkle: false, drag: 0.985, g: 0.05,
				color: channelColor(pick(scheme)),
			}, opts));
		};

		if (effect === 'ring') {
			const n = scaleN(44 + ((Math.random() * 26) | 0));
			const spd = rand(3.2, 4.6) * size;
			for (let i = 0; i < n; i++) {
				const a = (Math.PI * 2 * i) / n;
				const s = spd * rand(0.94, 1.06);
				emit({ vx: Math.cos(a) * s, vy: Math.sin(a) * s, decay: rand(0.012, 0.018), r: rand(1.4, 2.4), g: 0.03, drag: 0.985 });
			}
		} else if (effect === 'willow') {
			// Slow, long-lived, heavy — droops under gravity and lingers, so the
			// afterglow paints soft drooping streaks without any drawn lines.
			const n = scaleN(36 + ((Math.random() * 26) | 0));
			const spd = rand(2.2, 3.2) * size;
			for (let i = 0; i < n; i++) {
				const a = Math.random() * Math.PI * 2;
				const s = spd * rand(0.5, 1);
				emit({ vx: Math.cos(a) * s, vy: Math.sin(a) * s, decay: rand(0.006, 0.010), r: rand(1.6, 2.4), g: 0.09, drag: 0.975 });
			}
		} else if (effect === 'chrysanthemum') {
			const n = scaleN(60 + ((Math.random() * 46) | 0));
			const spd = rand(3, 4.6) * size;
			for (let i = 0; i < n; i++) {
				const a = Math.random() * Math.PI * 2;
				const s = spd * Math.sqrt(rand(0.15, 1));
				emit({ vx: Math.cos(a) * s, vy: Math.sin(a) * s, decay: rand(0.010, 0.016), r: rand(1.4, 2.3), g: 0.05, drag: 0.982 });
			}
		} else if (effect === 'crackle') {
			const n = scaleN(55 + ((Math.random() * 45) | 0));
			const spd = rand(2.4, 4.4) * size;
			for (let i = 0; i < n; i++) {
				const a = Math.random() * Math.PI * 2;
				const s = spd * rand(0.3, 1);
				emit({ vx: Math.cos(a) * s, vy: Math.sin(a) * s, decay: rand(0.016, 0.028), r: rand(1.2, 2), g: 0.05, drag: 0.98, twinkle: true });
			}
		} else if (effect === 'comet') {
			// A few fast, fading sparks in random directions — short bright darts
			// whose afterglow gives a clean comet streak, no fake rod.
			const n = scaleN(10 + ((Math.random() * 8) | 0));
			const spd = rand(3.4, 5) * size;
			for (let i = 0; i < n; i++) {
				const a = Math.random() * Math.PI * 2;
				const s = spd * rand(0.7, 1);
				emit({ vx: Math.cos(a) * s, vy: Math.sin(a) * s, decay: rand(0.012, 0.02), r: rand(1.8, 2.8), g: 0.06, drag: 0.97 });
			}
		} else { // peony — classic round burst
			const n = scaleN(50 + ((Math.random() * 44) | 0));
			const spd = rand(2.8, 4.8) * size;
			for (let i = 0; i < n; i++) {
				const a = Math.random() * Math.PI * 2;
				const s = spd * Math.sqrt(rand(0.1, 1));
				emit({ vx: Math.cos(a) * s, vy: Math.sin(a) * s, decay: rand(0.012, 0.018), r: rand(1.5, 2.7), g: 0.048, drag: 0.984 });
			}
		}

		if (sparks.length > MAX_SPARKS) sparks.splice(0, sparks.length - MAX_SPARKS);
	}

	// ── User-launched fireworks ─────────────────────────────────────
	// Click (or tap) open hero space and a rocket bursts where you clicked.
	// Interactive elements keep their jobs, and a camera drag on the 3D stage
	// ends in a click event too — a small movement threshold filters those out.
	const INTERACTIVE = 'a, button, input, select, textarea, lang-switcher, [role="button"]';
	let downX = 0, downY = 0;
	hero.addEventListener('pointerdown', (e) => { downX = e.clientX; downY = e.clientY; }, { passive: true });
	hero.addEventListener('click', (e) => {
		if (e.target.closest(INTERACTIVE)) return;
		if (Math.hypot(e.clientX - downX, e.clientY - downY) > 6) return; // was a drag
		if (soundOn) audioCtx(); // unlock audio inside the user gesture
		const rect = hero.getBoundingClientRect();
		const x = Math.min(Math.max(e.clientX - rect.left, 8), W - 8);
		const y = Math.min(Math.max(e.clientY - rect.top, H * 0.06), H * 0.8);
		launch(x, y);
		sinceLaunch = 0; // the user just fired — hold the ambient schedule back
	});

	// A staggered volley for the chip — real timers driving real rockets. The
	// hero avatar's torch-light clip runs ~4.4s: it dips the torch into the
	// fire around 1.6s in and raises it burning near the end. Rockets need
	// ~2s to climb, so launching on the dip ("lighting the fuse") makes the
	// first bursts land right as the avatar lifts the lit torch. Without the
	// avatar the fuse delay still reads naturally — fuses take a moment.
	const FUSE_MS = 1600;
	function volley() {
		if (soundOn) audioCtx(); // unlock audio inside the user gesture
		const n = 5 + ((Math.random() * 3) | 0);
		for (let i = 0; i < n; i++) setTimeout(() => launch(null, null, true), FUSE_MS + i * (140 + Math.random() * 140));
		sinceLaunch = 0;
	}

	// Inject a "🎆 Fireworks" chip into the hero's animation-chip row so the
	// feature is discoverable and keyboard-reachable. Its data-anim points at
	// the torch-light clip, so the page's own avatar chip handler makes the
	// hero avatar light a torch while this script fires the synced volley.
	// The chip is only created inside the seasonal window, so it never ships
	// as a dead button; the torch clip lives in the library year-round.
	const chipRow = document.getElementById('hero-chips');
	if (chipRow) {
		style.textContent += `
			.hero-chip--fireworks {
				border-color: color-mix(in srgb, var(--fw-blue) 55%, transparent);
			}
			.hero-chip--fireworks:hover, .hero-chip--fireworks:focus-visible {
				border-color: var(--fw-red);
				color: var(--fw-mid);
			}
		`;
		const chip = document.createElement('button');
		chip.type = 'button';
		chip.className = 'hero-chip hero-chip--fireworks';
		chip.dataset.anim = 'torch-light';
		chip.setAttribute('aria-label', 'Light the torch and set off a volley of fireworks');
		chip.textContent = '🎆 Fireworks';
		chip.addEventListener('click', volley);

		// Mute toggle for the burst sound. Persisted, so a visitor who mutes
		// once stays muted across pages and visits (within the window).
		const mute = document.createElement('button');
		mute.type = 'button';
		mute.className = 'hero-chip hero-chip--fireworks';
		mute.setAttribute('aria-label', 'Firework sound');
		const paintMute = () => {
			mute.textContent = soundOn ? '🔊' : '🔇';
			mute.setAttribute('aria-pressed', String(soundOn));
			mute.title = soundOn ? 'Mute firework sound' : 'Unmute firework sound';
		};
		paintMute();
		mute.addEventListener('click', () => {
			soundOn = !soundOn;
			storage.set(soundOn ? 'on' : 'off');
			if (soundOn) audioCtx(); // unlock inside the gesture
			paintMute();
		});

		chipRow.prepend(mute);
		chipRow.prepend(chip);
	}

	let raf = 0;
	let sinceLaunch = 0;
	let nextGap = 36; // frames until first rocket
	let running = false;

	function frame() {
		if (!running) return;
		raf = requestAnimationFrame(frame);

		// Sparks aren't cleared each frame — the canvas fades a little instead,
		// leaving a short glowing tail behind every moving dot. This afterglow
		// IS the firework streak; a gentler fade means longer, softer tails.
		ctx.globalCompositeOperation = 'destination-out';
		ctx.fillStyle = 'rgba(0,0,0,0.15)';
		ctx.fillRect(0, 0, W, H);
		ctx.globalCompositeOperation = C.comp;

		// Ambient auto-launches — suppressed under reduced motion (the loop then
		// only runs to finish rockets the user explicitly set off).
		if (!reducedMotion && ++sinceLaunch >= nextGap) {
			sinceLaunch = 0;
			nextGap = 100 + ((Math.random() * 150) | 0); // ~1.7–4.2s at 60fps
			launch();
			if (Math.random() < 0.35) launch();          // occasional double
			if (Math.random() < 0.12) launch();          // rare triple
		}

		for (let i = rockets.length - 1; i >= 0; i--) {
			const r = rockets[i];
			r.x += r.vx;
			r.y += r.vy;
			r.vy += r.g;
			r.trail.push({ x: r.x, y: r.y });
			if (r.trail.length > 6) r.trail.shift();

			ctx.beginPath();
			for (let t = 0; t < r.trail.length; t++) {
				const p = r.trail[t];
				if (t === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
			}
			ctx.strokeStyle = r.color;
			ctx.globalAlpha = 0.6;
			ctx.lineWidth = 1.8;
			ctx.stroke();
			ctx.globalAlpha = 1;

			if (r.vy >= -0.4) { // apex reached — explode
				burst(r.x, r.y, r.user);
				rockets.splice(i, 1);
			}
		}

		for (let i = sparks.length - 1; i >= 0; i--) {
			const s = sparks[i];
			s.x += s.vx;
			s.y += s.vy;
			s.vy += s.g;
			s.vx *= s.drag;
			s.vy *= s.drag;
			s.life -= s.decay;
			if (s.life <= 0) { sparks.splice(i, 1); continue; }

			let alpha = s.life;
			if (s.twinkle) alpha *= Math.random() < 0.5 ? 0.15 : 1;

			ctx.globalAlpha = Math.max(0, alpha);
			ctx.fillStyle = s.color;
			ctx.beginPath();
			ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
			ctx.fill();
		}
		ctx.globalAlpha = 1;

		// Under reduced motion the loop exists only to finish a user's rockets;
		// once the sky is clear, park it until the next explicit launch.
		if (reducedMotion && rockets.length === 0 && sparks.length === 0) stop();
	}

	function start() {
		if (running) return;
		running = true;
		sinceLaunch = 0; nextGap = 36;
		raf = requestAnimationFrame(frame);
	}
	function stop() {
		running = false;
		if (raf) cancelAnimationFrame(raf);
		raf = 0;
		// Wipe the canvas so scrolling back doesn't flash a frozen mid-air frame.
		ctx.setTransform(1, 0, 0, 1, 0, 0);
		ctx.clearRect(0, 0, canvas.width, canvas.height);
		ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
	}

	document.addEventListener('visibilitychange', updateRunning);
	reducedMotionMq.addEventListener?.('change', (e) => {
		reducedMotion = e.matches;
		updateRunning();
	});

	// Lifecycle. On navigating away we park the loop and free the AudioContext
	// (an open one blocks bfcache), nulling it so it's rebuilt on the next
	// gesture if the page is restored. Observers persist across a bfcache round
	// trip and are only disconnected on a real unload; pageshow resumes.
	window.addEventListener('pagehide', (e) => {
		stop();
		if (ac) { try { ac.close(); } catch (_) { /* already closed */ } ac = null; }
		if (!e.persisted) { io.disconnect(); ro.disconnect(); themeObserver.disconnect(); }
	});
	window.addEventListener('pageshow', updateRunning);

	updateRunning();
})();

/* Halloween Weekend 2026: the classic homepage's seasonal look.
 *
 * Window mirrored from src/shared/seasonal-drops.js and api/_lib/seasonal-drops.js
 * (tests/seasonal-drops.test.js pins all three together). It honors the same
 * "Halloween look" opt-out the desktop Settings toggle writes.
 *  - Creepster on the hero and section headings, an orange/violet top ribbon;
 *  - a canvas in `.hero` with bats crossing the sky and embers drifting up;
 *  - a "🎃 Trick or treat" chip: the avatar plays Thriller (via home.html's own
 *    delegated chip handler) while a flock of bats bursts from the stage;
 *  - Halloween example prompts in the Forge "Try" row.
 * Reduced motion keeps the static theme and a single still frame; explicit
 * clicks still animate. The loop parks while the tab is hidden or the hero is
 * scrolled out of view.
 */
(() => {
	const STARTS = Date.parse('2026-10-30T10:00:00Z');
	const ENDS = Date.parse('2026-11-02T12:00:00Z');
	const now = Date.now();
	if (now < STARTS || now >= ENDS) return;
	try {
		if (localStorage.getItem('twx_season_off:halloween-2026') != null) return;
	} catch (_) { /* storage blocked: show the look */ }
	if (document.getElementById('halloween-ribbon')) return;

	document.documentElement.dataset.season = 'halloween';
	const font = document.createElement('link');
	font.rel = 'stylesheet';
	font.href = '/fonts/creepster.css';
	document.head.appendChild(font);

	const reducedMq = window.matchMedia('(prefers-reduced-motion: reduce)');
	let reduced = reducedMq.matches;

	const style = document.createElement('style');
	style.textContent = `
		:root { --hw-o: #ff8a2a; --hw-v: #b48ae0; --hw-bat: #0d0614; }
		:root[data-theme='light'] { --hw-o: #d4560a; --hw-v: #6a3fa0; --hw-bat: #2a1238; }
		#halloween-ribbon {
			position: fixed; top: 0; left: 0; right: 0; height: 3px; z-index: 120; pointer-events: none;
			background: linear-gradient(90deg, transparent, var(--hw-o) 22%, var(--hw-v) 50%, var(--hw-o) 78%, transparent);
			opacity: .7;
		}
		#halloween-ribbon::after {
			content: ''; position: absolute; inset: -14px 0 auto 0; height: 40px;
			background: linear-gradient(90deg, transparent, color-mix(in srgb, var(--hw-o) 45%, transparent) 30%,
				color-mix(in srgb, var(--hw-v) 45%, transparent) 70%, transparent);
			filter: blur(10px); opacity: .5;
		}
		html[data-season='halloween'] .hero-h,
		html[data-season='halloween'] .block-h {
			font-family: 'Creepster', 'Space Grotesk', system-ui, sans-serif;
			font-weight: 400; letter-spacing: .035em;
		}
		html[data-season='halloween'] .hero-h { text-shadow: 0 0 34px color-mix(in srgb, var(--hw-o) 40%, transparent); }
		html[data-season='halloween'] .hero-h em,
		html[data-season='halloween'] .block-h em { color: var(--hw-o); font-style: normal; }
		.halloween-sky { position: absolute; inset: 0; overflow: hidden; pointer-events: none; z-index: 1; }
		.halloween-sky canvas { width: 100%; height: 100%; display: block; }
		.hero-chip--halloween { border-color: color-mix(in srgb, var(--hw-o) 60%, transparent); }
		.hero-chip--halloween:hover, .hero-chip--halloween:focus-visible { border-color: var(--hw-o); color: var(--hw-o); }
		.hero-chip--halloween:active { transform: scale(.97); }
	`;
	document.head.appendChild(style);

	const ribbon = document.createElement('div');
	ribbon.id = 'halloween-ribbon';
	ribbon.setAttribute('aria-hidden', 'true');
	document.body.appendChild(ribbon);

	// Halloween prompts for the Forge "Try" row (home-forge.js reads data-prompt).
	const TRIES = [
		['a carved jack-o\'-lantern, glowing from inside', 'jack-o\'-lantern'],
		['a pointed witch hat, worn purple velvet', 'witch hat'],
		['a rusty haunted iron lantern, cobwebs', 'haunted lantern'],
	];
	document.querySelectorAll('.hero-try').forEach((b, i) => {
		if (!TRIES[i]) return;
		b.removeAttribute('data-i18n'); // keep the translator from restoring the year-round prompt
		b.dataset.prompt = TRIES[i][0];
		b.textContent = TRIES[i][1];
	});

	const hero = document.querySelector('.hero');
	if (!hero) return;
	if (getComputedStyle(hero).position === 'static') hero.style.position = 'relative';
	const layer = document.createElement('div');
	layer.className = 'halloween-sky';
	layer.setAttribute('aria-hidden', 'true');
	const canvas = document.createElement('canvas');
	layer.appendChild(canvas);
	hero.prepend(layer);
	const ctx = canvas.getContext('2d');
	if (!ctx) return;

	let W = 0, H = 0, dpr = 1;
	let batInk = '#0d0614', orange = '#ff8a2a';
	function readColors() {
		const cs = getComputedStyle(document.documentElement);
		batInk = cs.getPropertyValue('--hw-bat').trim() || batInk;
		orange = cs.getPropertyValue('--hw-o').trim() || orange;
	}
	function resize() {
		const r = hero.getBoundingClientRect();
		dpr = Math.min(window.devicePixelRatio || 1, 2);
		W = Math.max(1, r.width); H = Math.max(1, r.height);
		canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
		ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
		if (!running) draw(0);
	}

	const rand = (a, b) => a + Math.random() * (b - a);
	const bats = [];
	const embers = [];
	function spawnBat(x, y, burst) {
		const dir = burst ? (Math.random() < .5 ? -1 : 1) : 1;
		bats.push({
			x: x ?? -40, y: y ?? rand(.06, .42) * H,
			vx: burst ? dir * rand(2.2, 4.4) : rand(.7, 1.5), vy: burst ? rand(-2.6, -.6) : 0,
			size: burst ? rand(8, 15) : rand(9, 18), phase: rand(0, 6.28), flap: rand(.22, .32),
			wob: rand(.6, 1.4), life: burst ? 150 : Infinity,
		});
	}
	function spawnEmber() {
		embers.push({ x: rand(0, W), y: H + 6, vy: rand(.25, .7), drift: rand(-.25, .25), r: rand(.8, 2.1), a: rand(.35, .9), t: rand(0, 6.28) });
	}

	function drawBat(b) {
		const flap = Math.sin(b.phase) * .9;
		const s = b.size;
		ctx.save();
		ctx.translate(b.x, b.y);
		if (b.vx < 0) ctx.scale(-1, 1);
		ctx.fillStyle = batInk;
		ctx.beginPath();
		ctx.moveTo(0, 0);
		ctx.quadraticCurveTo(-s * .45, -s * (.25 + flap * .5), -s, -s * flap * .6);
		ctx.quadraticCurveTo(-s * .7, s * .05, -s * .55, s * .22);
		ctx.quadraticCurveTo(-s * .3, s * .08, 0, s * .2);
		ctx.quadraticCurveTo(s * .3, s * .08, s * .55, s * .22);
		ctx.quadraticCurveTo(s * .7, s * .05, s, -s * flap * .6);
		ctx.quadraticCurveTo(s * .45, -s * (.25 + flap * .5), 0, 0);
		ctx.fill();
		ctx.beginPath();
		ctx.arc(0, -s * .02, s * .14, 0, Math.PI * 2);
		ctx.fill();
		ctx.restore();
	}

	function draw(dt) {
		ctx.clearRect(0, 0, W, H);
		for (let i = embers.length - 1; i >= 0; i--) {
			const e = embers[i];
			e.t += .04 * dt; e.y -= e.vy * dt; e.x += (e.drift + Math.sin(e.t) * .2) * dt;
			const a = e.a * Math.min(1, e.y / (H * .5));
			if (e.y < -6 || a <= 0) { embers.splice(i, 1); continue; }
			ctx.globalAlpha = a;
			ctx.fillStyle = orange;
			ctx.beginPath(); ctx.arc(e.x, e.y, e.r, 0, Math.PI * 2); ctx.fill();
		}
		ctx.globalAlpha = 1;
		for (let i = bats.length - 1; i >= 0; i--) {
			const b = bats[i];
			b.phase += b.flap * 1.4 * dt;
			b.x += b.vx * dt;
			b.vy *= .985;
			b.y += (b.vy + Math.sin(b.phase * .18) * .35 * b.wob) * dt;
			b.life -= dt;
			if (b.x > W + 60 || b.x < -60 || b.y < -40 || b.life <= 0) { bats.splice(i, 1); continue; }
			drawBat(b);
		}
	}

	let raf = 0, running = false, last = 0, visible = true, inView = true, sinceBat = 0;
	function frame(t) {
		if (!running) return;
		raf = requestAnimationFrame(frame);
		const dt = last ? Math.min(3, (t - last) / 16.67) : 1;
		last = t;
		if (!reduced) {
			sinceBat += dt;
			if (sinceBat > 170 && bats.filter((b) => b.life === Infinity).length < 4) { spawnBat(); sinceBat = rand(-80, 40); }
			if (embers.length < 26 && Math.random() < .08 * dt) spawnEmber();
		}
		draw(dt);
		if (reduced && !bats.length && !embers.length) stop();
	}
	function start() {
		if (running || !visible || !inView) return;
		if (reduced && !bats.length) return;
		running = true; last = 0;
		raf = requestAnimationFrame(frame);
	}
	function stop() { running = false; cancelAnimationFrame(raf); }

	// A flock from the avatar stage; explicit, so it plays under reduced motion too.
	function flock() {
		const stage = document.getElementById('hero-stage');
		const hr = hero.getBoundingClientRect();
		const sr = stage ? stage.getBoundingClientRect() : hr;
		const cx = sr.left - hr.left + sr.width / 2;
		const cy = sr.top - hr.top + sr.height * .35;
		for (let i = 0; i < 14; i++) spawnBat(cx + rand(-30, 30), cy + rand(-20, 20), true);
		start();
	}

	const chipRow = document.getElementById('hero-chips');
	if (chipRow) {
		const chip = document.createElement('button');
		chip.type = 'button';
		chip.className = 'hero-chip hero-chip--halloween';
		chip.dataset.anim = 'thriller';
		chip.setAttribute('aria-label', 'Trick or treat: the avatar dances Thriller and a flock of bats takes off');
		chip.textContent = '🎃 Trick or treat';
		chip.addEventListener('click', flock);
		chipRow.prepend(chip);
	}

	readColors();
	resize();
	if (!reduced) for (let i = 0; i < 3; i++) spawnBat(rand(0, W), undefined, false);
	if (window.ResizeObserver) new ResizeObserver(resize).observe(hero);
	if (window.IntersectionObserver) {
		new IntersectionObserver((es) => {
			inView = es[0]?.isIntersecting ?? true;
			inView ? start() : stop();
		}).observe(hero);
	}
	document.addEventListener('visibilitychange', () => {
		visible = document.visibilityState !== 'hidden';
		visible ? start() : stop();
	});
	new MutationObserver(readColors).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
	reducedMq.addEventListener?.('change', (e) => {
		reduced = e.matches;
		if (!reduced) start();
	});
	start();
})();
