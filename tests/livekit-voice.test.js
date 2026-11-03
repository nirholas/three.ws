import { describe, it, expect, vi, beforeEach } from 'vitest';

// LiveKitVoice talks to a LiveKit server through livekit-client's Room. The
// Room is the network boundary, so it is replaced with a recording double;
// everything inside LiveKitVoice (event wiring, mic handling, protocol
// emits) runs for real.
const roomState = { micError: null, rooms: [] };

vi.mock('livekit-client', () => {
	class Room {
		constructor() {
			this.handlers = new Map();
			this.state = 'disconnected';
			this.connectedTo = null;
			this.localParticipant = {
				identity: 'visitor',
				setMicrophoneEnabled: async (on) => {
					if (roomState.micError) throw roomState.micError;
					this.micOn = on;
				},
			};
			roomState.rooms.push(this);
		}
		on(event, fn) {
			this.handlers.set(event, fn);
			return this;
		}
		async connect(url, token) {
			this.connectedTo = { url, token };
			this.state = 'connected';
		}
		async disconnect() {
			this.state = 'disconnected';
		}
	}
	return {
		Room,
		RoomEvent: {
			TrackSubscribed: 'trackSubscribed',
			TrackUnsubscribed: 'trackUnsubscribed',
			DataReceived: 'dataReceived',
			ActiveSpeakersChanged: 'activeSpeakersChanged',
		},
		Track: { Kind: { Audio: 'audio' } },
	};
});

const { LiveKitVoice } = await import('../src/runtime/livekit-voice.js');

function makeProtocol() {
	const emitted = [];
	return { emitted, emit: (action) => emitted.push(action) };
}

function sendData(room, msg) {
	room.handlers.get('dataReceived')(new TextEncoder().encode(JSON.stringify(msg)));
}

describe('LiveKitVoice', () => {
	beforeEach(() => {
		roomState.micError = null;
		roomState.rooms = [];
	});

	it('joins the room and enables the microphone when one is available', async () => {
		const voice = new LiveKitVoice({ serverUrl: 'ws://lk', token: 't', protocol: makeProtocol() });
		await voice.connect();
		const room = roomState.rooms[0];
		expect(room.connectedTo).toEqual({ url: 'ws://lk', token: 't' });
		expect(room.micOn).toBe(true);
		expect(voice.connected).toBe(true);
		expect(voice.micEnabled).toBe(true);
		expect(voice.micError).toBeNull();
	});

	it('stays joined in listen-only mode when the visitor has no microphone', async () => {
		const err = Object.assign(new Error('Requested device not found'), { name: 'NotFoundError' });
		roomState.micError = err;
		const protocol = makeProtocol();
		const voice = new LiveKitVoice({ serverUrl: 'ws://lk', token: 't', protocol });

		await expect(voice.connect()).resolves.toBeUndefined();
		expect(voice.connected).toBe(true);
		expect(voice.micEnabled).toBe(false);
		expect(voice.micError).toBe(err);

		// The avatar still lip-syncs and gestures from the agent's data channel.
		const room = roomState.rooms[0];
		sendData(room, { type: 'transcript', text: 'Hello there' });
		sendData(room, { type: 'gesture', name: 'wave' });
		expect(protocol.emitted.map((a) => a.type)).toEqual(['speak', 'gesture']);
		expect(protocol.emitted[0].payload.text).toBe('Hello there');
	});

	it('stays joined when the visitor denies microphone permission', async () => {
		roomState.micError = Object.assign(new Error('Permission denied'), { name: 'NotAllowedError' });
		const voice = new LiveKitVoice({ serverUrl: 'ws://lk', token: 't', protocol: makeProtocol() });
		await voice.connect();
		expect(voice.connected).toBe(true);
		expect(voice.micEnabled).toBe(false);
	});
});
