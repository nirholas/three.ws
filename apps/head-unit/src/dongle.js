// The one door between this app and the Carlinkit dongle.
//
// Everything above this file (the session state machine, the server, the page)
// talks to the five-call contract below and never to USB. Everything below it
// is node-carplay's own DongleDriver, which speaks the dongle's wire protocol.
// That split is what lets the whole app run, and be tested, with no hardware:
// hand createDongle a WebUSB-shaped object with no device on it and every
// caller sees the honest "no dongle" answer, not a fake video source.
//
// Why not node-carplay's CarplayNode class: its findDevice() loops forever
// while nothing is plugged in and its start() logs and swallows every failure,
// so a caller can never tell "no dongle" from "dongle broken". This adapter
// does the same reset-and-reopen dance it does, with each outcome surfaced.

import {
	DongleDriver,
	DEFAULT_CONFIG,
	AudioCommand,
	AudioData,
	BluetoothAddress,
	PhoneType,
	Plugged,
	SendAudio,
	SendCommand,
	SendTouch,
	SoftwareVersion,
	TouchAction,
	Unplugged,
	VideoData,
	decodeTypeMap,
} from 'node-carplay/node';

/**
 * The USB ids a Carlinkit CPC200 enumerates as. Read from node-carplay's own
 * table so the empty state can never drift from what the driver accepts.
 * @type {ReadonlyArray<{vendorId: number, productId: number}>}
 */
export const DONGLE_IDS = Object.freeze(DongleDriver.knownDevices.map((d) => Object.freeze({ ...d })));

/** `1314:1520` style, the form `lsusb` prints, so the owner can compare by eye. */
export const formatUsbId = ({ vendorId, productId }) =>
	`${vendorId.toString(16).padStart(4, '0')}:${productId.toString(16).padStart(4, '0')}`;

/** Thrown by open() when no CPC200 is on the bus. Not a failure: a state. */
export class DongleAbsentError extends Error {
	constructor(message = 'No CarPlay dongle is connected') {
		super(message);
		this.name = 'DongleAbsentError';
	}
}

// The dongle drops off the bus for one to three seconds after a reset.
const RESET_SETTLE_MS = 3000;
// With no phone after this long, ask the dongle to start wireless pairing.
const PAIR_AFTER_MS = 15000;

const PHONE_NAMES = {
	[PhoneType.CarPlay]: 'carplay',
	[PhoneType.AndroidAuto]: 'androidauto',
	[PhoneType.AndroidMirror]: 'androidmirror',
	[PhoneType.iPhoneMirror]: 'iphonemirror',
	[PhoneType.HiCar]: 'hicar',
};

const KEYS = new Set(['home', 'back', 'left', 'right', 'selectDown', 'selectUp', 'play', 'pause', 'next', 'prev', 'siri', 'frame']);

/** Key names a client may send, for the server's input validation. */
export const ALLOWED_KEYS = Object.freeze([...KEYS]);

const TOUCH_ACTIONS = { down: TouchAction.Down, move: TouchAction.Move, up: TouchAction.Up };

/**
 * @param {object} opts
 * @param {{ requestDevice(o: {filters: object[]}): Promise<any> }} opts.webusb
 *   node-usb's `webusb` in production; anything with the same shape in tests.
 * @param {object} [opts.config] node-carplay dongle config overrides (width, height, fps, dpi, nightMode, hand).
 * @param {() => {start(): void, stop(): void, on(e: string, cb: Function): void}} [opts.createMicrophone]
 *   Built on the first Siri or phone call, never at boot, so a box with no
 *   capture device still runs everything else.
 * @param {(ms: number) => Promise<void>} [opts.sleep]
 * @param {typeof DongleDriver} [opts.Driver]
 */
