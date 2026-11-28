// A small job queue: runs at most `concurrency` generations at once, tracks each
// record's phase, and can be stopped. It knows nothing about Airtable or Forge; the
// caller's `runJob(item, { signal, onStatus })` does the work and resolves when the
// record has been saved.

import { AbortedError } from './forge-client.js';

export const PHASES = {
	queued: 'Queued',
	submitting: 'Sending',
	waiting: 'In line',
	throttled: 'three.ws is busy, retrying',
	running: 'Generating',
	saving: 'Saving to record',
	done: 'Done',
	failed: 'Failed',
	stopped: 'Stopped',
};

/** Forge job statuses mapped onto the phases shown in the list. */
export function phaseForForgeStatus(status) {
	if (status === 'rate_limited') return 'throttled';
	if (status === 'queued' || status === 'pending' || status === 'waiting' || status === 'in_line') return 'waiting';
	return 'running';
}

export const ACTIVE_PHASES = new Set(['queued', 'submitting', 'waiting', 'throttled', 'running', 'saving']);

export class ForgeQueue {
	constructor({ runJob, concurrency = 2 }) {
		this.runJob = runJob;
		this.concurrency = concurrency;
		this.items = new Map();
		this.pending = [];
		this.running = 0;
		this.controller = new AbortController();
		this.listeners = new Set();
	}

	subscribe(listener) {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	snapshot() {
		return new Map(this.items);
	}

	emit() {
		const snap = this.snapshot();
		for (const listener of this.listeners) listener(snap);
	}

	set(id, patch) {
		this.items.set(id, { ...(this.items.get(id) || {}), ...patch });
		this.emit();
	}

	isActive(id) {
		return ACTIVE_PHASES.has(this.items.get(id)?.phase);
	}

	get activeCount() {
		let n = 0;
		for (const item of this.items.values()) if (ACTIVE_PHASES.has(item.phase)) n++;
		return n;
	}

	/** Queue records ({ id, prompt }). Ones already in flight are skipped. */
	enqueue(entries) {
		if (this.controller.signal.aborted) this.controller = new AbortController();
		for (const entry of entries) {
			if (this.isActive(entry.id)) continue;
			this.items.set(entry.id, { phase: 'queued', prompt: entry.prompt, error: null, result: null, elapsedMs: 0 });
			this.pending.push(entry);
		}
		this.emit();
		this.pump();
	}

	pump() {
		while (this.running < this.concurrency && this.pending.length) {
			const entry = this.pending.shift();
			this.running++;
			this.execute(entry, this.controller.signal).finally(() => {
				this.running--;
				this.pump();
			});
		}
	}

	async execute(entry, signal) {
		this.set(entry.id, { phase: 'submitting' });
		try {
			const result = await this.runJob(entry, {
				signal,
				onStatus: (status, elapsedMs, retryInMs, line = null) =>
					this.set(entry.id, { phase: phaseForForgeStatus(status), elapsedMs, position: line?.position ?? null }),
				onSaving: () => this.set(entry.id, { phase: 'saving' }),
			});
			this.set(entry.id, { phase: 'done', result });
		} catch (error) {
			if (error instanceof AbortedError || signal.aborted) {
				this.set(entry.id, { phase: 'stopped', error: null });
			} else {
				this.set(entry.id, { phase: 'failed', error });
			}
		}
	}

	/** Stop everything: queued records go back to idle, running ones stop polling. */
	stop() {
		for (const entry of this.pending) this.items.delete(entry.id);
		this.pending = [];
		this.controller.abort();
		this.emit();
	}
}
