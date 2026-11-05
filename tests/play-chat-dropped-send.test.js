// @vitest-environment jsdom
//
// Meetup #3 client audit (failure states): a chat line typed while the room
// socket was down was handed to CommunityNet, silently dropped, and the input
// was cleared anyway, so the player lost what they wrote and never learned it
// did not go out. The send now reports delivery; the UI keeps the text.

import { describe, it, expect, vi } from 'vitest';
import { CommunityUI } from '../src/game/coincommunities-ui.js';

function fakeUi(onChat) {
	return {
		chatInput: { value: 'gm everyone' },
		h: { onChat },
		chatInterceptor: null,
		addChat: vi.fn(),
	};
}

describe('chat send on a dropped socket', () => {
	it('keeps the typed text and says it was not sent', () => {
		const ui = fakeUi(() => false);
		CommunityUI.prototype._sendChat.call(ui);
		expect(ui.chatInput.value).toBe('gm everyone');
		expect(ui.addChat).toHaveBeenCalledTimes(1);
		expect(ui.addChat.mock.calls[0][0].text).toMatch(/not sent/i);
	});

	it('clears the input once the line actually went out', () => {
		const ui = fakeUi(() => true);
		CommunityUI.prototype._sendChat.call(ui);
		expect(ui.chatInput.value).toBe('');
		expect(ui.addChat).not.toHaveBeenCalled();
	});
});

describe('game wiring', () => {
	it('passes the CommunityNet delivery result back to the chat box', async () => {
		const src = (await import('node:fs')).readFileSync('src/game/coincommunities.js', 'utf8');
		expect(src).toMatch(/_sendChat\(text\) \{[^}]*return this\.net\?\.sendChat\(text\) \?\? false;\s*\}/);
	});
});
