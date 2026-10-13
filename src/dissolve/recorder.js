// Capture the live canvas to a shareable clip. Pure mime negotiation plus a
// thin MediaRecorder wrapper; the browser does all of the encoding.

const MIME_PREFERENCE = [
	'video/webm;codecs=vp9',
	'video/webm;codecs=vp8',
	'video/webm',
	'video/mp4;codecs=avc1',
	'video/mp4',
];

/** First container the browser can actually record, or null. */
export function pickMime(isTypeSupported) {
	for (const mime of MIME_PREFERENCE) {
		if (isTypeSupported(mime)) return mime;
	}
	return null;
}

export function extensionFor(mime) {
	return mime && mime.startsWith('video/mp4') ? 'mp4' : 'webm';
}

export class CanvasRecorder {
	constructor(canvas) {
		this.canvas = canvas;
		this.recorder = null;
		this.chunks = [];
		this.mime = null;
	}

	static isSupported() {
		return typeof MediaRecorder !== 'undefined' && typeof HTMLCanvasElement.prototype.captureStream === 'function' && !!pickMime((m) => MediaRecorder.isTypeSupported(m));
	}

	get recording() {
		return !!this.recorder && this.recorder.state === 'recording';
	}

	start(fps = 60) {
		this.mime = pickMime((m) => MediaRecorder.isTypeSupported(m));
		if (!this.mime) throw new Error('This browser cannot record video from a canvas.');
		this.chunks = [];
		const stream = this.canvas.captureStream(fps);
		this.recorder = new MediaRecorder(stream, { mimeType: this.mime, videoBitsPerSecond: 12_000_000 });
		this.recorder.ondataavailable = (e) => {
			if (e.data && e.data.size > 0) this.chunks.push(e.data);
		};
		this.recorder.start(250);
	}

	/** Resolves with the finished clip as a Blob. */
	stop() {
		return new Promise((resolve, reject) => {
			if (!this.recorder) return reject(new Error('Not recording.'));
			const recorder = this.recorder;
			recorder.onstop = () => {
				for (const track of recorder.stream.getTracks()) track.stop();
				this.recorder = null;
				resolve(new Blob(this.chunks, { type: this.mime }));
			};
			recorder.onerror = (e) => reject(e.error || new Error('Recording failed.'));
			recorder.stop();
		});
	}
}
