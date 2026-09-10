// @vitest-environment jsdom
/**
 * Stopping acoustic sensing while it is still starting.
 *
 * start() is not instant: it awaits the microphone prompt and then measures a
 * carrier against the machine's own speakers, which together run to about a
 * second. A viewer who presses Start and changes their mind lands squarely
 * inside that window, and before this was guarded the late-resolving start()
 * armed a session the user had already stopped: a frame loop over a torn-down
 * context, and on the sensor itself an oscillator and a microphone track that
 * the stop had released. It surfaced as an embed that kept reading gestures
 * after Stop, with the browser's recording indicator still lit.
 *
 * The contract pinned here is simply that stop always wins.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SonarController } from '../src/sonar/controller.js';
import { DopplerSensor } from '../src/sonar/doppler.js';

/** Resolvers for the pending getUserMedia, so a test controls the timing. */
let pendingMic;
const track = { stop: vi.fn() };

function fakeAudioContext() {
	const node = () => ({ connect: vi.fn(), disconnect: vi.fn() });
	return class {
		constructor() {
			this.sampleRate = 48000;
			this.currentTime = 0;
			this.state = 'running';
			this.destination = node();
		}
		resume() {
			return Promise.resolve();
		}
		close() {
			this.state = 'closed';
			return Promise.resolve();
		}
		createAnalyser() {
			return {
				fftSize: 2048,
				frequencyBinCount: 1024,
				smoothingTimeConstant: 0,
				connect: vi.fn(),
				getFloatFrequencyData: (buf) => buf.fill(-100),
			};
		}
		createMediaStreamSource() {
			return node();
		}
		createGain() {
			return {
				gain: { value: 0, linearRampToValueAtTime: vi.fn(), setValueAtTime: vi.fn() },
				connect: vi.fn(),
			};
		}
		createOscillator() {
			return {
				type: 'sine',
				frequency: { value: 0, setValueAtTime: vi.fn() },
				connect: vi.fn(),
				start: vi.fn(),
				stop: vi.fn(),
			};
		}
	};
}

beforeEach(() => {
	track.stop.mockClear();
	window.AudioContext = fakeAudioContext();
	navigator.mediaDevices = {
		getUserMedia: () =>
			new Promise((resolve) => {
				pendingMic = () => resolve({ getTracks: () => [track] });
			}),
	};
});

afterEach(() => {
	delete window.AudioContext;
	delete navigator.mediaDevices;
});

describe('stopping while still starting', () => {
	it('releases the microphone a late start had already opened', async () => {
		// The user-visible symptom: the browser's recording indicator stays lit
		// after Stop, because the stream arrived once nothing was watching for it.
		const c = new SonarController({ autoTone: false });
		const starting = c.start();
		c.stop();
		pendingMic();
		await starting;
		expect(track.stop).toHaveBeenCalled();
	});

	it('arms no frame loop for a session that was already stopped', async () => {
		const raf = vi.spyOn(window, 'requestAnimationFrame');
		const sensor = new DopplerSensor({ autoTone: false });
		const starting = sensor.start();
		sensor.stop();
		const armedBefore = raf.mock.calls.length;
		pendingMic();
		await starting;
		expect(sensor.running).toBe(false);
		expect(raf.mock.calls.length).toBe(armedBefore);
		raf.mockRestore();
	});

	it('leaves the abandoned sensor stopped rather than running unobserved', async () => {
		const sensor = new DopplerSensor({ autoTone: false });
		const starting = sensor.start();
		sensor.stop();
		pendingMic();
		await starting;
		expect(sensor.running).toBe(false);
	});

	it('starts cleanly on a second attempt after an aborted one', async () => {
		const c = new SonarController({ autoTone: false });
		const aborted = c.start();
		c.stop();
		pendingMic();
		await aborted;

		const starting = c.start();
		pendingMic();
		await starting;
		expect(c.running).toBe(true);
		c.stop();
		expect(c.running).toBe(false);
	});
});
