// The cast: which real agents stand in the campus, where they stand, and how a
// conversation with one is grounded. Pure data and rules, no DOM and no
// Three.js, so tests can pin every decision. agents.js spawns the bodies and
// talk.js runs the conversation panel.
//
// Nothing here is invented. Every member comes from GET /api/agents/public
// (a published, public agent whose avatar GLB is publicly readable), speaks
// through POST /api/chat with its own id (so its published persona answers),
// and is introduced by the name, description and skills on its public record.

import { facingOf, SPAWN } from './places.js';

/** Distance at which an agent takes the prompt ("Talk to <name>"). */
export const AGENT_TRIGGER = 2.6;
/** Where a tap on an agent puts the visitor: inside AGENT_TRIGGER, not in their face. */
export const APPROACH_DISTANCE = 1.7;
/** Distance at which the greeter notices the visitor, turns and waves. */
export const GREET_RANGE = 4.5;
/** How many members the campus seats on a desktop and on a phone. */
export const CAST_MAX = { desktop: 10, touch: 5 };
/** The published library build the embed snippet pins (docs/embedding.md). */
export const EMBED_VERSION = '1.5.2';

// The onboarding defaults an untouched agent still wears (mirrors
// PLACEHOLDER_NAMES in api/agents/public.js, which keeps the same rows off the
// live agent wall, and the citizen rule in src/game/npc/citizens.js). A body
// wearing one of these has told us nothing about who it is, so the campus
// does not introduce it by that name.
const PLACEHOLDER_NAMES = new Set([
	'my first agent', 'agent', 'avatar', 'my avatar', 'my agent',
	'untitled agent', 'new agent', 'untitled', 'character', 'model',
]);

// The onboarding bio an untouched agent still carries (same rule as
// src/game/npc/citizens.js). It says nothing about the agent, so the campus
// treats it as no description at all.
const BOILERPLATE_BIO = /^(a friendly starter agent|operated by a three\.ws agent|edit the personality)/i;

