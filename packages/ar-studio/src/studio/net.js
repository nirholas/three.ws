// Shared rooms: two phones, one scene, live.
//
// Open a room and anyone who loads the same page with `?room=CODE` joins the
// same arrangement: every add, move, resize, rotate and remove syncs to
// everyone in it, with a live count of who is there. It runs on the same
// Colyseus world server that backs the three.ws multiplayer surfaces; point
// `server` at your own deployment to host it yourself.
//
// Optional by design. `colyseus.js` is an optional peer dependency, loaded
// dynamically the first time someone opens a room: if it is not installed, or no
// server is configured, or the socket cannot be reached after one retry, the
// status goes to `unavailable` and the studio simply stays single-player. It
// never loops on a dead endpoint.
//
// Transforms ride in the room's shared logical frame (relEast / relNorth metres,
// yawDeg) so every device agrees on an arrangement while mapping it onto its own
// floor. See ./coords.js.
//
// Ported from the three.ws AR Studio room client (Apache-2.0).

import { createLogger } from '../log.js';

const log = createLogger('ar-studio:net');
const ROOM_NAME = 'studio_world';
const MAX_RETRIES = 1;
/** Generous enough for a scale-to-zero host's cold start, tight enough to fail honestly. */
export const CONNECT_TIMEOUT_MS = 15000;

let _deps = null;

/**
 * Load colyseus.js and the room schema on demand. Resolves null when the
 * optional dependency is absent, which is the "rooms are simply off" path.
 */
async function loadDeps() {
	if (_deps !== null) return _deps;
	try {
		const [colyseus, schemas] = await Promise.all([
			import('colyseus.js'),
			import('./schemas.js'),
		]);
		_deps = { Client: colyseus.Client, getStateCallbacks: colyseus.getStateCallbacks, StudioState: schemas.StudioState };
	} catch (err) {
		log.warn('shared rooms need the optional "colyseus.js" dependency:', err?.message || err);
		_deps = false;
	}
	return _deps;
}

/**
 * Join a room with a hard client-side timeout. Colyseus's own joinOrCreate waits
 * for a JOIN_ROOM handshake with no timeout, so a socket that opens but never
 * completes leaves the promise pending forever: which strands the UI in
 * "Connecting…" with no error to catch and no reconnect to run.
 */
async function joinWithTimeout(client, options, StudioState) {
	let timer;
	const timeout = new Promise((_, reject) => {
		timer = setTimeout(() => reject(new Error('connect_timeout')), CONNECT_TIMEOUT_MS);
	});
	const join = client.joinOrCreate(ROOM_NAME, options, StudioState);
	try {
		return await Promise.race([join, timeout]);
	} finally {
		clearTimeout(timer);
		// A join that resolves after the timeout must not orphan a live socket.
		join.then((room) => {
			try { if (room && room.connection?.isOpen) room.leave(); } catch { /* already gone */ }
		}).catch(() => {});
	}
}

export class StudioNet {
	/**
	 * @param {object} opts
	 * @param {string} opts.roomKey    Shared match key derived from the room code.
	 * @param {string} [opts.clientId] Stable per-browser id: decides model ownership.
	 * @param {string} [opts.name]     Optional display name for presence.
	 * @param {string} opts.url        Colyseus server URL (wss://…).
	 */
	constructor({ roomKey, clientId = '', name = '', url = '' } = {}) {
		this.roomKey = String(roomKey || '').slice(0, 64);
		this.clientId = String(clientId || '').slice(0, 80);
		this.name = String(name || '').slice(0, 120);
		this.url = String(url || '').replace(/\/$/, '');
		this.status = 'idle';
		this.error = '';
		this.room = null;
		this.client = null;
		this._listeners = { status: [], models: [], model: [], presence: [], reject: [] };
		this._retries = 0;
		this._reconnectTimer = null;
		this._connectGen = 0;
		this._destroyed = false;
		this._presenceQueued = false;
		this._modelsQueued = false;
	}

	/** Subscribe: 'status' | 'models' | 'model' | 'presence' | 'reject'. */
	on(event, fn) {
		(this._listeners[event] ||= []).push(fn);
		return this;
	}

	_emit(event, payload) {
		for (const fn of this._listeners[event] || []) {
			try { fn(payload); } catch (e) { log.warn(`${event} listener error:`, e?.message || e); }
		}
	}

	_setStatus(status, error = '') {
		this.status = status;
		this.error = error;
		this._emit('status', { status, error });
	}

	_closeRoom() {
		const room = this.room;
		if (!room) return;
		this.room = null;
		try { room.removeAllListeners(); } catch { /* already torn down */ }
		try { room.leave(); } catch { /* already gone */ }
	}

