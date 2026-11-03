// @vitest-environment jsdom
//
// Meetup #3 client audit (failure states): every party action (invite, accept,
// decline, leave, goto, party chat) went out through a socket that may be down,
// and a dropped send vanished. Party chat was worse: the chat box cleared as if
// the message went out. A dropped action now says so, and dropped party chat
// tells the chat box to keep the text.

import { describe, it, expect, vi } from 'vitest';

vi.mock('../src/game/party.css', () => ({}));
const { PartyClient } = await import('../src/game/party.js');

function makeHost(live) {
	const toasts = [];
	const row = document.createElement('div');
	const chatInput = document.createElement('input');
	row.appendChild(chatInput);
	document.body.appendChild(row);
	const net = {
		status: live ? 'online' : 'offline',
		sent: [],
		on: () => () => {},
		sendParty(p) { if (!live) return false; this.sent.push(p); return true; },
	};
	const ui = { chatInput, chat: row, toast: (msg, kind) => toasts.push({ msg, kind }) };
	return { host: { net, ui }, toasts, ui, net };
}

describe('party actions over a dropped socket', () => {
	it('tells the player an invite did not go out', () => {
		const { host, toasts } = makeHost(false);
		const party = new PartyClient(host);
		party.invitePeer('peer-1');
		expect(toasts.some((t) => /reconnect/i.test(t.msg))).toBe(true);
	});

	it('stays quiet when the invite was delivered', () => {
		const { host, toasts, net } = makeHost(true);
		const party = new PartyClient(host);
		party.invitePeer('peer-1');
		expect(net.sent.some((p) => p.op === 'invite')).toBe(true);
		expect(toasts).toHaveLength(0);
	});

	it('reports dropped party chat as unsent so the chat box keeps the text', () => {
		const { host, ui } = makeHost(false);
		const party = new PartyClient(host);
		party.state.party = { id: 'p1', members: [] };
		party.scope = 'party';
		expect(ui.chatInterceptor('hello crew')).toBe('unsent');
	});

	it('claims delivered party chat', () => {
		const { host, ui } = makeHost(true);
		const party = new PartyClient(host);
		party.state.party = { id: 'p1', members: [] };
		party.scope = 'party';
		expect(ui.chatInterceptor('/p hello crew')).toBe(true);
	});
});
