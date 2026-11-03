// A WebUSB bus and device at the USB boundary only. Everything above it, the
// real node-carplay DongleDriver included, runs unmodified. The device shape
// mirrors node-carplay's own test double (src/modules/__tests__/mocks/usbMocks.ts):
// one interface, one bulk IN and one bulk OUT endpoint on endpoint 1.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const fixture = JSON.parse(
	readFileSync(fileURLToPath(new URL('../fixtures/dongle-session.json', import.meta.url)), 'utf8'),
);

export const frameBytes = (name) => Buffer.from(fixture.frames.find((f) => f.name === name).hex, 'hex');

const endpoint = (direction) => ({ endpointNumber: 1, direction, type: 'bulk', packetSize: 512 });
const usbInterface = { interfaceNumber: 0, claimed: false, alternates: [], alternate: { endpoints: [endpoint('in'), endpoint('out')] } };

/**
 * A CPC200 that answers transferIn from a recorded byte stream. When the
 * stream runs dry, reads wait until unplug(), then fail the way libusb does
 * once a device has left the bus.
 */
export function recordedDongle({ vendorId = 0x1314, productId = 0x1520, stream = Buffer.alloc(0), openError = null } = {}) {
	let cursor = 0;
	let unplugged = false;
	let release;
	const gone = new Promise((r) => (release = r));
	const sent = [];
	const device = {
		vendorId,
		productId,
		opened: false,
		configuration: { configurationValue: 1, interfaces: [usbInterface] },
		resets: 0,
		async open() {
			if (openError) throw openError;
			if (unplugged) throw new Error('LIBUSB_ERROR_NO_DEVICE');
			device.opened = true;
		},
		async close() {
			device.opened = false;
		},
		async reset() {
			device.resets += 1;
		},
		async selectConfiguration() {},
		async claimInterface() {},
		async transferOut(_ep, payload) {
			sent.push(Buffer.from(payload));
			return { status: 'ok', bytesWritten: payload.length };
		},
		async transferIn(_ep, length) {
			if (cursor >= stream.length) {
				await gone;
				throw new Error('LIBUSB_TRANSFER_ERROR');
			}
			const chunk = stream.subarray(cursor, cursor + length);
			cursor += length;
			const copy = new Uint8Array(chunk.length);
			copy.set(chunk);
			return { status: 'ok', data: new DataView(copy.buffer) };
		},
	};
	return {
		device,
		sent,
		unplug() {
			unplugged = true;
			release();
		},
	};
}

/** node-usb's `webusb`, reduced to the one call the adapter makes. */
export function bus() {
	const devices = new Set();
	return {
		plug: (d) => devices.add(d),
		remove: (d) => devices.delete(d),
		async requestDevice({ filters }) {
			for (const d of devices) {
				if (filters.some((f) => f.vendorId === d.vendorId && f.productId === d.productId)) return d;
			}
			// Same error node-usb's webusb throws with nothing on the bus.
			throw new Error("Failed to execute 'requestDevice' on 'USB': No device selected.");
		},
	};
}

/** Timers that record what was scheduled and fire only when told to. */
export function manualTimers() {
	const pending = new Map();
	let id = 0;
	return {
		setTimeout(fn, ms) {
			pending.set(++id, { fn, ms });
			return id;
		},
		clearTimeout(handle) {
			pending.delete(handle);
		},
		delays: () => [...pending.values()].map((t) => t.ms),
		async fireAll() {
			const due = [...pending.values()];
			pending.clear();
			for (const t of due) await t.fn();
		},
	};
}

/** Resolve once `predicate()` holds, polling on the event loop (no wall-clock waits). */
export async function until(predicate, label = 'condition') {
	for (let i = 0; i < 2000; i += 1) {
		if (predicate()) return;
		await new Promise((r) => setImmediate(r));
	}
	throw new Error(`timed out waiting for ${label}`);
}
