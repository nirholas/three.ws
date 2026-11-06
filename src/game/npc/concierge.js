// The welcome concierge: a well-dressed NPC near spawn who greets first-time
// visitors once, answers questions through the shared NPC chat (grounded in the
// real feature list, see concierge-logic.js) and leads a skippable tour of real
// landmarks.
//
// Mounted by coincommunities.js right after the WorldLife manager is built, and
// disposed with it. It costs nothing while idle: a 500 ms proximity check runs
// until the player is within WAKE_RADIUS, and only then does a per-frame loop
// tick the NPC body and its labels. When the NPC layer is disabled (?npcs=0)
// mountConcierge returns null before building anything or touching the network.

import { Mesh, RingGeometry, MeshBasicMaterial, DoubleSide, Vector3 } from 'three';
import { Npc } from './npc.js';
import { openChat, isChatPanelOpen } from './npc-chat.js';
import { CLIP_IDLE, CLIP_WALK } from '../avatar-rig.js';
import { hasOpenOverlay, prefersReducedMotion, isTypingTarget } from '../a11y.js';
import { ONBOARD_KEY } from '../play-onboard.js';
import { loadEventConfig } from '../../shared/event-config.js';
import { t } from '../i18n-play.js';
import { log } from '../../shared/log.js';
import {
	CONCIERGE_POST, CONCIERGE_PROVIDER, WAKE_RADIUS, GREET_RADIUS, WALK_AWAY,
	isFirstVisit, markGreeted, npcLayerEnabled, eventLine, buildTour, nextStop, reached,
	conciergePersona,
} from './concierge-logic.js';

const WALK_SPEED = 2.6;
const GREET_STOP_DISTANCE = 3;
const TALK_RANGE = 3.5;
const STYLE_ID = 'concierge-styles';

function lsOk() {
	try { return window.localStorage; } catch { return null; }
}

function injectStyles() {
	if (document.getElementById(STYLE_ID)) return;
	const s = document.createElement('style');
	s.id = STYLE_ID;
	s.textContent = `
	.concierge-card {
		position: fixed; left: 50%; bottom: calc(96px + env(safe-area-inset-bottom, 0px)); transform: translateX(-50%);
		z-index: 17; width: min(420px, calc(100vw - 32px)); box-sizing: border-box;
		background: var(--cc-panel-solid, #0c0c0e); color: var(--cc-text, #f5f5f6);
		border: 1px solid var(--cc-edge, rgba(255,255,255,0.14)); border-radius: var(--cc-radius, 6px);
		box-shadow: 0 10px 34px rgba(0,0,0,0.55); padding: 14px 16px; font-size: 14px; line-height: 1.45;
		animation: concierge-in 0.22s ease;
	}
	@keyframes concierge-in { from { opacity: 0; transform: translate(-50%, 8px); } to { opacity: 1; transform: translate(-50%, 0); } }
	@media (prefers-reduced-motion: reduce) { .concierge-card { animation: none; } }
	.concierge-who { font-size: 11px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; opacity: 0.7; margin-bottom: 4px; }
	.concierge-text { margin: 0 0 12px; }
	.concierge-step { font-size: 11px; opacity: 0.65; margin-bottom: 4px; }
	.concierge-actions { display: flex; flex-wrap: wrap; gap: 8px; }
	.concierge-btn {
		font: inherit; font-weight: 600; font-size: 13px; cursor: pointer; min-height: 40px;
		padding: 8px 14px; border-radius: var(--cc-radius, 4px);
		background: transparent; color: inherit; border: 1px solid var(--cc-edge, rgba(255,255,255,0.28));
		transition: background 0.15s ease, border-color 0.15s ease, transform 0.05s ease;
	}
	.concierge-btn:hover { background: rgba(255,255,255,0.1); border-color: rgba(255,255,255,0.5); }
	.concierge-btn:active { transform: translateY(1px); background: rgba(255,255,255,0.18); }
	.concierge-btn:focus-visible { outline: 2px solid #fff; outline-offset: 2px; }
	.concierge-btn.is-primary { background: #fff; color: var(--cc-ink, #060607); border-color: #fff; }
	.concierge-btn.is-primary:hover { background: #e8e8ea; }
	.concierge-name { cursor: pointer; }
	.concierge-name:hover { text-decoration: underline; }
	.concierge-name:focus-visible { outline: 2px solid #fff; outline-offset: 2px; }
	@media (pointer: coarse) { .concierge-name { min-height: 44px; display: inline-flex; align-items: center; justify-content: center; } }
	`;
	document.head.appendChild(s);
}

