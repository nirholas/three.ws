// Diorama play mode: turns a saved or freshly forged world with a `game` block
// into a playable microgame. The renderer hosts the session (camera, frame
// hook, object visibility), game-rules.js decides pickups, hazards and the
// timer, and this module owns the walker, input, HUD and result overlays.
//
// The walker is the visitor's own walk avatar (same roster and storage key as
// the site's companion), loaded through walk-sdk. If that fails the visitor
// gets a Retry, never a silent empty island.

import * as THREE from 'three';
import { loadWalkAvatar } from '../../walk-sdk/src/internal/load-avatar.js';
import { resolveConfig, resolveAvatarEntry } from '../../walk-sdk/src/config.js';
import { lsGet } from '../../walk-sdk/src/internal/storage.js';
import {
	playability,
	objectiveText,
	createGameState,
	startGame,
	stepGame,
	hudFor,
	resolveWalker,
} from './game-rules.js';

const WALKER_HEIGHT = 0.9;
const WALK_SPEED = 2.4;
const TURN_RATE = 12;
const CAM_DIST = 4.2;
const CAM_HEIGHT = 2.6;
const ARRIVE_DIST = 0.12;
const STICK_RADIUS = 48;
const KEY_DIRS = {
	ArrowUp: [0, -1],
	KeyW: [0, -1],
	ArrowDown: [0, 1],
	KeyS: [0, 1],
	ArrowLeft: [-1, 0],
	KeyA: [-1, 0],
	ArrowRight: [1, 0],
	KeyD: [1, 0],
};

function h(tag, cls, text) {
	const node = document.createElement(tag);
	if (cls) node.className = cls;
	if (text !== undefined) node.textContent = text;
	return node;
}

/**
 * @param {{ stage: HTMLElement, renderer: ReturnType<import('./renderer.js').createDioramaRenderer>,
 *           getDiorama: () => object|null, onExit?: () => void }} opts
 */
