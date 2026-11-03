// A muted voice player must look muted to everyone else. The voice-state flag
// alone (`voice`) stays true while muted (the peer connections stay open so the
// muted player still hears the room), so without a separate flag peers cannot
// tell "muted" from "listening quietly" and keep talking at someone who has
// muted, or assume a dead mic. The server owns the flag like every other
// schema field and never lets it be set for a player who is not in voice.
import { describe, it, expect } from 'vitest';
import { Encoder, Reflection } from '@colyseus/schema';
import { WalkRoom } from '../multiplayer/src/rooms/WalkRoom.js';
import { Player, WalkState } from '../multiplayer/src/schemas.js';

function makeRoom() {
	const room = Object.create(WalkRoom.prototype);
	const player = new Player();
	Object.defineProperty(room, 'state', {
		value: { players: new Map([['s1', player]]) },
		writable: true,
		configurable: true,
	});
	room._actionOk = () => true;
	return { room, player, client: { sessionId: 's1' } };
}

describe('voice-state carries the muted flag', () => {
	it('joining voice unmuted, then muting, then unmuting', () => {
		const { room, player, client } = makeRoom();
		room._handleVoiceState(client, { on: true, muted: false });
		expect([player.voice, player.voiceMuted]).toEqual([true, false]);
		room._handleVoiceState(client, { on: true, muted: true });
		expect([player.voice, player.voiceMuted]).toEqual([true, true]);
		room._handleVoiceState(client, { on: true, muted: false });
		expect([player.voice, player.voiceMuted]).toEqual([true, false]);
	});

	it('leaving voice clears muted, and muted alone never puts anyone in voice', () => {
		const { room, player, client } = makeRoom();
		room._handleVoiceState(client, { on: true, muted: true });
		room._handleVoiceState(client, { on: false, muted: true });
		expect([player.voice, player.voiceMuted]).toEqual([false, false]);
		room._handleVoiceState(client, { muted: true });
		expect([player.voice, player.voiceMuted]).toEqual([false, false]);
	});

	it('an older client that sends only { on } is treated as unmuted', () => {
		const { room, player, client } = makeRoom();
		room._handleVoiceState(client, { on: true });
		expect([player.voice, player.voiceMuted]).toEqual([true, false]);
	});

	it('voiceMuted is a synced schema field that reaches a peer', () => {
		const state = new WalkState();
		const p = new Player();
		p.id = 's1';
		p.voice = true;
		p.voiceMuted = true;
		state.players.set('s1', p);
		const encoder = new Encoder(state);
		// Decode from the reflected handshake, exactly as CommunityNet does.
		const decoder = Reflection.decode(Reflection.encode(encoder));
		decoder.decode(encoder.encodeAll());
		const seen = decoder.state.players.get('s1');
		expect(seen.voice).toBe(true);
		expect(seen.voiceMuted).toBe(true);
	});
});