function button(label, onClick, primary) {
	const b = document.createElement('button');
	b.type = 'button';
	b.className = 'concierge-btn' + (primary ? ' is-primary' : '');
	b.textContent = label;
	b.addEventListener('click', onClick);
	return b;
}

/**
 * Mount the concierge into a live world. Returns { dispose, openChat } or null
 * when the NPC layer is disabled.
 */
export function mountConcierge({ scene, camera, renderer, getPlayer, ui, world, storage = lsOk(), search = location.search }) {
	if (!npcLayerEnabled(search)) return null;
	injectStyles();

	const npc = new Npc(scene, {
		id: 'concierge', name: t('play.concierge_name', 'Concierge'), role: 'flavor',
		avatar: '/avatars/realistic-female.glb',
		pos: { x: CONCIERGE_POST.x, z: CONCIERGE_POST.z }, yaw: CONCIERGE_POST.yaw,
		range: TALK_RANGE, prompt: t('play.concierge_prompt', 'Ask the concierge'),
	});
	npc.label.classList.add('concierge-name');
	npc.label.style.pointerEvents = 'auto';
	npc.label.tabIndex = 0;
	npc.label.setAttribute('role', 'button');
	npc.label.title = t('play.concierge_prompt', 'Ask the concierge');
	const openFromLabel = () => converse();
	npc.label.addEventListener('click', openFromLabel);
	npc.label.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openFromLabel(); } });

	let disposed = false;
	let awake = false;
	let raf = 0;
	let timer = 0;
	let greeted = !isFirstVisit(storage);
	let greeting = false;       // walking over to greet
	let card = null;
	let tour = null;            // { stops, index }
	let marker = null;
	let eventCfg = null;
	let eventLoaded = false;
	let walkingTo = null;       // { x, z } target while moving
	let moving = false;
	let last = 0;
	const post = new Vector3(CONCIERGE_POST.x, 0, CONCIERGE_POST.z);

	const player = () => getPlayer?.() || null;
	const dist = (p) => Math.hypot(p.x - npc.pos.x, p.z - npc.pos.z);
	const reduced = () => prefersReducedMotion();

	function place(node, y) {
		const w = renderer.domElement.clientWidth, h = renderer.domElement.clientHeight;
		const v = new Vector3(npc.pos.x, y, npc.pos.z).project(camera);
		if (v.z > 1 || v.z < -1) { node.style.display = 'none'; return; }
		node.style.display = '';
		node.style.transform = `translate(-50%, -100%) translate(${(v.x * 0.5 + 0.5) * w}px, ${(-v.y * 0.5 + 0.5) * h}px)`;
	}

	function setMoving(m) {
		if (m === moving) return;
		moving = m;
		npc.anim.crossfadeTo?.(m ? CLIP_WALK : CLIP_IDLE, 0.2)?.catch?.(() => {});
	}

	function stepToward(target, dt, stopAt) {
		const dx = target.x - npc.pos.x, dz = target.z - npc.pos.z;
		const d = Math.hypot(dx, dz);
		if (d <= stopAt) { setMoving(false); return true; }
		const step = Math.min(WALK_SPEED * dt, d - stopAt);
		npc.pos.x += (dx / d) * step;
		npc.pos.z += (dz / d) * step;
		npc.rig.position.copy(npc.pos);
		npc.baseYaw = Math.atan2(dx, dz);
		setMoving(true);
		return false;
	}

	function clearCard() {
		card?.remove();
		card = null;
	}

	function showCard({ step, text, actions }) {
		clearCard();
		card = document.createElement('div');
		card.className = 'concierge-card';
		card.setAttribute('role', 'region');
		card.setAttribute('aria-label', t('play.concierge_name', 'Concierge'));
		const who = document.createElement('div');
		who.className = 'concierge-who';
		who.textContent = t('play.concierge_name', 'Concierge');
		card.appendChild(who);
		if (step) {
			const s = document.createElement('div');
			s.className = 'concierge-step';
			s.textContent = step;
			card.appendChild(s);
		}
		const p = document.createElement('p');
		p.className = 'concierge-text';
		p.setAttribute('aria-live', 'polite');
		p.textContent = text;
		card.appendChild(p);
		const row = document.createElement('div');
		row.className = 'concierge-actions';
		for (const a of actions) row.appendChild(button(a.label, a.run, a.primary));
		card.appendChild(row);
		document.body.appendChild(card);
		row.querySelector('.is-primary')?.focus({ preventScroll: true });
	}

	async function ensureEvent() {
		if (eventLoaded) return;
		eventLoaded = true;
		try { eventCfg = await loadEventConfig(); } catch (e) { log.warn('[concierge] event config unavailable:', e?.message); }
	}

	function openingText() {
		const ev = eventLine(eventCfg);
		const base = t('play.concierge_welcome', 'Welcome to the $three world. I can answer questions or show you around.');
		return ev ? `${ev} ${base}` : base;
	}

	function offer() {
		showCard({
			text: openingText(),
			actions: [
				{ label: t('play.concierge_tour', 'Show me around'), run: startTour, primary: true },
				{ label: t('play.concierge_ask', 'Ask a question'), run: converse },
				{ label: t('play.concierge_dismiss', 'Not now'), run: dismiss },
			],
		});
	}

	function dismiss() {
		clearCard();
		endTour();
		greeting = false;
		setMoving(false);
	}

	function converse() {
		if (disposed) return;
		clearCard();
		endTour();
		const ev = eventLine(eventCfg);
		const persona = conciergePersona() + (ev ? `\nRight now: ${ev}` : '');
		openChat(npc, {
			ui, world, persona, role: t('play.concierge_role', 'Concierge · three.ws'),
			greeting: openingText(), pinProvider: CONCIERGE_PROVIDER,
		});
	}

	function setMarker(stop) {
		if (!marker) {
			marker = new Mesh(
				new RingGeometry(1.2, 1.6, 40),
				new MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.6, side: DoubleSide }),
			);
			marker.rotation.x = -Math.PI / 2;
			scene.add(marker);
		}
		marker.position.set(stop.x, 0.05, stop.z);
	}

	function endTour() {
		tour = null;
		if (marker) { scene.remove(marker); marker.geometry.dispose(); marker.material.dispose(); marker = null; }
		setMoving(false);
		walkingTo = null;
	}

	function startTour() {
		const p = player();
		if (!p) return;
		clearCard();
		tour = { stops: buildTour(p), index: 0, arrived: false };
		showStop();
	}

	function showStop() {
		const stop = tour.stops[tour.index];
		tour.arrived = false;
		walkingTo = { x: stop.x, z: stop.z };
		setMarker(stop);
		showCard({
			step: t('play.concierge_step', 'Stop {{n}} of {{total}}', { n: tour.index + 1, total: tour.stops.length }),
			text: t('play.concierge_follow', 'Follow me to {{name}}.', { name: stop.name }),
			actions: [
				{ label: t('play.concierge_next', 'Skip this stop'), run: advance },
				{ label: t('play.concierge_end', 'End tour'), run: dismiss },
			],
		});
	}

	function advance() {
		if (!tour) return;
		const nxt = nextStop(tour.stops, tour.index);
		if (nxt == null) { finishTour(); return; }
		tour.index = nxt;
		showStop();
	}

	function finishTour() {
		endTour();
		showCard({
			text: t('play.concierge_done', 'That is the tour. Ask me anything, or explore on your own.'),
			actions: [
				{ label: t('play.concierge_ask', 'Ask a question'), run: converse, primary: true },
				{ label: t('play.concierge_close', 'Close'), run: dismiss },
			],
		});
	}

	function arrive() {
		const stop = tour.stops[tour.index];
		tour.arrived = true;
		npc.say(stop.line);
		const last = tour.index + 1 >= tour.stops.length;
		showCard({
			step: t('play.concierge_step', 'Stop {{n}} of {{total}}', { n: tour.index + 1, total: tour.stops.length }),
			text: stop.line,
			actions: [
				{ label: last ? t('play.concierge_finish', 'Finish') : t('play.concierge_continue', 'Next stop'), run: advance, primary: true },
				{ label: t('play.concierge_end', 'End tour'), run: dismiss },
			],
		});
	}

	function onKey(e) {
		if (disposed) return;
		if (e.key === 'Escape' && (tour || card) && !isChatPanelOpen()) { dismiss(); return; }
		if ((e.key === 'e' || e.key === 'E') && !isTypingTarget(e.target) && !hasOpenOverlay() && !isChatPanelOpen()) {
			const p = player();
			if (p && dist(p) <= TALK_RANGE) { e.preventDefault(); converse(); }
		}
	}
	document.addEventListener('keydown', onKey);

	function onboardingDone() {
		try { return !!storage?.getItem(ONBOARD_KEY); } catch { return true; }
	}

	function frame(now) {
		raf = 0;
		if (disposed || !awake) return;
		const dt = Math.min(0.05, (now - last) / 1000);
		last = now;
		const p = player();
		if (p) {
			if (!greeted && !greeting && onboardingDone() && !hasOpenOverlay() && !isChatPanelOpen() && dist(p) <= GREET_RADIUS) {
				greeted = true;
				markGreeted(storage);
				greeting = true;
				ensureEvent().then(() => { if (!disposed && greeting) { npc.faceTowards(p); npc.emote('av-call-me'); } });
			}
			if (greeting) {
				if (reduced()) { npc.pos.set(p.x + GREET_STOP_DISTANCE, 0, p.z); npc.rig.position.copy(npc.pos); }
				if (stepToward(p, dt, GREET_STOP_DISTANCE)) { greeting = false; npc.faceTowards(p); offer(); }
			} else if (tour) {
				const stop = tour.stops[tour.index];
				if (dist(p) > WALK_AWAY && Math.hypot(p.x - stop.x, p.z - stop.z) > WALK_AWAY) {
					dismiss();
				} else if (!tour.arrived) {
					const gap = Math.hypot(p.x - npc.pos.x, p.z - npc.pos.z);
					// Wait for the player rather than leaving them behind.
					if (gap < 9) stepToward(walkingTo, dt, 0.5); else setMoving(false);
					if (reached(p, stop)) arrive();
				}
			} else if (!card) {
				// Drift back to the post when idle.
				stepToward(post, dt, 0.2);
			}
		}
		npc.tick(dt);
		place(npc.label, npc.height + 0.2);
		if (npc.bubble) place(npc.bubble, npc.height + 0.7);
		raf = requestAnimationFrame(frame);
	}

	function check() {
		if (disposed) return;
		const p = player();
		const near = !!p && dist(p) <= WAKE_RADIUS;
		if (near && !awake) {
			awake = true;
			npc.label.style.display = '';
			last = performance.now();
			if (!eventLoaded) ensureEvent();
			raf = requestAnimationFrame(frame);
		} else if (!near && awake && !tour && !greeting && !card) {
			awake = false;
			npc.label.style.display = 'none';
			if (npc.bubble) npc.bubble.style.display = 'none';
		}
	}
	npc.label.style.display = 'none';
	timer = setInterval(check, 500);
	check();

	return {
		npc,
		openChat: converse,
		dispose() {
			disposed = true;
			clearInterval(timer);
			if (raf) cancelAnimationFrame(raf);
			document.removeEventListener('keydown', onKey);
			clearCard();
			endTour();
			npc.dispose();
		},
	};
}
