// The agents who live on the campus: real registered three.ws agents, wearing
// their own public avatars, standing where cast.js seats them. Each one idles,
// takes a few steps now and then, turns to face a visitor who comes close, and
// can be spoken to (talk.js). The greeter at the gate waves and says hello
// through the agent's own /api/chat brain.
//
// Bodies come from the shared avatar rig (src/game/avatar-rig.js), so a model
// is downloaded once per distinct GLB and cloned, and gestures are the clip
// library every other three.ws scene uses.

import { Box3, Group, Vector3 } from 'three';
import { buildAvatar, CLIP_IDLE, CLIP_WALK, getAllEmoteDefs, loadManifest, newAnim, releaseAvatar } from '../../game/avatar-rig.js';
import { log } from '../../shared/log.js';
import { insideSolids } from '../../shared/solids.js';
import { CAST_MAX, GREET_RANGE, arrivalMessage, castSpots, groundingPrompt, parseSse, pickCast, pickGreeter } from './cast.js';
import { PLACES, placeById } from './places.js';

const WALK_SPEED = 1.05;
const TURN_SPEED = 5;
const WANDER_RADIUS = 1.5;
const WANDER_PAUSE = [3, 7]; // seconds between strolls
const NOTICE_RANGE = 6; // an agent stops and faces a visitor this close
const BUBBLE_SECONDS = 7;
const GESTURE = { wave: 'wave', nod: 'nod', think: 'think' };

const rand = (a, b) => a + Math.random() * (b - a);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const shortestTurn = (from, to) => Math.atan2(Math.sin(to - from), Math.cos(to - from));

/** Scale a loaded body to human height and seat its feet on the ground, as the player rig does. */
function fitBody(rig) {
	const model = rig.children.find((c) => !c.userData?.avatarStandIn);
	if (!model) return 1.7;
	const size = new Box3().setFromObject(model).getSize(new Vector3());
	if (size.y > 0 && (size.y < 1.2 || size.y > 2.4)) model.scale.multiplyScalar(1.7 / size.y);
	const fitted = new Box3().setFromObject(model);
	model.position.y -= fitted.min.y;
	return Math.min(2.4, Math.max(1.2, fitted.max.y - fitted.min.y));
}

/** Where a member stands in words, for the prompt and the grounding prompt. */
function placeLabel(spot) {
	if (spot.place === 'gate') return 'the gate path';
	const p = placeById(spot.place);
	return p ? p.title : 'the campus';
}

/**
 * @param {{
 *   scene: import('three').Scene,
 *   tagsEl: HTMLElement,
 *   solids: Array<{group:{position:Vector3}, keepout:number}>,
 *   isTouch: boolean,
 *   reducedMotion: boolean,
 *   visitorName: () => string,
 *   onGreeting: (member: object, text: string) => void,
 * }} o
 */
