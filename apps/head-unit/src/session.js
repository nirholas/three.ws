// The head unit's connection state machine.
//
//   disconnected  no dongle on the bus. Probe again every probeIntervalMs.
//   probing       a dongle is being found, reset, claimed and configured.
//   connected     the dongle is streaming. `phone` says whether a phone joined.
//   error         open failed or the dongle stopped answering. Retry with
//                 exponential backoff, or at once when the owner taps Retry.
//
// The machine owns no USB itself; it drives the dongle contract from
// dongle.js, which is why it can be tested against a recorded session.

import { DongleAbsentError, formatUsbId } from './dongle.js';

/**
 * @param {object} opts
 * @param {ReturnType<import('./dongle.js').createDongle>} opts.dongle
 * @param {number} [opts.probeIntervalMs]
 * @param {number} [opts.retryBaseMs]
 * @param {number} [opts.retryMaxMs]
 * @param {{setTimeout: typeof setTimeout, clearTimeout: typeof clearTimeout}} [opts.timers]
 * @param {() => number} [opts.now]
 */
export function createSession({
	dongle,
	probeIntervalMs = 3000,
	retryBaseMs = 2000,
	retryMaxMs = 30000,
	timers = globalThis,
	now = Date.now,
}) {
	const listeners = new Set();
	let state = 'disconnected';
	let phone = null;
	let error = null;
	let attempts = 0;
	let nextAt = null;
	let timer = null;
	let running = false;
	let pending = Promise.resolve();
	// The dongle can report a phone before open() resolves; keep the last word.
	let lastPhone = null;

	const snapshot = () => ({
		state,
		phone,
		error,
		attempts,
		nextAt,
		usbIds: dongle.ids.map(formatUsbId),
	});

	function set(patch) {
		if ('state' in patch) state = patch.state;
		if ('phone' in patch) phone = patch.phone;
		if ('error' in patch) error = patch.error;
		if ('nextAt' in patch) nextAt = patch.nextAt;
		const snap = snapshot();
		for (const fn of listeners) fn(snap);
	}

	function schedule(ms) {
		if (timer) timers.clearTimeout(timer);
		timer = timers.setTimeout(() => {
			timer = null;
			return probe();
		}, ms);
		return now() + ms;
	}

	const backoff = (n) => Math.min(retryBaseMs * 2 ** Math.max(0, n - 1), retryMaxMs);

	function probe() {
		if (!running || state === 'probing' || state === 'connected') return pending;
		lastPhone = null;
		set({ state: 'probing', nextAt: null });
		pending = dongle.open().then(
			() => {
				attempts = 0;
				if (!running) return dongle.close();
				set({ state: 'connected', error: null, phone: lastPhone });
			},
			(err) => {
				if (!running) return;
				if (err instanceof DongleAbsentError) {
					attempts = 0;
					set({ state: 'disconnected', error: null, phone: null, nextAt: schedule(probeIntervalMs) });
				} else {
					attempts += 1;
					set({ state: 'error', error: describe(err), phone: null, nextAt: schedule(backoff(attempts)) });
				}
			},
		);
		return pending;
	}

	dongle.onPhone((p) => {
		lastPhone = p;
		if (state === 'connected') set({ phone: p });
	});
	dongle.onFailure((err) => {
		if (!running) return;
		lastPhone = null;
		attempts += 1;
		set({ state: 'error', error: describe(err), phone: null, nextAt: schedule(backoff(attempts)) });
	});

	return {
		snapshot,
		onChange(fn) {
			listeners.add(fn);
			return () => listeners.delete(fn);
		},
		/** Begin probing. Resolves when the first probe settles. */
		start() {
			running = true;
			return probe();
		},
		/** Skip the wait: probe now if nothing is connected or in flight. */
		retryNow() {
			if (!running || (state !== 'disconnected' && state !== 'error')) return Promise.resolve(false);
			if (timer) timers.clearTimeout(timer);
			timer = null;
			return probe().then(() => true);
		},
		async stop() {
			running = false;
			if (timer) timers.clearTimeout(timer);
			timer = null;
			await pending;
			await dongle.close();
			set({ state: 'disconnected', phone: null, nextAt: null });
		},
	};
}

// libusb errors read like LIBUSB_ERROR_ACCESS; the common one has a known fix.
function describe(err) {
	const message = String(err?.message || err || 'Unknown dongle error');
	if (/LIBUSB_ERROR_ACCESS/.test(message)) {
		return `${message}. This user cannot open the dongle: install the udev rule from apps/head-unit/deploy and replug it.`;
	}
	if (/LIBUSB_ERROR_BUSY/.test(message)) {
		return `${message}. Another program holds the dongle: stop it and retry.`;
	}
	return message;
}
