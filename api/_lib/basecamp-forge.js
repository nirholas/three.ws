// The three.ws chatbot in Basecamp Campfires and Pings.
//
// Someone types `!threews a brass desk lamp` in a Campfire. Basecamp POSTs
// { command, creator, callback_url } to the command URL the admin pasted
// (api/basecamp/command.js), and whatever HTML that request returns is posted
// in the room. A 3D model takes longer than Basecamp waits, so the reply says
// the model is being made, the job runs in its own request, and the finished
// model is posted later through the payload's callback_url.
//
//   parseCommand      what the person asked for: help, or a prompt and tier
//   callbackTarget    the callback_url, accepted only on Basecamp's own hosts
//   claimJob          create the job record once per key (SET NX)
//   runBasecampForge  the same forge_free generation the MCP studio tool and the
//                     Teams bot run, polled until it settles, then delivered
//   dispatchRun       start runBasecampForge in its own request, so the work
//                     keeps a full CPU on Cloud Run after the reply is sent
//
// The generation is owned by the three.ws account that created the command URL
// (api/_lib/basecamp-chatbots.js), so it lands in that account's history.

import { cacheDel, cacheGetFresh, cacheSet, cacheSetIfAbsent } from './cache.js';
import { sha256Hex } from './idempotency.js';
import { TOOLS, collectJob } from '../_mcp-studio/tools.js';
import { platformAuthHeaders } from './creator-account.js';
import { outcomeOf, statusFromFrame } from './teams-forge.js';

export const RECORD_TTL_S = 3 * 24 * 3600;
export const INLINE_WAIT_MS = 150_000;
export const POLL_INTERVAL_MS = 6_000;
// Cloud Run ends a request at 900s; a run yields before that and, while the
// generator is still working, hands the job to a fresh run.
export const RUN_BUDGET_MS = 13 * 60_000;
export const MAX_RUNS = 3;
export const PROMPT_MIN = 3;
export const PROMPT_MAX = 1000;
// Commands repeated inside this window (a Basecamp retry, a double send) map to
// the same job instead of starting a second generation.
export const DEDUPE_WINDOW_MS = 60_000;
const DELIVERY_ATTEMPTS = 3;
const DELIVERY_TIMEOUT_MS = 10_000;
const PROGRESS_WRITE_MS = 4_000;
const RUN_PATH = '/api/basecamp/forge-run';
const DISPATCH_HEADER_MS = 4_000;

const recordKey = (key) => `basecamp-forge:${key}`;
const runLockKey = (key) => `basecamp-forge:run:${key}`;
const deliveredKey = (key) => `basecamp-forge:delivered:${key}`;
const KEY_RE = /^bc-[0-9a-f]{40}$/;
const SGID_RE = /^[A-Za-z0-9+/=_-]{8,1500}--[0-9a-f]{20,128}$/;
const BASECAMP_HOST_RE = /^(?:[a-z0-9-]+\.)*basecamp(?:api)?\.com$/;

export function isJobKey(key) {
	return typeof key === 'string' && KEY_RE.test(key);
}

export function settled(record) {
	return record?.state === 'done' || record?.state === 'failed';
}

export function escapeHtml(value) {
	return String(value ?? '')
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}

function decodeEntities(text) {
	return text
		.replace(/&nbsp;/g, ' ')
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'")
		.replace(/&amp;/g, '&');
}

/**
 * What a chatbot command asks for. The text after `!name` arrives as plain
 * text in a Campfire and can carry markup from a Ping, so tags are dropped
 * and entities decoded before reading it.
 *
 *   ''  'help'  '?'                  -> { kind: 'help' }
 *   'a red chair'                    -> { kind: 'forge', prompt, tier: 'standard' }
 *   '--draft a red chair'            -> tier 'draft' (fastest)
 *   'a red chair --high'             -> tier 'high' (most detail)
 *   'hi'                             -> { kind: 'too_short' }
 */
export function parseCommand(raw) {
	let text = decodeEntities(String(raw ?? '').replace(/<[^>]*>/g, ' '))
		.replace(/\s+/g, ' ')
		.trim();
	// In a Ping the whole message reaches the bot; drop a leading !name.
	text = text.replace(/^![A-Za-z0-9_]+\s*/, '');
	if (!text || /^(?:help|\?|commands|usage)$/i.test(text)) return { kind: 'help' };
	let tier = 'standard';
	text = text
		.replace(/(^|\s)--(draft|high|standard)(?=\s|$)/gi, (_, lead, t) => {
			tier = t.toLowerCase();
			return lead;
		})
		.replace(/\s+/g, ' ')
		.trim();
	if (text.length < PROMPT_MIN) return { kind: 'too_short' };
	return { kind: 'forge', prompt: text.slice(0, PROMPT_MAX), tier };
}

