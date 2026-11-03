// Forge-in-world session state: the rendering-free half of the placement-first
// flow in coincommunities.js (_forgeProp).
//
// ForgeSession   the one generation in flight (prompt, reference photo, where
//                the player put its hologram), plus this session's history of
//                results so a previous model can be re-armed without forging it
//                again, and the observed durations the Forge form quotes.
// PendingSpawns  model placements sent to the room and not yet confirmed. The
//                room echoes the spawn id on obj:reject, so a placement refused
//                for its asset (off-list or over the size ceiling) can roll back
//                the palette entry it was armed from instead of leaving a phantom.
//
// No DOM, no three.js: everything here is unit-tested in tests/forge-session.test.js.

/** obj:reject reasons that mean the model itself can never be placed here. */
export const ASSET_REJECT_REASONS = Object.freeze(['asset_url', 'asset_size']);

const HISTORY_MAX = 6;

export class ForgeSession {
	/**
	 * @param {{now?: () => number, historyMax?: number}} [opts]
	 */
	constructor({ now = () => Date.now(), historyMax = HISTORY_MAX } = {}) {
		this._now = now;
		this._historyMax = historyMax;
		this._seq = 0;
		/** @type {null | {id:number, prompt:string, file:any, name:string, startedAt:number, pose:object|null, state:'generating'|'failed'|'done'}} */
		this.job = null;
		/** Newest first. */
		this.history = [];
	}

	/** A generation is running right now (a failed or finished job is not busy). */
	get busy() { return this.job?.state === 'generating'; }

	/** Start a generation. Throws while another is running: one forge at a time. */
	begin({ prompt = '', file = null, name = '' } = {}) {
		if (this.busy) throw new Error('A forge is already running.');
		this.job = {
			id: ++this._seq,
			prompt: String(prompt || ''),
			file: file || null,
			name: name || String(prompt || '').slice(0, 24) || 'Forged item',
			startedAt: this._now(),
			pose: this.job?.state === 'failed' ? this.job.pose : null,
			state: 'generating',
		};
		return this.job;
	}

	/** Remember where the player put the hologram for the current job. */
	setPose(pose) {
		if (!this.job) return;
		this.job.pose = pose ? { x: pose.x, y: pose.y, z: pose.z, yaw: pose.yaw || 0, scale: pose.scale || 1 } : null;
	}

	/** The job finished: record it in history and return the entry. */
	succeed({ url, propId, triangles = null, bytes = null, simplified = false }) {
		const job = this.job;
		if (!job) return null;
		job.state = 'done';
		return this._record({
			ok: true, url, propId, triangles, bytes, simplified,
			seconds: Math.round((this._now() - job.startedAt) / 1000),
		});
	}

	/** The job failed: record it and keep the request so it can be retried. */
	fail(message) {
		const job = this.job;
		if (!job) return null;
		job.state = 'failed';
		return this._record({ ok: false, message: String(message || 'The forge could not build that.') });
	}

	/** What a retry of the current (failed) job submits, and where it lands. */
	retryRequest() {
		if (!this.job) return null;
		return { prompt: this.job.prompt, file: this.job.file, pose: this.job.pose };
	}

	/** Drop the current job (dismissed, or its result handed off). */
	clear() { this.job = null; }

	/** Median duration of this session's completed forges (failures excluded). */
	observed() {
		const secs = this.history.filter((e) => e.ok && Number.isFinite(e.seconds)).map((e) => e.seconds).sort((a, b) => a - b);
		if (!secs.length) return { count: 0, medianSeconds: null };
		const mid = Math.floor(secs.length / 2);
		const median = secs.length % 2 ? secs[mid] : Math.round((secs[mid - 1] + secs[mid]) / 2);
		return { count: secs.length, medianSeconds: median };
	}

	_record(fields) {
		const job = this.job;
		const entry = { id: `fh${job.id}`, name: job.name, prompt: job.prompt, file: job.file, at: this._now(), ...fields };
		this.history.unshift(entry);
		if (this.history.length > this._historyMax) this.history.length = this._historyMax;
		return entry;
	}
}

export class PendingSpawns {
	constructor() {
		this._seq = 0;
		this._map = new Map();
	}

	/**
	 * Remember a model placement and return the spawn id to send with it
	 * (matches the room's OBJ_ID_RE: letters, digits, _ and -, at most 48).
	 */
	track({ propId, url }) {
		const id = `mp_${Date.now().toString(36)}_${(++this._seq).toString(36)}`;
		this._map.set(id, { propId, url });
		// A placement the room never answers (it dropped the socket) must not
		// pin memory forever; keep only the most recent few dozen.
		if (this._map.size > 64) this._map.delete(this._map.keys().next().value);
		return id;
	}

	/** The room accepted it. Returns the tracked entry, or null. */
	confirm(id) {
		const entry = this._map.get(id);
		if (!entry) return null;
		this._map.delete(id);
		return entry;
	}

	/**
	 * The room refused it. Returns `{propId, url, rollback, reason}` (rollback is
	 * true when the model itself was refused), or null for an untracked id.
	 */
	reject(id, reason) {
		const entry = this._map.get(id);
		if (!entry) return null;
		this._map.delete(id);
		return { propId: entry.propId, url: entry.url, rollback: ASSET_REJECT_REASONS.includes(reason), reason };
	}

	/** Is this spawn id one of ours that is still waiting on the room? */
	has(id) { return this._map.has(id); }
}
