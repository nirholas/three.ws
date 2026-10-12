// The Grid: a neon wireframe room where the platform's apps are things you
// walk up to. A live board, a directory, a wallet-moves wall and one kiosk per
// app, all fed by the same real endpoints the desktop and the Field use. Your
// byte tier comes from the gems you mined in the campus. E opens the app on
// the desktop; the campus and the desktop are one button away.

import {
	AmbientLight, BoxGeometry, Color, DirectionalLight, EdgesGeometry, GridHelper, LineBasicMaterial, LineSegments,
	Mesh, MeshBasicMaterial, PerspectiveCamera, PlaneGeometry, Raycaster, Scene, Vector2,
} from 'three';
import { createPlayer } from '../../docs-world/player.js';
import { createControls } from '../../docs-world/controls.js';
import { createCameraModeController, CAMERA_MODE_LABELS } from '../../game/camera-modes.js';
import { createFrameGovernor, FPS_ACTIVE, FPS_IDLE, getPowerSaver, onPowerSaverChange, trackWindowFocus } from '../../shared/frame-governor.js';
import { createRenderer } from '../../webgl-support.js';
import { loadLaunches, loadPulse, loadStats, loadToken } from '../../field/data.js';
import { icon } from '../icons.js';
import { createMiner } from '../world/mine.js';
import { ROOM, ROOM_BOUND, SPAWN, WALLS, kioskLayout, nearestSurface, tierFor } from './logic.js';
import { INK, DIM, createSurface, paintBoard, paintDirectory, paintKiosk, paintPulse } from './panels.js';
import './grid.css';

const REFRESH_MS = 30_000;
const PULSE_LIMIT = 24;

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

async function loadNewAgents() {
	const r = await fetch('/api/agents/public?sort=newest&limit=8', { credentials: 'omit', headers: { accept: 'application/json' } });
	if (!r.ok) throw new Error(`HTTP ${r.status}`);
	const d = await r.json();
	return Array.isArray(d.agents) ? d.agents : [];
}

/**
 * @param {{
 *   apps: Array<{id:string,title:string,desc?:string,hue:number}>,
 *   directory: Array<{id:string,title:string,desc?:string}>,
 *   reducedMotion?: boolean,
 *   onLeave: (o: { app?: string|null, to?: 'desktop'|'campus' }) => void,
 * }} o
 */
