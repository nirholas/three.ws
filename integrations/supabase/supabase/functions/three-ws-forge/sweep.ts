// One sweep over the three_ws_models table: claim the rows that are due,
// advance each one step (submit, poll, or copy the finished GLB into Storage),
// and repeat until nothing is due or the time budget runs out.
//
// The database is reached only through the Store interface. The Edge Function
// backs it with supabase-js; the tests back it with the same SQL migration on
// a local Postgres. The state machine itself lives here, once.

import {
	type ForgeConfig,
	type ForgeOutcome,
	GlbDownloadError,
	type Tier,
	downloadGlb,
	pollModel,
	submitModel,
} from './forge.ts';

export type ModelStatus = 'queued' | 'submitting' | 'generating' | 'storing' | 'done' | 'failed';

export interface ModelRow {
	id: string;
	user_id: string | null;
	prompt: string;
	tier: Tier;
	status: ModelStatus;
	forge_job_id: string | null;
	source_glb_url: string | null;
	attempts: number;
	created_at: string;
	submitted_at: string | null;
}

export interface ModelPatch {
	status?: ModelStatus;
	forge_job_id?: string | null;
	backend?: string | null;
	source_glb_url?: string | null;
	storage_path?: string | null;
	preview_image_url?: string | null;
	error_code?: string | null;
	error?: string | null;
	attempts?: number;
	next_attempt_at?: string;
	lease_until?: string | null;
	submitted_at?: string | null;
	completed_at?: string | null;
}

export interface Store {
	claim(maxRows: number, leaseSeconds: number): Promise<ModelRow[]>;
	nextDueSeconds(): Promise<number | null>;
	update(id: string, patch: ModelPatch): Promise<void>;
	upload(path: string, bytes: Uint8Array): Promise<void>;
}

export interface SweepOptions {
	store: Store;
	forge: ForgeConfig;
	/** Stop claiming new rows after this long. Steps already started finish. */
	budgetMs?: number;
	batch?: number;
	leaseSeconds?: number;
	pollIntervalS?: number;
	/** Transient failures a row may take before it is failed. Quota waits do not count. */
	maxAttempts?: number;
	/** A job three.ws accepted but has not finished this long after is failed as timed out. */
	maxAgeMs?: number;
	now?: () => number;
	sleep?: (ms: number) => Promise<void>;
	log?: (event: Record<string, unknown>) => void;
}

export interface SweepSummary {
	claimed: number;
	submitted: number;
	polled: number;
	stored: number;
	failed: number;
	retried: number;
}

