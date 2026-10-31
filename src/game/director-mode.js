// Venue projector view: /play?director=1.
//
// A screen on a wall (or an OBS browser source) that watches the world without
// being in it. Four jobs, all here so the rest of /play stays untouched but for a
// handful of `this._director` hooks in coincommunities.js:
//
//   1. A server-honored spectator seat. CommunityNet joins with { spectator: true },
//      so no peer is ever sent an avatar for it and it is never in the online count.
//   2. An auto-director camera. It cuts every 15 to 30 seconds between occupied
//      points of interest (director-shots.js is the pure shot logic and is unit
//      tested), and holds the totem and crowd for the meetup's group photo.
//   3. A projector-scale broadcast overlay: event name and LIVE or countdown, the
//      world, the live count and an invite QR. No player HUD (director-mode.css
//      hides every other node on the page).
//   4. Unattended resilience. It reconnects forever, keeps the last frame under a
//      quiet pill while it does, holds a wake lock, hides the idle cursor, and
//      reloads itself out of a lost WebGL context or a stalled render loop.
//
// The overlay copy is a pure function of /event.json and the clock
// (director-overlay-state.js), the same file and helpers every other meetup
// surface reads, so the wall can never disagree with the lobby banner.

import './director-mode.css';
import { prefersReducedMotion, onReducedMotionChange } from './a11y.js';
import { PHOTO_STAGE, groupPhotoState } from './meetup-schedule.js';
import { MODE, parseDirectorEvent, overlayModel } from './director-overlay-state.js';
import {
	buildCandidates, chooseShot, planShot, shotPose, shouldCutEarly, pushOutOfBoxes, photoCandidate,
} from './director-shots.js';

const EVENT_URL = '/event.json';
const EVENT_REFRESH_MS = 60_000;
const TICK_MS = 250;
const HISTORY_LEN = 6;
// The photo shot is held from the gather call until this long after the shutter,
// so the broadcast shows the crowd posing and the frame everyone just took.
const PHOTO_AFTERHOLD_MS = 6_000;
const PILL_DELAY_MS = 2_000;
const CONTEXT_RESTORE_MS = 4_000;
const FRAME_STALL_MS = 90_000;
const NOT_IN_WORLD_MS = 60_000;
const DENIED_RELOAD_MS = 30_000;
const CURSOR_IDLE_MS = 3_000;
const WAKE_LOCK_RECHECK_MS = 30_000;
const RELOAD_LOG_KEY = 'ccDirectorReloads';
const RELOAD_WINDOW_MS = 10 * 60_000;

/** True when the page was opened as a venue screen. */
export function isDirectorRequested(search = location.search) {
	return new URLSearchParams(search).get('director') === '1';
}

function h(tag, cls, text) {
	const node = document.createElement(tag);
	if (cls) node.className = cls;
	if (text != null) node.textContent = text;
	return node;
}

export class DirectorMode {
	/** @param {object} cc the CoinCommunities hub */
	constructor(cc) {
		this.cc = cc;
		// Captured now: enter() rewrites the URL (and drops params it does not know).
		this.search = location.search;
		this.event = null;
		this.eventPinned = new URLSearchParams(this.search).has('meetup');
		this.eventFetchedAt = 0;
		this.extraLandmarks = [];
		this.history = [];
		this.plan = null;
		this.planStart = 0;
		this.players = [];
		this.reduced = prefersReducedMotion();
		this._key = '';
		this._lastDrive = performance.now();
		this._notWorldSince = 0;
		this._offlineSince = 0;
		this._deniedSince = 0;
		this._flashedFor = 0;
		this._wl = null;
		this._qrFor = '';
		this._disposers = [];

		document.body.classList.add('cc-director');
		this._pinRenderBudget();
		this._buildOverlay();
		this._bindResilience();
		this._disposers.push(onReducedMotionChange((reduced) => {
			this.reduced = reduced;
			document.body.classList.toggle('cc-director-calm', reduced);
			// Hold the current frame instead of moving it, and re-plan as a still.
			if (this.plan) this.plan = null;
		}));

		this._fetchEvent();
		this._tickTimer = setInterval(() => this._tick(), TICK_MS);
		this._tick();
	}

	// ------------------------------------------------------------- hub hooks

	/** Canonical-URL hook: keep the screen a screen, and keep a ?meetup= preview. */
	decorateUrl(q) {
		q.set('director', '1');
		const meetup = new URLSearchParams(this.search).get('meetup');
		if (meetup) q.set('meetup', meetup);
	}

