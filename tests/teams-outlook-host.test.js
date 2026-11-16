// The three.ws Microsoft 365 app outside Teams: the bot reads which host sent an
// activity from its Bot Framework channel id and answers Outlook and the
// Microsoft 365 app with cards those hosts render, keeping the richer card for
// Teams. Outlook limits asserted here come from Microsoft's published guidance:
// https://learn.microsoft.com/en-us/microsoftteams/platform/m365-apps/extend-m365-teams-message-extension
// (openURL is the only supported card action, bot-delivered cards are not
// supported, only the compose context runs) and the Outlook Adaptive Card
// version (1.4, the version Outlook ships after 1.0).

import { readFileSync } from 'node:fs';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Ajv from 'ajv';
import draft06 from 'ajv/dist/refs/json-schema-draft-06.json' with { type: 'json' };
import { SignJWT, generateKeyPair, exportJWK, createLocalJWKSet } from 'jose';
import {
	BOTFRAMEWORK_ISSUER, TEAMS_CHANNEL, M365_EXTENSIONS_CHANNEL,
	channelHostOf, attachmentFor, handleActivity, verifyBotToken,
} from '../api/_lib/teams-bot.js';
import { ADAPTIVE_VERSION, OUTLOOK_ADAPTIVE_VERSION, adaptiveCardFor, adaptiveTemplate } from '../api/_lib/glance-adaptive.js';
import { CREATE_COMMAND_ID } from '../api/_lib/teams-forge-bot.js';

function compile(file) {
	const { id, ...body } = JSON.parse(readFileSync(new URL(`./fixtures/${file}`, import.meta.url), 'utf8'));
	const ajv = new Ajv({ strict: false, allErrors: true, validateFormats: false });
	ajv.addMetaSchema(draft06);
	return ajv.compile({ $id: id, ...body });
}
const validate14 = compile('adaptive-card-1.4.schema.json');
const validate15 = compile('adaptive-card-1.5.schema.json');

// Bot Framework caps a message activity, attachments included, at about 28 KB.
const MAX_CARD_BYTES = 28 * 1024;

const SERVICE = 'https://smba.trafficmanager.net/amer/';
const card = {
	id: '3f2b6a1c-9d4e-4f7a-8b2c-1e5d7a9c0b4f',
	name: 'Forge Bot',
	headline: 'Turns prompts into 3D models',
	description: 'Generates textured GLB models from a text prompt.',
	url: 'https://three.ws/agents/3f2b6a1c-9d4e-4f7a-8b2c-1e5d7a9c0b4f',
	image: 'https://three.ws/avatars/forge.png',
	metric: { value: '42', label: 'models this week' },
	stats: [
		{ label: 'Skills', value: '3' },
		{ label: 'Followers', value: '120' },
		{ label: 'Since', value: 'Oct 2026' },
	],
};

const activityFrom = (channelId, extra = {}) => ({ type: 'invoke', channelId, serviceUrl: SERVICE, from: { id: '29:u' }, ...extra });

/** Every action and selectAction anywhere in a card. */
function actionsOf(node, out = []) {
	if (Array.isArray(node)) node.forEach((n) => actionsOf(n, out));
	else if (node && typeof node === 'object') {
		if (typeof node.type === 'string' && node.type.startsWith('Action.')) out.push(node);
		Object.values(node).forEach((v) => actionsOf(v, out));
	}
	return out;
}
const hasKey = (node, key, value) => JSON.stringify(node).includes(value === undefined ? `"${key}"` : `"${key}":${JSON.stringify(value)}`);

describe('channelHostOf', () => {
	it('reads Teams from the msteams channel', () => {
		expect(TEAMS_CHANNEL).toBe('msteams');
		expect(channelHostOf({ channelId: 'msteams' })).toBe('teams');
		expect(channelHostOf({ channelId: 'MSTeams' })).toBe('teams');
	});

	it('reads Outlook and the Microsoft 365 app from the m365extensions channel', () => {
		expect(M365_EXTENSIONS_CHANNEL).toBe('m365extensions');
		expect(channelHostOf({ channelId: 'm365extensions' })).toBe('outlook');
	});

	it('treats a missing or unknown channel as the conservative Outlook host', () => {
		expect(channelHostOf({})).toBe('outlook');
		expect(channelHostOf({ channelId: 'webchat' })).toBe('outlook');
		expect(channelHostOf(null)).toBe('outlook');
	});
});

