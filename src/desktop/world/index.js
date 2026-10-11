// The world controller: mounts the campus over the desktop, wires input,
// proximity prompts, the sit-down and walk-in transitions, the phone, the VR
// headset, gem mining and the agents who live on the campus (agents.js,
// talk.js), and runs the frame loop. main.js decides whether the
// visitor starts here or on the desktop; the taskbar's World button brings
// them back.

import { MeshBasicMaterial, Vector3 } from 'three';
import { createPlayer } from '../../docs-world/player.js';
import { createControls } from '../../docs-world/controls.js';
import { createCameraModeController, CAMERA_MODE_LABELS } from '../../game/camera-modes.js';
import { createFrameGovernor, FPS_ACTIVE, FPS_IDLE, getPowerSaver, onPowerSaverChange, trackWindowFocus } from '../../shared/frame-governor.js';
import { log } from '../../shared/log.js';
import { icon } from '../icons.js';
import { createCampus } from './campus.js';
import { createDesktopScreen } from './screen.js';
import { createTickerBoard, loadTickerItems } from './ticker.js';
import { createMiner, GEM_BY_ID } from './mine.js';
import { enterVR, vrSupported } from './xr.js';
import { createAgents } from './agents.js';
import { APPROACH_DISTANCE } from './cast.js';
import { createTalkPanel } from './talk.js';
import { CAMPUS_RADIUS, PLACES, SPAWN, nearestInteractable, placeById, standPointFor } from './places.js';
import './world.css';

const TICKER_REFRESH_MS = 60_000;
const SIT_SECONDS = 1.15;

function h(tag, cls, html) {
	const el = document.createElement(tag);
	if (cls) el.className = cls;
	if (html != null) el.innerHTML = html;
	return el;
}
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/** Wait for an element's running CSS transitions to settle. Resolves at once when nothing animates. */
async function settled(el) {
	const anims = typeof el.getAnimations === 'function' ? el.getAnimations() : [];
	await Promise.all(anims.map((a) => a.finished.catch(() => {})));
}

/**
 * @param {{
 *   shell: { launchId(id:string, o?:object): void, prefs: object, onPrefs(fn:(p:object)=>void): void, displayName(): string, toast(msg:string): void },
 *   apps: Array<{id:string,title:string,hue:number}>,
 *   reducedMotion?: boolean,
 *   onDesktop: (o: { app?: string|null, place?: string|null }) => void,
 * }} o
 */
