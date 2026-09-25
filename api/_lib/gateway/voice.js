// Spoken replies for chats with "voice replies" turned on (/voice on in the
// chat, or the toggle on /settings/connections). After the text reply lands,
// the same reply is rendered as a voice note (./audio.js synthesizeReply) and
// sent with the adapter's sendVoice. A channel whose adapter has no sendVoice
// (SMS) never offers the setting. A speech failure never fails the turn: the
// owner already has the text.

import { synthesizeReply, ttsLanes } from './audio.js';

/** Whether any TTS lane can speak right now. */
export function voiceRepliesAvailable() {
	return ttsLanes().length > 0;
}

/**
 * Speak `text` into the chat when the link asked for it and the platform can
 * play audio. Returns what happened, for logs and tests.
 * @returns {Promise<'sent'|'off'|'unsupported'|'empty'|'failed'>}
 */
export async function maybeSpeakReply({ gw, chatId, link, text, agentId = null }) {
	if (!link?.voice_replies) return 'off';
	if (typeof gw.sendVoice !== 'function') return 'unsupported';
	try {
		const clip = await synthesizeReply(text, { agentId: agentId || link.default_agent_id || null });
		if (!clip) return 'empty';
		await gw.sendVoice(chatId, clip);
		return 'sent';
	} catch (e) {
		console.warn('[gateway] spoken reply failed', e?.code || e?.message);
		return 'failed';
	}
}