	/**
	 * The room re-streamed its state after a (re)connect. The screen kept its last
	 * frame through the drop, so reconcile it: drop builds removed while it was away.
	 */
	onRoomSynced() {
		const blocks = this.cc.net?.room?.state?.blocks;
		if (!blocks || typeof blocks.has !== 'function') return;
		this.cc.voxels?.retainOnly((key) => blocks.has(key));
	}

	/** Add a point of interest the director may cut to (a later feature's stage, say). */
	addLandmark(landmark) {
		this.extraLandmarks.push(landmark);
	}

	/**
	 * Called from _updateCamera every frame. Returns true when the director owns
	 * the camera this frame.
	 */
	drive() {
		const cc = this.cc;
		if (cc.phase !== 'world') return false;
		const now = performance.now();
		this._lastDrive = now;
		if (cc.localRig) cc.localRig.visible = false;
		this._ensureShot(now);
		const plan = this.plan;
		if (!plan) return false;
		const t = Math.min(1, Math.max(0, (now - this.planStart) / plan.durationMs));
		const { pos, look } = shotPose(plan, t);
		// Belt and braces: planShot already proved the path clear, but the district
		// can change under it (a build, a late-loading building).
		const safe = pushOutOfBoxes(pos, this._boxes());
		cc.camera.position.set(safe.x, safe.y, safe.z);
		cc.camera.lookAt(look.x, look.y, look.z);
		return true;
	}

	// ----------------------------------------------------------- shot control

	_boxes() {
		return this.cc._district?.colliders || [];
	}

	_collectPlayers() {
		const out = [];
		for (const r of this.cc.remotes.values()) {
			const p = r?.rig?.position;
			if (p && Number.isFinite(p.x) && Number.isFinite(p.z)) out.push({ x: p.x, z: p.z });
		}
		return out;
	}

	_landmarks() {
		const cc = this.cc;
		const out = [];
		if (cc._totem) {
			out.push({ id: 'totem', label: 'totem', x: cc._totem.position.x, y: 3.2, z: cc._totem.position.z, facing: 0, standoff: 20, height: 6, radius: 14, weight: 1.15 });
		}
		if (cc._screen) {
			out.push({ id: 'jumbotron', label: 'jumbotron', x: cc._screen.position.x, y: 7, z: cc._screen.position.z, facing: cc._screen.rotation.y, standoff: 30, height: 8, radius: 16, weight: 1 });
		}
		if (cc._chartScreen) {
			out.push({ id: 'chart', label: 'chart wall', x: 0, y: 5, z: -30, facing: 0, standoff: 24, height: 6, radius: 14, weight: 0.9 });
		}
		if (cc._danceFloorPos) {
			out.push({ id: 'dancefloor', label: 'dance floor', x: cc._danceFloorPos.x, y: 1.2, z: cc._danceFloorPos.z, facing: null, standoff: 17, height: 7, radius: Math.max((cc._floorRadius || 8) + 4, 12), weight: 1.1 });
		}
		if (cc._oracleRibbon) {
			out.push({ id: 'oracle', label: 'oracle', x: 17, y: 4.2, z: -20, facing: null, standoff: 16, height: 6, radius: 12, weight: 0.8 });
		}
		return out.concat(this.extraLandmarks);
	}

	_photoWindow(now) {
		if (!this.event) return null;
		const gp = groupPhotoState(this.event, now);
		if (gp.stage === PHOTO_STAGE.NONE) return null;
		const until = gp.shutterAt + PHOTO_AFTERHOLD_MS;
		if (now >= until) return null;
		return { gp, until };
	}

	_ensureShot(perfNow) {
		const wall = Date.now();
		const photo = this._photoWindow(wall);
		if (photo && this.plan?.id !== 'photo') {
			const cand = photoCandidate(this._landmarks(), this.players);
			if (cand) {
				this._start(planShot(cand, {
					boxes: this._boxes(), reducedMotion: this.reduced, locked: true,
					durationMs: Math.max(5_000, photo.until - wall),
				}), cand, perfNow);
				return;
			}
		}
		const p = this.plan;
		const over = !p || perfNow - this.planStart >= p.durationMs;
		const early = !!p && perfNow - this.planStart > 4_000 && shouldCutEarly(p, this.players);
		if (over || early) this._cut(perfNow);
	}

	_cut(perfNow) {
		const players = this.players;
		const candidates = buildCandidates({ landmarks: this._landmarks(), players });
		const cand = chooseShot({ candidates, players, history: this.history });
		if (!cand) return;
		this._start(planShot(cand, { boxes: this._boxes(), reducedMotion: this.reduced }), cand, perfNow);
	}

