/**
 * Single-user stand-in for the Live Share session, used when the stage opens
 * outside a Teams meeting. Same surface as StageSession, so the stage runs the
 * same code path; there is no network and nobody to follow. Pins persist in
 * this browser so a solo review survives a reload and can still be exported.
 */

import { isPin } from './stage-model.js';

const PIN_KEY = 'twx_review_pins_v1';

export class SoloSession {
	#handlers = new Map();
	#pins = new Map();

	constructor({ userId, profile }) {
		this.userId = userId;
		this.profile = { ...profile, pointer: null, modelKey: '' };
		this.modelState = null;
		this.animState = null;
		this.followState = null;
		try {
			const saved = JSON.parse(localStorage.getItem(PIN_KEY) || '[]');
			for (const p of saved) if (isPin(p)) this.#pins.set(p.id, p);
		} catch {
			// Storage blocked: pins live for this visit only.
		}
	}

	get shared() {
		return false;
	}

	on(event, fn) {
		if (!this.#handlers.has(event)) this.#handlers.set(event, new Set());
		this.#handlers.get(event).add(fn);
		return () => this.#handlers.get(event)?.delete(fn);
	}

	emit(event, ...args) {
		for (const fn of this.#handlers.get(event) || []) fn(...args);
	}

	now() {
		return Date.now();
	}

	participants() {
		return [{ userId: this.userId, name: this.profile.name, color: this.profile.color, pointer: null, modelKey: this.profile.modelKey, isLocal: true }];
	}

	async updatePresence(patch) {
		Object.assign(this.profile, patch);
	}

	async updatePose() {}

	async setModel(value) {
		this.modelState = value;
		this.emit('model', value, true);
	}

	async setAnim(value) {
		this.animState = value;
		this.emit('anim', value, true, this.now());
	}

	pinList() {
		return [...this.#pins.values()];
	}

	addPin(pin) {
		this.#pins.set(pin.id, pin);
		this.#persist();
		this.emit('pins');
	}

	removePin(id) {
		this.#pins.delete(id);
		this.#persist();
		this.emit('pins');
	}

	#persist() {
		try {
			localStorage.setItem(PIN_KEY, JSON.stringify(this.pinList().slice(-500)));
		} catch {
			// Storage blocked or full: the in-memory list still exports.
		}
	}

	dispose() {}
}
