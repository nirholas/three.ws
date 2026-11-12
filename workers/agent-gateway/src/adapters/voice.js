// Voice adapter: the phone-call leg of the voice gateway (Twilio).
//
// api/gateway/voice.js answers the call, records what the caller says and
// queues each recording as {kind:'voice_call_turn'} with the turn id the call
// is polling for. This adapter runs that turn: download the recording,
// transcribe it, run the ordinary gateway core against a collecting gateway
// (api/_lib/gateway/voice-calls.js), speak the collected reply with the agent's
// voice, and store the reply text and its MP3 on the turn so the call plays it.
//
// The chat is the caller's E.164 number. Caller ID can be forged, so the
// collecting gateway runs without buttons: any trade preview is cancelled and
// the caller hears why. The browser leg of voice never comes through here; it
// runs synchronously in the receiver with the signed-in session.
//
// Off unless GATEWAY_VOICE_TELEPHONY=1 and the Twilio credentials are set.

import { handleEvent } from '../../../../api/_lib/gateway/core.js';
import { transcribeVoice, MediaError } from '../../../../api/_lib/gateway/media.js';
import { synthesizeReply } from '../../../../api/_lib/gateway/audio.js';
import { getLiveLink } from '../../../../api/_lib/gateway/store.js';
import {
	PLATFORM,
	collectingGateway,
	finishVoiceTurn,
	pruneVoiceTurns,
	speakable,
	telephonyConfigured,
	toMp3,
} from '../../../../api/_lib/gateway/voice-calls.js';
import { PlatformError, isPermanentStatus } from '../errors.js';

export { telephonyConfigured as voiceConfigured };

const RECORDING_ATTEMPTS = 4;
const RECORDING_BACKOFF_MS = 750;
const PRUNE_EVERY_MS = 60 * 60 * 1000;
export const TURN_APOLOGY = 'Sorry, something went wrong on my side. Please try again.';

/**
 * @param {object} [opts]
 * @param {Record<string,string|undefined>} [opts.env]
 * @param {typeof fetch} [opts.fetch]            recording downloads
 * @param {object} [opts.deps]                   the turn's boundaries, injectable for tests
 */
export function createVoiceAdapter({ env = process.env, fetch: fetchImpl = globalThis.fetch, deps = {} } = {}) {
	const d = {
		handleEvent,
		transcribeVoice,
		synthesizeReply,
		getLiveLink,
		finishVoiceTurn,
		pruneVoiceTurns,
		toMp3,
		sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
		...deps,
	};
	const basic = `Basic ${Buffer.from(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`).toString('base64')}`;
	let lastPrune = 0;

	/**
	 * Twilio posts the recording callback before the file is always fetchable,
	 * so a 404 is retried a few times before it counts.
	 */
	async function downloadRecording(recordingUrl) {
		const url = `${recordingUrl}.wav`;
		let last = null;
		for (let i = 0; i < RECORDING_ATTEMPTS; i++) {
			if (i) await d.sleep(RECORDING_BACKOFF_MS * i);
			let r;
			try {
				r = await fetchImpl(url, { headers: { authorization: basic }, signal: AbortSignal.timeout(15_000) });
			} catch (e) {
				last = new PlatformError(PLATFORM, `network: ${e.message}`, { cause: e });
				continue;
			}
			if (r.ok) return { buffer: Buffer.from(await r.arrayBuffer()), mimeType: 'audio/wav' };
			last = new PlatformError(PLATFORM, `recording ${r.status}`, { status: r.status, permanent: r.status !== 404 && isPermanentStatus(r.status) });
			if (last.permanent) break;
		}
		throw last;
	}

	function normalize(payload) {
		if (payload?.kind !== 'voice_call_turn') return null;
		const { turnId, caller, recordingUrl } = payload;
		if (!turnId || !caller || !/^https:\/\/api\.twilio\.com\//.test(String(recordingUrl || ''))) return null;
		return {
			platform: PLATFORM,
			chatId: String(caller),
			chatType: 'phone',
			chatTitle: null,
			userId: String(caller),
			username: null,
			turnId: String(turnId),
			recordingUrl: String(recordingUrl),
		};
	}

	function gateway() {
		return collectingGateway({ buttons: false });
	}

	/** One spoken turn. Never throws: the caller is waiting on the line for an outcome. */
	async function handle(event, gw) {
		if (Date.now() - lastPrune > PRUNE_EVERY_MS) {
			lastPrune = Date.now();
			d.pruneVoiceTurns({ olderThanHours: 24 }).catch((e) => console.warn('[voice] prune failed', e?.message));
		}
		let heard;
		try {
			const audio = await downloadRecording(event.recordingUrl);
			heard = await d.transcribeVoice(audio);
		} catch (e) {
			const text = e instanceof MediaError ? e.message : TURN_APOLOGY;
			if (!(e instanceof MediaError)) console.warn('[voice] recording failed', e?.message);
			await d.finishVoiceTurn({ id: event.turnId, text, failed: !(e instanceof MediaError) });
			return;
		}
		try {
			await d.handleEvent({ ...event, text: heard }, gw);
		} catch (e) {
			console.warn('[voice] turn failed', e?.message);
			await d.finishVoiceTurn({ id: event.turnId, text: TURN_APOLOGY, failed: true });
			return;
		}
		const said = speakable(gw.transcript()) || 'I have nothing to add.';
		let clip = null;
		try {
			const link = await d.getLiveLink(PLATFORM, event.chatId);
			const spoken = await d.synthesizeReply(said, { agentId: link?.default_agent_id || null });
			if (spoken) clip = await d.toMp3(spoken.buffer);
		} catch (e) {
			// No clip: the call reads the text with Twilio's own voice instead.
			console.warn('[voice] speech failed, falling back to <Say>', e?.code || e?.message);
		}
		await d.finishVoiceTurn({ id: event.turnId, text: said, clip });
	}

	return {
		platform: PLATFORM,
		normalize,
		gateway,
		handle,
		describe() {
			return { mode: 'twilio', telephony: true };
		},
	};
}
