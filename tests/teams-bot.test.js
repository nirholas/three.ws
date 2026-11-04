// Pure rules behind the Teams message extension (api/_lib/teams-bot.js): which
// Bot Framework tokens are accepted, how the search text and agent links are
// read from an invoke, and the shape of the cards sent back to Teams.

import { describe, it, expect } from 'vitest';
import {
	BOTFRAMEWORK_ISSUER, SEARCH_COMMAND_ID, TeamsBotError,
	checkBotClaims, searchTextOf, agentIdFromUrl, attachmentFor, resultResponse, messageResponse, handleActivity,
} from '../api/_lib/teams-bot.js';

const APP = '5d1c2b3a-0000-4000-8000-00000000b071';
const SERVICE = 'https://smba.trafficmanager.net/amer/';
const AGENT = '3f2b6a1c-9d4e-4f7a-8b2c-1e5d7a9c0b4f';

function expectCode(fn, code) {
	try {
		fn();
	} catch (err) {
		expect(err).toBeInstanceOf(TeamsBotError);
		expect(err.code).toBe(code);
		return;
	}
	throw new Error(`expected ${code}`);
}

describe('checkBotClaims', () => {
	const ok = { iss: BOTFRAMEWORK_ISSUER, aud: APP, serviceurl: SERVICE };

	it('accepts a Bot Framework token for this bot from the same service', () => {
		expect(checkBotClaims(ok, { appId: APP, serviceUrl: SERVICE })).toBe(true);
	});

	it('accepts an audience list and a token without a serviceurl claim', () => {
		expect(checkBotClaims({ iss: BOTFRAMEWORK_ISSUER, aud: ['other', APP] }, { appId: APP, serviceUrl: SERVICE })).toBe(true);
	});

	it('rejects another issuer, another bot, and a serviceUrl the token was not issued for', () => {
		expectCode(() => checkBotClaims({ ...ok, iss: 'https://sts.windows.net/x/' }, { appId: APP, serviceUrl: SERVICE }), 'invalid_token');
		expectCode(() => checkBotClaims({ ...ok, aud: 'someone-else' }, { appId: APP, serviceUrl: SERVICE }), 'invalid_token');
		expectCode(() => checkBotClaims(ok, { appId: APP, serviceUrl: 'https://attacker.example/' }), 'invalid_token');
		expectCode(() => checkBotClaims(null, { appId: APP, serviceUrl: SERVICE }), 'invalid_token');
	});
});

describe('searchTextOf', () => {
	it('reads the searchQuery parameter, trimmed and capped', () => {
		expect(searchTextOf({ parameters: [{ name: 'searchQuery', value: '  forge  ' }] })).toBe('forge');
		expect(searchTextOf({ parameters: [{ name: 'searchQuery', value: 'x'.repeat(300) }] })).toHaveLength(100);
	});

	it('returns empty on the initial run and for non-text values', () => {
		expect(searchTextOf({ initialRun: true, parameters: [{ name: 'searchQuery', value: 'forge' }] })).toBe('');
		expect(searchTextOf({ parameters: [{ name: 'initialRun', value: true }] })).toBe('');
		expect(searchTextOf({ parameters: [{ name: 'searchQuery', value: 42 }] })).toBe('');
		expect(searchTextOf(undefined)).toBe('');
	});
});

describe('agentIdFromUrl', () => {
	it('reads the agent id from a three.ws agent page, with or without www, path or query', () => {
		expect(agentIdFromUrl(`https://three.ws/agents/${AGENT}`)).toBe(AGENT);
		expect(agentIdFromUrl(`https://www.three.ws/agents/${AGENT.toUpperCase()}/earnings?x=1`)).toBe(AGENT);
	});

	it('ignores other hosts, other paths, plain http and malformed ids', () => {
		expect(agentIdFromUrl(`https://three.ws.evil.example/agents/${AGENT}`)).toBeNull();
		expect(agentIdFromUrl(`http://three.ws/agents/${AGENT}`)).toBeNull();
		expect(agentIdFromUrl(`https://three.ws/forge/${AGENT}`)).toBeNull();
		expect(agentIdFromUrl('https://three.ws/agents/------------------------------------')).toBeNull();
		expect(agentIdFromUrl(null)).toBeNull();
	});
});

describe('cards', () => {
	const card = {
		id: AGENT, name: 'Forge Bot', description: 'Builds 3D props.', url: `https://three.ws/agents/${AGENT}`,
		image: 'https://three.ws/thumb.png', monogram: 'FB', accent: { from: '#000', to: '#111', hue: 200 },
		status: 'active', headline: 'Working.', metric: { label: 'Moves today', value: 3 },
		stats: [{ label: 'This week', value: 9 }, { label: 'All time', value: 40 }, { label: 'Skills', value: 2 }],
		lastAction: null,
	};

	it('sends the bound Adaptive Card with a thumbnail preview that opens the agent', () => {
		const a = attachmentFor(card);
		expect(a.contentType).toBe('application/vnd.microsoft.card.adaptive');
		expect(a.content.type).toBe('AdaptiveCard');
		expect(a.preview.contentType).toBe('application/vnd.microsoft.card.thumbnail');
		expect(a.preview.content).toMatchObject({ title: 'Forge Bot', text: 'Builds 3D props.', tap: { type: 'openUrl', value: card.url } });
		expect(a.preview.content.images).toEqual([{ url: card.image, alt: 'Forge Bot' }]);
	});

	it('falls back to the headline and drops images when there is no picture', () => {
		const a = attachmentFor({ ...card, description: null, image: null });
		expect(a.preview.content.text).toBe('Working.');
		expect(a.preview.content.images).toBeUndefined();
	});

	it('wraps results and messages in the composeExtension envelope', () => {
		expect(resultResponse([])).toEqual({ composeExtension: { type: 'result', attachmentLayout: 'list', attachments: [] } });
		expect(messageResponse('hi')).toEqual({ composeExtension: { type: 'message', text: 'hi' } });
	});
});

describe('handleActivity (no database needed)', () => {
	it('ignores non-invoke activities and unknown invokes', async () => {
		expect(await handleActivity({ type: 'message', text: 'hello' })).toBeNull();
		expect(await handleActivity({ type: 'invoke', name: 'something/else' })).toEqual({});
	});

	it('answers an unknown command id with a message instead of searching', async () => {
		const r = await handleActivity({ type: 'invoke', name: 'composeExtension/query', value: { commandId: 'other' } });
		expect(r.composeExtension.type).toBe('message');
		expect(SEARCH_COMMAND_ID).toBe('searchAgents');
	});

	it('answers a non-agent link with a message instead of a lookup', async () => {
		const r = await handleActivity({ type: 'invoke', name: 'composeExtension/queryLink', value: { url: 'https://three.ws/pricing' } });
		expect(r).toEqual(messageResponse('This three.ws link is not an agent page.'));
	});
});
