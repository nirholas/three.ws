// "Create a 3D model" jobs started from a Teams or Copilot chat.
//
// One record per job lives in the shared cache under `teams-forge:<key>`. The
// key is derived from the Teams activity that asked (conversation id and
// activity id), so Teams' own retries of a slow submit land on the same record
// and the same generation, and it doubles as the forge idempotency key.
//
//   claimJob          create the record once per key (SET NX)
//   runTeamsForge     drive the job to the end: the same forge_free handler the
//                     MCP studio tool runs (api/_mcp-studio/tools.js), then real
//                     polling of its job until it settles; on settle, replace
//                     the posted message for the whole chat (updateActivity)
//   refreshStatus     one status probe for a card refresh (`adaptiveCard/action`)
//   dispatchRun       start runTeamsForge in its own request, so the work keeps
//                     a full CPU on Cloud Run instead of running throttled after
//                     the invoke's response has been sent
//
// The record never holds a percentage: the cards show the forge's phase,
// elapsed time and remaining estimate (api/_lib/teams-forge-cards.js).

import { cacheDel, cacheGetFresh, cacheSet, cacheSetIfAbsent } from './cache.js';
import { sha256Hex } from './idempotency.js';
import { TOOLS, collectJob } from '../_mcp-studio/tools.js';
import { jobFields } from '../_mcp-studio/jobs.js';
import { coldStartState } from '../../src/shared/forge-frames.js';
import * as connector from './teams-connector.js';
import { cardAttachment, forgeErrorCard, forgeFinishedCard, forgeProgressCard } from './teams-forge-cards.js';

export const RECORD_TTL_S = 3 * 24 * 3600;
// forge_free waits inline for the model up to this long, then hands back a job
// handle that the poll loop below keeps collecting.
export const INLINE_WAIT_MS = 150_000;
export const POLL_INTERVAL_MS = 6_000;
// Cloud Run ends a request at 900s; the run settles or yields before that.
export const RUN_BUDGET_MS = 13 * 60_000;
// A record still without a job handle this long after it was created never
// reached the generator (its run died before the submit), so it fails honestly.
export const STARTING_STALE_MS = 6 * 60_000;
// A card refresh is an invoke the client waits on; a status probe that takes
// longer answers with the last known state rather than stall the card.
export const REFRESH_PROBE_MS = 3_500;
const PROGRESS_WRITE_MS = 4_000;
const RUN_PATH = '/api/microsoft-teams/forge-run';
const DISPATCH_HEADER_MS = 4_000;

const recordKey = (key) => `teams-forge:${key}`;
const runLockKey = (key) => `teams-forge:run:${key}`;
const broadcastKey = (key) => `teams-forge:bcast:${key}`;

const KEY_RE = /^teams-[0-9a-f]{40}$/;

/** True the first time `tag` is claimed for `key` (within the record's lifetime). */
export function claimOnce(tag, key) {
	return cacheSetIfAbsent(`teams-forge:${tag}:${key}`, 1, RECORD_TTL_S);
}

/** The job key for one Teams activity. */
export function forgeKey(conversationId, activityId) {
	return `teams-${sha256Hex(`${conversationId || ''}|${activityId || ''}`).slice(0, 40)}`;
}

export function isForgeKey(key) {
	return typeof key === 'string' && KEY_RE.test(key);
}

export function settled(record) {
	return record?.state === 'done' || record?.state === 'failed';
}

const defaultDeps = {
	now: () => Date.now(),
	sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
	forge: (args, ctx, origin) => TOOLS.forge_free.handler(args, null, reqFor(origin), ctx),
	collect: (origin, jobId, shape) => collectJob(origin, jobId, shape),
	connector,
	dispatch: (key, origin) => dispatchRun(key, origin),
};

/** The dependencies a caller passed, over the real ones. */
export function depsWith(overrides = {}) {
	return { ...defaultDeps, ...overrides };
}

// forge_free resolves its API base from the request (STUDIO_API_BASE when set,
// else the app origin; a loopback host in development), so the run hands it
// the host the job was requested on.
function reqFor(origin) {
	let host = '';
	try {
		host = new URL(origin).host;
	} catch {
		host = '';
	}
	return { headers: { host } };
}

export async function loadJob(key) {
	if (!isForgeKey(key)) return null;
	return (await cacheGetFresh(recordKey(key))) || null;
}

async function storeJob(record) {
	await cacheSet(recordKey(record.key), record, RECORD_TTL_S);
	return record;
}

/**
 * Merge a change into the stored record. A settled record never goes back to
 * running: the run and a card refresh can both see the job finish.
 */
export async function patchJob(key, patch) {
	const current = await loadJob(key);
	if (!current) return null;
	if (settled(current) && !settled(patch)) {
		return patch.activityId || patch.broadcast ? storeJob({ ...current, ...pick(patch, ['activityId', 'broadcast']) }) : current;
	}
	return storeJob({ ...current, ...patch });
}

