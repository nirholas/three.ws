// The Discord adapter: interaction and gateway-message normalisation, and the
// send surface with the Discord REST API answered at its boundary.

import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { DiscordAPIError, Routes } from 'discord.js';
import { createDiscordAdapter, parseTypedCommand, snowflakeTime, toPlatformError } from '../src/adapters/discord.js';
import { PlatformError } from '../src/errors.js';

const fixture = (name) => JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), 'utf8'));
const env = { DISCORD_BOT_TOKEN: 'fixture-bot-token-never-sent', DISCORD_APP_ID: '1290000000000000001' };

/** The REST client at its boundary: records each call and answers like Discord. */
function fakeRest(answer = () => undefined) {
	const calls = [];
	let nextId = 1400000000000000000n;
	const handle = (verb) => async (route, opts = {}) => {
		calls.push({ verb, route, opts });
		const custom = answer(verb, route, opts);
		if (custom instanceof Error) throw custom;
		if (custom) return custom;
		if (verb === 'delete') return undefined;
		const channel = /\/channels\/(\d+)\//.exec(route)?.[1] || '1280000000000000002';
		nextId += 1n;
		return { id: String(nextId), channel_id: channel, content: opts.body?.content };
	};
	return { rest: { get: handle('get'), post: handle('post'), patch: handle('patch'), put: handle('put'), delete: handle('delete') }, calls };
}

function adapterAt(interactionFixture, answer) {
	const { rest, calls } = fakeRest(answer);
	const minted = snowflakeTime(fixture(interactionFixture).id);
	const adapter = createDiscordAdapter({ env, rest, config: { discordGateway: false }, now: () => minted + 2000 });
	return { adapter, calls };
}

describe('discord normalize', () => {
	const { adapter } = adapterAt('discord-interaction-command');

	it('reads a /three subcommand with its option as command and args', () => {
		expect(adapter.normalize(fixture('discord-interaction-command'))).toMatchObject({
			platform: 'discord', chatId: '1280000000000000002', chatType: 'guild', chatTitle: 'agent-desk',
			userId: '1270000000000000001', username: 'fixture_owner', command: 'use', args: '2',
			interaction: { id: '1300000000000000001', type: 2, applicationId: '1290000000000000001' },
		});
	});

	it('reads a top-level command', () => {
		const i = fixture('discord-interaction-command');
		i.data = { id: '1', name: 'balance', type: 1 };
		expect(adapter.normalize(i)).toMatchObject({ command: 'balance', args: '' });
	});

	it('maps a button press in a DM to an action on the pressed message', () => {
		expect(adapter.normalize(fixture('discord-interaction-button'))).toMatchObject({
			chatType: 'dm',
			userId: '1270000000000000001',
			action: { verb: 'approve', previewId: '4d5e6f70-1111-4222-8333-944455566677' },
			messageRef: { kind: 'channel', channelId: '1280000000000000003', messageId: '1299000000000000009' },
		});
	});

	it('turns a mention into text without the mention, and a typed command into a command', () => {
		expect(adapter.normalize(fixture('discord-message-mention'))).toMatchObject({ chatType: 'guild', chatTitle: 'agent-desk', text: 'how is my portfolio doing?' });
		const typed = fixture('discord-message-mention');
		typed.message.content = '<@1290000000000000001> /three balance';
		expect(adapter.normalize(typed)).toMatchObject({ command: 'balance', args: '' });
	});

	it('routes an audio attachment to voice and an image to photo', () => {
		const voice = fixture('discord-message-mention');
		voice.message.attachments = [{ url: 'https://cdn.discordapp.com/attachments/1/2/voice-message.ogg', content_type: 'audio/ogg', size: 9000, filename: 'voice-message.ogg' }];
		expect(typeof adapter.normalize(voice).voice.fetch).toBe('function');
		const photo = fixture('discord-message-mention');
		photo.message.attachments = [{ url: 'https://cdn.discordapp.com/attachments/1/2/chart.png', content_type: 'image/png', size: 9000, filename: 'chart.png' }];
		expect(adapter.normalize(photo).photo.caption).toBe('how is my portfolio doing?');
	});

	it('ignores bots, unknown buttons and empty mentions', () => {
		const fromBot = fixture('discord-message-mention');
		fromBot.message.author.bot = true;
		expect(adapter.normalize(fromBot)).toBeNull();
		const button = fixture('discord-interaction-button');
		button.data.custom_id = 'someone-elses-button';
		expect(adapter.normalize(button)).toBeNull();
		const bare = fixture('discord-message-mention');
		bare.message.content = '<@1290000000000000001>';
		expect(adapter.normalize(bare)).toBeNull();
	});

	it('parseTypedCommand handles /three and plain commands', () => {
		expect(parseTypedCommand('/three link ABCD-EFGH')).toEqual({ command: 'link', args: 'ABCD-EFGH' });
		expect(parseTypedCommand('/three')).toEqual({ command: 'help', args: '' });
		expect(parseTypedCommand('/Portfolio')).toEqual({ command: 'portfolio', args: '' });
		expect(parseTypedCommand('not a command')).toBeNull();
	});
});

