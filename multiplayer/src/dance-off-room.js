// Room glue for dance-off rounds. The round machine and tally are pure and live
// in dance-off.js; this file connects one machine to one WalkRoom: it feeds the
// machine the floor census, relays its transitions to clients, applies the winner's
// reward and posts the feed event.
//
// WalkRoom only calls five hooks on the controller returned by attachDanceOff:
// tick (via the clock registered here), sync, leave, reaction and the
// 'dance:start' message registered here. Everything else is in this file.
//
// Dev knobs (environment, server side only):
//   DANCE_OFF=off                 turn the feature off for this process
//   DANCE_OFF_TIMINGS=a=ms,b=ms   override phase lengths (see parseTimings)
//   DANCE_OFF_FORCE_LIVE=1        behave as if the event window were open

import { DanceOff, DANCE_FLOOR, onFloor, parseTimings } from './dance-off.js';
import { eventLiveNow } from './event-window.js';
import { publishFeedEvent } from './feed.js';
import { grantCosmetic } from './economy.js';
import { getCosmetic } from './cosmetics-catalog.js';

/** The reward for winning a round. Event tier: never sold, kept forever. */
export const CHAMPION_COSMETIC = 'aura-spotlight-dance-champ';

const TICK_MS = 1000;
const START_COOLDOWN_MS = 10_000; // per player, between 'dance:start' requests

/**
 * @param {object} room a WalkRoom (or a stand-in with the same surface)
 * @param {object} [deps] test seams; production passes none
 */
export function attachDanceOff(room, deps = {}) {
	const env = deps.env || process.env;
	if (String(env.DANCE_OFF || '').toLowerCase() === 'off') return null;

	const now = deps.now || (() => Date.now());
	const isLive = deps.isLive || (() => env.DANCE_OFF_FORCE_LIVE === '1' || eventLiveNow(now()));
	const feed = deps.publishFeedEvent || publishFeedEvent;
	const grant = deps.grantCosmetic || grantCosmetic;
	const machine = new DanceOff({ timings: parseTimings(env.DANCE_OFF_TIMINGS), now: now() });
	const startAsk = new Map(); // sessionId -> last 'dance:start' request time

	const live = () => {
		try { return !!isLive(); } catch { return false; }
	};

	const census = () => {
		const floor = [];
		for (const [id, p] of room.state.players) {
			if (p.dead) continue;
			if (onFloor(p.x, p.z)) {
				floor.push({ id, name: p.name || id.slice(0, 6), d: Math.hypot(p.x - DANCE_FLOOR.x, p.z - DANCE_FLOOR.z) });
			}
		}
		return { live: live(), players: room.state.players.size, onFloor: floor };
	};

	const broadcast = (event) => {
		const deaf = typeof room._stillDeaf === 'function' ? room._stillDeaf() : [];
		room.broadcast('dance:state', machine.snapshot(event, now(), live()), { except: deaf });
	};

	const send = (client, type, msg) => {
		try { client.send(type, msg); } catch { /* client left between the check and the send */ }
	};

	// The reward. grantCosmetic is a no-op on an account that already owns the item,
	// so a repeat win, a reconnect or a duplicate transition can never grant twice
	// or announce twice; only the first win sends the souvenir card.
	const reward = (winner) => {
		const client = room.clients.find((c) => c.sessionId === winner.id);
		const profile = room.econ?.get(winner.id);
		if (!client || !profile) return false;
		if (!grant(profile, CHAMPION_COSMETIC)) return false;
		room._persistEcon?.(winner.id);
		room._sendProfile?.(client);
		const item = getCosmetic(CHAMPION_COSMETIC);
		send(client, 'souvenir', {
			id: CHAMPION_COSMETIC,
			name: item?.name || 'Champion Spotlight',
			slot: item?.slot || 'aura',
			eventId: 'dance-off',
			eventName: 'Dance-off champion',
		});
		return true;
	};

	const onWinner = (ev) => {
		const first = reward(ev.winner);
		const winnerClient = room.clients.find((c) => c.sessionId === ev.winner.id);
		const player = room.state.players.get(ev.winner.id);
		feed(
			{
				type: 'dance-off',
				ts: now(),
				actor: player?.name || ev.winner.name || 'A dancer',
				votes: ev.winner.votes,
				contestants: ev.standings.length,
				coin: room.state.coin || '',
			},
			`${room.roomId}:${machine.roundId}`,
		);
		broadcast('winner');
		if (winnerClient) send(winnerClient, 'dance:reward', { roundId: machine.roundId, cosmeticId: CHAMPION_COSMETIC, first });
	};

	const apply = (events) => {
		for (const ev of events) {
			if (ev.type === 'open') broadcast('open');
			else if (ev.type === 'start') broadcast('start');
			else if (ev.type === 'tally') broadcast('tally');
			else if (ev.type === 'winner') onWinner(ev);
			else if (ev.type === 'dissolve') broadcast('dissolve');
			else if (ev.type === 'idle') broadcast('idle');
		}
	};

	const controller = {
		machine,

		/** One authoritative beat. Safe to call late or twice in a second. */
		tick() {
			apply(machine.tick(now(), census()));
		},

		/** Current state to one client (on join), so a mid-round arrival is in sync. */
		sync(client) {
			send(client, 'dance:state', machine.snapshot('sync', now(), live()));
		},

		/** A session left: drop its vote, and its contestant slot with every vote for it. */
		leave(sessionId) {
			startAsk.delete(sessionId);
			const events = machine.leave(sessionId, now(), live());
			if (machine.phase === 'performing' || events.length) broadcast(events.length ? 'dissolve' : 'tick');
		},

		/**
		 * A reaction arrived. It always broadcasts as confetti (the room does that);
		 * this decides whether it also counts as a vote. The voter is a connected
		 * session by construction, the target must be a contestant.
		 */
		reaction(client, payload) {
			const target = typeof payload?.target === 'string' ? payload.target : '';
			if (!target || machine.phase !== 'performing') return;
			const res = machine.vote(client.sessionId, target, now());
			send(client, 'dance:ack', { roundId: machine.roundId, target, counted: res.counted, reason: res.reason });
			if (res.counted) broadcast('vote');
		},

		/** A player asks for a round now. */
		start(client) {
			const t = now();
			if (t - (startAsk.get(client.sessionId) || 0) < START_COOLDOWN_MS) return;
			startAsk.set(client.sessionId, t);
			const here = census();
			if (!here.onFloor.some((p) => p.id === client.sessionId)) {
				send(client, 'dance:ack', { roundId: machine.roundId, start: false, reason: 'not-on-floor' });
				return;
			}
			const res = machine.requestStart(t, here);
			if (!res.ok) {
				send(client, 'dance:ack', { roundId: machine.roundId, start: false, reason: res.reason });
				return;
			}
			apply(res.events);
		},
	};

	room.onMessage('dance:start', (client) => controller.start(client));
	room.clock.setInterval(() => controller.tick(), TICK_MS);
	return controller;
}