function looksAnonymous(name) {
	const n = name.toLowerCase();
	if (PLACEHOLDER_NAMES.has(n)) return true;
	if (/^avatar[\s#_-]/.test(n)) return true;
	if (/^model\s*[({[]?\d+/.test(n)) return true;
	if (/_(merged|meshy|biped|animations)/i.test(name)) return true;
	if (/^selfie avatar/i.test(name)) return true;
	if (name.length > 40) return true;
	return false;
}

/** A public agent record can join the cast when it has a real name and a public body. */
export function isCastable(a) {
	if (!a || typeof a !== 'object') return false;
	const name = String(a.name || '').trim();
	if (!name || looksAnonymous(name)) return false;
	return typeof a.avatar_model_url === 'string' && /^https?:\/\/|^\//.test(a.avatar_model_url);
}

/** Reduce a public agent record to what the world renders and says. */
export function toCastMember(a) {
	const id = String(a.id);
	const description = String(a.description || '').trim();
	return {
		id,
		name: String(a.name || '').trim(),
		description: BOILERPLATE_BIO.test(description) ? '' : description,
		skills: (Array.isArray(a.skills) ? a.skills : []).map((s) => (typeof s === 'string' ? s : s?.name)).filter(Boolean),
		glb: a.avatar_model_url || null,
		thumb: a.avatar_thumbnail || a.avatar_thumbnail_url || null,
		home: a.home_url || `/agents/${id}`,
		chats: Number(a.chat_count) || 0,
		registered: !!a.is_registered,
		onchain: a.onchain || null,
	};
}

/**
 * Choose the cast from a public agent listing: the most talked-to real agents
 * first, each distinct body before any repeat of one, capped at `max`.
 */
export function pickCast(agents, { max }) {
	const pool = (Array.isArray(agents) ? agents : []).filter(isCastable).map(toCastMember);
	pool.sort((a, b) => b.chats - a.chats || a.name.localeCompare(b.name));
	const seenBody = new Set();
	const seenId = new Set();
	const firsts = [];
	const repeats = [];
	for (const m of pool) {
		if (seenId.has(m.id)) continue;
		seenId.add(m.id);
		if (seenBody.has(m.glb)) repeats.push(m);
		else {
			seenBody.add(m.glb);
			firsts.push(m);
		}
	}
	return [...firsts, ...repeats].slice(0, Math.max(0, max | 0));
}

/** The member who greets visitors at the gate: most talked-to, with a description to introduce. */
export function pickGreeter(cast) {
	if (!Array.isArray(cast) || !cast.length) return null;
	return cast.find((m) => m.description) || cast[0];
}

/**
 * Where the cast stands. Deterministic, so the same agents stand in the same
 * spots on every visit: the greeter beside the gate path, a gathering on the
 * campus side of Agent Plaza, a couple along the path, one in front of each
 * other building. Every spot is outside every keep-out.
 * @returns {Array<{x:number, z:number, yaw:number, role:'greeter'|'plaza'|'path'|'front', place:string}>}
 */
export function castSpots(n, places) {
	const by = (id) => places.find((p) => p.id === id);
	const toward = (x, z, tx, tz) => Math.atan2(tx - x, tz - z);
	const spots = [];
	// 1. The greeter, just off the path from the gate to the desk, facing the gate.
	spots.push({ x: 3.4, z: 24, yaw: toward(3.4, 24, SPAWN.x, SPAWN.z), role: 'greeter', place: 'gate' });
	// 2. Agent Plaza: a loose semicircle on the side visitors arrive from, facing the beacon.
	const plaza = by('agents');
	if (plaza) {
		const a0 = facingOf(plaza);
		const r = plaza.keepout + 1.8;
		for (const off of [-0.35, 0.35, -1.0, 1.0, -1.6, 1.6]) {
			const a = a0 + off;
			const x = plaza.x + Math.sin(a) * r;
			const z = plaza.z + Math.cos(a) * r;
			spots.push({ x, z, yaw: toward(x, z, plaza.x, plaza.z), role: 'plaza', place: plaza.id });
		}
	}
	// 3. Two more along the gate path, facing the campus centre.
	for (const [x, z] of [[-3.4, 18], [3.4, 15]]) spots.push({ x, z, yaw: toward(x, z, 0, 0), role: 'path', place: 'gate' });
	// 4. One in front of each other building, a step to the side of its doorstep.
	for (const [id, side] of [['exchange', 1], ['market', -1], ['launchpad', 1], ['gallery', -1], ['forge', 1]]) {
		const p = by(id);
		if (!p) continue;
		const a = facingOf(p) + side * 0.55;
		const r = p.keepout + 3.6;
		const x = p.x + Math.sin(a) * r;
		const z = p.z + Math.cos(a) * r;
		spots.push({ x, z, yaw: toward(x, z, 0, 0), role: 'front', place: p.id });
	}
	return spots.slice(0, Math.max(0, n | 0));
}

/**
 * The agent within reach, as a prompt target.
 * @param {Array<{id:string, name:string, sub:string, x:number, z:number}>} agents
 */
export function nearestAgent(px, pz, agents) {
	let best = null;
	for (const a of agents || []) {
		const d = Math.hypot(px - a.x, pz - a.z);
		if (d < AGENT_TRIGGER && (!best || d < best.d)) best = { type: 'agent', id: a.id, title: `Talk to ${a.name}`, sub: a.sub || '', d, x: a.x, z: a.z };
	}
	return best;
}

/**
 * Split a server-sent-events buffer into parsed `data:` JSON events, keeping
 * the unfinished tail for the next read. Comments, non-JSON data and empty
 * frames are dropped. Matches the /api/chat frame format.
 */
export function parseSse(buffer) {
	const events = [];
	let rest = String(buffer || '');
	let sep;
	while ((sep = rest.indexOf('\n\n')) !== -1) {
		const frame = rest.slice(0, sep);
		rest = rest.slice(sep + 2);
		const data = frame
			.split('\n')
			.filter((l) => l.startsWith('data:'))
			.map((l) => l.slice(5).trim())
			.join('');
		if (!data) continue;
		try {
			events.push(JSON.parse(data));
		} catch {
			/* a comment or a non-JSON frame */
		}
	}
	return { events, rest };
}

/** The one-tag embed that puts this exact agent on any web page. */
export function embedSnippet(member) {
	return [
		`<script type="module" src="https://three.ws/agent-3d/${EMBED_VERSION}/agent-3d.js"></script>`,
		`<agent-3d agent-id="${member.id}" chat voice style="width:100%;height:480px;display:block"></agent-3d>`,
	].join('\n');
}

const PROMPT_CAP = 2000; // api/chat.js system_prompt max

/**
 * System prompt that grounds a member in its own public record when the
 * agent has no published persona (api/chat.js only applies `system_prompt`
 * when the agent's persona is absent). Everything in it is read from the
 * record; nothing is invented. Capped to the API's limit.
 */
export function groundingPrompt(member, { place = 'the campus' } = {}) {
	const parts = [
		`You are ${member.name}, a real agent registered on three.ws, standing in ${place} on the three.ws campus: a 3D world where visitors walk up to agents as avatars. A visitor has just walked up to you and is talking to you in person.`,
	];
	if (member.description) parts.push(`Your public profile says: "${member.description.slice(0, 600)}". Speak as that agent.`);
	if (member.skills.length) parts.push(`Skills you actually offer: ${member.skills.slice(0, 12).join(', ')}. Bring them up when the conversation goes there.`);
	parts.push(
		'Speak in short spoken sentences, one to three at a time. No markdown, no lists, no stage directions. Be warm and curious; ask the visitor something back.',
		'You can point them to your profile on three.ws, to the desk ahead (sitting down opens their desktop), or to the Exchange, the Launchpad, the Forge, the Gallery, the Mine, Agent Plaza and the Marketplace.',
		'$THREE is the platform\'s coin and the only coin you ever recommend. Never name, link or promote any other token.',
	);
	return parts.join('\n\n').slice(0, PROMPT_CAP);
}

/** What the greeter is asked when a visitor walks through the gate. */
export function arrivalMessage(visitorName = '') {
	const who = String(visitorName || '').trim();
	return `A visitor${who ? ` named ${who}` : ''} has just walked through the three.ws gate and you are the first agent they meet. In one or two short spoken sentences, welcome them to three.ws, introduce yourself by name, and tell them they can walk ahead to the desk to open their desktop or talk to any agent they see. Plain text, no markdown.`;
}
