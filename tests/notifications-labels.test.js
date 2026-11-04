// @vitest-environment jsdom
// The bell and /notifications render every row through notifLabel / notifLink /
// TYPE_ICON. Knock, agent mail and event-market entrant notifications shipped
// without entries, so they rendered as their raw type ("knock received") with
// the generic icon, and a knock row linked nowhere because its payload carries
// `url`, not `link`. Payload shapes mirror the senders:
// api/_lib/knock/deliver.js, api/_lib/mail/inbound.js,
// api/_lib/event-markets/entrants.js.

import { describe, it, expect } from 'vitest';
import { notifLabel, notifLink, TYPE_ICON } from '../src/notifications.js';

const knock = {
	type: 'knock_received',
	payload: { title: 'Ada knocked (0.50 USDC)', body: 'Quick question about your agent', sender: 'Ada', knock_id: 'k1', amount_atomics: '500000', url: '/knock' },
};
const mail = {
	type: 'mail_received',
	payload: { agent_id: 'a1', agent_name: 'Scout', mailbox: 'scout@agents.three.ws', from: 'bob@example.com', from_name: 'Bob', subject: 'Invoice question', message_id: 'm1', link: '/agents/a1/mail?m=m1' },
};
const entrant = {
	type: 'event_market_entrant',
	payload: { market_slug: 'demo-day', title: 'Who wins demo day?', outcome_label: 'Team Blue', probability: 0.42, even_prior: false, link: '/markets/demo-day/kit' },
};

describe('notification labels for knock, mail and event-market entrant rows', () => {
	it('never falls back to the raw type string', () => {
		for (const n of [knock, mail, entrant]) {
			expect(notifLabel(n)).not.toBe(n.type.replace(/_/g, ' '));
		}
	});

	it('a knock shows its title', () => {
		expect(notifLabel(knock)).toBe('Ada knocked (0.50 USDC)');
		expect(notifLabel({ type: 'knock_received', payload: { sender: 'Ada' } })).toBe('Ada knocked on your door');
		expect(notifLabel({ type: 'knock_received', payload: {} })).toBe('Someone knocked on your door');
	});

	it('mail names the agent, the sender and the subject', () => {
		expect(notifLabel(mail)).toBe('Scout got mail from Bob: "Invoice question"');
		expect(notifLabel({ type: 'mail_received', payload: { from: 'bob@example.com' } })).toBe('Your agent got mail from bob@example.com');
	});

	it('an entrant notice names the market and the outcome', () => {
		expect(notifLabel(entrant)).toBe('You are entered in "Who wins demo day?" as Team Blue');
		expect(notifLabel({ type: 'event_market_entrant', payload: { title: 'Who wins?' } })).toBe('You are entered in "Who wins?"');
	});

	it('each type has its own icon', () => {
		expect(TYPE_ICON.knock_received).toBeTruthy();
		expect(TYPE_ICON.mail_received).toBeTruthy();
		expect(TYPE_ICON.event_market_entrant).toBeTruthy();
	});

	it('a knock row links to the knock inbox from its payload url', () => {
		expect(notifLink(knock)).toBe('/knock');
		expect(notifLink(mail)).toBe('/agents/a1/mail?m=m1');
		expect(notifLink(entrant)).toBe('/markets/demo-day/kit');
	});

	it('a payload url is held to the same safe-navigation rule as link', () => {
		expect(notifLink({ type: 'knock_received', payload: { url: 'javascript:alert(1)' } })).toBeNull();
		expect(notifLink({ type: 'knock_received', payload: { url: '//evil.example' } })).toBeNull();
	});
});