export function createAgents({ scene, tagsEl, solids, isTouch, reducedMotion, visitorName, onGreeting }) {
	/** @type {Array<Member>} */
	const members = [];
	let greeter = null;
	let state = 'idle'; // idle | loading | ready | empty | error
	let error = '';
	let disposed = false;
	const listeners = new Set();
	const scratch = new Vector3();

	function emit() {
		for (const fn of listeners) fn({ state, error, count: members.length });
	}

	// ---- loading ----
	async function fetchCast(max) {
		const r = await fetch(`/api/agents/public?avatar=1&sort=popular&limit=${Math.max(24, max * 4)}`, { headers: { accept: 'application/json' } });
		if (!r.ok) throw new Error(`The agent directory answered ${r.status}`);
		const data = await r.json();
		let list = Array.isArray(data.agents) ? data.agents : [];
		// A directory that predates the avatar_model_url field: hydrate the most
		// talked-to real agents from their profiles so the campus still fills.
		if (list.length && !list.some((a) => 'avatar_model_url' in a)) {
			const named = list.filter((a) => a.name && a.name.trim() && a.name.length <= 40).slice(0, max * 2);
			const hydrated = await Promise.all(named.map(async (a) => {
				try {
					const pr = await fetch(`/api/agents/${encodeURIComponent(a.id)}`, { headers: { accept: 'application/json' } });
					if (!pr.ok) return a;
					const { agent } = await pr.json();
					return { ...a, avatar_model_url: agent?.avatar_model_url || null, description: a.description || agent?.description || '' };
				} catch {
					return a;
				}
			}));
			list = hydrated;
		}
		return list;
	}

	async function load() {
		if (state === 'loading' || state === 'ready') return;
		state = 'loading';
		error = '';
		emit();
		const max = isTouch ? CAST_MAX.touch : CAST_MAX.desktop;
		let cast;
		try {
			cast = pickCast(await fetchCast(max), { max });
		} catch (err) {
			state = 'error';
			error = err?.message || 'The agent directory is unreachable';
			log.warn('[world] cast failed to load', error);
			emit();
			return;
		}
		if (disposed) return;
		if (!cast.length) {
			state = 'empty';
			emit();
			return;
		}
		greeter = pickGreeter(cast);
		// The greeter takes spot 0; everyone else fills the rest in order.
		const ordered = [greeter, ...cast.filter((m) => m !== greeter)];
		const spots = castSpots(ordered.length, PLACES);
		await loadManifest();
		await Promise.all(ordered.map((m, i) => spots[i] && spawn(m, spots[i])));
		if (disposed) return;
		state = 'ready';
		emit();
	}

	async function spawn(member, spot) {
		const rig = new Group();
		rig.position.set(spot.x, 0, spot.z);
		rig.rotation.y = spot.yaw;
		rig.userData.hit = { type: 'agent', id: member.id };
		scene.add(rig);
		const anim = newAnim();
		const tag = document.createElement('button');
		tag.type = 'button';
		tag.className = 'wd-tag';
		tag.dataset.agent = member.id;
		tag.innerHTML = `<b>${esc(member.name)}</b>${member.registered ? '<i class="wd-tag-reg" title="Registered on-chain"></i>' : ''}<span class="wd-bubble" hidden></span>`;
		tag.setAttribute('aria-label', `Talk to ${member.name}`);
		tagsEl.append(tag);
		const m = {
			member, spot, rig, anim, tag,
			bubble: tag.querySelector('.wd-bubble'),
			height: 1.7,
			home: new Vector3(spot.x, 0, spot.z),
			target: null,
			wait: rand(...WANDER_PAUSE),
			held: false,
			facing: null,
			noticed: false,
			bubbleT: 0,
			greeted: false,
			greeting: null,
			ready: false,
			gesturing: false,
			place: placeLabel(spot),
		};
		members.push(m);
		const res = await buildAvatar(rig, member.glb, anim, { clips: 'locomotion' });
		if (disposed) return;
		if (res.fallback) log.info('[world] agent wore the default body', member.name);
		m.height = fitBody(rig);
		anim.appendAnimationDefs(getAllEmoteDefs());
		rig.traverse((o) => { if (o !== rig && !o.userData.hit) o.userData.hit = rig.userData.hit; });
		m.ready = true;
	}

	// ---- behaviour ----
	function blocked(x, z) {
		return insideSolids(x, z, solids, 0.6);
	}
	function pickStroll(m) {
		for (let i = 0; i < 6; i++) {
			const a = Math.random() * Math.PI * 2;
			const r = rand(0.6, WANDER_RADIUS);
			const x = m.home.x + Math.sin(a) * r;
			const z = m.home.z + Math.cos(a) * r;
			if (!blocked(x, z)) return new Vector3(x, 0, z);
		}
		return null;
	}

	function face(m, yaw, dt) {
		const d = shortestTurn(m.rig.rotation.y, yaw);
		const step = Math.min(Math.abs(d), TURN_SPEED * dt);
		m.rig.rotation.y += Math.sign(d) * step;
	}

	function update(dt, playerPos, camera) {
		for (const m of members) {
			if (!m.ready) continue;
			const dx = playerPos.x - m.rig.position.x;
			const dz = playerPos.z - m.rig.position.z;
			const dist = Math.hypot(dx, dz);
			const toPlayer = Math.atan2(dx, dz);
			const near = dist < NOTICE_RANGE;
			if (near && !m.noticed) {
				m.noticed = true;
				m.target = null;
				if (m !== greeterMember() && !reducedMotion) gesture(m, GESTURE.nod);
			} else if (!near && m.noticed && dist > NOTICE_RANGE + 2) {
				m.noticed = false;
				m.greeted = false;
			}
			if (m === greeterMember() && dist < GREET_RANGE && !m.greeted) {
				m.greeted = true;
				greet(m);
			}
			if (m.held || near) {
				// Stand still and look at the visitor.
				face(m, toPlayer, dt);
				if (m.anim.currentName === CLIP_WALK) m.anim.crossfadeTo(CLIP_IDLE, 0.25);
			} else if (m.target) {
				const tx = m.target.x - m.rig.position.x;
				const tz = m.target.z - m.rig.position.z;
				const td = Math.hypot(tx, tz);
				if (td < 0.12) {
					m.target = null;
					m.wait = rand(...WANDER_PAUSE);
					m.anim.crossfadeTo(CLIP_IDLE, 0.3);
				} else {
					face(m, Math.atan2(tx, tz), dt);
					const step = Math.min(td, WALK_SPEED * dt);
					m.rig.position.x += (tx / td) * step;
					m.rig.position.z += (tz / td) * step;
					if (m.anim.currentName !== CLIP_WALK && !m.gesturing) m.anim.crossfadeTo(CLIP_WALK, 0.3);
				}
			} else if (!reducedMotion) {
				m.wait -= dt;
				if (m.wait <= 0) {
					m.target = pickStroll(m);
					if (!m.target) m.wait = rand(...WANDER_PAUSE);
				}
				// Drift back toward the seated facing while idle.
				face(m, m.spot.yaw, dt * 0.4);
			}
			m.anim.update(dt);
			if (m.bubbleT > 0) {
				m.bubbleT -= dt;
				if (m.bubbleT <= 0) m.bubble.hidden = true;
			}
			paintTag(m, camera, dist);
		}
	}

	function paintTag(m, camera, dist) {
		scratch.set(m.rig.position.x, m.height + 0.25, m.rig.position.z).project(camera);
		const onScreen = scratch.z < 1 && Math.abs(scratch.x) < 1.1 && Math.abs(scratch.y) < 1.1 && dist < 28;
		m.tag.hidden = !onScreen;
		if (!onScreen) return;
		const x = (scratch.x * 0.5 + 0.5) * innerWidth;
		const y = (-scratch.y * 0.5 + 0.5) * innerHeight;
		m.tag.style.transform = `translate(-50%, -100%) translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
		m.tag.classList.toggle('is-near', dist < NOTICE_RANGE);
		m.tag.classList.toggle('is-far', dist > 16);
	}

	function greeterMember() {
		return greeter ? members.find((m) => m.member === greeter) || null : null;
	}

	/** Play a one-shot clip and settle back to idle; the mixer, not a timer, ends it. */
	async function gesture(m, name) {
		if (!m?.ready || m.gesturing) return;
		m.gesturing = true;
		try {
			await m.anim.playOnce(name, { settleTo: CLIP_IDLE, fade: 0.3 });
		} finally {
			m.gesturing = false;
		}
	}

	/** Show a line over an agent's head. */
	function say(m, text) {
		if (!m) return;
		m.bubble.textContent = text;
		m.bubble.hidden = false;
		m.bubbleT = BUBBLE_SECONDS + Math.min(8, text.length / 25);
	}

	/** The greeter waves and asks its own brain for a welcome, grounded in its public record. */
	async function greet(m) {
		if (!reducedMotion) gesture(m, GESTURE.wave);
		if (m.greeting) return;
		m.greeting = streamReply(m.member, arrivalMessage(visitorName() === 'Guest' ? '' : visitorName()), [], { place: m.place })
			.then((text) => {
				if (disposed || !text) return;
				say(m, text);
				onGreeting?.(m.member, text);
			})
			.catch((err) => log.warn('[world] greeting failed', err?.message))
			.finally(() => { m.greeting = null; });
	}

	// ---- speech ----
	/**
	 * Stream one reply from an agent's own brain. Resolves with the full text;
	 * `onChunk` receives the text so far as it arrives.
	 * @returns {Promise<string>}
	 */
	async function streamReply(member, message, history, { place, onChunk, signal } = {}) {
		const r = await fetch('/api/chat', {
			method: 'POST',
			headers: { 'content-type': 'application/json', accept: 'text/event-stream' },
			signal,
			body: JSON.stringify({
				message,
				history: history.slice(-20),
				agentId: member.id,
				system_prompt: groundingPrompt(member, { place }),
				context: { modelName: member.name, currentEnvironment: `three.ws campus, ${place}`.slice(0, 80) },
			}),
		});
		if (r.status === 429) {
			const e = new Error('You are talking faster than the campus allows. Give it a minute.');
			e.code = 'rate_limited';
			throw e;
		}
		if (!r.ok) {
			let detail = '';
			try {
				const j = await r.json();
				detail = j.error_description || j.message || '';
			} catch { /* no body */ }
			if (r.status === 401) detail = `Sign in to talk to ${member.name} here.`;
			throw new Error(detail || `${member.name} could not answer (${r.status}).`);
		}
		const ctype = r.headers.get('content-type') || '';
		if (!ctype.includes('text/event-stream')) {
			const data = await r.json();
			const text = String(data.reply || data.text || '').trim();
			onChunk?.(text);
			return text;
		}
		const reader = r.body.getReader();
		const dec = new TextDecoder();
		let buf = '';
		let text = '';
		let done = null;
		for (;;) {
			const { value, done: end } = await reader.read();
			if (end) break;
			buf += dec.decode(value, { stream: true });
			const parsed = parseSse(buf);
			buf = parsed.rest;
			for (const ev of parsed.events) {
				if (ev.type === 'chunk' && ev.text) {
					text += ev.text;
					onChunk?.(text);
				} else if (ev.type === 'done') done = ev;
				else if (ev.type === 'error') throw new Error(ev.message || `${member.name} could not answer.`);
			}
		}
		return (done?.reply || text).trim();
	}

	// ---- queries ----
	function positions() {
		return members.filter((m) => m.ready).map((m) => ({ id: m.member.id, name: m.member.name, sub: m.member.description ? m.member.description.slice(0, 72) : 'A registered three.ws agent', x: m.rig.position.x, z: m.rig.position.z }));
	}
	function byId(id) {
		return members.find((m) => m.member.id === id) || null;
	}
	/** Public avatar portraits of the agents on campus, for the gallery walls. */
	function thumbs() {
		return members.filter((m) => m.ready && m.member.thumb).map((m) => ({ id: m.member.id, name: m.member.name, url: m.member.thumb }));
	}
	function hold(id, on) {
		const m = byId(id);
		if (m) m.held = on;
	}

	function dispose() {
		disposed = true;
		for (const m of members) {
			releaseAvatar(m.rig);
			m.anim.dispose?.();
			scene.remove(m.rig);
			m.tag.remove();
		}
		members.length = 0;
	}

	return {
		load,
		update,
		positions,
		thumbs,
		byId,
		hold,
		say: (id, text) => say(byId(id), text),
		gesture: (id, name) => gesture(byId(id), GESTURE[name] || name),
		streamReply,
		onState: (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
		get state() { return state; },
		get error() { return error; },
		get greeter() { return greeter; },
		dispose,
	};
}
