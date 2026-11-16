// Teams Store validation, bot rules: a welcome on install, answers to hi,
// hello and help, and a useful reply to an unknown command. Every activity is
// a real Bot Framework payload shape, sent through the same handleActivity the
// verified /api/microsoft-teams/messages endpoint calls, with only the outbound
// Bot Connector stubbed. Production token verification is never bypassed: these
// tests start after it.
//
// Payload shapes follow Microsoft's documented examples:
//   https://learn.microsoft.com/en-us/microsoftteams/platform/bots/how-to/conversations/subscribe-to-conversation-events
//   https://learn.microsoft.com/en-us/microsoftteams/platform/concepts/deploy-and-publish/appsource/prepare/teams-store-validation-guidelines#bots
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { handleActivity } from '../api/_lib/teams-bot.js';

const manifest = JSON.parse(readFileSync(new URL('../integrations/microsoft/copilot-teams/manifest.template.json', import.meta.url), 'utf8'));
const APP_NAME = manifest.name.short;
const SERVICE = 'https://smba.trafficmanager.net/amer/';
const BOT = { id: '28:00000000-0000-4000-8000-0000000000b0', name: APP_NAME };
const USER = { id: '29:1yzCpmVa2GvH7R2kVqMU8kK7W5dwKDGNvnP3lZvI2BGo', name: 'Bob Smith', aadObjectId: 'c4e3f5b2-6a2a-4e3e-9f43-1d3b2c5f6a7b' };
const TENANT = { id: '72f988bf-86f1-41af-91ab-2d7cd011db47' };
const PERSONAL = { conversationType: 'personal', tenantId: TENANT.id, id: 'a:1Gdx4wrNEtwvO3ZcVfVu5ZQ1F3C2A' };
const GROUP = { isGroup: true, conversationType: 'groupChat', tenantId: TENANT.id, id: '19:meeting_ZDk3NzMzMjAtNTQ1ZC00YzNlLWJjMjAtNzgxMmM3NzE0ZmM4@thread.v2' };
const CHANNEL = { isGroup: true, conversationType: 'channel', tenantId: TENANT.id, id: '19:7705841b240044b297123ad7f9c99217@thread.skype' };

let seq = 0;
const nextId = () => `w:${++seq}`;

function harness({ connector = true } = {}) {
	const calls = { send: [], reply: [] };
	const deps = {
		dispatch: async () => {},
		rateLimit: async () => null,
		connector: {
			connectorConfigured: () => connector,
			sendToConversation: async (a) => (calls.send.push(a), { id: `1:sent${seq}` }),
			replyToActivity: async (a) => (calls.reply.push(a), { id: `1:reply${seq}` }),
			updateActivity: async () => ({}),
		},
	};
	return { calls, ctx: { origin: 'https://three.ws', selfBase: 'https://three-ws-api.example.run.app', deps } };
}

function botAdded(conversation, { from = USER, team } = {}) {
	return {
		type: 'conversationUpdate',
		id: nextId(),
		timestamp: '2026-11-16T15:00:00.000Z',
		channelId: 'msteams',
		serviceUrl: SERVICE,
		from,
		recipient: BOT,
		conversation,
		membersAdded: [{ id: BOT.id }],
		channelData: { tenant: TENANT, eventType: team ? 'teamMemberAdded' : undefined, ...(team ? { team } : {}) },
	};
}

// Message payloads leave out the tenant so the account-linking path (which
// records installs in the database) treats the sender as unlinked.
function message(text, conversation = PERSONAL) {
	return {
		type: 'message',
		id: nextId(),
		timestamp: '2026-11-16T15:01:00.000Z',
		channelId: 'msteams',
		serviceUrl: SERVICE,
		from: USER,
		recipient: BOT,
		conversation,
		text,
		textFormat: 'plain',
	};
}

const reply = (calls) => calls.reply.at(-1)?.activity?.text || '';

describe('welcome message on install', () => {
	it('welcomes a person once when they add the bot in personal scope, naming the app as the manifest does', async () => {
		const { calls, ctx } = harness();
		expect(await handleActivity(botAdded(PERSONAL), ctx)).toBeNull();
		expect(calls.send).toHaveLength(1);
		expect(calls.send[0]).toMatchObject({ serviceUrl: SERVICE, conversationId: PERSONAL.id });
		const text = calls.send[0].activity.text;
		expect(text).toContain(APP_NAME);
		expect(text).toMatch(/forge/);
		expect(text).toMatch(/help/);
		expect(text).toMatch(/limit/i);
	});

	it('says who added the bot to a team or group chat', async () => {
		for (const [conversation, extra] of [[CHANNEL, { team: { id: CHANNEL.id, name: 'Design' } }], [GROUP, {}]]) {
			const { calls, ctx } = harness();
			await handleActivity(botAdded(conversation, extra), ctx);
			expect(calls.send).toHaveLength(1);
			expect(calls.send[0].activity.text).toContain('Bob Smith added');
			expect(calls.send[0].activity.text).toContain(APP_NAME);
		}
	});

	it('stays silent when someone else joins, or when the bot cannot reply', async () => {
		const other = harness();
		await handleActivity({ ...botAdded(GROUP), membersAdded: [{ id: '29:someone-else' }] }, other.ctx);
		expect(other.calls.send).toHaveLength(0);
		const off = harness({ connector: false });
		expect(await handleActivity(botAdded(PERSONAL), off.ctx)).toBeNull();
		expect(off.calls.send).toHaveLength(0);
	});
});

describe('hi, hello, help and unknown commands', () => {
	it('answers help with every capability and no link that leaves Teams', async () => {
		const { calls, ctx } = harness();
		await handleActivity(message('help'), ctx);
		const text = reply(calls);
		expect(text).toMatch(/forge/);
		expect(text).toMatch(/Search agents/i);
		expect(text).toMatch(/tab/i);
		expect(text).toMatch(/meeting/i);
		expect(text).not.toMatch(/https?:\/\//);
	});

	it('greets hi and hello, including an @mention in a channel', async () => {
		for (const text of ['hi', 'Hello!', '<at>three.ws 3D Studio</at> hi']) {
			const { calls, ctx } = harness();
			await handleActivity(message(text, text.startsWith('<at>') ? CHANNEL : PERSONAL), ctx);
			expect(reply(calls)).toMatch(/^Hi Bob/);
			expect(reply(calls)).toMatch(/forge/);
		}
	});

	it('tells the person an unknown command was not recognised and what works instead', async () => {
		const { calls, ctx } = harness();
		await handleActivity(message('dance'), ctx);
		expect(reply(calls)).toMatch(/did not recognise "dance"/);
		expect(reply(calls)).toMatch(/help/);
	});
});

describe('copy rules', () => {
	it('names the app exactly as the manifest does', async () => {
		const { APP_NAME: name } = await import('../api/_lib/teams-bot-welcome.js');
		expect(name).toBe(APP_NAME);
	});
});