	_start(plan, cand, perfNow) {
		this.plan = plan;
		this.planStart = perfNow;
		this.history.unshift({ id: cand.id, kind: cand.kind, x: cand.x, z: cand.z });
		this.history.length = Math.min(this.history.length, HISTORY_LEN);
	}

	// -------------------------------------------------------- render budget

	// A wall display is the one client that must never degrade itself: it is
	// watched on a big screen, often from an unfocused OBS source on a machine
	// that is otherwise idle. Pin the quality tier, switch off the watchdog that
	// would step it down on a slow frame, and refuse the 30fps blur and
	// power-saver caps that exist for a laptop on battery.
	_pinRenderBudget() {
		const cc = this.cc;
		cc._perfTier = 'high';
		cc._watchdog = { tick() {} };
		Object.defineProperty(cc, '_powerSaver', { configurable: true, get: () => false, set: () => {} });
		if (cc._focus) Object.defineProperty(cc._focus, 'focused', { configurable: true, get: () => true, set: () => {} });
		cc._applyPerfTier?.();
	}

	// ---------------------------------------------------------------- overlay

	_buildOverlay() {
		const root = h('div');
		root.id = 'cc-director';
		root.className = 'dir';

		const top = h('header', 'dir-top');
		const ev = h('div', 'dir-event');
		this.elBadge = h('span', 'dir-badge');
		this.elDot = h('i', 'dir-dot');
		this.elDot.setAttribute('aria-hidden', 'true');
		this.elBadgeText = h('span');
		this.elBadge.append(this.elDot, this.elBadgeText);
		this.elClock = h('span', 'dir-clock');
		const badgeRow = h('div', 'dir-badge-row');
		badgeRow.append(this.elBadge, this.elClock);
		this.elTitle = h('h1', 'dir-title');
		this.elTagline = h('p', 'dir-tagline');
		ev.append(badgeRow, this.elTitle, this.elTagline);

		this.elQr = h('aside', 'dir-qr');
		this.elQrImg = h('img', 'dir-qr-img');
		this.elQrImg.alt = 'QR code to join this world in your browser';
		this.elQrImg.width = 220;
		this.elQrImg.height = 220;
		this.elQrImg.hidden = true;
		this.elQrCap = h('div', 'dir-qr-cap', 'Scan to join');
		this.elQrUrl = h('div', 'dir-qr-url');
		this.elQr.append(this.elQrImg, this.elQrCap, this.elQrUrl);
		top.append(ev, this.elQr);

		const bottom = h('footer', 'dir-bottom');
		const world = h('div', 'dir-world');
		this.elWorld = h('div', 'dir-world-name');
		this.elSymbol = h('div', 'dir-world-symbol');
		this.elOnline = h('div', 'dir-online');
		this.elOnlineDot = h('i', 'dir-online-dot');
		this.elOnlineDot.setAttribute('aria-hidden', 'true');
		this.elOnlineText = h('span');
		this.elOnline.append(this.elOnlineDot, this.elOnlineText);
		world.append(this.elWorld, this.elSymbol, this.elOnline);

		this.elSeg = h('div', 'dir-seg');
		this.elSegNow = h('div', 'dir-seg-now');
		this.elSegDetail = h('div', 'dir-seg-detail');
		this.elSegNext = h('div', 'dir-seg-next');
		this.elSeg.append(this.elSegNow, this.elSegDetail, this.elSegNext);
		bottom.append(world, this.elSeg);

		this.elProgress = h('div', 'dir-progress');
		this.elProgressBar = h('div', 'dir-progress-bar');
		this.elProgress.append(this.elProgressBar);

		this.elPhoto = h('div', 'dir-photo');
		this.elPhoto.setAttribute('role', 'status');
		this.elPhotoNum = h('div', 'dir-photo-num');
		this.elPhotoCap = h('div', 'dir-photo-cap');
		this.elPhoto.append(this.elPhotoNum, this.elPhotoCap);

		this.elPill = h('div', 'dir-pill');
		this.elPill.setAttribute('role', 'status');
		this.elPill.hidden = true;
		this.elFlash = h('div', 'dir-flash');
		this.elFlash.setAttribute('aria-hidden', 'true');

		root.append(top, bottom, this.elProgress, this.elPhoto, this.elPill, this.elFlash);
		document.body.appendChild(root);
		this.root = root;
	}