describe('discord gateway: interactions', () => {
	it('fills the deferred reply first, then sends followups, with mentions disabled', async () => {
		const { adapter, calls } = adapterAt('discord-interaction-command');
		const event = adapter.normalize(fixture('discord-interaction-command'));
		const gw = adapter.gateway(event);
		const first = await gw.sendText(event.chatId, 'This chat now talks to Agent 2.');
		await gw.sendText(event.chatId, 'second message');
		const token = fixture('discord-interaction-command').token;
		expect(calls[0]).toMatchObject({ verb: 'patch', route: Routes.webhookMessage(env.DISCORD_APP_ID, token, '@original'), opts: { auth: false } });
		expect(calls[0].opts.body).toEqual({ content: 'This chat now talks to Agent 2.', allowed_mentions: { parse: [] } });
		expect(calls[1]).toMatchObject({ verb: 'post', route: Routes.webhook(env.DISCORD_APP_ID, token), opts: { auth: false } });
		expect(first).toMatchObject({ kind: 'interaction', interactionId: '1300000000000000001', applicationId: env.DISCORD_APP_ID });
	});

	it('removes the "thinking..." placeholder when a command produced nothing', async () => {
		const { adapter, calls } = adapterAt('discord-interaction-command');
		const event = adapter.normalize(fixture('discord-interaction-command'));
		const gw = adapter.gateway(event);
		await adapter.finish(event, gw);
		expect(calls[0]).toMatchObject({ verb: 'delete', route: Routes.webhookMessage(env.DISCORD_APP_ID, fixture('discord-interaction-command').token, '@original') });
	});

	it('edits the pressed message through the press itself, and acks privately', async () => {
		const { adapter, calls } = adapterAt('discord-interaction-button');
		const event = adapter.normalize(fixture('discord-interaction-button'));
		const gw = adapter.gateway(event);
		await gw.ackAction(event, 'Approved. Executing...');
		await gw.editMessage(event.messageRef, 'Sell preview\n\nApproved. Executing...', { choices: [] });
		const token = fixture('discord-interaction-button').token;
		expect(calls[0]).toMatchObject({ verb: 'post', route: Routes.webhook(env.DISCORD_APP_ID, token) });
		expect(calls[0].opts.body.flags).toBe(64);
		expect(calls[1]).toMatchObject({ verb: 'patch', route: Routes.webhookMessage(env.DISCORD_APP_ID, token, '@original') });
		expect(calls[1].opts.body.components).toEqual([]);
	});

	it('renders choices as one action row of buttons', async () => {
		const { adapter, calls } = adapterAt('discord-interaction-command');
		const event = adapter.normalize(fixture('discord-interaction-command'));
		await adapter.gateway(event).sendChoice(event.chatId, 'Buy preview', [{ id: 'gw:ap:x', label: 'Approve', style: 'primary' }, { id: 'gw:cx:x', label: 'Cancel', style: 'danger' }]);
		expect(calls[0].opts.body.components).toEqual([{ type: 1, components: [
			{ type: 2, style: 1, label: 'Approve', custom_id: 'gw:ap:x' },
			{ type: 2, style: 4, label: 'Cancel', custom_id: 'gw:cx:x' },
		] }]);
	});

	it('falls back to the bot channel API once an interaction token has expired', async () => {
		const { rest, calls } = fakeRest();
		const i = fixture('discord-interaction-command');
		const adapter = createDiscordAdapter({ env, rest, config: { discordGateway: false }, now: () => snowflakeTime(i.id) + 20 * 60 * 1000 });
		const event = adapter.normalize(i);
		const ref = await adapter.gateway(event).sendText(event.chatId, 'late answer');
		expect(calls[0]).toMatchObject({ verb: 'post', route: Routes.channelMessages('1280000000000000002') });
		expect(calls[0].opts.auth).toBeUndefined();
		expect(ref).toMatchObject({ kind: 'channel', channelId: '1280000000000000002' });
	});
});