describe('Glance card per host', () => {
	it('keeps the richer 1.6 card for Teams, valid against the published schema', () => {
		const teams = adaptiveCardFor(card);
		expect(teams.version).toBe(ADAPTIVE_VERSION);
		expect(hasKey(teams, 'style', 'RoundedCorners')).toBe(true);
		// No 1.6 schema is published: RoundedCorners is the one 1.6 attribute, so
		// everything else is checked against 1.5.
		const as15 = JSON.parse(JSON.stringify({ ...teams, version: '1.5' }).replace(/,"style":"RoundedCorners"/g, ''));
		expect(validate15(as15), JSON.stringify(validate15.errors)).toBe(true);
	});

	it('gives Outlook a 1.4 card that validates against the 1.4 schema', () => {
		const outlook = adaptiveCardFor(card, { host: 'outlook' });
		expect(OUTLOOK_ADAPTIVE_VERSION).toBe('1.4');
		expect(outlook.version).toBe('1.4');
		expect(validate14(outlook), JSON.stringify(validate14.errors)).toBe(true);
	});

	it('keeps the Outlook card within the Outlook limits', () => {
		const outlook = adaptiveCardFor(card, { host: 'outlook' });
		const actions = actionsOf(outlook);
		expect(actions.length).toBeGreaterThan(0);
		for (const a of actions) {
			expect(a.type).toBe('Action.OpenUrl');
			expect(a.url).toMatch(/^https:\/\//);
		}
		expect(hasKey(outlook, 'refresh')).toBe(false);
		expect(hasKey(outlook, 'style', 'RoundedCorners')).toBe(false);
		expect(Buffer.byteLength(JSON.stringify(outlook))).toBeLessThan(MAX_CARD_BYTES);
	});

	it('leaves the Windows widgets template untouched', () => {
		expect(adaptiveTemplate().version).toBe(ADAPTIVE_VERSION);
	});
});

describe('attachmentFor per channel', () => {
	it('sends the Teams card to msteams and the Outlook card to m365extensions', () => {
		expect(attachmentFor(card, { host: 'teams' }).content.version).toBe(ADAPTIVE_VERSION);
		expect(attachmentFor(card).content.version).toBe(ADAPTIVE_VERSION);
		const outlook = attachmentFor(card, { host: 'outlook' });
		expect(outlook.content.version).toBe('1.4');
		expect(validate14(outlook.content), JSON.stringify(validate14.errors)).toBe(true);
		expect(outlook.preview.contentType).toBe('application/vnd.microsoft.card.thumbnail');
		expect(outlook.preview.content.tap).toEqual({ type: 'openUrl', value: card.url });
	});
});

describe('handleActivity from Outlook and the Microsoft 365 app', () => {
	it('answers a non-agent link from m365extensions with a message, as in Teams', async () => {
		const res = await handleActivity(activityFrom('m365extensions', { name: 'composeExtension/queryLink', value: { url: 'https://three.ws/pricing' } }));
		expect(res).toEqual({ composeExtension: { type: 'message', text: 'This three.ws link is not an agent page.' } });
	});

	it('does not open the live 3D form in Outlook, which cannot run its refreshing card', async () => {
		const res = await handleActivity(activityFrom('m365extensions', { name: 'composeExtension/fetchTask', value: { commandId: CREATE_COMMAND_ID, commandContext: 'compose' } }));
		expect(res.task.type).toBe('message');
		expect(res.task.value).toMatch(/Teams/);
		expect(hasKey(res, 'Action.Execute')).toBe(false);
	});

	it('answers a createModel submit from m365extensions with a message, never a bot-delivered card', async () => {
		const res = await handleActivity(activityFrom('m365extensions', { name: 'composeExtension/submitAction', value: { commandId: CREATE_COMMAND_ID, data: { prompt: 'a brass compass' } } }));
		expect(res.composeExtension.type).toBe('message');
		expect(res.composeExtension.text).toMatch(/Teams/);
	});

	it('still opens the 3D form for msteams', async () => {
		const res = await handleActivity(activityFrom('msteams', { name: 'composeExtension/fetchTask', value: { commandId: CREATE_COMMAND_ID, commandContext: 'compose' } }));
		expect(res.task.type).toBe('continue');
		expect(res.task.value.card.contentType).toBe('application/vnd.microsoft.card.adaptive');
	});
});

describe('the same Bot Framework auth for every channel', () => {
	const APP = '5d1c2b3a-0000-4000-8000-00000000b071';
	let saved;
	let privateKey;
	let otherKey;
	let keys;

	beforeAll(async () => {
		saved = process.env.MS_TEAMS_BOT_APP_ID;
		process.env.MS_TEAMS_BOT_APP_ID = APP;
		const pair = await generateKeyPair('RS256');
		privateKey = pair.privateKey;
		otherKey = (await generateKeyPair('RS256')).privateKey;
		const jwk = { ...(await exportJWK(pair.publicKey)), kid: 'k1', alg: 'RS256' };
		keys = createLocalJWKSet({ keys: [jwk] });
	});
	afterAll(() => {
		if (saved === undefined) delete process.env.MS_TEAMS_BOT_APP_ID;
		else process.env.MS_TEAMS_BOT_APP_ID = saved;
	});

	const sign = (key, claims = {}) =>
		new SignJWT({ serviceurl: SERVICE, ...claims })
			.setProtectedHeader({ alg: 'RS256', kid: 'k1' })
			.setIssuer(BOTFRAMEWORK_ISSUER)
			.setAudience(APP)
			.setIssuedAt()
			.setExpirationTime('5m')
			.sign(key);

	for (const channelId of ['msteams', 'm365extensions']) {
		it(`verifies a ${channelId} activity against the Bot Framework keys and rejects a forged one`, async () => {
			const activity = activityFrom(channelId, { name: 'composeExtension/query' });
			await expect(verifyBotToken(`Bearer ${await sign(privateKey)}`, { serviceUrl: activity.serviceUrl, keys })).resolves.toMatchObject({ aud: APP });
			await expect(verifyBotToken(`Bearer ${await sign(otherKey)}`, { serviceUrl: activity.serviceUrl, keys })).rejects.toMatchObject({ code: 'invalid_token' });
			await expect(verifyBotToken(undefined, { serviceUrl: activity.serviceUrl, keys })).rejects.toMatchObject({ code: 'missing_token' });
		});
	}
});

describe('the tab routes let every Microsoft 365 host frame them', () => {
	// The frame-ancestors hosts Microsoft lists for a tab that runs in Teams,
	// Outlook (work and outlook.com) and the Microsoft 365 app:
	// https://learn.microsoft.com/en-us/microsoftteams/platform/m365-apps/extend-m365-teams-personal-tab
	const HOSTS = [
		'https://teams.microsoft.com', 'https://*.teams.microsoft.com', 'https://*.cloud.microsoft',
		'https://*.office.com', 'https://outlook.office.com', 'https://outlook.office365.com',
		'https://outlook-sdf.office.com', 'https://outlook-sdf.office365.com',
		'https://outlook.live.com', 'https://outlook-sdf.live.com', 'https://*.microsoft365.com',
	];
	const routes = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8')).routes;

	for (const src of ['/microsoft/teams-tab/?', '/microsoft/teams-stage/?']) {
		it(`${src} allows Teams, Outlook and the Microsoft 365 app as frame ancestors`, () => {
			const csp = routes.find((r) => r.src === src && r.headers?.['content-security-policy'])?.headers['content-security-policy'];
			const ancestors = (csp.match(/frame-ancestors ([^;]+)/)?.[1] || '').split(/\s+/);
			for (const host of HOSTS) expect(ancestors, host).toContain(host);
		});
	}
});