	_paint(m) {
		const live = m.mode === MODE.LIVE;
		this.root.dataset.mode = m.mode;
		this.elBadge.hidden = !m.badge;
		this.elBadge.classList.toggle('dir-badge--live', live);
		this.elBadgeText.textContent = m.badge;
		this.elClock.textContent = m.clock;
		this.elClock.hidden = !m.clock;
		this.elTitle.textContent = m.eventName;
		this.elTitle.hidden = !m.eventName;
		this.elTagline.textContent = m.tagline;
		this.elTagline.hidden = !m.tagline;

		this.elWorld.textContent = m.world;
		this.elSymbol.textContent = m.symbol;
		this.elSymbol.hidden = !m.symbol;
		this.elOnlineText.textContent = m.onlineLabel;

		const seg = m.segment;
		const next = m.next;
		this.elSeg.hidden = !seg && !next;
		this.elSegNow.textContent = seg ? seg.title : '';
		this.elSegNow.hidden = !seg;
		this.elSegDetail.textContent = seg?.detail || '';
		this.elSegDetail.hidden = !seg?.detail;
		this.elSegNext.textContent = next ? (next.in ? `Next in ${next.in}: ${next.title}` : `Next: ${next.title}`) : '';
		this.elSegNext.hidden = !next;

		this.elProgress.hidden = !live;
		this.elProgressBar.style.transform = `scaleX(${Math.min(1, Math.max(0, m.progress))})`;

		const photo = m.photo;
		this.elPhoto.hidden = !photo;
		this.root.classList.toggle('dir--photo', !!photo);
		if (photo) {
			this.elPhotoNum.textContent = photo.seconds != null ? String(photo.seconds) : '';
			this.elPhotoNum.hidden = photo.seconds == null;
			this.elPhotoCap.textContent = photo.caption;
		}
	}

	async _paintQr() {
		const cc = this.cc;
		const coin = cc.coin;
		if (!coin?.mint) return;
		const q = new URLSearchParams({ coin: coin.mint });
		if (coin.name) q.set('name', coin.name);
		if (coin.symbol) q.set('symbol', coin.symbol);
		const url = `${location.origin}/play?${q.toString()}`;
		if (url === this._qrFor) return;
		this._qrFor = url;
		this.elQrUrl.textContent = `${location.host}/play`;
		try {
			const mod = await import('qrcode');
			const QRCode = mod.default ?? mod;
			const dataUrl = await QRCode.toDataURL(url, {
				width: 440, margin: 1, errorCorrectionLevel: 'M', color: { dark: '#0b0714', light: '#ffffff' },
			});
			this.elQrImg.src = dataUrl;
			this.elQrImg.hidden = false;
		} catch {
			// The QR is a convenience. Without it the screen still names the address.
			this.elQrImg.hidden = true;
			this.elQrCap.textContent = 'Join at';
		}
	}

	// -------------------------------------------------------------- event feed

	async _fetchEvent() {
		this.eventFetchedAt = Date.now();
		try {
			const res = await fetch(EVENT_URL, { cache: 'no-cache' });
			if (!res.ok) return;
			this.event = parseDirectorEvent(await res.json(), this.search, Date.now());
		} catch { /* keep the last good event; the wall must never go blank on a blip */ }
	}

	// ------------------------------------------------------------------- tick

	_tick() {
		const cc = this.cc;
		const wall = Date.now();
		this.players = this._collectPlayers();

		// A ?meetup= preview is anchored to when it was parsed ("now" means 20s from
		// then), so a pinned preview is read once. Real events refresh every minute.
		if (!this.eventPinned && wall - this.eventFetchedAt > EVENT_REFRESH_MS) this._fetchEvent();

		const model = overlayModel({
			event: this.event, now: wall,
			world: { name: cc.coin?.name, symbol: cc.coin?.symbol },
			online: cc.remotes.size,
		});
		if (model.key !== this._key) {
			this._key = model.key;
			this._paint(model);
		}
		this._paintQr();
		this._tickConnection(wall);
		this._tickFlash(wall);
		this._tickWatchdogs();
	}

	_tickFlash(wall) {
		if (!this.event) return;
		const gp = groupPhotoState(this.event, wall);
		if (gp.stage !== PHOTO_STAGE.SHUTTER || this._flashedFor === gp.shutterAt) return;
		this._flashedFor = gp.shutterAt;
		if (this.reduced) return;
		this.elFlash.classList.remove('dir-flash--go');
		void this.elFlash.offsetWidth;
		this.elFlash.classList.add('dir-flash--go');
	}