	async connect() {
		if (this._destroyed) return;
		this._closeRoom();
		if (!this.url || !this.roomKey) { this._setStatus('unavailable'); return; }
		const deps = await loadDeps();
		if (!deps) { this._setStatus('unavailable', 'colyseus.js is not installed'); return; }

		const gen = ++this._connectGen;
		this._setStatus('connecting');
		try {
			this.client = new deps.Client(this.url);
			const room = await joinWithTimeout(this.client, {
				roomKey: this.roomKey,
				clientId: this.clientId,
				name: this.name,
			}, deps.StudioState);
			if (this._destroyed || gen !== this._connectGen) {
				try { room.leave(); } catch { /* already gone */ }
				return;
			}
			this.room = room;
			this._retries = 0;

			const $ = deps.getStateCallbacks(this.room);

			// Any add / per-field change / remove re-emits the full model list so the
			// studio reconciles against it. The join handshake fires onAdd once per
			// existing model, so the burst is coalesced into one emit next tick.
			const $models = $(this.room.state)?.models;
			if ($models) {
				$models.onAdd((model, id) => {
					$(model).onChange(() => this._emit('model', this._modelShape(model, id)));
					this._queueModels();
				});
				$models.onRemove((model, id) => {
					this._emit('model', { id, removed: true });
					this._queueModels();
				});
			}

			const $viewers = $(this.room.state)?.viewers;
			if ($viewers) {
				$viewers.onAdd(() => this._queuePresence());
				$viewers.onRemove(() => this._queuePresence());
			}

			this.room.onMessage('model:reject', (msg) => this._emit('reject', msg));
			this.room.onLeave((code) => {
				if (this._destroyed || code === 1000) return;
				this._setStatus('offline');
				this._scheduleReconnect();
			});
			this.room.onError((code, message) => log.warn('room error', code, message));

			this._setStatus('online');
			this._queueModels();
			this._queuePresence();
		} catch (err) {
			const reason = err?.message || (err?.code != null ? `code ${err.code}` : String(err));
			log.warn('connect failed:', reason);
			this._setStatus('failed', reason);
			this._scheduleReconnect();
		}
	}

	_scheduleReconnect() {
		if (this._reconnectTimer || this._destroyed) return;
		if (this._retries >= MAX_RETRIES) { this._setStatus('unavailable', this.error); return; }
		this._retries++;
		const delay = 2500 + Math.random() * 1500;
		this._reconnectTimer = setTimeout(() => {
			this._reconnectTimer = null;
			if (!this._destroyed) this.connect();
		}, delay);
	}

	_modelShape(m, id) {
		return {
			id: id ?? m.id,
			src: m.src,
			title: m.title,
			relEast: m.relEast,
			relNorth: m.relNorth,
			yawDeg: m.yawDeg,
			scale: m.scale,
			height: m.height,
			ownerId: m.ownerId,
			mine: !!this.clientId && m.ownerId === this.clientId,
		};
	}

	_queueModels() {
		if (this._modelsQueued || this._destroyed) return;
		this._modelsQueued = true;
		Promise.resolve().then(() => {
			this._modelsQueued = false;
			const map = this.room?.state?.models;
			if (this._destroyed || !map) return;
			const models = [];
			map.forEach((m, id) => models.push(this._modelShape(m, id)));
			this._emit('models', models);
		});
	}

	_queuePresence() {
		if (this._presenceQueued || this._destroyed) return;
		this._presenceQueued = true;
		Promise.resolve().then(() => {
			this._presenceQueued = false;
			const map = this.room?.state?.viewers;
			if (this._destroyed || !map) return;
			let count = 0;
			const names = [];
			map.forEach((v) => { count++; if (v.name) names.push(v.name); });
			this._emit('presence', { count, names });
		});
	}

	_live() {
		return this.status === 'online' && this.room && this.room.connection?.isOpen === true;
	}

	/** Add a model to the shared scene. `model` is in the shared logical frame. */
	spawn(model) {
		if (!this._live()) return false;
		try {
			this.room.send('model:spawn', {
				id: model.id,
				src: String(model.src || ''),
				title: String(model.title || '').slice(0, 120),
				relEast: Number(model.relEast) || 0,
				relNorth: Number(model.relNorth) || 0,
				yawDeg: Number(model.yawDeg) || 0,
				scale: Number(model.scale) || 1,
				height: Number(model.height) || 0,
			});
			return true;
		} catch (e) {
			log.warn('spawn failed:', e?.message || e);
			return false;
		}
	}

	/** Move, resize or rotate a model you own. Partial patch. */
	update(id, patch) {
		if (!this._live() || !id) return false;
		const msg = { id: String(id) };
		for (const k of ['relEast', 'relNorth', 'yawDeg', 'scale']) {
			if (Number.isFinite(patch?.[k])) msg[k] = patch[k];
		}
		try { this.room.send('model:update', msg); return true; } catch (e) {
			log.warn('update failed:', e?.message || e);
			return false;
		}
	}

	/** Remove a model you own. */
	remove(id) {
		if (!this._live() || !id) return false;
		try { this.room.send('model:remove', { id: String(id) }); return true; } catch (e) {
			log.warn('remove failed:', e?.message || e);
			return false;
		}
	}

	heartbeat() {
		if (!this._live()) return;
		try { this.room.send('heartbeat', {}); } catch (e) { log.warn('heartbeat failed:', e?.message || e); }
	}

	destroy() {
		this._destroyed = true;
		if (this._reconnectTimer) { clearTimeout(this._reconnectTimer); this._reconnectTimer = null; }
		this._closeRoom();
		this.client = null;
		this._setStatus('destroyed');
	}
}