export function storagePathFor(row: Pick<ModelRow, 'id' | 'user_id'>): string {
	return `${row.user_id ?? 'service'}/${row.id}.glb`;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function sweep(options: SweepOptions): Promise<SweepSummary> {
	const {
		store,
		forge,
		budgetMs = 50_000,
		batch = 4,
		leaseSeconds = 240,
		pollIntervalS = 5,
		maxAttempts = 12,
		maxAgeMs = 45 * 60_000,
		now = Date.now,
		sleep = defaultSleep,
		log = () => {},
	} = options;
	const summary: SweepSummary = { claimed: 0, submitted: 0, polled: 0, stored: 0, failed: 0, retried: 0 };
	const at = (seconds: number) => new Date(now() + seconds * 1000).toISOString();

	async function fail(row: ModelRow, code: string, message: string) {
		summary.failed++;
		log({ event: 'failed', id: row.id, code, message });
		await store.update(row.id, {
			status: 'failed',
			error_code: code,
			error: message,
			lease_until: null,
			completed_at: new Date(now()).toISOString(),
		});
	}

	// A quota wait (the account's daily limit) is the expected answer until the
	// limit resets, not a failure, so it does not spend one of the row's attempts.
	async function retry(row: ModelRow, status: ModelStatus, code: string, message: string, afterS: number, quota = false) {
		const attempts = quota ? row.attempts : row.attempts + 1;
		if (!quota && attempts >= maxAttempts) {
			await fail(row, code, `${message} Gave up after ${attempts} attempts.`);
			return;
		}
		summary.retried++;
		log({ event: 'retry', id: row.id, code, after_s: afterS, attempts });
		await store.update(row.id, {
			status,
			attempts,
			error_code: code,
			error: message,
			next_attempt_at: at(afterS),
			lease_until: null,
		});
	}

	async function storeGlb(row: ModelRow, glbUrl: string) {
		let bytes: Uint8Array;
		try {
			bytes = await downloadGlb(forge, glbUrl);
		} catch (err) {
			if (err instanceof GlbDownloadError && !err.retryable) return fail(row, 'invalid_glb', err.message);
			return retry(row, 'storing', 'download_failed', err instanceof Error ? err.message : String(err), 15);
		}
		const path = storagePathFor(row);
		await store.upload(path, bytes);
		summary.stored++;
		log({ event: 'stored', id: row.id, path, bytes: bytes.byteLength });
		await store.update(row.id, {
			status: 'done',
			storage_path: path,
			error_code: null,
			error: null,
			lease_until: null,
			completed_at: new Date(now()).toISOString(),
		});
	}

	async function apply(row: ModelRow, outcome: ForgeOutcome) {
		switch (outcome.kind) {
			case 'done': {
				const ready: ModelRow = { ...row, status: 'storing', source_glb_url: outcome.glbUrl };
				await store.update(row.id, {
					status: 'storing',
					source_glb_url: outcome.glbUrl,
					forge_job_id: outcome.jobId ?? row.forge_job_id,
					backend: outcome.backend ?? null,
					preview_image_url: outcome.previewImageUrl ?? null,
					submitted_at: row.submitted_at ?? new Date(now()).toISOString(),
				});
				return storeGlb(ready, outcome.glbUrl);
			}
			case 'pending':
				return store.update(row.id, {
					status: 'generating',
					forge_job_id: outcome.jobId,
					backend: outcome.backend ?? null,
					submitted_at: row.submitted_at ?? new Date(now()).toISOString(),
					error_code: null,
					error: null,
					next_attempt_at: at(pollIntervalS),
					lease_until: null,
				});
			case 'retry':
				return retry(row, row.forge_job_id ? 'generating' : 'queued', outcome.code, outcome.message, outcome.retryAfterS, outcome.quota);
			case 'fatal':
				return fail(row, outcome.code, outcome.message);
		}
	}

	async function step(row: ModelRow) {
		try {
			if (row.submitted_at && now() - Date.parse(row.submitted_at) > maxAgeMs) {
				return await fail(row, 'timeout', `three.ws had not finished the model ${Math.round(maxAgeMs / 60_000)} minutes after it started.`);
			}
			if (row.status === 'storing' && row.source_glb_url) return await storeGlb(row, row.source_glb_url);
			if (row.forge_job_id) {
				summary.polled++;
				return await apply(row, await pollModel(forge, row.forge_job_id));
			}
			summary.submitted++;
			log({ event: 'submit', id: row.id, tier: row.tier });
			return await apply(row, await submitModel(forge, row));
		} catch (err) {
			// A Storage or database write failed. Release the row so a later
			// sweep picks it up from the state it last reached.
			const message = err instanceof Error ? err.message : String(err);
			log({ event: 'step_error', id: row.id, message });
			await store
				.update(row.id, { error_code: 'sweep_error', error: message, next_attempt_at: at(30), lease_until: null })
				.catch((writeErr) => log({ event: 'release_failed', id: row.id, message: String(writeErr) }));
		}
	}

	const deadline = now() + budgetMs;
	while (now() < deadline) {
		const rows = await store.claim(batch, leaseSeconds);
		if (rows.length === 0) {
			const dueS = await store.nextDueSeconds();
			if (dueS === null) break;
			const waitMs = Math.max(1000, Math.ceil(dueS * 1000));
			if (now() + waitMs >= deadline) break;
			await sleep(waitMs);
			continue;
		}
		summary.claimed += rows.length;
		await Promise.all(rows.map(step));
	}
	return summary;
}
