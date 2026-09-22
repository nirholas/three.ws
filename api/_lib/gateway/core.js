// The chat gateway core: one platform-neutral handler for every inbound chat
// event, driven by a platform adapter (workers/agent-gateway/src/telegram.js,
// workers/agent-gateway/src/discord.js).
//
// An adapter turns platform updates into events and implements the Gateway
// interface below; everything else (pairing, commands, conversation, previews,
// approvals) lives here, so Telegram and Discord behave identically.
//
// @typedef {object} GatewayEvent
// @property {'telegram'|'discord'} platform
// @property {string} chatId          the chat, DM channel or guild channel
// @property {string} [chatType]      private | group | supergroup | dm | guild
// @property {string} [chatTitle]
// @property {string} userId          the platform user who sent it
// @property {string} [username]
// @property {string} [text]          a plain message
// @property {string} [command]       a slash command, lowercased, without the slash
// @property {string} [args]          everything after the command
// @property {{ verb:'approve'|'cancel', previewId:string }} [action]  a button press
// @property {{ fetch:() => Promise<{buffer:Buffer, mimeType:string}> }} [voice]
// @property {{ fetch:() => Promise<{buffer:Buffer, mimeType:string}>, caption?:string }} [photo]
// @property {object} [messageRef]    the pressed message, for button events
//
// @typedef {object} Gateway
// @property {'telegram'|'discord'} platform
// @property {(chatId:string, text:string) => Promise<object>} sendText            returns a message ref
// @property {(chatId:string, text:string, choices:{id:string,label:string,style?:string}[]) => Promise<object>} sendChoice
// @property {(ref:object, text:string, opts?:{choices?:object[]}) => Promise<void>} editMessage  choices [] removes buttons
// @property {(chatId:string, media:{url:string, caption?:string}) => Promise<object>} sendMedia
// @property {(chatId:string) => Promise<void>} typing
// @property {(event:GatewayEvent, text?:string) => Promise<void>} ackAction      answer a button press

import { limits } from '../rate-limit.js';
import { getLiveLink, touchLink, issueChatCode, redeemSiteCode, GatewayError } from './store.js';
import { normalizePairCode, formatPairCode } from './codes.js';
import { COMMAND_HANDLERS, helpText } from './commands.js';
import { converse } from './conversation.js';
import { handleAction } from './approvals.js';
import { transcribeVoice, describePhoto, MediaError } from './media.js';
import { appOrigin } from './format.js';

function identityOf(event) {
	return {
		platform: event.platform,
		platformUserId: String(event.userId),
		platformUsername: event.username || null,
		chatId: String(event.chatId),
		chatType: event.chatType || null,
		chatTitle: event.chatTitle || null,
	};
}

async function pairingPrompt(gw, event) {
	const rl = await limits.gatewayPair(`${event.platform}:${event.chatId}`);
	if (!rl.success) return gw.sendText(event.chatId, 'Too many pairing codes for this chat. Wait an hour, or generate a code on the site and send /link <code> here.');
	const { code, expiresInMinutes } = await issueChatCode(identityOf(event));
	const pretty = formatPairCode(code);
	return gw.sendText(event.chatId, [
		'Connect this chat to your three.ws agent.',
		'',
		`Your pairing code: ${pretty}`,
		`Open ${appOrigin()}/settings/connections?code=${code}`,
		`sign in, and confirm. The code expires in ${expiresInMinutes} minutes.`,
		'',
		`Already on the site? Generate a code there and send /link <code> here instead.`,
	].join('\n'));
}

async function cmdLink({ gw, event, link }) {
	const code = normalizePairCode(event.args);
	if (!code) {
		if (link) return gw.sendText(event.chatId, `This chat is already paired. Send /help to see what you can do, or /unlink to disconnect.`);
		return pairingPrompt(gw, event);
	}
	try {
		await redeemSiteCode({ code, identity: identityOf(event) });
	} catch (e) {
		if (e instanceof GatewayError) return gw.sendText(event.chatId, e.message);
		throw e;
	}
	return gw.sendText(event.chatId, `Paired. This chat now talks to your three.ws account.\n\n${helpText()}`);
}

async function textFromMedia(gw, event) {
	try {
		if (event.voice) {
			const { buffer, mimeType } = await event.voice.fetch();
			const heard = await transcribeVoice({ buffer, mimeType });
			await gw.sendText(event.chatId, `Heard: "${heard}"`);
			return heard;
		}
		const { buffer, mimeType } = await event.photo.fetch();
		return await describePhoto({ buffer, mimeType, caption: event.photo.caption || '' });
	} catch (e) {
		if (e instanceof MediaError) {
			await gw.sendText(event.chatId, e.message);
			return null;
		}
		console.error('[gateway] media failed', e?.code || e?.message);
		await gw.sendText(event.chatId, event.voice
			? 'I could not transcribe that voice note. Try again, or type it.'
			: 'I could not read that photo. Try again, or describe it in text.');
		return null;
	}
}

/**
 * Handle one inbound chat event end to end.
 * @param {GatewayEvent} event
 * @param {Gateway} gw
 */
export async function handleEvent(event, gw) {
	const link = await getLiveLink(event.platform, event.chatId);

	if (event.action) return handleAction({ gw, event, link });
	if (event.command === 'start' || event.command === 'link') return cmdLink({ gw, event, link });
	if (event.command === 'help') return gw.sendText(event.chatId, link ? helpText() : `${helpText()}\n\nThis chat is not paired yet: send /start to get a pairing code.`);

	if (!link) return pairingPrompt(gw, event);

	// A paired group chat still belongs to one person: everyone else is told so,
	// and never reaches the owner's agent or wallet.
	if (String(event.userId) !== String(link.platform_user_id)) {
		return gw.sendText(event.chatId, 'This chat is paired to another person\'s three.ws account. Only they can talk to the agent here.');
	}

	const rl = await limits.gatewayMessage(link.id);
	if (!rl.success) return gw.sendText(event.chatId, 'You are sending messages faster than your agent can answer. Wait a minute and try again.');
	await touchLink(link.id);

	if (event.command) {
		const run = COMMAND_HANDLERS[event.command];
		if (run) return run({ gw, event, link });
		return gw.sendText(event.chatId, `Unknown command /${event.command}. Send /help for the list.`);
	}

	const text = event.voice || event.photo ? await textFromMedia(gw, event) : String(event.text || '').trim();
	if (!text) return;
	return converse({ gw, event, link, text });
}