describe('discord gateway: channels', () => {
	it('sends notifications, typing and images through the channel API', async () => {
		const { rest, calls } = fakeRest();
		const gw = createDiscordAdapter({ env, rest, config: { discordGateway: false } }).gateway(null);
		await gw.sendText('555', 'Your run finished');
		await gw.typing('555');
		await gw.sendMedia('555', { url: 'https://three.ws/api/render/glb?glbUrl=x', caption: 'Rendered' });
		expect(calls.map((c) => [c.verb, c.route])).toEqual([
			['post', Routes.channelMessages('555')],
			['post', Routes.channelTyping('555')],
			['post', Routes.channelMessages('555')],
		]);
		expect(calls[2].opts.body.embeds).toEqual([{ image: { url: 'https://three.ws/api/render/glb?glbUrl=x' } }]);
	});

	it('edits a stored interaction ref by webhook, and through the channel when that is refused', async () => {
		const refused = new DiscordAPIError({ code: 50027, message: 'Invalid Webhook Token' }, 50027, 401, 'PATCH', '/webhooks/x', {});
		const { rest, calls } = fakeRest((verb, route) => (verb === 'patch' && route.startsWith('/webhooks/') ? refused : undefined));
		const now = Date.now();
		const gw = createDiscordAdapter({ env, rest, config: { discordGateway: false }, now: () => now }).gateway(null);
		const freshId = String((BigInt(now - 60_000) - 1420070400000n) << 22n);
		await gw.editMessage({ kind: 'interaction', applicationId: env.DISCORD_APP_ID, token: 't', interactionId: freshId, channelId: '777', messageId: '888' }, 'Expired.', { choices: [] });
		expect(calls.map((c) => [c.verb, c.route])).toEqual([
			['patch', Routes.webhookMessage(env.DISCORD_APP_ID, 't', '888')],
			['patch', Routes.channelMessage('777', '888')],
		]);
	});

	it('uploads a spoken reply as an audio file', async () => {
		const { rest, calls } = fakeRest();
		await createDiscordAdapter({ env, rest, config: { discordGateway: false } }).gateway(null).sendVoice('555', { buffer: Buffer.from('OggS'), mimeType: 'audio/ogg', filename: 'reply.ogg' });
		expect(calls[0].opts.files).toEqual([{ name: 'reply.ogg', data: Buffer.from('OggS'), contentType: 'audio/ogg' }]);
	});
});

describe('discord error mapping', () => {
	it('marks 4xx permanent and leaves 5xx retryable', () => {
		const forbidden = toPlatformError(new DiscordAPIError({ code: 50001, message: 'Missing Access' }, 50001, 403, 'POST', '/channels/1/messages', {}));
		expect(forbidden).toBeInstanceOf(PlatformError);
		expect(forbidden).toMatchObject({ platform: 'discord', status: 403, code: 50001, permanent: true });
		const outage = toPlatformError(new DiscordAPIError({ code: 0, message: 'Internal Server Error' }, 0, 503, 'POST', '/channels/1/messages', {}));
		expect(outage.permanent).toBe(false);
	});
});
