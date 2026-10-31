// Presenter PA: the pure pieces (resampling, framing, playout scheduling, role
// labels), kept free of DOM and WebCodecs so they are unit-testable. The browser
// side lives in world-pa.js and the server relay in multiplayer/src/world-pa.js.

export const PA_SAMPLE_RATE = 48000;   // Opus runs at 48 kHz; every mic is resampled to it
export const PA_FRAME_SAMPLES = 960;   // 20 ms Opus frames
export const PA_FRAME_US = 20000;
export const PA_BITRATE = 32000;       // speech-clear mono, ~4 KB/s per listener
export const PA_BATCH_FRAMES = 5;      // ~100 ms per network message
export const PA_JITTER_S = 0.25;       // listener buffer: absorbs network jitter without feeling delayed
export const PA_MAX_LAG_S = 1.2;       // past this, drop audio to catch back up to live
export const PA_STALE_MS = 10000;      // no packets for this long: the stream is gone (a lost stop)

// Streaming linear resampler. Carries its fractional position and the previous
// block's last sample across calls, so consecutive blocks join without a click.
// Linear interpolation is plenty for speech headed into a 32 kbps codec.
export class LinearResampler {
	constructor(fromRate, toRate = PA_SAMPLE_RATE) {
		this.ratio = fromRate / toRate;
		this.pos = 0;      // read position into [prev, ...block], in input samples
		this.prev = 0;
		this.passthrough = fromRate === toRate;
	}
	push(block) {
		if (this.passthrough) return block;
		const n = block.length;
		if (!n) return new Float32Array(0);
		const out = [];
		// Index -1 is the previous block's last sample, so pos starts in [0, 1).
		let pos = this.pos;
		while (pos < n) {
			const i = Math.floor(pos);
			const frac = pos - i;
			const a = i - 1 < 0 ? this.prev : block[i - 1];
			const b = block[i];
			out.push(a + (b - a) * frac);
			pos += this.ratio;
		}
		this.pos = pos - n;
		this.prev = block[n - 1];
		return Float32Array.from(out);
	}
}

// Cuts an arbitrary stream of sample blocks into exact fixed-size frames.
export class FrameAccumulator {
	constructor(size = PA_FRAME_SAMPLES) {
		this.size = size;
		this.buf = new Float32Array(size);
		this.fill = 0;
	}
	push(block) {
		const frames = [];
		let off = 0;
		while (off < block.length) {
			const take = Math.min(this.size - this.fill, block.length - off);
			this.buf.set(block.subarray(off, off + take), this.fill);
			this.fill += take;
			off += take;
			if (this.fill === this.size) {
				frames.push(this.buf);
				this.buf = new Float32Array(this.size);
				this.fill = 0;
			}
		}
		return frames;
	}
}

// Where the next decoded buffer starts on the listener's AudioContext clock.
// Buffers play back to back; when the stream starves (first packet, or a network
// stall) the playhead restarts one jitter-buffer ahead of now, and when it has
// drifted too far ahead of live the buffer is dropped (returns -1) so latency
// drains back down instead of growing for the rest of the keynote.
export class PlayoutClock {
	constructor({ jitter = PA_JITTER_S, maxLag = PA_MAX_LAG_S } = {}) {
		this.jitter = jitter;
		this.maxLag = maxLag;
		this.playhead = 0;
	}
	schedule(now, duration) {
		if (this.playhead < now + 0.02) this.playhead = now + this.jitter;
		if (this.playhead - now > this.maxLag) return -1;
		const at = this.playhead;
		this.playhead += duration;
		return at;
	}
	reset() {
		this.playhead = 0;
	}
}

export function speakerLabel(role) {
	if (role === 'creator') return 'Coin creator';
	if (role === 'guest-host') return 'Guest host';
	return 'Host';
}

// What this browser can do. Listening needs WebCodecs' AudioDecoder (Chrome,
// Edge, Firefox 130+, Safari 26+); speaking also needs AudioEncoder and a mic.
export function paSupport(g = globalThis) {
	const audio = !!(g.AudioContext || g.webkitAudioContext);
	return {
		listen: audio && typeof g.AudioDecoder === 'function' && typeof g.EncodedAudioChunk === 'function',
		speak: audio && typeof g.AudioEncoder === 'function' && typeof g.AudioData === 'function'
			&& !!g.navigator?.mediaDevices?.getUserMedia,
		captions: !!(g.SpeechRecognition || g.webkitSpeechRecognition),
	};
}

export function formatElapsed(ms) {
	const s = Math.max(0, Math.floor(ms / 1000));
	const m = Math.floor(s / 60);
	return `${m}:${String(s % 60).padStart(2, '0')}`;
}

// Human copy for every way going live can fail, so the panel never shows a code.
export function paErrorText(reason, speaker = '') {
	switch (reason) {
		case 'not-host':
			return 'Only the coin creator or an event host can use the PA. Guest hosts: paste the host key you were given.';
		case 'busy':
			return `${speaker || 'Another host'} is on the mic right now. Take over only if you are running this segment.`;
		case 'taken':
			return 'Another host took over the mic. Your broadcast has ended.';
		case 'permission-denied':
			return 'Microphone access was blocked. Allow the mic for three.ws in your browser, then try again.';
		case 'no-mic':
			return 'No microphone was found. Plug one in, then try again.';
		case 'unsupported':
			return 'Broadcasting needs a browser with WebCodecs audio (Chrome, Edge or Firefox on desktop).';
		case 'offline':
			return 'Not connected to the world yet. Wait for the connection, then try again.';
		case 'timeout':
			return 'The world server did not answer. Check your connection and try again.';
		case 'dropped':
			return 'The connection dropped, so the broadcast ended. Go live again once you are reconnected.';
		case 'encoder':
			return 'The audio encoder stopped. Go live again; if it repeats, reload the page.';
		default:
			return 'Could not start the broadcast. Try again.';
	}
}