/**
 * The callback URL from a command payload when it is a real Basecamp line URL,
 * else null. Anyone holding a command URL can POST any payload to it, so the
 * bot only ever posts back to Basecamp's own hosts over https.
 */
export function callbackTarget(raw) {
	if (typeof raw !== 'string' || raw.length > 2048) return null;
	let url;
	try {
		url = new URL(raw);
	} catch {
		return null;
	}
	if (url.protocol !== 'https:' || url.username || url.password || url.port) return null;
	if (!BASECAMP_HOST_RE.test(url.hostname.toLowerCase())) return null;
	if (!/\/integrations\/[^/]+\/buckets\/\d+\/chats\/\d+\/lines(?:\.json)?$/.test(url.pathname)) return null;
	const account = /^\/(\d+)\//.exec(url.pathname)?.[1] || null;
	return { url: raw, account };
}

/** The person who sent a command, as far as it is needed for the reply. */
export function creatorOf(creator) {
	if (!creator || typeof creator !== 'object') return null;
	const name = String(creator.name || '').replace(/\s+/g, ' ').trim().slice(0, 120);
	const sgid = typeof creator.attachable_sgid === 'string' && SGID_RE.test(creator.attachable_sgid) ? creator.attachable_sgid : null;
	const id = creator.id != null && /^\d{1,20}$/.test(String(creator.id)) ? String(creator.id) : null;
	return { id, name, sgid };
}

/** The job key for one command: repeats inside DEDUPE_WINDOW_MS share it. */
export function jobKey({ connectionId, callbackUrl, creatorId, prompt, tier }, now = Date.now()) {
	const bucket = Math.floor(now / DEDUPE_WINDOW_MS);
	return `bc-${sha256Hex(`${connectionId}|${callbackUrl}|${creatorId || ''}|${tier}|${prompt}|${bucket}`).slice(0, 40)}`;
}

// ---------------------------------------------------------------------------
// The lines the bot posts. Basecamp rich text: https://github.com/basecamp/bc3-api/blob/master/sections/rich_text.md

const EXAMPLE = 'a low-poly lighthouse with a red roof';

export function helpHtml() {
	return [
		'<strong>three.ws makes 3D models from a sentence.</strong>',
		'<br>Type the chatbot name, then describe one object, character or creature:',
		`<br><code>!threews ${EXAMPLE}</code>`,
		'<br>Add <code>--draft</code> for the fastest result or <code>--high</code> for the most detail.',
		' The finished model is posted here with a 3D viewer link, a phone AR link and a GLB download.',
		' (If your admin named the chatbot something else, use that name instead of threews.)',
	].join('');
}

export function tooShortHtml() {
	return `Describe the model in a few words, for example <code>!threews ${EXAMPLE}</code>. Type <code>!threews help</code> for options.`;
}

export function startedHtml(record) {
	const tierNote = record.tier === 'draft' ? ' (draft quality)' : record.tier === 'high' ? ' (high detail, this one takes longer)' : '';
	return `<strong>Making a 3D model${tierNote}:</strong> ${escapeHtml(record.prompt)}<br>It will be posted here when it is ready, usually within two minutes.`;
}

export function duplicateHtml(record) {
	if (record.state === 'done') return doneHtml(record, { mention: false });
	if (record.state === 'failed') return failedHtml(record, { mention: false });
	return `Already making that one: ${escapeHtml(record.prompt)}. It will be posted here when it is ready.`;
}

function mentionFor(record, mention) {
	if (mention && record.by?.sgid) return `<bc-attachment sgid="${escapeHtml(record.by.sgid)}"></bc-attachment> `;
	return '';
}

export function doneHtml(record, { mention = true } = {}) {
	const r = record.result || {};
	const links = [
		r.viewerUrl ? `<a href="${escapeHtml(r.viewerUrl)}">Open in 3D</a>` : '',
		r.arUrl ? `<a href="${escapeHtml(r.arUrl)}">View in AR on your phone</a>` : '',
		r.glbUrl ? `<a href="${escapeHtml(r.glbUrl)}">Download GLB</a>` : '',
	].filter(Boolean);
	const poster = r.posterUrl && /^https:\/\//.test(r.posterUrl)
		? `<br><a href="${escapeHtml(r.viewerUrl || r.glbUrl)}"><img src="${escapeHtml(r.posterUrl)}" alt="${escapeHtml(record.prompt)}"></a>`
		: '';
	return `${mentionFor(record, mention)}<strong>Your 3D model is ready:</strong> ${escapeHtml(record.prompt)}${poster}<br>${links.join(' | ')}`;
}