export function createGrid({ apps, directory, reducedMotion = false, onLeave }) {
	const el = document.createElement('div');
	el.className = 'gd';
	el.hidden = true;
	el.innerHTML = `
		<canvas class="gd-canvas" aria-label="The Grid, a 3D room of live three.ws apps"></canvas>
		<div class="gd-hud">
			<div class="gd-top">
				<div class="gd-brand"><b>three.ws</b><span>The Grid</span></div>
				<div class="gd-tools">
					<button type="button" class="gd-tool gd-cam" title="Camera (C)">${icon('camera', 18)}<span class="gd-cam-label"></span></button>
					<button type="button" class="gd-tool gd-campus" title="Walk the campus">${icon('compass', 18)}<span>Campus</span></button>
					<button type="button" class="gd-tool gd-desk" title="Go to the desktop">${icon('desktop', 18)}<span>Desktop</span></button>
				</div>
			</div>
			<div class="gd-prompt" hidden role="status"><kbd class="gd-key">E</kbd><div><b></b><span></span></div></div>
			<div class="gd-tier" role="img" aria-label="Byte tier"><b class="gd-tier-name">TIER 1 - BYTE</b><div class="gd-bar"><i></i></div><small class="gd-tier-note"></small></div>
			<div class="gd-help">WASD move &nbsp; Shift run &nbsp; Drag to look &nbsp; E open &nbsp; C camera</div>
		</div>`;
	document.body.append(el);
	const $ = (s) => el.querySelector(s);
	const canvas = $('.gd-canvas');
	const prompt = $('.gd-prompt');
	const isTouch = matchMedia('(pointer: coarse)').matches;
	if (isTouch) $('.gd-help').hidden = true;

	// ---- renderer and scene ----
	const renderer = createRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance' }, { fallback: canvas.parentElement });
	renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
	renderer.setSize(innerWidth, innerHeight, false);
	const scene = new Scene();
	scene.background = new Color(0x000504);
	const camera = new PerspectiveCamera(58, innerWidth / innerHeight, 0.1, 120);
	scene.add(new AmbientLight(0x7dffd0, 1.15));
	const key = new DirectionalLight(0xbfffe8, 1.6);
	key.position.set(6, 12, 8);
	scene.add(key);

	const lineMat = new LineBasicMaterial({ color: new Color(INK), transparent: true, opacity: 0.85 });
	const dimMat = new LineBasicMaterial({ color: new Color(DIM), transparent: true, opacity: 0.55 });
	const room = new LineSegments(new EdgesGeometry(new BoxGeometry(ROOM.half * 2, ROOM.height, ROOM.half * 2)), lineMat);
	room.position.y = ROOM.height / 2;
	scene.add(room);
	// Depth cues the void lacks: a metre grid on the floor and rings on the ceiling.
	const floor = new GridHelper(ROOM.half * 2, ROOM.half, new Color(INK), new Color(DIM));
	floor.material.transparent = true;
	floor.material.opacity = 0.32;
	scene.add(floor);
	const ceiling = new GridHelper(ROOM.half * 2, 6, new Color(DIM), new Color(DIM));
	ceiling.material.transparent = true;
	ceiling.material.opacity = 0.18;
	ceiling.position.y = ROOM.height;
	scene.add(ceiling);

	// ---- live state ----
	const S = {
		stats: { status: 'loading' },
		agents: { status: 'loading' },
		launches: { status: 'loading' },
		pulse: { status: 'loading' },
		token: { status: 'loading' },
	};
	const kioskDefs = kioskLayout(apps);
	const surfaces = [...WALLS, ...kioskDefs].map((def) => {
		const px = def.kind === 'board' ? [2048, 819] : def.kind === 'kiosk' ? [640, Math.round(640 * (def.h / def.w))] : [1024, 640];
		const surf = createSurface(px[0], px[1], renderer.capabilities.getMaxAnisotropy());
		const mesh = new Mesh(new PlaneGeometry(def.w, def.h), new MeshBasicMaterial({ map: surf.texture, toneMapped: false }));
		mesh.position.set(def.x, def.y, def.z);
		mesh.rotation.y = def.yaw;
		mesh.userData.surfaceId = def.id;
		scene.add(mesh);
		const edge = new LineSegments(new EdgesGeometry(mesh.geometry), lineMat);
		edge.position.copy(mesh.position);
		edge.rotation.copy(mesh.rotation);
		edge.translateZ(0.02);
		scene.add(edge);
		if (def.kind === 'kiosk') {
			// A plinth line drops to the floor so the slab reads as standing.
			const stand = new LineSegments(new EdgesGeometry(new BoxGeometry(def.w * 0.9, 0.12, 0.5)), dimMat);
			stand.position.set(def.x, 0.06, def.z + 0.2);
			scene.add(stand);
		}
		return { def, surf, mesh, edge, hot: false };
	});
	const byId = new Map(surfaces.map((s) => [s.def.id, s]));
	const pickables = surfaces.map((s) => s.mesh);
	// Kiosks are solid: the player walks up to one, not through it.
	const solids = kioskDefs.map((k) => ({ obb: { x: k.x, z: k.z, yaw: k.yaw, hw: k.w / 2 + 0.1, hd: 0.45 } }));

	function paint(s) {
		switch (s.def.kind) {
			case 'board': return paintBoard(s.surf, S, s.hot);
			case 'directory': return paintDirectory(s.surf, directory, s.hot);
			case 'pulse': return paintPulse(s.surf, S, s.hot);
			default: return paintKiosk(s.surf, s.def, s.hot);
		}
	}
	function repaint(kinds) {
		for (const s of surfaces) if (!kinds || kinds.includes(s.def.kind)) { paint(s); s.surf.texture.needsUpdate = true; }
	}

	// ---- feeds ----
	let timers = [];
	async function feed(key, load, kinds) {
		try {
			S[key] = { status: 'ok', items: await load() };
		} catch (err) {
			S[key] = { status: 'error', error: err?.message === 'no price' ? 'No price yet' : `Feed unavailable (${err?.message || 'network'})` };
		}
		repaint(kinds);
	}
	const FEEDS = {
		stats: () => feed('stats', loadStats, ['board']),
		agents: () => feed('agents', loadNewAgents, ['board']),
		launches: () => feed('launches', () => loadLaunches(5), ['board']),
		pulse: () => feed('pulse', async () => (await loadPulse({ limit: PULSE_LIMIT })).events, ['board', 'pulse']),
		token: () => feed('token', loadToken, ['board']),
	};
	function refreshAll() {
		return Promise.all(Object.values(FEEDS).map((f) => f()));
	}

	// ---- the player ----
	const player = createPlayer(scene, renderer, { spawn: SPAWN, yaw: SPAWN.yaw, bound: ROOM_BOUND, keepout: 0 });
	const cameraCtl = createCameraModeController({ storageKey: 'tws:grid-camera', onChange: syncCamera });
	function syncCamera() {
		$('.gd-cam-label').textContent = CAMERA_MODE_LABELS[cameraCtl.mode];
		player.setVisible(!cameraCtl.isFirstPerson());
	}
	syncCamera();
	$('.gd-cam').addEventListener('click', () => cameraCtl.cycle(camera));

	// ---- tier from the gems mined in the campus ----
	const tierEl = $('.gd-tier');
	const tierName = $('.gd-tier-name');
	const tierBar = $('.gd-bar i');
	const tierNote = $('.gd-tier-note');
	const miner = createMiner({
		onBalance(b) {
			if (b.offline) {
				tierName.textContent = 'TIER -';
				tierBar.style.width = '0%';
				tierNote.textContent = 'Gem ledger unreachable. It retries when you come back.';
				return;
			}
			const t = tierFor(Number(b.points) || 0);
			tierName.textContent = `TIER ${t.level} - ${t.name.toUpperCase()}`;
			tierBar.style.width = `${Math.round(t.progress * 100)}%`;
			tierEl.setAttribute('aria-label', `Tier ${t.level}, ${t.name}`);
			tierNote.textContent = t.next ? `${t.toNext} points to ${t.next}. Mine gems in the campus.` : 'Top tier reached.';
		},
	});

	// ---- input, proximity, interaction ----
	const controls = createControls(canvas, {
		onInteract: () => interact(),
		onCycleCamera: () => cameraCtl.cycle(camera),
		onTap: (e) => tap(e),
	});
	controls.orbit.yaw = SPAWN.yaw;
	controls.orbit.dist = 8;
	controls.orbit.pitch = 0.17;
	const ray = new Raycaster();
	const ndc = new Vector2();
	function tap(e) {
		const r = canvas.getBoundingClientRect();
		ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
		ray.setFromCamera(ndc, camera);
		const hit = ray.intersectObjects(pickables, false)[0];
		if (!hit) return;
		const s = byId.get(hit.object.userData.surfaceId);
		if (!s) return;
		if (nearest === s) return interact();
		// Out of reach: step up to it, facing in, close enough to use.
		const d = s.def;
		const x = d.x + Math.sin(d.yaw) * 2.6;
		const z = d.z + Math.cos(d.yaw) * 2.6;
		const yaw = d.yaw + Math.PI;
		player.root.position.set(x, 0, z);
		player.root.rotation.y = yaw;
		controls.orbit.yaw = yaw;
	}

	let nearest = null;
	function updateNearest() {
		const p = player.position;
		const def = nearestSurface(p.x, p.z, surfaces.map((s) => s.def));
		const n = def ? byId.get(def.id) : null;
		if (n === nearest) return;
		if (nearest) { nearest.hot = false; paint(nearest); nearest.surf.texture.needsUpdate = true; }
		nearest = n;
		if (n) {
			n.hot = true;
			paint(n);
			n.surf.texture.needsUpdate = true;
			prompt.querySelector('b').textContent = n.def.title;
			prompt.querySelector('span').textContent = n.def.sub;
			prompt.querySelector('.gd-key').textContent = isTouch ? 'Tap' : 'E';
		}
		prompt.hidden = !n;
	}
	function interact() {
		if (!nearest) return;
		leave({ app: nearest.def.app });
	}
	$('.gd-desk').addEventListener('click', () => leave({ app: null, to: 'desktop' }));
	$('.gd-campus').addEventListener('click', () => leave({ app: null, to: 'campus' }));

	// ---- frame loop ----
	const governor = createFrameGovernor();
	const focus = trackWindowFocus();
	let saver = getPowerSaver();
	onPowerSaverChange((on) => (saver = on));
	let last = 0;
	let running = false;
	const limit = ROOM.half - 0.6;
	function frame(now) {
		const cap = saver || !focus.focused ? FPS_IDLE : FPS_ACTIVE;
		if (!governor.shouldRun(now, cap)) return;
		const dt = Math.min(0.05, last ? (now - last) / 1000 : 0.016);
		last = now;
		player.update(dt, controls.readMove(), controls.orbit.yaw, controls.run, solids);
		updateNearest();
		cameraCtl.tick(dt);
		cameraCtl.apply(camera, player.position, player.height, controls.orbit, 0.35);
		// The camera never leaves the room: walls would otherwise block the view.
		camera.position.x = Math.max(-limit, Math.min(limit, camera.position.x));
		camera.position.z = Math.max(-limit, Math.min(limit, camera.position.z));
		camera.position.y = Math.max(0.4, Math.min(ROOM.height - 0.5, camera.position.y));
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
	function resize() {
		renderer.setSize(innerWidth, innerHeight, false);
		camera.aspect = innerWidth / innerHeight;
		camera.updateProjectionMatrix();
	}
	addEventListener('resize', () => { if (!el.hidden) resize(); });

	// ---- lifecycle ----
	function leave(o) {
		stopLoop();
		timers.forEach(clearInterval);
		timers = [];
		el.hidden = true;
		document.documentElement.classList.remove('in-grid');
		onLeave(o);
	}
	let entered = false;
	function enter() {
		el.hidden = false;
		controls.enabled = true;
		// The desktop beneath may hold keyboard focus in an input (search, Run); controls ignore keys typed into one.
		document.activeElement?.blur?.();
		document.documentElement.classList.add('in-grid');
		resize();
		repaint();
		if (!entered) entered = true;
		refreshAll();
		miner.refresh();
		timers = [setInterval(() => { if (!document.hidden) { refreshAll(); miner.refresh(); } }, REFRESH_MS)];
		startLoop();
	}
	function dispose() {
		stopLoop();
		timers.forEach(clearInterval);
		surfaces.forEach((s) => { s.surf.dispose(); s.mesh.geometry.dispose(); s.mesh.material.dispose(); s.edge.geometry.dispose(); });
		renderer.dispose();
		el.remove();
	}
	return { el, enter, dispose, get entered() { return entered; } };
}