function pick(obj, keys) {
	return Object.fromEntries(keys.filter((k) => obj[k] !== undefined).map((k) => [k, obj[k]]));
}

/**
 * Create the record for a new job. Resolves to `{ record, created }`; a key
 * that already has a record (a Teams retry) returns that record untouched.
 */
export async function claimJob({ key, prompt, tier, by, conversation, origin, parent = null, seed = null }, { now = Date.now() } = {}) {
	const record = {
		v: 1,
		key,
		prompt,
		tier,
		by: by?.id ? { id: String(by.id), name: String(by.name || '') } : null,
		conversation: conversation?.id ? { id: String(conversation.id), serviceUrl: String(conversation.serviceUrl || '') } : null,
		origin,
		activityId: null,
		parent,
		seed: Number.isInteger(seed) ? seed : null,
		createdAt: now,
		state: 'starting',
		jobId: null,
		status: null,
		result: null,
		error: null,
		settledAt: null,
		broadcast: false,
	};
	if (await cacheSetIfAbsent(recordKey(key), record, RECORD_TTL_S)) return { record, created: true };
	return { record: (await loadJob(key)) || record, created: false };
}

/** The card state from a raw forge status frame. */
export function statusFromFrame(frame = {}) {
	const f = jobFields(frame);
	const cold = coldStartState(frame);
	return {
		phase: f.phase,
		elapsed: f.elapsed_seconds,
		eta: f.eta_seconds,
		cold: Boolean(cold),
		coldBootLeft: cold?.remainingSeconds ?? null,
	};
}

function statusFromPending(sc = {}) {
	return {
		phase: sc.phase || 'running',
		elapsed: sc.elapsed_seconds ?? null,
		eta: sc.eta_seconds ?? null,
		cold: Boolean(sc.coldStart),
		coldBootLeft: sc.coldStartRemainingSeconds ?? null,
	};
}

/**
 * The record change a forge_free or collectJob result implies, or null when it
 * says nothing new (a transient status-check failure: the job keeps running).
 */
export function outcomeOf(result, now = Date.now()) {
	const sc = result?.structuredContent || {};
	const glbUrl = sc.glbUrl || sc.glb_url;
	if (!result?.isError && glbUrl) {
		return {
			state: 'done',
			...(sc.job_id ? { jobId: sc.job_id } : {}),
			result: { glbUrl, viewerUrl: sc.viewerUrl || sc.viewer_url || null, posterUrl: sc.poster_png_url || null },
			error: null,
			settledAt: now,
		};
	}
	if (!result?.isError && sc.status === 'pending' && sc.jobId) {
		const status = statusFromPending(sc);
		return { state: status.phase === 'queued' ? 'queued' : 'running', jobId: sc.jobId, status };
	}
	if (result?.isError) {
		if (sc.retryable) return null;
		const raw = String(result.content?.[0]?.text || '').trim();
		// The remedy is written for an agent ("call check_job ..."); the card has
		// its own Try again button, so only the failure itself is shown.
		const message = (sc.remedy ? raw.replace(sc.remedy, '') : raw).trim() || 'The 3D generator did not return a model for this prompt.';
		return { state: 'failed', error: message, settledAt: now };
	}
	return null;
}

/** The card a record renders as right now. */
export function cardFor(record, { now = Date.now() } = {}) {
	if (record?.state === 'done') return forgeFinishedCard(record, { origin: record.origin });
	if (record?.state === 'failed') return forgeErrorCard(record);
	return forgeProgressCard(record, { now });
}

/**
 * Replace the bot's message with the settled card for everyone in the chat.
 * Runs once per job; a no-op when the message was inserted by the user (the
 * bot can only update activities it posted) or the connector is not set up.
 */
export async function broadcastSettled(record, deps = defaultDeps) {
	if (!settled(record) || record.broadcast || !record.activityId || !record.conversation?.id) return record;
	if (!deps.connector.connectorConfigured()) return record;
	if (!(await cacheSetIfAbsent(broadcastKey(record.key), 1, RECORD_TTL_S))) return record;
	try {
		await deps.connector.updateActivity({
			serviceUrl: record.conversation.serviceUrl,
			conversationId: record.conversation.id,
			activityId: record.activityId,
			activity: { type: 'message', attachments: [cardAttachment(cardFor(record, { now: deps.now() }))] },
		});
	} catch (err) {
		await cacheDel(broadcastKey(record.key)).catch(() => {});
		console.warn(`[teams-forge] update of ${record.key} failed: ${err?.message || err}`);
		return record;
	}
	return (await patchJob(record.key, { broadcast: true })) || { ...record, broadcast: true };
}

/**
 * Run a job to its end. Returns the final record (settled, or still running
 * when the generator outlasts RUN_BUDGET_MS; a later card refresh collects it).
 */