export function failedHtml(record, { mention = true } = {}) {
	const reason = String(record.error || 'The 3D generator did not return a model for this prompt.').slice(0, 400);
	return `${mentionFor(record, mention)}<strong>That 3D model did not finish:</strong> ${escapeHtml(record.prompt)}<br>${escapeHtml(reason)}<br>Try again, or describe a single object in plain words.`;
}

export function revokedHtml() {
	return 'This three.ws chatbot URL was revoked by its owner. A Basecamp admin can paste a new command URL from three.ws (Dashboard, Settings, Basecamp chatbot).';
}

export function unknownTokenHtml() {
	return 'This three.ws chatbot URL is not recognized. A Basecamp admin can create a new command URL at three.ws/integrations/basecamp and paste it into the chatbot settings.';
}

export function rateLimitedHtml() {
	return 'This Basecamp is sending three.ws more models than it can make at once. Give it a few minutes, then try again.';
}

export function noCallbackHtml() {
	return 'three.ws could not find where to post the finished model, so nothing was started. Send the command again from a Campfire or a Ping.';
}

// ---------------------------------------------------------------------------
// The job record (shared cache, `basecamp-forge:<key>`).

export async function loadJob(key) {
	if (!isJobKey(key)) return null;
	return (await cacheGetFresh(recordKey(key))) || null;
}

async function storeJob(record) {
	await cacheSet(recordKey(record.key), record, RECORD_TTL_S);
	return record;
}

/**
 * Merge a change into the stored record. A settled record never goes back to
 * running; changes that carry no state (the delivery outcome) still land.
 */
export async function patchJob(key, patch) {
	const current = await loadJob(key);
	if (!current) return null;
	if (settled(current) && patch?.state && !settled(patch)) return current;
	return storeJob({ ...current, ...patch });
}

/**
 * Create the record for a new job. Resolves to `{ record, created }`; a key
 * that already has a record returns that record untouched. `origin` is the
 * base the forge runs against and the links point at; `selfBase` is this
 * service, where a follow-up run is dispatched.
 */
export async function claimJob({ key, prompt, tier, connectionId, userId, by, callbackUrl, origin, selfBase = null }, { now = Date.now() } = {}) {
	const record = {
		v: 1,
		key,
		prompt,
		tier,
		connectionId,
		userId,
		by: by || null,
		callbackUrl,
		origin,
		selfBase: selfBase || origin,
		createdAt: now,
		state: 'starting',
		jobId: null,
		status: null,
		result: null,
		error: null,
		settledAt: null,
		runs: 0,
		delivered: false,
	};
	if (await cacheSetIfAbsent(recordKey(key), record, RECORD_TTL_S)) return { record, created: true };
	return { record: (await loadJob(key)) || record, created: false };
}

/** The record change a forge_free or collectJob result implies, or null. */
export function resultOf(result, now = Date.now()) {
	const change = outcomeOf(result, now);
	if (change?.state === 'done') {
		const sc = result?.structuredContent || {};
		const arUrl = sc.arUrl || sc.ar_url || null;
		change.result = { ...change.result, ...(arUrl ? { arUrl } : {}) };
	}
	return change;
}

// ---------------------------------------------------------------------------
// Delivery: POST the settled line to the command's callback_url.

async function postLine(url, content, fetchImpl) {
	const ac = new AbortController();
	const timer = setTimeout(() => ac.abort(), DELIVERY_TIMEOUT_MS);
	try {
		const res = await fetchImpl(url, {
			method: 'POST',
			headers: { 'content-type': 'application/json', 'user-agent': 'three.ws-basecamp-chatbot (+https://three.ws/integrations/basecamp)' },
			body: JSON.stringify({ content }),
			signal: ac.signal,
		});
		await res.text().catch(() => '');
		return res.status;
	} catch {
		return 0;
	} finally {
		clearTimeout(timer);
	}
}

/**
 * Post a settled job's line in the room it was asked from, once. A 5xx, 429
 * or network failure is retried with backoff; a 4xx on a line that mentions
 * the requester is retried once without the mention (the sgid came from an
 * unsigned payload and may not be valid). Resolves to the final HTTP status.
 */
export async function deliverSettled(record, deps = defaultDeps) {
	if (!settled(record) || record.delivered || !record.callbackUrl) return null;
	if (!(await cacheSetIfAbsent(deliveredKey(record.key), 1, RECORD_TTL_S))) return null;
	const render = (mention) => (record.state === 'done' ? doneHtml(record, { mention }) : failedHtml(record, { mention }));
	let mention = Boolean(record.by?.sgid);
	let status = 0;
	for (let attempt = 0; attempt < DELIVERY_ATTEMPTS; attempt++) {
		status = await postLine(record.callbackUrl, render(mention), deps.fetch);
		if (status >= 200 && status < 300) break;
		if (status >= 400 && status < 500 && status !== 429) {
			if (!mention) break;
			mention = false;
			continue;
		}
		await deps.sleep(1000 * 2 ** attempt);
	}
	const ok = status >= 200 && status < 300;
	if (!ok) console.warn(`[basecamp-forge] delivery of ${record.key} failed with status ${status || 'network error'}`);
	await patchJob(record.key, { delivered: ok, deliveryStatus: status });
	return status;
}