export function createPlay({ stage, renderer, getDiorama, onExit }) {
	const root = h('div', 'dio-play');
	root.hidden = true;
	root.setAttribute('role', 'dialog');
	root.setAttribute('aria-label', 'Play this world');

	const hud = h('div', 'dio-play__hud');
	const objective = h('p', 'dio-play__objective');
	const stats = h('p', 'dio-play__stats');
	const progress = h('span', 'dio-play__progress');
	const clock = h('span', 'dio-play__clock');
	stats.append(progress, clock);
	const exitBtn = h('button', 'dio-play__exit', 'Exit');
	exitBtn.type = 'button';
	exitBtn.setAttribute('aria-label', 'Exit play mode (Escape)');
	hud.append(objective, stats, exitBtn);

	const card = h('div', 'dio-play__card');
	const cardTitle = h('h2', 'dio-play__title');
	const cardBody = h('p', 'dio-play__body');
	const cardBtn = h('button', 'dio-play__cta');
	cardBtn.type = 'button';
	const cardSecondary = h('button', 'dio-play__alt', 'Exit');
	cardSecondary.type = 'button';
	const cardActions = h('div', 'dio-play__actions');
	cardActions.append(cardBtn, cardSecondary);
	card.append(cardTitle, cardBody, cardActions);

	const stick = h('div', 'dio-play__stick');
	stick.setAttribute('aria-hidden', 'true');
	const knob = h('div', 'dio-play__knob');
	stick.append(knob);

	root.append(hud, card, stick);
	stage.append(root);

	const session = {
		open: false,
		diorama: null,
		state: null,
		walker: null, // { group, controller, model }
		pos: { x: 0, z: 0 },
		heading: Math.PI,
		camYaw: Math.PI, // fixed for the run so WASD never swings with the walker
		keys: new Set(),
		stick: null, // { id, dx, dz }
		target: null, // tap-to-move { x, z }
		loadingAvatar: null,
		lastStatus: '',
	};

	// ── card states ────────────────────────────────────────────────────────

	function showCard({ title, body, cta, ctaDisabled = false, onCta, alt = 'Exit' }) {
		cardTitle.textContent = title;
		cardBody.textContent = body;
		cardBtn.textContent = cta;
		cardBtn.disabled = ctaDisabled;
		cardBtn.onclick = onCta;
		cardSecondary.textContent = alt;
		card.hidden = false;
		hud.classList.remove('is-live');
		if (!ctaDisabled) cardBtn.focus({ preventScroll: true });
	}

	function hideCard() {
		card.hidden = true;
	}

	function ready() {
		const verdict = playability(session.diorama);
		showCard({
			title: session.diorama.title || 'A little world',
			body: verdict.ok
				? `${objectiveText(session.diorama)}. Move with WASD or the arrow keys, drag the pad, or tap the ground.`
				: verdict.reason,
			cta: verdict.ok ? 'Start' : 'Not ready yet',
			ctaDisabled: !verdict.ok,
			onCta: begin,
		});
		session.lastStatus = verdict.ok ? 'ready' : 'blocked';
	}

	// ── walker ─────────────────────────────────────────────────────────────

	async function ensureWalker() {
		if (session.walker) return session.walker;
		if (!session.loadingAvatar) {
			const config = resolveConfig();
			const entry = resolveAvatarEntry(lsGet(config.keys.avatar), config);
			const fallbackEntry = resolveAvatarEntry(config.defaultAvatarId, config);
			session.loadingAvatar = loadWalkAvatar(entry, {
				assetBase: config.assetBase,
				apiBase: config.apiBase,
				manifestUrl: config.manifestUrl,
				fallbackEntry,
			})
				.then(({ model, controller }) => {
					const box = new THREE.Box3().setFromObject(model);
					const size = box.getSize(new THREE.Vector3());
					const scale = WALKER_HEIGHT / Math.max(0.001, size.y);
					model.scale.setScalar(scale);
					const fitted = new THREE.Box3().setFromObject(model);
					const center = fitted.getCenter(new THREE.Vector3());
					model.position.x -= center.x;
					model.position.z -= center.z;
					model.position.y -= fitted.min.y;
					const group = new THREE.Group();
					group.add(model);
					session.walker = { group, controller, model };
					return session.walker;
				})
				.finally(() => {
					session.loadingAvatar = null;
				});
		}
		return session.loadingAvatar;
	}

	function placeWalker() {
		const spawn = session.diorama.game.spawn;
		session.pos = { x: spawn.x, z: spawn.z };
		session.heading = spawn.heading;
		session.camYaw = spawn.heading;
		session.target = null;
		syncWalkerTransform();
	}

	function syncWalkerTransform() {
		const w = session.walker;
		if (!w) return;
		w.group.position.set(session.pos.x, renderer.surfaceHeight(session.pos.x, session.pos.z), session.pos.z);
		w.group.rotation.y = session.heading;
	}

	// ── input ──────────────────────────────────────────────────────────────

	const forward = new THREE.Vector3();
	const right = new THREE.Vector3();

	function inputVector() {
		let ix = 0;
		let iz = 0;
		for (const code of session.keys) {
			const d = KEY_DIRS[code];
			if (d) {
				ix += d[0];
				iz += d[1];
			}
		}
		if (session.stick) {
			ix += session.stick.dx;
			iz += session.stick.dz;
		}
		const len = Math.hypot(ix, iz);
		if (len > 1) {
			ix /= len;
			iz /= len;
		}
		return { ix, iz };
	}

	function cameraBasis() {
		const cam = renderer.camera;
		cam.getWorldDirection(forward);
		forward.y = 0;
		if (forward.lengthSq() < 1e-6) forward.set(0, 0, -1);
		forward.normalize();
		right.set(-forward.z, 0, forward.x);
	}

	function onKeyDown(ev) {
		if (!session.open) return;
		if (ev.code === 'Escape') {
			close();
			return;
		}
		if (KEY_DIRS[ev.code]) {
			session.keys.add(ev.code);
			session.target = null;
			ev.preventDefault();
		}
	}
	function onKeyUp(ev) {
		session.keys.delete(ev.code);
	}

	function stickPoint(ev) {
		const r = stick.getBoundingClientRect();
		const cx = r.left + r.width / 2;
		const cy = r.top + r.height / 2;
		let dx = ev.clientX - cx;
		let dy = ev.clientY - cy;
		const len = Math.hypot(dx, dy);
		if (len > STICK_RADIUS) {
			dx = (dx / len) * STICK_RADIUS;
			dy = (dy / len) * STICK_RADIUS;
		}
		knob.style.transform = `translate(${dx}px, ${dy}px)`;
		session.stick = { id: ev.pointerId, dx: dx / STICK_RADIUS, dz: dy / STICK_RADIUS };
		session.target = null;
	}
	function releaseStick(ev) {
		if (session.stick && ev && ev.pointerId !== session.stick.id) return;
		session.stick = null;
		knob.style.transform = '';
	}

	const ray = new THREE.Raycaster();
	const ndc = new THREE.Vector2();
	const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
	const hit = new THREE.Vector3();

	function onStagePointer(ev) {
		if (!session.open || !card.hidden) return;
		if (ev.target.closest('.dio-play__hud, .dio-play__stick, .dio-play__card')) return;
		const canvas = renderer.renderer.domElement;
		const r = canvas.getBoundingClientRect();
		ndc.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
		ray.setFromCamera(ndc, renderer.camera);
		if (ray.ray.intersectPlane(groundPlane, hit)) session.target = { x: hit.x, z: hit.z };
	}

	// ── per-frame ──────────────────────────────────────────────────────────

	function frame(dt, now) {
		const w = session.walker;
		if (!w) return;
		let moving = false;

		if (session.state.phase === 'playing') {
			const { ix, iz } = inputVector();
			cameraBasis();
			let mx = right.x * ix + forward.x * -iz;
			let mz = right.z * ix + forward.z * -iz;
			let speed = Math.hypot(mx, mz);
			if (speed < 0.05 && session.target) {
				const dx = session.target.x - session.pos.x;
				const dz = session.target.z - session.pos.z;
				const dist = Math.hypot(dx, dz);
				if (dist < ARRIVE_DIST) session.target = null;
				else {
					mx = dx / dist;
					mz = dz / dist;
					speed = 1;
				}
			}
			if (speed > 0.05) {
				const step = Math.min(1, speed) * WALK_SPEED * dt;
				const len = Math.hypot(mx, mz);
				const next = resolveWalker(
					{ x: session.pos.x + (mx / len) * step, z: session.pos.z + (mz / len) * step },
					session.diorama,
					session.state.collected,
				);
				session.pos = next;
				const want = Math.atan2(mx, mz);
				let diff = want - session.heading;
				diff = Math.atan2(Math.sin(diff), Math.cos(diff));
				session.heading += diff * Math.min(1, TURN_RATE * dt);
				moving = true;
			}
			advance(now);
		}

		syncWalkerTransform();
		w.controller.setState(moving ? 'walk' : 'idle');
		w.controller.update?.(dt);
		chaseCamera(dt);
	}

	function advance(now) {
		const before = session.state;
		const after = stepGame(before, session.diorama, session.pos, now);
		if (after === before) return;
		session.state = after;
		for (const id of after.collected) {
			if (!before.collected.includes(id)) renderer.setObjectVisible(id, false);
		}
		paintHud();
		if (after.phase === 'won' || after.phase === 'lost') finish(after);
	}

	const camGoal = new THREE.Vector3();
	function chaseCamera(dt) {
		const cam = renderer.camera;
		const y = renderer.surfaceHeight(session.pos.x, session.pos.z);
		camGoal.set(
			session.pos.x - Math.sin(session.camYaw) * CAM_DIST,
			y + CAM_HEIGHT,
			session.pos.z - Math.cos(session.camYaw) * CAM_DIST,
		);
		cam.position.lerp(camGoal, Math.min(1, 3.5 * dt));
		cam.lookAt(session.pos.x, y + WALKER_HEIGHT * 0.7, session.pos.z);
	}

	// ── flow ───────────────────────────────────────────────────────────────

	function paintHud() {
		const numbers = hudFor(session.state, session.diorama);
		objective.textContent = numbers.objective;
		progress.textContent = numbers.progress;
		clock.textContent = numbers.clock;
		progress.hidden = !numbers.progress;
		clock.hidden = !numbers.clock;
	}

	function resetPickups() {
		for (const id of session.diorama.game.targetIds) renderer.setObjectVisible(id, true);
	}

	function begin() {
		session.state = startGame(createGameState(session.diorama), performance.now());
		resetPickups();
		placeWalker();
		hideCard();
		hud.classList.add('is-live');
		paintHud();
		root.focus({ preventScroll: true });
	}

	function finish(state) {
		const won = state.phase === 'won';
		showCard({
			title: won ? 'You won' : 'Not this time',
			body: `${state.reason} ${Math.round(state.elapsedMs / 100) / 10}s.`,
			cta: 'Play again',
			onCta: () => {
				session.state = createGameState(session.diorama);
				resetPickups();
				begin();
			},
		});
		session.lastStatus = state.phase;
	}

	async function start() {
		const diorama = getDiorama();
		if (!diorama || session.open) return;
		session.diorama = diorama;
		root.hidden = false;
		session.open = true;
		hud.classList.remove('is-live');
		stick.hidden = false;

		if (!diorama.game) {
			session.state = { phase: 'ready', collected: [] };
			showCard({
				title: 'No goal in this world',
				body: playability(diorama).reason,
				cta: 'Back',
				onCta: close,
			});
			return;
		}
		session.state = createGameState(diorama);

		showCard({ title: diorama.title || 'A little world', body: 'Getting your character ready...', cta: 'Loading', ctaDisabled: true });
		try {
			await ensureWalker();
		} catch (err) {
			if (!session.open) return;
			showCard({
				title: 'Your character did not load',
				body: `${err?.message || 'The avatar failed to load.'} Check your connection and try again.`,
				cta: 'Retry',
				onCta: () => {
					session.open = false;
					start();
				},
			});
			return;
		}
		if (!session.open) return;
		renderer.scene.add(session.walker.group);
		placeWalker();
		renderer.enterPlay({ onFrame: frame });
		ready();
	}

	function close() {
		if (!session.open) return;
		session.open = false;
		session.keys.clear();
		releaseStick();
		if (session.walker) renderer.scene.remove(session.walker.group);
		if (session.diorama?.game) resetPickups();
		renderer.exitPlay();
		root.hidden = true;
		onExit?.();
	}

	// Rebind the card Exit button and global listeners once.
	cardSecondary.addEventListener('click', close);
	exitBtn.addEventListener('click', close);
	stick.addEventListener('pointerdown', (ev) => {
		stick.setPointerCapture?.(ev.pointerId);
		stickPoint(ev);
	});
	stick.addEventListener('pointermove', (ev) => {
		if (session.stick && session.stick.id === ev.pointerId) stickPoint(ev);
	});
	stick.addEventListener('pointerup', releaseStick);
	stick.addEventListener('pointercancel', releaseStick);
	stage.addEventListener('pointerdown', onStagePointer);
	window.addEventListener('keydown', onKeyDown);
	window.addEventListener('keyup', onKeyUp);

	return {
		start,
		close,
		get isOpen() {
			return session.open;
		},
		dispose() {
			close();
			window.removeEventListener('keydown', onKeyDown);
			window.removeEventListener('keyup', onKeyUp);
			stage.removeEventListener('pointerdown', onStagePointer);
			root.remove();
		},
	};
}