export async function runTeamsForge(key, overrides = {}) {
	const deps = depsWith(overrides);
	let record = await loadJob(key);
	if (!record || settled(record)) return record;
	if (!(await cacheSetIfAbsent(runLockKey(key), deps.now(), Math.ceil(RUN_BUDGET_MS / 1000) + 60))) return record;
	const started = deps.now();
	try {
		let lastWrite = 0;
		let writing = Promise.resolve();
		const onProgress = (frame) => {
			const jobId = frame?.job_id || null;
			const t = deps.now();
			const firstHandle = jobId && !record.jobId;
			if (!firstHandle && t - lastWrite < PROGRESS_WRITE_MS) return;
			lastWrite = t;
			const status = statusFromFrame(frame);
			const patch = { state: status.phase === 'queued' ? 'queued' : 'running', status, ...(jobId ? { jobId } : {}) };
			record = { ...record, ...patch };
			writing = writing.then(() => patchJob(key, patch)).catch(() => {});
		};
		const ctx = {
			caller: `teams:${record.by?.id || record.conversation?.id || key}`,
			deadline: started + INLINE_WAIT_MS,
			onProgress,
			...(record.seed != null ? { seed: record.seed } : {}),
		};
		let result;
		try {
			result = await deps.forge({ prompt: record.prompt, tier: record.tier, idempotency_key: key }, ctx, record.origin);
		} catch (err) {
			result = { isError: true, content: [{ type: 'text', text: `The 3D generator could not be reached: ${err?.message || err}` }] };
		}
		await writing;
		record = (await patchJob(key, outcomeOf(result, deps.now()) || {})) || record;
		const shape = { kind: 'model', what: 'model', prompt: record.prompt };
		while (!settled(record) && record.jobId && deps.now() - started < RUN_BUDGET_MS) {
			await deps.sleep(POLL_INTERVAL_MS);
			const change = outcomeOf(await deps.collect(record.origin, record.jobId, shape), deps.now());
			if (change) record = (await patchJob(key, change)) || record;
			else record = (await loadJob(key)) || record;
		}
		if (!settled(record) && !record.jobId) {
			record = (await patchJob(key, {
				state: 'failed',
				error: 'The 3D generator never accepted the job.',
				settledAt: deps.now(),
			})) || record;
		}
		return await broadcastSettled(record, deps);
	} finally {
		await cacheDel(runLockKey(key)).catch(() => {});
	}
}

function withTimeout(promise, ms) {
	let timer;
	return Promise.race([
		promise,
		new Promise((resolve) => {
			timer = setTimeout(() => resolve(undefined), ms);
		}),
	]).finally(() => clearTimeout(timer));
}

/**
 * One status probe for a card refresh: the stored record, brought up to date
 * from the generator when the job is still running. Null for an unknown key.
 */
export async function refreshStatus(key, overrides = {}) {
	const deps = depsWith(overrides);
	let record = await loadJob(key);
	if (!record) return null;
	if (!settled(record)) {
		if (record.jobId) {
			const shape = { kind: 'model', what: 'model', prompt: record.prompt };
			const result = await withTimeout(deps.collect(record.origin, record.jobId, shape).catch(() => undefined), REFRESH_PROBE_MS);
			const change = result ? outcomeOf(result, deps.now()) : null;
			if (change) record = (await patchJob(key, change)) || { ...record, ...change };
		} else if (deps.now() - record.createdAt > STARTING_STALE_MS) {
			record = (await patchJob(key, {
				state: 'failed',
				error: 'The job never reached the 3D generator.',
				settledAt: deps.now(),
			})) || record;
		}
	}
	return broadcastSettled(record, deps);
}

/**
 * Start runTeamsForge for `key` in its own request to this service. Resolves
 * once the run endpoint has accepted it (its 202 headers), never waiting for
 * the generation; the run's connection stays open until the job settles. With
 * no CRON_SECRET to authenticate that request (a bare dev box) the run starts
 * in this process instead.
 */
export async function dispatchRun(key, origin, { fetchImpl = fetch, env = process.env } = {}) {
	const secret = String(env.CRON_SECRET || '').trim();
	const local = () => {
		runTeamsForge(key).catch((err) => console.error(`[teams-forge] run ${key} failed: ${err?.message || err}`));
		return 'local';
	};
	if (!secret || !origin) return local();
	const ac = new AbortController();
	const timer = setTimeout(() => ac.abort(), DISPATCH_HEADER_MS);
	try {
		const res = await fetchImpl(`${origin}${RUN_PATH}`, {
			method: 'POST',
			headers: { authorization: `Bearer ${secret}`, 'content-type': 'application/json' },
			body: JSON.stringify({ key }),
			signal: ac.signal,
		});
		clearTimeout(timer);
		if (res.status !== 202) {
			await res.text().catch(() => '');
			console.warn(`[teams-forge] run endpoint answered ${res.status} for ${key}; running in process`);
			return local();
		}
		// Drain the open response in the background so the run's connection stays
		// up for its whole life; cancelling it would end the run's request.
		res.text().catch(() => {});
		return 'remote';
	} catch (err) {
		clearTimeout(timer);
		console.warn(`[teams-forge] run endpoint unreachable for ${key} (${err?.message || err}); running in process`);
		return local();
	}
}