// ---------------------------------------------------------------------------
// The run.

const defaultDeps = {
	now: () => Date.now(),
	sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
	forge: (args, ctx, origin) => TOOLS.forge_free.handler(args, null, reqFor(origin), ctx),
	collect: (origin, jobId, shape) => collectJob(origin, jobId, shape),
	dispatch: (key, origin) => dispatchRun(key, origin),
	fetch: (...a) => fetch(...a),
};

export function depsWith(overrides = {}) {
	return { ...defaultDeps, ...overrides };
}

// forge_free resolves its API base from the request host.
function reqFor(origin) {
	let host = '';
	try {
		host = new URL(origin).host;
	} catch {
		host = '';
	}
	return { headers: { host } };
}

/**
 * Drive a job to its end and post the result in the room. Returns the final
 * record. A generation still running at RUN_BUDGET_MS is handed to a fresh run
 * (up to MAX_RUNS), and one that outlasts every run fails honestly.
 */
export async function runBasecampForge(key, overrides = {}) {
	const deps = depsWith(overrides);
	let record = await loadJob(key);
	if (!record) return null;
	if (settled(record)) {
		await deliverSettled(record, deps);
		return record;
	}
	if (!(await cacheSetIfAbsent(runLockKey(key), deps.now(), Math.ceil(RUN_BUDGET_MS / 1000) + 60))) return record;
	const started = deps.now();
	let handOff = false;
	try {
		record = (await patchJob(key, { runs: (record.runs || 0) + 1 })) || record;
		const shape = { kind: 'model', what: 'model', prompt: record.prompt };
		if (!record.jobId) {
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
				caller: `basecamp:${record.connectionId}`,
				creatorAuth: platformAuthHeaders({ onBehalf: true, userId: record.userId }),
				deadline: started + INLINE_WAIT_MS,
				onProgress,
			};
			let result;
			try {
				result = await deps.forge({ prompt: record.prompt, tier: record.tier, idempotency_key: key }, ctx, record.origin);
			} catch (err) {
				result = { isError: true, content: [{ type: 'text', text: `The 3D generator could not be reached: ${err?.message || err}` }] };
			}
			await writing;
			record = (await patchJob(key, resultOf(result, deps.now()) || {})) || record;
		}
		while (!settled(record) && record.jobId && deps.now() - started < RUN_BUDGET_MS) {
			await deps.sleep(POLL_INTERVAL_MS);
			const change = resultOf(await deps.collect(record.origin, record.jobId, shape), deps.now());
			record = (change ? await patchJob(key, change) : await loadJob(key)) || record;
		}
		if (!settled(record) && !record.jobId) {
			record = (await patchJob(key, { state: 'failed', error: 'The 3D generator never accepted the job.', settledAt: deps.now() })) || record;
		} else if (!settled(record)) {
			if ((record.runs || 0) < MAX_RUNS) handOff = true;
			else record = (await patchJob(key, { state: 'failed', error: 'The 3D generator took too long to finish this model.', settledAt: deps.now() })) || record;
		}
	} finally {
		await cacheDel(runLockKey(key)).catch(() => {});
	}
	if (handOff) {
		await deps.dispatch(key, record.selfBase || record.origin);
		return record;
	}
	await deliverSettled(record, deps);
	return record;
}

/**
 * Start runBasecampForge for `key` in its own request to this service.
 * Resolves once the run endpoint has accepted it (its 202 headers). With no
 * CRON_SECRET to authenticate that request (a bare dev box) the run starts in
 * this process instead.
 */
export async function dispatchRun(key, origin, { fetchImpl = fetch, env = process.env } = {}) {
	const secret = String(env.CRON_SECRET || '').trim();
	const local = () => {
		runBasecampForge(key).catch((err) => console.error(`[basecamp-forge] run ${key} failed: ${err?.message || err}`));
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
			console.warn(`[basecamp-forge] run endpoint answered ${res.status} for ${key}; running in process`);
			return local();
		}
		// Keep reading the open response so the run's request stays up for its whole life.
		res.text().catch(() => {});
		return 'remote';
	} catch (err) {
		clearTimeout(timer);
		console.warn(`[basecamp-forge] run endpoint unreachable for ${key} (${err?.message || err}); running in process`);
		return local();
	}
}