export function createDongle({
	webusb,
	config = {},
	createMicrophone = null,
	sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
	Driver = DongleDriver,
	resetSettleMs = RESET_SETTLE_MS,
	pairAfterMs = PAIR_AFTER_MS,
}) {
	const settings = { ...DEFAULT_CONFIG, ...config };
	const handlers = { video: new Set(), audio: new Set(), phone: new Set(), failure: new Set(), info: new Set() };
	const emit = (kind, value) => {
		for (const fn of handlers[kind]) fn(value);
	};
	const subscribe = (kind) => (fn) => {
		handlers[kind].add(fn);
		return () => handlers[kind].delete(fn);
	};

	let driver = null;
	let mic = null;
	let pairTimer = null;
	let frameTimer = null;

	const clearTimers = () => {
		if (pairTimer) clearTimeout(pairTimer);
		if (frameTimer) clearInterval(frameTimer);
		pairTimer = frameTimer = null;
	};

	async function find() {
		try {
			return await webusb.requestDevice({ filters: DONGLE_IDS.map((d) => ({ ...d })) });
		} catch {
			// requestDevice rejects when nothing matches: that is the absent case.
			return null;
		}
	}

	function microphone() {
		if (!mic && createMicrophone) {
			mic = createMicrophone();
			mic.on('data', (chunk) => driver?.send(new SendAudio(chunk)));
		}
		return mic;
	}

	function onMessage(message) {
		if (message instanceof SoftwareVersion) {
			emit('info', { firmware: message.version.replace(/\0+$/, '').trim() });
		} else if (message instanceof BluetoothAddress) {
			emit('info', { bluetoothAddress: message.address.replace(/\0+$/, '').trim() });
		} else if (message instanceof Plugged) {
			clearTimers();
			const interval = settings.phoneConfig?.[message.phoneType]?.frameInterval;
			if (interval) frameTimer = setInterval(() => driver?.send(new SendCommand('frame')), interval);
			emit('phone', { type: PHONE_NAMES[message.phoneType] || 'unknown', wireless: message.wifi === 1 });
		} else if (message instanceof Unplugged) {
			if (frameTimer) clearInterval(frameTimer);
			frameTimer = null;
			emit('phone', null);
		} else if (message instanceof VideoData) {
			emit('video', { width: message.width, height: message.height, data: message.data });
		} else if (message instanceof AudioData) {
			routeAudio(message);
		}
	}

	function routeAudio(message) {
		const format = decodeTypeMap[message.decodeType];
		if (message.data && format) {
			emit('audio', {
				kind: 'pcm',
				audioType: message.audioType,
				sampleRate: format.frequency,
				channels: format.channel,
				samples: message.data,
			});
		} else if (message.volumeDuration != null) {
			emit('audio', { kind: 'volume', audioType: message.audioType, volume: message.volume, duration: message.volumeDuration });
		} else if (message.command != null) {
			emit('audio', { kind: 'command', audioType: message.audioType, command: AudioCommand[message.command] || String(message.command) });
			if (message.command === AudioCommand.AudioSiriStart || message.command === AudioCommand.AudioPhonecallStart) microphone()?.start();
			if (message.command === AudioCommand.AudioSiriStop || message.command === AudioCommand.AudioPhonecallStop) mic?.stop();
		}
	}

	/**
	 * Find the dongle, reset it, find it again, claim it and send the session
	 * config. Resolves once the dongle is streaming; a phone may join later.
	 * @throws {DongleAbsentError} nothing on the bus (before or after the reset)
	 */
	async function open() {
		if (driver) return;
		let device = await find();
		if (!device) throw new DongleAbsentError();
		await device.open();
		await device.reset();
		await device.close();
		await sleep(resetSettleMs);
		device = await find();
		if (!device) throw new DongleAbsentError('The dongle did not come back after its reset');
		await device.open();
		const next = new Driver();
		next.on('message', onMessage);
		next.on('failure', () => {
			clearTimers();
			driver = null;
			emit('failure', new Error('The dongle stopped answering on USB'));
		});
		try {
			await next.initialise(device);
			await next.start(settings);
		} catch (err) {
			next.removeAllListeners();
			await next.close().catch(() => {});
			throw err;
		}
		driver = next;
		pairTimer = setTimeout(() => driver?.send(new SendCommand('wifiPair')), pairAfterMs);
	}

	async function close() {
		clearTimers();
		mic?.stop();
		const current = driver;
		driver = null;
		if (current) {
			current.removeAllListeners();
			await current.close();
		}
	}

	/**
	 * Forward a touch on the projected screen. x and y are 0..1 across the
	 * projection, which is what the dongle's protocol expects.
	 * @param {number} x
	 * @param {number} y
	 * @param {'down'|'move'|'up'} action
	 */
	function sendTouch(x, y, action) {
		const code = TOUCH_ACTIONS[action];
		if (!driver || code == null) return false;
		driver.send(new SendTouch(x, y, code));
		return true;
	}

	function sendKey(name) {
		if (!driver || !KEYS.has(name)) return false;
		driver.send(new SendCommand(name));
		return true;
	}

	return {
		ids: DONGLE_IDS,
		config: settings,
		open,
		close,
		sendTouch,
		sendKey,
		get isOpen() {
			return driver != null;
		},
		onVideo: subscribe('video'),
		onAudio: subscribe('audio'),
		onPhone: subscribe('phone'),
		onFailure: subscribe('failure'),
		onInfo: subscribe('info'),
	};
}