	// Quiet by design: no card, no toast, no error text. A small pill over the
	// last frame says the feed is catching up, and goes away on its own.
	_tickConnection(wall) {
		const cc = this.cc;
		const status = cc.net?.status;
		const inWorld = cc.phase === 'world';
		const ok = inWorld && status === 'online';
		if (ok) {
			this._offlineSince = 0;
			this._deniedSince = 0;
			this.elPill.hidden = true;
			return;
		}
		if (!this._offlineSince) this._offlineSince = wall;
		if (status === 'denied') {
			if (!this._deniedSince) this._deniedSince = wall;
			if (wall - this._deniedSince > DENIED_RELOAD_MS) this._reloadSoon('denied');
		} else {
			this._deniedSince = 0;
		}
		if (wall - this._offlineSince < PILL_DELAY_MS) return;
		this.elPill.textContent = inWorld ? 'Reconnecting' : 'Connecting';
		this.elPill.hidden = false;
	}

	_tickWatchdogs() {
		const cc = this.cc;
		const now = performance.now();
		if (cc.phase === 'world') {
			this._notWorldSince = 0;
			if (!document.hidden && now - this._lastDrive > FRAME_STALL_MS) this._reloadSoon('frame_stall');
		} else {
			if (!this._notWorldSince) this._notWorldSince = now;
			if (now - this._notWorldSince > NOT_IN_WORLD_MS) this._reloadSoon('not_in_world');
		}
	}

	// ------------------------------------------------------------- resilience

	_bindResilience() {
		this._lockWake();
		const onVisible = () => { if (!document.hidden) this._lockWake(); };
		document.addEventListener('visibilitychange', onVisible);
		this._wakeTimer = setInterval(() => { if (!this._wl) this._lockWake(); }, WAKE_LOCK_RECHECK_MS);

		const canvas = this.cc.canvas || document.getElementById('kx-canvas');
		if (canvas) {
			// The hub already asks the browser to restore a lost context. A venue screen
			// cannot wait forever for a GPU that is not coming back, so if it has not
			// returned shortly, start over.
			canvas.addEventListener('webglcontextlost', () => {
				clearTimeout(this._ctxTimer);
				this._ctxTimer = setTimeout(() => this._reloadSoon('context_lost'), CONTEXT_RESTORE_MS);
			});
			canvas.addEventListener('webglcontextrestored', () => clearTimeout(this._ctxTimer));
		}

		let idle;
		const wake = () => {
			document.body.classList.remove('cc-director-idle');
			clearTimeout(idle);
			idle = setTimeout(() => document.body.classList.add('cc-director-idle'), CURSOR_IDLE_MS);
		};
		addEventListener('pointermove', wake, { passive: true });
		addEventListener('pointerdown', wake, { passive: true });
		wake();

		addEventListener('keydown', (e) => {
			if ((e.key === 'f' || e.key === 'F') && !e.metaKey && !e.ctrlKey && !e.altKey) {
				if (document.fullscreenElement) document.exitFullscreen?.();
				else document.documentElement.requestFullscreen?.().catch(() => {});
			}
		});
	}

	async _lockWake() {
		try {
			if (!navigator.wakeLock || document.visibilityState !== 'visible') return;
			const lock = await navigator.wakeLock.request('screen');
			this._wl = lock;
			lock.addEventListener('release', () => { if (this._wl === lock) this._wl = null; });
		} catch { /* denied or unsupported: the OS or OBS keeps the screen awake instead */ }
	}

	// Reload with a growing delay, so a fault that survives a reload (no GPU, a
	// server that is down) retries gently instead of hammering the page.
	_reloadSoon(reason) {
		if (this._reloading) return;
		this._reloading = true;
		let log = [];
		try {
			log = JSON.parse(sessionStorage.getItem(RELOAD_LOG_KEY) || '[]').filter((t) => Date.now() - t < RELOAD_WINDOW_MS);
			log.push(Date.now());
			sessionStorage.setItem(RELOAD_LOG_KEY, JSON.stringify(log));
		} catch { /* storage blocked: reload at the base delay */ }
		const delay = Math.min(2_000 * 2 ** Math.max(0, log.length - 1), 60_000);
		console.info(`[director] reloading in ${delay}ms (${reason})`);
		setTimeout(() => location.reload(), delay);
	}

	dispose() {
		clearInterval(this._tickTimer);
		clearInterval(this._wakeTimer);
		clearTimeout(this._ctxTimer);
		for (const d of this._disposers) d();
		this._wl?.release?.().catch(() => {});
		this.root?.remove();
		document.body.classList.remove('cc-director', 'cc-director-idle', 'cc-director-calm');
	}
}
