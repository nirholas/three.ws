// Pure logic for the welcome concierge (see concierge.js): who has been greeted,
// what the event line says, where the tour goes, and the persona prompt. No DOM
// and no three.js, so every decision here is unit-testable in node.
//
// The landmark list is read from the same modules that place the real stations
// (multiplayer/src/world-features.js, world-zones.js, intel-kiosk.js,
// signature-wall.js), never hand-copied coordinates, so a station that moves or
// disappears moves or disappears from the tour and the persona with it.

import { WHEEL, GACHA, WAR_PORTAL, PLAZA_STAGE, ATMS } from '../../../multiplayer/src/world-features.js';
import { spawnsOfType } from '../world-zones.js';
import { KIOSK_SPOT } from '../intel-kiosk.js';
import { SIGNATURE_WALL } from '../signature-wall.js';
import { eventState } from '../../shared/event-config.js';

export const GREETED_KEY = 'cc-concierge-greeted-v1';

/** Where the concierge stands, a few steps from the spawn ring, facing the plaza centre. */
export const CONCIERGE_POST = Object.freeze({ x: 5, z: 6, yaw: Math.atan2(-5, -6) });

/** The free provider key the brain endpoint answers for signed-out callers. */
export const CONCIERGE_PROVIDER = 'gpt-oss-120b';

/** How close the player must be for the concierge to wake, and to greet. */
export const WAKE_RADIUS = 22;
export const GREET_RADIUS = 14;
/** A tour stop counts as reached inside this radius. */
export const STOP_RADIUS = 4.5;
/** Walking this far from the concierge during a tour ends it. */
export const WALK_AWAY = 40;

const boutique = spawnsOfType('boutique')[0];

/**
 * Every station and panel a first-timer can find, with its real position and the
 * one line the concierge says there. `tour` marks the stops of the guided route.
 */
export const LANDMARKS = Object.freeze([
	{ id: 'intel-kiosk', name: 'the Intel Kiosk', at: KIOSK_SPOT, tour: true,
		line: 'This is the Intel Kiosk. It pulls live market intel for the coin of this world.',
		feature: 'Intel Kiosk: live market intel and momentum for the coin of the world.' },
	{ id: 'signature-wall', name: 'the Signature Wall', at: { x: SIGNATURE_WALL.x, z: SIGNATURE_WALL.z }, tour: true,
		line: 'Sign the wall. Every visitor leaves a mark, and it stays.',
		feature: 'Signature Wall: a persistent graffiti wall every visitor can sign.' },
	{ id: 'wheel', name: 'Fortune’s Folly wheel', at: { x: WHEEL[0].x, z: WHEEL[0].z }, tour: true,
		line: 'Fortune’s Folly, the wheel of fortune. Spin it when you feel lucky.',
		feature: 'Wheel of Fortune station: spin for prizes.' },
	{ id: 'war-portal', name: 'the War Portal', at: { x: WAR_PORTAL.x, z: WAR_PORTAL.z }, tour: true,
		line: 'The War Portal is the door to Coin Wars. Queue your community for a battle.',
		feature: 'War Portal: the door into Coin Wars, where communities battle.' },
	{ id: 'gacha', name: 'the card gacha', at: { x: GACHA[0].x, z: GACHA[0].z }, tour: false,
		feature: 'Card gacha machine: pull real graded trading cards.' },
	{ id: 'plaza-stage', name: 'the plaza stage', at: { x: PLAZA_STAGE.x, z: PLAZA_STAGE.z }, tour: false,
		feature: 'Plaza stage: where shows and events happen.' },
	{ id: 'boutique', name: 'the cosmetics boutique', at: { x: boutique.x, z: boutique.z }, tour: false,
		feature: 'Cosmetics boutique: buy and wear cosmetics for your avatar.' },
	{ id: 'bank', name: 'the bank', at: { x: ATMS[0].x, z: ATMS[0].z }, tour: false,
		feature: 'Bank teller: the in-world cash economy.' },
	{ id: 'chart-screen', name: 'the chart jumbotron', at: { x: 0, z: -30 }, tour: false,
		feature: 'Chart jumbotron: the live price chart, volume and trade tape of the coin.' },
]);

/** Landmarks the persona must be able to name; the guard test fails when one stops existing. */
export function featureLines() {
	return LANDMARKS.map((l) => l.feature);
}

/** The persona prompt, grounded in the feature list above (exported for tests and chat). */
export function conciergePersona() {
	return [
		'You are the Concierge, the well-dressed host who greets newcomers to the $three world on three.ws.',
		'Warm, brief and welcoming. You know this place well and never invent features.',
		'Things that really exist in this world, and the only ones you may describe:',
		...featureLines().map((f) => `- ${f}`),
		'Also real: townsfolk who each run a paid counter (press E near them), a jobs board with quests, gathering and cooking stations, vehicles you can drive (F), and an emote wheel (hold Q).',
		'How to earn: finish quests on the jobs board, gather and cook at the stations, and trade with the townsfolk. How to spend: the cosmetics boutique, the paid counters, and the wheel.',
		'How to sign in: use the sign-in or wallet button in the top bar. Browsing and walking around work without it.',
		'If asked about something not on this list, say you are not sure and point to the nearest thing that is real. Offer to show them around when it fits.',
	].join('\n');
}

/** True when the visitor has never been greeted. Storage that cannot be read counts as greeted (never nag). */
export function isFirstVisit(storage) {
	try { return !storage.getItem(GREETED_KEY); } catch { return false; }
}

export function markGreeted(storage) {
	try { storage.setItem(GREETED_KEY, '1'); } catch { /* blocked storage: the in-memory flag in concierge.js still stops a repeat */ }
}

/** True unless the NPC layer was turned off for this page (?npcs=0). */
export function npcLayerEnabled(search = '') {
	try { return new URLSearchParams(search).get('npcs') !== '0'; } catch { return true; }
}

/**
 * The opening line about a live or imminent event, or null. Only inside the
 * window (from one hour before the start to the end); outside it nothing exists.
 */
export function eventLine(cfg, now = Date.now()) {
	if (!cfg) return null;
	const state = eventState(cfg, now);
	if (state === 'over') return null;
	if (state === 'upcoming') {
		if (cfg.startsAt - now > 3600 * 1000) return null;
		return `${cfg.name} starts soon.${cfg.tagline ? ' ' + cfg.tagline : ''}`;
	}
	return `${cfg.name} is happening right now.${cfg.tagline ? ' ' + cfg.tagline : ''}`;
}

/** The tour: ordered stops starting with the one nearest the player, each with a real position. */
export function buildTour(from) {
	const stops = LANDMARKS.filter((l) => l.tour);
	const left = stops.slice();
	const out = [];
	let cur = { x: from.x, z: from.z };
	while (left.length) {
		let bi = 0, bd = Infinity;
		left.forEach((s, i) => {
			const d = Math.hypot(s.at.x - cur.x, s.at.z - cur.z);
			if (d < bd) { bd = d; bi = i; }
		});
		const [s] = left.splice(bi, 1);
		out.push({ id: s.id, name: s.name, x: s.at.x, z: s.at.z, line: s.line });
		cur = s.at;
	}
	return out;
}

/** Next index after skipping the current stop; null once the tour is finished. */
export function nextStop(tour, index) {
	return index + 1 < tour.length ? index + 1 : null;
}

/** True when a player standing at `p` has reached `stop`. */
export function reached(p, stop) {
	return Math.hypot(p.x - stop.x, p.z - stop.z) <= STOP_RADIUS;
}