export function createWorld({ shell, apps, reducedMotion = false, onDesktop }) {
	const el = h('div', 'wd');
	el.hidden = true;
	el.innerHTML = `
		<canvas class="wd-canvas" aria-label="three.ws campus"></canvas>
		<div class="wd-hud">
			<div class="wd-top">
				<div class="wd-brand"><b>three.ws</b><span class="wd-where">Campus</span></div>
				<div class="wd-tools">
					<button type="button" class="wd-tool wd-gems" aria-haspopup="dialog" aria-expanded="false" title="Your gems">${icon('gem', 18)}<span class="wd-gems-pts">0</span></button>
					<button type="button" class="wd-tool wd-cam" title="Camera (C)">${icon('camera', 18)}<span class="wd-cam-label"></span></button>
					<button type="button" class="wd-tool wd-vr" hidden title="Enter VR">${icon('vr', 18)}<span>VR</span></button>
					<button type="button" class="wd-tool wd-desk" title="Go straight to the desktop">${icon('desktop', 18)}<span>Desktop</span></button>
				</div>
			</div>
			<div class="wd-prompt" hidden role="status">
				<kbd class="wd-key">E</kbd>
				<div class="wd-prompt-text"><b></b><span></span></div>
				<div class="wd-dig" hidden><i></i></div>
			</div>
			<button type="button" class="wd-digbtn" hidden>Hold to dig</button>
			<nav class="wd-places" aria-label="Places"></nav>
			<div class="wd-stick" hidden><i></i></div>
			<div class="wd-tags"></div>
			<div class="wd-toasts" aria-live="polite"></div>
			<section class="wd-gempanel" hidden role="dialog" aria-label="Your gems">
				<header><b>Your gems</b><button type="button" class="wd-x" aria-label="Close">${icon('close', 16)}</button></header>
				<ul class="wd-gemlist"></ul>
				<p class="wd-gemfoot"></p>
			</section>
		</div>
		<div class="wd-phone" hidden role="dialog" aria-label="Pocket">
			<div class="wd-phone-frame">
				<button type="button" class="wd-phone-x" aria-label="Put the phone down">${icon('close', 18)}</button>
				<iframe title="Pocket" name="tws-os:pocket" allow="xr-spatial-tracking; clipboard-write; microphone; camera"></iframe>
			</div>
		</div>
		<div class="wd-fade" aria-hidden="true"><p class="wd-fade-cap"></p></div>`;
	document.body.append(el);

	const $ = (sel) => el.querySelector(sel);
	const canvas = $('.wd-canvas');
	const prompt = $('.wd-prompt');
	const promptKey = $('.wd-key');
	const promptTitle = $('.wd-prompt-text b');
	const promptSub = $('.wd-prompt-text span');
	const dig = $('.wd-dig');
	const digBar = $('.wd-dig i');
	const digBtn = $('.wd-digbtn');
	const where = $('.wd-where');
	const fade = $('.wd-fade');
	const fadeCap = $('.wd-fade-cap');
	const toasts = $('.wd-toasts');
	const stick = $('.wd-stick');
	const isTouch = matchMedia('(pointer: coarse)').matches;
	if (isTouch) promptKey.textContent = 'Tap';

	// ---- scene ----
	const screen = createDesktopScreen({ apps });
	const screenMaterial = new MeshBasicMaterial({ map: screen.texture, toneMapped: false });
	const ticker = createTickerBoard();
	const tickerMaterial = new MeshBasicMaterial({ map: ticker.texture, toneMapped: false });
	const campus = createCampus(canvas, { screenMaterial, tickerMaterial, reducedMotion });
	const { renderer, scene, camera } = campus;
	const player = createPlayer(scene, renderer, { spawn: SPAWN, yaw: SPAWN.yaw, bound: CAMPUS_RADIUS, keepout: 0 });

	// ---- the agents who live here ----
	const agents = createAgents({
		scene,
		tagsEl: $('.wd-tags'),
		solids: campus.solids,
		isTouch,
		reducedMotion,
		visitorName: () => shell.displayName(),
		onGreeting: (m) => { if (!talk.isOpen) toast(`${m.name} says hello`, '#c4b5fd'); },
	});
	let castErrorShown = false;
	agents.onState(({ state, error }) => {
		if (state === 'error' && !castErrorShown) {
			castErrorShown = true;
			toast(`The agents could not come out: ${error}. The campus is still open.`, '#f87171');
		}
	});
	const talk = createTalkPanel({
		host: $('.wd-hud'),
		shell,
		agents,
		onOpen: () => { controls.enabled = false; gemPanel.hidden = true; },
		onClose: () => { if (!busy && phone.hidden) controls.enabled = true; },
	});
	// A name tag is a button: tap it to walk over, or to start talking when already there.
	$('.wd-tags').addEventListener('click', (e) => {
		const tag = e.target.closest('.wd-tag');
		if (!tag || busy) return;
		const m = agents.byId(tag.dataset.agent);
		if (!m) return;
		if (nearest?.type === 'agent' && nearest.id === m.member.id) return interact();
		goToAgent(m);
	});
	/** Step up to an agent from the side the player is on, close enough to talk, facing them. */
	function goToAgent(m) {
		const ax = m.rig.position.x;
		const az = m.rig.position.z;
		const p = player.position;
		let a = Math.atan2(p.x - ax, p.z - az);
		if (!Number.isFinite(a) || Math.hypot(p.x - ax, p.z - az) < 0.01) a = m.spot.yaw;
		const x = ax + Math.sin(a) * APPROACH_DISTANCE;
		const z = az + Math.cos(a) * APPROACH_DISTANCE;
		const yaw = a + Math.PI;
		player.root.position.set(x, 0, z);
		player.root.rotation.y = yaw;
		controls.orbit.yaw = yaw;
		camera.position.set(x - Math.sin(yaw) * 6, 3.2, z - Math.cos(yaw) * 6);
	}

	const cameraCtl = createCameraModeController({ storageKey: 'tws:world-camera', onChange: syncCamera });
	const camBtn = $('.wd-cam');
	function syncCamera() {
		$('.wd-cam-label').textContent = CAMERA_MODE_LABELS[cameraCtl.mode];
		player.setVisible(!cameraCtl.isFirstPerson());
	}
	syncCamera();
	camBtn.addEventListener('click', () => cameraCtl.cycle(camera));

	let busy = false; // a transition is running: ignore interactions
	let nearest = null;
	let digHeld = false;

	const controls = createControls(canvas, {
		onInteract: () => interact(),
		onCycleCamera: () => cameraCtl.cycle(camera),
		onTap: (e) => {
			const hit = campus.pick(e.clientX, e.clientY);
			if (!hit) return;
			// A tap only acts on what the player could also reach by walking up:
			// far-away taps walk the player there instead.
			if (nearest && nearest.id === hit.id) return interact();
			if (hit.type === 'agent') {
				const m = agents.byId(hit.id);
				if (m) goToAgent(m);
				return;
			}
			const target = hit.type === 'place' ? placeById(hit.id) : hit.type === 'vein' ? campus.veinPositions.find((v) => v.id === hit.id) : placeById('office');
			if (target) goTo(target.type === 'vein' || hit.type === 'vein' ? { x: target.x, z: target.z, keepout: 0.75 } : target);
		},
	});
	controls.orbit.yaw = SPAWN.yaw;
	controls.orbit.dist = 7;

	// Hold-to-dig needs key state, which controls.js deliberately hides.
	addEventListener('keydown', (e) => {
		if (!controls.enabled) return;
		if ((e.key === 'e' || e.key === 'E') && !e.repeat) digHeld = true;
	});
	addEventListener('keyup', (e) => {
		if (e.key === 'e' || e.key === 'E') digHeld = false;
	});
	addEventListener('blur', () => (digHeld = false));
	for (const ev of ['pointerdown']) digBtn.addEventListener(ev, (e) => { e.preventDefault(); digHeld = true; });
	for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) digBtn.addEventListener(ev, () => (digHeld = false));

	// ---- live data: ticker ----
	let tickerTimer = 0;
	async function refreshTicker() {
		const { items, notes } = await loadTickerItems();
		ticker.setItems(items, notes);
	}
	function scheduleTicker() {
		clearInterval(tickerTimer);
		tickerTimer = setInterval(() => { if (!el.hidden && !document.hidden) refreshTicker(); }, TICKER_REFRESH_MS);
	}

	// ---- live data: gems ----
	const gemsBtn = $('.wd-gems');
	const gemPanel = $('.wd-gempanel');
	const gemList = $('.wd-gemlist');
	const gemFoot = $('.wd-gemfoot');
	const miner = createMiner({ onBalance: paintGems });
	function paintGems(b) {
		$('.wd-gems-pts').textContent = b.offline ? 'offline' : String(b.points || 0);
		gemList.replaceChildren();
		const table = b.table || Object.values(GEM_BY_ID);
		for (const g of table) {
			const n = b.gems?.[g.id] || 0;
			const li = h('li', n ? '' : 'is-empty');
			li.innerHTML = `<i style="--c:${esc(g.hex)}"></i><span>${esc(g.label)}</span><small>${g.points} pt${g.points === 1 ? '' : 's'}</small><b>${n}</b>`;
			gemList.append(li);
		}
		if (b.offline) gemFoot.textContent = 'The gem ledger is unreachable right now. Digging will retry when it is back.';
		else if (b.miner === 'account') gemFoot.textContent = `${b.total || 0} gems, ${b.points || 0} points, saved to your account.`;
		else if (b.total) gemFoot.textContent = `${b.total} gems in this browser. Sign in and they move to your account.`;
		else gemFoot.textContent = 'Nothing yet. Walk into the mine and hold E at a glowing vein.';
	}
	paintGems(miner.balance);
	gemsBtn.addEventListener('click', () => {
		const open = gemPanel.hidden;
		gemPanel.hidden = !open;
		gemsBtn.setAttribute('aria-expanded', String(open));
		if (open) miner.refresh();
	});
	$('.wd-gempanel .wd-x').addEventListener('click', () => { gemPanel.hidden = true; gemsBtn.setAttribute('aria-expanded', 'false'); });

	// ---- places strip (teleport) ----
	const nav = $('.wd-places');
	for (const p of PLACES) {
		const b = h('button', 'wd-place', `<i style="--h:${p.hue}"></i>${esc(p.title)}`);
		b.type = 'button';
		b.title = p.sub;
		b.addEventListener('click', () => goTo(p));
		nav.append(b);
	}
	/** Put the player just outside a place, facing it. */
	function goTo(p) {
		const s = standPointFor(p);
		player.root.position.set(s.x, 0, s.z);
		player.root.rotation.y = s.yaw;
		controls.orbit.yaw = s.yaw;
		camera.position.set(s.x - Math.sin(s.yaw) * 6, 3.2, s.z - Math.cos(s.yaw) * 6);
	}

	// ---- toasts ----
	function toast(text, color) {
		const t = h('div', 'wd-toast', esc(text));
		if (color) t.style.setProperty('--c', color);
		toasts.append(t);
		t.addEventListener('animationend', () => t.remove(), { once: true });
	}

	// ---- fade ----
	async function fadeTo(opaque, caption = '') {
		fadeCap.textContent = caption;
		fade.classList.toggle('is-on', opaque);
		if (reducedMotion) return;
		await new Promise((r) => requestAnimationFrame(r));
		await settled(fade);
	}

	// ---- interactions ----
	let vrOk = false;
	vrSupported().then((ok) => {
		vrOk = ok;
		$('.wd-vr').hidden = !ok;
	});
	$('.wd-vr').addEventListener('click', () => wearHeadset());
	$('.wd-desk').addEventListener('click', () => sitDown());

	async function interact() {
		if (busy || !nearest) return;
		if (nearest.type === 'object') {
			if (nearest.id === 'monitor') return sitDown();
			if (nearest.id === 'phone') return pickUpPhone();
			if (nearest.id === 'headset') return wearHeadset();
		}
		if (nearest.type === 'place') return enterPlace(placeById(nearest.id));
		if (nearest.type === 'agent') return talkTo(nearest.id);
		// Veins are hold-to-dig; a press alone just nudges.
		if (nearest.type === 'vein' && !digHeld) toast('Hold E to dig', '#c4b5fd');
	}

	/** Open the conversation panel on the agent in reach; the agent holds still and faces the visitor. */
	function talkTo(id) {
		const m = agents.byId(id);
		if (!m) return;
		talk.open(m.member, { place: m.place });
	}

	let sitting = null; // { t, from, to, look }
	async function sitDown() {
		if (busy) return;
		busy = true;
		talk.close();
		controls.enabled = false;
		gemPanel.hidden = true;
		// Dolly from where the camera is into the screen; the frame loop drives it.
		sitting = { t: 0, from: camera.position.clone(), to: campus.desk.sitTo.clone(), look: campus.desk.screenCentre.clone(), fromLook: new Vector3() };
		camera.getWorldDirection(sitting.fromLook).multiplyScalar(5).add(camera.position);
		await new Promise((resolve) => (sitting.done = resolve));
		await fadeTo(true, '');
		leaveTo({ app: null, place: 'office' });
	}

	async function enterPlace(place) {
		if (!place || busy) return;
		busy = true;
		talk.close();
		controls.enabled = false;
		await fadeTo(true, `Entering ${place.title}`);
		const s = standPointFor(place);
		player.root.position.set(s.x, 0, s.z);
		player.root.rotation.y = s.yaw;
		leaveTo({ app: place.app, place: place.id });
	}

	/** Hand control to the desktop. The world stays mounted (paused) so coming back is instant. */
	function leaveTo(o) {
		stopLoop();
		el.hidden = true;
		sitting = null;
		onDesktop(o);
		busy = false;
	}

	// ---- phone ----
	const phone = $('.wd-phone');
	const phoneFrame = phone.querySelector('iframe');
	function pickUpPhone() {
		if (!phoneFrame.src) phoneFrame.src = '/pocket?chrome=off';
		phone.hidden = false;
		controls.enabled = false;
		phone.querySelector('.wd-phone-x').focus();
	}
	function putDownPhone() {
		phone.hidden = true;
		controls.enabled = true;
	}
	phone.querySelector('.wd-phone-x').addEventListener('click', putDownPhone);
	phone.addEventListener('click', (e) => { if (e.target === phone) putDownPhone(); });
	addEventListener('keydown', (e) => {
		if (e.key === 'Escape' && !phone.hidden) putDownPhone();
	});

	// ---- VR ----
	let xrSession = null;
	async function wearHeadset() {
		if (busy) return;
		if (!vrOk) {
			// No runtime: the honest alternative is first-person view.
			cameraCtl.setMode('firstperson', camera);
			toast('No VR headset found in this browser. Switched to first person; press C to change the camera.', '#60a5fa');
			return;
		}
		try {
			xrSession = await enterVR(renderer, {
				onEnd: () => {
					xrSession = null;
					el.classList.remove('is-xr');
					campus.resize();
					player.setVisible(!cameraCtl.isFirstPerson());
				},
			});
			el.classList.add('is-xr');
			player.setVisible(false);
		} catch (err) {
			log.warn('[world] VR session failed', err?.message);
			toast(`Could not start VR: ${err?.message || 'the headset refused the session'}.`, '#f87171');
		}
	}
	/** Thumbstick locomotion from the first XR gamepad; the XR rig follows the player. */
	function xrMove() {
		const session = renderer.xr.getSession?.();
		if (!session) return null;
		for (const src of session.inputSources) {
			const ax = src.gamepad?.axes;
			if (ax && ax.length >= 4 && (Math.abs(ax[2]) > 0.1 || Math.abs(ax[3]) > 0.1)) return { x: ax[2], z: -ax[3] };
		}
		return { x: 0, z: 0 };
	}

	// ---- proximity ----
	function updateNearest() {
		const p = player.position;
		const n = nearestInteractable(p.x, p.z, { veinPositions: campus.veinPositions, agents: agents.positions() });
		const changed = (n && n.id) !== (nearest && nearest.id);
		nearest = n;
		if (changed) {
			campus.highlight(n);
			prompt.hidden = !n;
			if (n) {
				promptTitle.textContent = n.title;
				promptSub.textContent = n.sub;
				promptKey.textContent = n.type === 'vein' ? (isTouch ? 'Hold' : 'Hold E') : isTouch ? 'Tap' : 'E';
			}
			dig.hidden = !n || n.type !== 'vein';
			digBtn.hidden = !(isTouch && n && n.type === 'vein');
		}
		// Which district are we in? Nearest place by distance, for the top-left line.
		let best = null;
		for (const pl of PLACES) {
			const d = Math.hypot(p.x - pl.x, p.z - pl.z);
			if (!best || d < best.d) best = { d, pl };
		}
		where.textContent = best && best.d < 12 ? best.pl.title : 'Campus';
	}

	// ---- mining ----
	async function updateMining(dt) {
		const vein = nearest && nearest.type === 'vein' ? nearest.id : null;
		const progress = miner.tick(dt, digHeld && controls.enabled, vein);
		digBar.style.width = `${Math.round(progress * 100)}%`;
		if (vein && miner.ready()) {
			const r = await miner.dig(vein);
			if (r.ok) toast(`${r.mined.label} +${r.mined.points}`, r.mined.hex);
			else if (r.error === 'dig_too_soon') toast(`Give the vein a moment (${r.retryIn || 1}s).`, '#c4b5fd');
			else if (r.error === 'daily_cap') toast('You have hit the daily dig limit. Come back tomorrow.', '#c4b5fd');
			else toast(r.message, '#f87171');
		}
	}

	// ---- touch stick ----
	function paintStick() {
		const j = controls.joystick;
		if (!isTouch) return;
		stick.hidden = !j.active;
		if (!j.active) return;
		stick.style.transform = `translate(${j.baseX - 52}px, ${j.baseY - 52}px)`;
		stick.firstElementChild.style.transform = `translate(${j.x * 36}px, ${j.y * 36}px)`;
	}

	// ---- frame loop ----
	const governor = createFrameGovernor();
	const focus = trackWindowFocus();
	let saver = getPowerSaver();
	onPowerSaverChange((on) => (saver = on));
	let last = 0;
	let running = false;
	const lookScratch = new Vector3();

	function frame(now) {
		const xr = renderer.xr.isPresenting;
		const cap = xr ? Infinity : saver || !focus.focused || !phone.hidden ? FPS_IDLE : FPS_ACTIVE;
		if (!xr && !governor.shouldRun(now, cap)) return;
		const dt = Math.min(0.05, last ? (now - last) / 1000 : 0.016);
		last = now;

		const move = xr ? xrMove() || { x: 0, z: 0 } : controls.readMove();
		const yaw = xr ? Math.atan2(-camera.matrixWorld.elements[8], -camera.matrixWorld.elements[10]) + Math.PI : controls.orbit.yaw;
		player.update(dt, move, yaw, controls.run, campus.solids);
		if (!sitting) agents.update(dt, player.position, camera);
		campus.tick(dt);
		ticker.tick(dt);
		if (Math.hypot(player.position.x, player.position.z - 8) < 14) {
			screen.draw({ wall: shell.prefs.wall, name: shell.displayName(), prompt: nearest?.id === 'monitor' ? 'Press E to sit down' : '', clock24: shell.prefs.clock24, accent: shell.prefs.accent });
		}
		updateNearest();
		updateMining(dt);
		paintStick();

		if (sitting) {
			sitting.t = Math.min(1, sitting.t + dt / (reducedMotion ? 0.01 : SIT_SECONDS));
			const e = sitting.t * sitting.t * (3 - 2 * sitting.t);
			camera.position.lerpVectors(sitting.from, sitting.to, e);
			lookScratch.lerpVectors(sitting.fromLook, sitting.look, e);
			camera.lookAt(lookScratch);
			if (sitting.t >= 1) sitting.done?.();
		} else if (xr) {
			// The XR camera is driven by the headset; keep the rig at the player's feet.
			camera.position.set(player.position.x, 0, player.position.z);
		} else {
			cameraCtl.tick(dt);
			cameraCtl.apply(camera, player.position, player.height, controls.orbit, 0.35);
		}
		renderer.render(scene, camera);
	}
	function startLoop() {
		if (running) return;
		running = true;
		last = 0;
		governor.reset();
		renderer.setAnimationLoop(frame);
	}
	function stopLoop() {
		running = false;
		renderer.setAnimationLoop(null);
	}
	addEventListener('resize', () => { if (!el.hidden) campus.resize(); });

	// ---- lifecycle ----
	let entered = false;
	/**
	 * Show the world. On the first entry the player stands at the gate; on a
	 * return they stand where they left (outside the place they walked into).
	 * @param {{ fromBoot?: boolean, at?: string }} [o]
	 */
	async function enter({ at } = {}) {
		el.hidden = false;
		campus.resize();
		controls.enabled = true;
		busy = false;
		if (at && placeById(at)) goTo(placeById(at));
		document.documentElement.classList.add('in-world');
		if (!entered) {
			entered = true;
			refreshTicker();
			miner.refresh();
			scheduleTicker();
			agents.load();
		}
		startLoop();
		fade.classList.add('is-on');
		await new Promise((r) => requestAnimationFrame(r));
		await fadeTo(false);
	}

	function dispose() {
		stopLoop();
		clearInterval(tickerTimer);
		xrSession?.end().catch(() => {});
		talk.dispose();
		agents.dispose();
		campus.dispose();
		screen.dispose();
		ticker.dispose();
		el.remove();
	}

	return { el, enter, dispose, get entered() { return entered; } };
}
