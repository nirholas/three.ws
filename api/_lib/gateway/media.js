// Voice notes and photos sent to a chat gateway become text the agent can read.
// Voice runs through the same NVIDIA Riva speech path as POST /api/asr; photos
// run through the same vision chain as POST /api/vision.

import { transcribeNvidiaAsr, nvidiaAsrConfigured } from '../asr-nvidia.js';
import { describeImage, visionConfigured } from '../vision.js';

export const MAX_VOICE_BYTES = 8 * 1024 * 1024;
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

export class MediaError extends Error {
	constructor(code, message) {
		super(message);
		this.code = code;
	}
}

/**
 * Transcribe a chat voice note. Telegram and Discord both deliver Ogg/Opus at
 * 48 kHz, which Riva accepts directly (no transcode).
 * @returns {Promise<string>}
 */
export async function transcribeVoice({ buffer, mimeType = 'audio/ogg', language = 'en-US' }) {
	if (!nvidiaAsrConfigured()) throw new MediaError('asr_unavailable', 'Voice notes are not available right now. Type your message instead.');
	if (!buffer?.length) throw new MediaError('empty_audio', 'That voice note was empty.');
	if (buffer.length > MAX_VOICE_BYTES) throw new MediaError('audio_too_large', 'That voice note is too long. Keep it under about five minutes.');
	const encoding = /ogg|opus/i.test(mimeType) ? 'OGGOPUS' : /flac/i.test(mimeType) ? 'FLAC' : 'OGGOPUS';
	const out = await transcribeNvidiaAsr({ audio: buffer, encoding, sampleRateHz: 48000, language });
	const text = String(out?.text || '').trim();
	if (!text) throw new MediaError('no_speech', 'I could not make out any words in that voice note.');
	return text;
}

/**
 * Describe a photo so the agent can reason about it. The caption, when the
 * owner sent one, is what they asked; the description is what the image shows.
 * @returns {Promise<string>} a message for the agent
 */
export async function describePhoto({ buffer, mimeType = 'image/jpeg', caption = '' }) {
	if (!visionConfigured()) throw new MediaError('vision_unavailable', 'Photos are not available right now. Describe it in text instead.');
	if (!buffer?.length) throw new MediaError('empty_image', 'That photo was empty.');
	if (buffer.length > MAX_IMAGE_BYTES) throw new MediaError('image_too_large', 'That photo is too large. Send one under 8 MB.');
	const prompt = caption
		? `The user sent this image with the message: "${caption.slice(0, 500)}". Describe what the image shows that is relevant to that message. Transcribe any visible text, numbers, token names or addresses exactly.`
		: 'Describe this image in a few sentences. Transcribe any visible text, numbers, token names or addresses exactly.';
	const out = await describeImage({ prompt, imageBase64: buffer.toString('base64'), mimeType, maxTokens: 400 });
	const description = String(out?.text || '').trim();
	return caption
		? `${caption}\n\n[Attached image: ${description}]`
		: `[The user sent an image: ${description}]`;
}
