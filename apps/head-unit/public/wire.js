// Binary frames from the head unit service to its page, over one WebSocket.
// Shared verbatim by the server (encode) and the page (decode), so the two
// ends cannot drift. JSON text frames carry state and control; these carry
// media, where a JSON envelope would double the size of every video frame.
//
//   video  [0x01][u32 width][u32 height][H.264 Annex B access unit]
//   audio  [0x02][u8 audioType][u8 channels][u8 0][u32 sampleRate][s16le PCM]
//
// All integers little-endian, matching the dongle's own protocol.

export const KIND_VIDEO = 1;
export const KIND_AUDIO = 2;

const VIDEO_HEADER = 9;
const AUDIO_HEADER = 8;

/**
 * @param {{width: number, height: number, data: Uint8Array}} video
 * @returns {Uint8Array}
 */
export function encodeVideo({ width, height, data }) {
	const out = new Uint8Array(VIDEO_HEADER + data.byteLength);
	const view = new DataView(out.buffer);
	view.setUint8(0, KIND_VIDEO);
	view.setUint32(1, width, true);
	view.setUint32(5, height, true);
	out.set(data, VIDEO_HEADER);
	return out;
}

/**
 * @param {{audioType: number, channels: number, sampleRate: number, samples: Int16Array}} audio
 * @returns {Uint8Array}
 */
export function encodeAudio({ audioType, channels, sampleRate, samples }) {
	const pcm = new Uint8Array(samples.buffer, samples.byteOffset, samples.byteLength);
	const out = new Uint8Array(AUDIO_HEADER + pcm.byteLength);
	const view = new DataView(out.buffer);
	view.setUint8(0, KIND_AUDIO);
	view.setUint8(1, audioType);
	view.setUint8(2, channels);
	view.setUint32(4, sampleRate, true);
	out.set(pcm, AUDIO_HEADER);
	return out;
}

/**
 * @param {ArrayBuffer|Uint8Array} frame
 * @returns {null | {kind: 'video', width: number, height: number, data: Uint8Array}
 *               | {kind: 'audio', audioType: number, channels: number, sampleRate: number, samples: Int16Array}}
 */
export function decodeFrame(frame) {
	const bytes = frame instanceof Uint8Array ? frame : new Uint8Array(frame);
	if (bytes.byteLength < 1) return null;
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const kind = view.getUint8(0);
	if (kind === KIND_VIDEO && bytes.byteLength >= VIDEO_HEADER) {
		return {
			kind: 'video',
			width: view.getUint32(1, true),
			height: view.getUint32(5, true),
			data: bytes.subarray(VIDEO_HEADER),
		};
	}
	if (kind === KIND_AUDIO && bytes.byteLength >= AUDIO_HEADER) {
		const pcm = bytes.slice(AUDIO_HEADER);
		const usable = pcm.byteLength - (pcm.byteLength % 2);
		return {
			kind: 'audio',
			audioType: view.getUint8(1),
			channels: view.getUint8(2) || 1,
			sampleRate: view.getUint32(4, true),
			samples: new Int16Array(pcm.buffer, 0, usable / 2),
		};
	}
	return null;
}
