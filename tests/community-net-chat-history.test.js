// @vitest-environment jsdom
//
// World chat scrollback reaches the client as one `chat_history` room message
// (work order 727). CommunityNet re-emits it as a 'chatHistory' event, which the
// game subscribes to when it wires the room. `on()` throws for an event name it
// does not know, so a missing registry entry crashed the world on join.

import { describe, it, expect, vi } from 'vitest';
import { CommunityNet } from '../src/game/community-net.js';

describe('CommunityNet chatHistory event', () => {
	it('accepts a chatHistory subscription', () => {
		const net = new CommunityNet({ name: 'nova', url: 'ws://127.0.0.1:1' });
		expect(() => net.on('chatHistory', () => {})).not.toThrow();
	});

	it('hands subscribers the batched lines', () => {
		const net = new CommunityNet({ name: 'nova', url: 'ws://127.0.0.1:1' });
		const seen = vi.fn();
		net.on('chatHistory', seen);
		const lines = [{ mid: 'mhk1-a1b2c3d4e5', name: 'nova', text: 'gm', ts: 1 }];
		net._emit('chatHistory', lines);
		expect(seen).toHaveBeenCalledWith(lines);
	});
});
