// The three.ws agent in Linear.
//
// Someone mentions @three.ws on an issue ("@three.ws a brass desk lamp with a
// green shade") or delegates the issue to it. Linear opens an agent session and
// sends an AgentSessionEvent webhook (api/linear/webhook.js). The agent answers
// with a thought inside Linear's 10-second window, makes a textured 3D model on
// the free Forge lane, and posts it back into the session: a response with a
// picture and links, the links on the session itself, and an attachment on the
// issue so the model sits with the work it belongs to. Replying in the session
// refines the model ("make it red --high").
//
//   parseEvent        what an event asks for: help, a model, a stop, or too little
//   refinePrompt      a follow-up reply read against the session's last model
//   claimJob          create the job record once per webhook delivery (SET NX)
//   runLinearForge    the same forge_free generation the Basecamp chatbot and the
//                     Teams bot run, polled until it settles, then delivered
//   dispatchRun       start runLinearForge in its own request, so the work keeps
//                     a full CPU on Cloud Run after the webhook is answered
//
// Activities follow https://linear.app/developers/agent-interaction. The models
// are owned by the three.ws account that installed the app in the workspace
// (api/_lib/linear-installs.js), so they land in that account's history.

import { cacheDel, cacheGetFresh, cacheSet, cacheSetIfAbsent } from './cache.js';
import { sha256Hex } from './idempotency.js';
import { TOOLS, collectJob } from '../_mcp-studio/tools.js';
import { platformAuthHeaders } from './creator-account.js';
import { outcomeOf, statusFromFrame } from './teams-forge.js';
import { linearTokenFor, linearGraphql, dropCachedToken, recordLinearSession } from './linear-installs.js';
import { limits } from './rate-limit.js';

export const RECORD_TTL_S = 3 * 24 * 3600;
export const INLINE_WAIT_MS = 150_000;
export const POLL_INTERVAL_MS = 6_000;
// Cloud Run ends a request at 900s; a run yields before that and, while the
// generator is still working, hands the job to a fresh run.
export const RUN_BUDGET_MS = 13 * 60_000;
export const MAX_RUNS = 3;
export const PROMPT_MIN = 3;
export const PROMPT_MAX = 1000;
const ISSUE_DESCRIPTION_MAX = 400;
const PROGRESS_WRITE_MS = 4_000;
const RUN_PATH = '/api/linear/forge-run';
const DISPATCH_HEADER_MS = 4_000;
const KEY_RE = /^ln-[0-9a-f]{40}$/;

const recordKey = (key) => `linear-forge:${key}`;
const runLockKey = (key) => `linear-forge:run:${key}`;
const deliveredKey = (key) => `linear-forge:delivered:${key}`;
const sessionKey = (sessionId) => `linear-forge:session:${sessionId}`;

export function isJobKey(key) {
	return typeof key === 'string' && KEY_RE.test(key);
}

export function settled(record) {
	return record?.state === 'done' || record?.state === 'failed' || record?.state === 'stopped';
}

// ---------------------------------------------------------------------------
// Reading what was asked

/**
 * Markdown from a Linear comment or issue as plain text: mentions of the app
 * (`@three.ws`, or the profile URL Linear writes for a mention) removed, links
 * reduced to their text, images, code fences and emphasis dropped.
 */
export function plainText(markdown) {
	return String(markdown ?? '')
		.replace(/```[\s\S]*?```/g, ' ')
		.replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
		.replace(/\[([^\]]*)\]\(https?:\/\/linear\.app\/[^/\s)]+\/profiles\/[^)\s]+\)/gi, ' ')
		.replace(/https?:\/\/linear\.app\/[^/\s)]+\/profiles\/[^\s)]+/gi, ' ')
		.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
		.replace(/(^|\s)@[\w.-]+/g, '$1')
		.replace(/^\s{0,3}(?:#{1,6}\s+|[-*+]\s+|>\s?|\d+\.\s+)/gm, '')
		.replace(/[*_~`]+/g, '')
		.replace(/\s+/g, ' ')
		.trim();
}

/** Pull `--draft` / `--high` / `--standard` out of a prompt. */
export function splitTier(text) {
	let tier = 'standard';
	const prompt = String(text ?? '')
		.replace(/(^|\s)--(draft|high|standard)(?=\s|$)/gi, (_, lead, t) => {
			tier = t.toLowerCase();
			return lead;
		})
		.replace(/\s+/g, ' ')
		.trim();
	return { prompt, tier };
}

const HELP_RE = /^(?:help|\?|commands|usage|how does this work\??)$/i;
const REFINE_RE = /^(?:make it|make them|but|with|without|now|more|less|same|change|add|remove|use|try|again|bigger|smaller|taller|shorter|in|as)\b/i;

/** The issue as a prompt: its title, plus the first paragraph of its description. */
export function issuePrompt(issue) {
	const title = plainText(issue?.title);
	const firstPara = String(issue?.description || '').split(/\n\s*\n/)[0];
	const desc = plainText(firstPara).slice(0, ISSUE_DESCRIPTION_MAX);
	if (!desc || desc.toLowerCase() === title.toLowerCase()) return title;
	return `${title}. ${desc}`;
}

/**
 * A reply in a session that already made a model: a change to it ("make it
 * red", "with a longer handle", one or two words) is applied to the last
 * prompt; anything that reads as a fresh description replaces it.
 */
export function refinePrompt(previous, text) {
	if (!previous) return text;
	const words = text.split(/\s+/).filter(Boolean).length;
	if (REFINE_RE.test(text) || words <= 3) return `${previous}, ${text.replace(/^make (?:it|them)\s+/i, '')}`.slice(0, PROMPT_MAX);
	return text;
}

/**
 * What an AgentSessionEvent asks for.
 *
 *   created, comment "@three.ws a red chair"      -> { kind: 'forge', prompt: 'a red chair', source: 'comment' }
 *   created, no comment (delegated) or bare mention -> { kind: 'forge', prompt: <issue title + description>, source: 'issue' }
 *   "@three.ws help"                                -> { kind: 'help' }
 *   prompted with signal stop                      -> { kind: 'stop' }
 *   prompted "make it red" after a model           -> { kind: 'forge', prompt: '<last prompt>, red', source: 'reply' }
 *   anything under three characters                -> { kind: 'too_short' }
 */
export function parseEvent(payload, { previousPrompt = null } = {}) {
	const session = payload?.agentSession || {};
	if (payload?.action === 'prompted') {
		const activity = payload.agentActivity || {};
		if (activity.signal === 'stop') return { kind: 'stop' };
		const body = activity.content?.body ?? activity.body ?? '';
		const { prompt, tier } = splitTier(plainText(body));
		if (HELP_RE.test(prompt)) return { kind: 'help' };
		if (prompt.length < PROMPT_MIN) return { kind: 'too_short' };
		return { kind: 'forge', prompt: refinePrompt(previousPrompt, prompt).slice(0, PROMPT_MAX), tier, source: previousPrompt ? 'reply' : 'comment' };
	}
	const { prompt: fromComment, tier } = splitTier(plainText(session.comment?.body));
	if (HELP_RE.test(fromComment)) return { kind: 'help' };
	if (fromComment.length >= PROMPT_MIN) return { kind: 'forge', prompt: fromComment.slice(0, PROMPT_MAX), tier, source: 'comment' };
	const fromIssue = issuePrompt(session.issue);
	if (fromIssue.length >= PROMPT_MIN) return { kind: 'forge', prompt: fromIssue.slice(0, PROMPT_MAX), tier, source: 'issue' };
	return { kind: 'too_short' };
}

/** One job per webhook delivery: Linear's retries of the same event share it. */
export function jobKey({ sessionId, activityId = null, action }) {
	return `ln-${sha256Hex(`${sessionId}|${action}|${activityId || ''}`).slice(0, 40)}`;
}

// ---------------------------------------------------------------------------
// What the agent says (Linear agent activity content, markdown bodies)

const EXAMPLE = 'a low-poly lighthouse with a red roof';

function tierNote(tier) {
	if (tier === 'draft') return ' on draft quality';
	if (tier === 'high') return ' on high detail, which takes a little longer';
	return '';
}

export function helpContent() {
	return {
		type: 'response',
		body: [
			'**three.ws makes 3D models from a sentence.**',
			'',
			`Mention me with a description, for example \`@three.ws ${EXAMPLE}\`, or delegate an issue to me and I will model what its title describes.`,
			'',
			'- Add `--draft` for the fastest result or `--high` for the most detail.',
			'- Reply in this thread to change the model, for example `make it blue` or `with a taller tower --high`.',
			'- Each model comes back with a 3D viewer, an AR link for your phone and a GLB file for Blender, Unity, Unreal or the web, and is attached to the issue.',
			'',
			'Setup and limits: https://three.ws/integrations/linear',
		].join('\n'),
	};
}

export function tooShortContent() {
	return {
		type: 'elicitation',
		body: `What should I model? Describe one object, character or creature in a few words, for example \`${EXAMPLE}\`.`,
	};
}

export function stoppedContent() {
	return { type: 'response', body: 'Stopped. I will not post the model I was working on. Mention me again whenever you want another one.' };
}

export function rateLimitedContent() {
	return {
		type: 'error',
		body: 'This workspace has asked for more models in the last 10 minutes than three.ws makes at once (30). Try again in a few minutes.',
	};
}

export function startedContent(record) {
	const from = record.source === 'issue' ? ' from this issue' : '';
	return {
		type: 'thought',
		body: `Making a 3D model${from}${tierNote(record.tier)}: **${mdEscape(record.prompt)}**. It usually takes about two minutes.`,
	};
}

export function forgingAction(record) {
	return { type: 'action', action: 'Generating 3D model', parameter: record.prompt };
}

export function forgedAction(record) {
	return { type: 'action', action: 'Generated 3D model', parameter: record.prompt, result: record.result?.glbUrl ? 'GLB ready' : 'done' };
}

export function slowContent() {
	return { type: 'thought', body: 'Still working: the generator is busy, so this one is taking longer than usual. I will post it here when it is done.' };
}

function mdEscape(text) {
	return String(text ?? '').replace(/([\\`*_[\]<>])/g, '\\$1');
}

export function modelLinks(record) {
	const r = record.result || {};
	return [
		r.viewerUrl ? { label: 'Open in 3D', url: r.viewerUrl } : null,
		r.arUrl ? { label: 'View in AR', url: r.arUrl } : null,
		r.glbUrl ? { label: 'Download GLB', url: r.glbUrl } : null,
	].filter(Boolean);
}

export function doneContent(record) {
	const r = record.result || {};
	const lines = [`**Your 3D model is ready:** ${mdEscape(record.prompt)}`];
	if (r.posterUrl && /^https:\/\//.test(r.posterUrl)) {
		lines.push('', `[![${mdEscape(record.prompt)}](${r.posterUrl})](${r.viewerUrl || r.glbUrl})`);
	}
	lines.push('', modelLinks(record).map((l) => `[${l.label}](${l.url})`).join(' · '));
	lines.push('', 'Reply here to change it, for example `make it blue --high`. The model is attached to this issue.');
	return { type: 'response', body: lines.join('\n') };
}

export function failedContent(record) {
	const reason = String(record.error || 'The 3D generator did not return a model for this prompt.').slice(0, 400);
	return { type: 'error', body: `That 3D model did not finish: ${reason}\n\nReply to try again, or describe a single object in plain words.` };
}

// ---------------------------------------------------------------------------
// The job record (shared cache, `linear-forge:<key>`)

export async function loadJob(key) {
	if (!isJobKey(key)) return null;
	return (await cacheGetFresh(recordKey(key))) || null;
}

async function storeJob(record) {
	await cacheSet(recordKey(record.key), record, RECORD_TTL_S);
	return record;
}

/** Merge a change into the stored record. A settled record never goes back to running. */
export async function patchJob(key, patch) {
	const current = await loadJob(key);
	if (!current) return null;
	if (settled(current) && patch?.state && !settled(patch)) return current;
	return storeJob({ ...current, ...patch });
}

/** The newest job in a session, for a stop signal or a refinement. */
export async function sessionJob(sessionId) {
	const key = sessionId ? await cacheGetFresh(sessionKey(sessionId)) : null;
	return key ? loadJob(key) : null;
}

/**
 * Create the record for a new job. Resolves to `{ record, created }`; a key that
 * already has one (a redelivered webhook) returns it untouched.
 */
export async function claimJob({ key, sessionId, organizationId, userId, issue, prompt, tier, source, origin, selfBase = null }, { now = Date.now() } = {}) {
	const record = {
		v: 1,
		key,
		sessionId,
		organizationId,
		userId,
		issueId: issue?.id || null,
		issueIdentifier: issue?.identifier || null,
		prompt,
		tier,
		source,
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
	if (!(await cacheSetIfAbsent(recordKey(key), record, RECORD_TTL_S))) return { record: (await loadJob(key)) || record, created: false };
	await cacheSet(sessionKey(sessionId), key, RECORD_TTL_S);
	return { record, created: true };
}

/** Stop the session's running job: it settles as stopped and is never posted. */
export async function stopSession(sessionId) {
	const job = await sessionJob(sessionId);
	if (!job || settled(job)) return job;
	return patchJob(job.key, { state: 'stopped', settledAt: Date.now() });
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
// Linear API calls

const ACTIVITY_MUTATION = 'mutation ThreeWsActivity($input: AgentActivityCreateInput!) { agentActivityCreate(input: $input) { success } }';
const SESSION_MUTATION = 'mutation ThreeWsSession($id: String!, $input: AgentSessionUpdateInput!) { agentSessionUpdate(id: $id, input: $input) { success } }';
const ATTACHMENT_MUTATION = 'mutation ThreeWsAttachment($input: AttachmentCreateInput!) { attachmentCreate(input: $input) { success } }';

/**
 * Run one GraphQL operation for a workspace with its live token. A token Linear
 * rejects is dropped from the cache and the call retried once with a fresh read.
 */
export async function callLinear(organizationId, query, variables, { fetchImpl = fetch } = {}) {
	for (let attempt = 0; attempt < 2; attempt++) {
		const install = await linearTokenFor(organizationId, { fetchImpl });
		if (!install) throw Object.assign(new Error('the Linear workspace has no live install'), { code: 'not_installed' });
		try {
			return await linearGraphql(install.token, query, variables, { fetchImpl });
		} catch (err) {
			if (err.code !== 'unauthenticated' || attempt > 0) throw err;
			dropCachedToken(organizationId);
		}
	}
	return null;
}

export function emitActivity(organizationId, sessionId, content, { ephemeral = false, call = callLinear } = {}) {
	const input = { agentSessionId: sessionId, content };
	if (ephemeral) input.ephemeral = true;
	return call(organizationId, ACTIVITY_MUTATION, { input });
}

function attachmentInput(record) {
	const r = record.result || {};
	const title = record.prompt.length > 80 ? `${record.prompt.slice(0, 79)}…` : record.prompt;
	return {
		issueId: record.issueId,
		url: r.viewerUrl || r.glbUrl,
		title: `3D model: ${title}`,
		subtitle: 'three.ws · 3D viewer, AR and GLB',
		iconUrl: `${record.origin}/brand/three-ws-app-icon-512.png`,
		metadata: { glbUrl: r.glbUrl || null, arUrl: r.arUrl || null, posterUrl: r.posterUrl || null, prompt: record.prompt, tier: record.tier },
	};
}

// ---------------------------------------------------------------------------
// Delivery

/**
 * Post a settled job into its session once. A finished model also puts its
 * links on the session and attaches the model to the issue; those two are
 * best-effort (a missing attachment must never hide the model), the response
 * itself is what the person waits for. Resolves to true when it was posted.
 */
export async function deliverSettled(record, deps = defaultDeps) {
	if (!settled(record) || record.delivered || record.state === 'stopped') return false;
	if (!(await cacheSetIfAbsent(deliveredKey(record.key), 1, RECORD_TTL_S))) return false;
	const emit = (content, opts) => emitActivity(record.organizationId, record.sessionId, content, { ...opts, call: deps.linear });
	let ok = false;
	try {
		if (record.state === 'done') {
			const links = modelLinks(record);
			const sideEffects = [
				links.length ? deps.linear(record.organizationId, SESSION_MUTATION, { id: record.sessionId, input: { addedExternalUrls: links } }) : null,
				record.issueId && links.length ? deps.linear(record.organizationId, ATTACHMENT_MUTATION, { input: attachmentInput(record) }) : null,
			].filter(Boolean);
			const outcomes = await Promise.allSettled(sideEffects);
			for (const o of outcomes) if (o.status === 'rejected') console.warn(`[linear-agent] ${record.key}: ${o.reason?.message || o.reason}`);
			await emit(forgedAction(record)).catch(() => {});
			await emit(doneContent(record));
		} else {
			await emit(failedContent(record));
		}
		ok = true;
	} catch (err) {
		console.warn(`[linear-agent] delivery of ${record.key} failed: ${err?.message || err}`);
		await cacheDel(deliveredKey(record.key)).catch(() => {});
	}
	await patchJob(record.key, { delivered: ok });
	return ok;
}

// ---------------------------------------------------------------------------
// The run

const defaultDeps = {
	now: () => Date.now(),
	sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
	forge: (args, ctx, origin) => TOOLS.forge_free.handler(args, null, reqFor(origin), ctx),
	collect: (origin, jobId, shape) => collectJob(origin, jobId, shape),
	dispatch: (key, origin) => dispatchRun(key, origin),
	linear: (organizationId, query, variables) => callLinear(organizationId, query, variables),
	installed: (organizationId) => linearTokenFor(organizationId),
	rateLimit: (organizationId) => limits.linearSession(organizationId),
	record: (organizationId) => recordLinearSession(organizationId),
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
 * Drive a job to its end and post the result in its Linear session. Returns the
 * final record. A generation still running at RUN_BUDGET_MS is handed to a
 * fresh run (up to MAX_RUNS), and one that outlasts every run fails honestly.
 */
export async function runLinearForge(key, overrides = {}) {
	const deps = depsWith(overrides);
	let record = await loadJob(key);
	if (!record) return null;
	if (settled(record)) {
		await deliverSettled(record, deps);
		return record;
	}
	if (!(await cacheSetIfAbsent(runLockKey(key), deps.now(), Math.ceil(RUN_BUDGET_MS / 1000) + 60))) return record;
	const started = deps.now();
	const emit = (content, opts) =>
		emitActivity(record.organizationId, record.sessionId, content, { ...opts, call: deps.linear }).catch((err) =>
			console.warn(`[linear-agent] ${key}: activity failed: ${err?.message || err}`),
		);
	let handOff = false;
	try {
		record = (await patchJob(key, { runs: (record.runs || 0) + 1 })) || record;
		if (record.runs > 1) await emit(slowContent(), { ephemeral: true });
		const shape = { kind: 'model', what: 'model', prompt: record.prompt };
		if (!record.jobId) {
			await emit(forgingAction(record));
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
				caller: `linear:${record.organizationId}`,
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

// ---------------------------------------------------------------------------
// The webhook's part

const ACK_TIMEOUT_MS = 3_000;

function withTimeout(promise, ms) {
	let timer;
	return Promise.race([promise, new Promise((resolve) => (timer = setTimeout(() => resolve('timeout'), ms)))]).finally(() => clearTimeout(timer));
}

/**
 * Handle one verified AgentSessionEvent inside Linear's five-second webhook
 * window. Help, stop and too-short answer directly. A model request claims its
 * job, posts the "making it" thought (Linear marks an agent unresponsive with
 * no activity inside 10 seconds), and dispatches the run. Resolves to a short
 * outcome string for the log.
 *
 * `deps.rateLimit(orgId)` and `deps.record(orgId)` are the per-workspace bucket
 * and the "last used" counter; `deps.installed(orgId)` the install lookup.
 */
export async function handleSessionEvent(payload, { origin, selfBase }, overrides = {}) {
	const deps = depsWith(overrides);
	const organizationId = payload?.organizationId;
	const session = payload?.agentSession;
	if (!organizationId || !session?.id) return 'ignored:malformed';
	if (payload.action !== 'created' && payload.action !== 'prompted') return `ignored:${payload.action}`;
	const install = await deps.installed(organizationId);
	if (!install) return 'ignored:not_installed';
	const say = (content) => emitActivity(organizationId, session.id, content, { call: deps.linear });

	const previous = payload.action === 'prompted' ? await sessionJob(session.id) : null;
	const ask = parseEvent(payload, { previousPrompt: previous?.prompt || null });
	if (ask.kind === 'stop') {
		await stopSession(session.id);
		await say(stoppedContent());
		return 'stopped';
	}
	if (ask.kind === 'help') {
		await say(helpContent());
		return 'help';
	}
	if (ask.kind === 'too_short') {
		await say(tooShortContent());
		return 'too_short';
	}
	const rl = await deps.rateLimit(organizationId);
	if (!rl.success) {
		await say(rateLimitedContent());
		return 'rate_limited';
	}
	const key = jobKey({ sessionId: session.id, activityId: payload.agentActivity?.id, action: payload.action });
	const { record, created } = await claimJob({
		key,
		sessionId: session.id,
		organizationId,
		userId: install.installedBy,
		issue: session.issue,
		prompt: ask.prompt,
		tier: ask.tier,
		source: ask.source,
		origin,
		selfBase,
	});
	if (!created) return 'duplicate';
	await deps.record(organizationId).catch((err) => console.warn(`[linear-agent] could not count a session for ${organizationId}: ${err?.message || err}`));
	await withTimeout(say(startedContent(record)).catch((err) => console.warn(`[linear-agent] ${key}: first thought failed: ${err?.message || err}`)), ACK_TIMEOUT_MS);
	await deps.dispatch(key, record.selfBase);
	return 'started';
}

/**
 * Start runLinearForge for `key` in its own request to this service. Resolves
 * once the run endpoint has accepted it (its 202 headers). With no CRON_SECRET
 * to authenticate that request (a bare dev box) the run starts in this process.
 */
export async function dispatchRun(key, origin, { fetchImpl = fetch, env = process.env } = {}) {
	const secret = String(env.CRON_SECRET || '').trim();
	const local = () => {
		runLinearForge(key).catch((err) => console.error(`[linear-agent] run ${key} failed: ${err?.message || err}`));
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
			console.warn(`[linear-agent] run endpoint answered ${res.status} for ${key}; running in process`);
			return local();
		}
		// Keep reading the open response so the run's request stays up for its whole life.
		res.text().catch(() => {});
		return 'remote';
	} catch (err) {
		clearTimeout(timer);
		console.warn(`[linear-agent] run endpoint unreachable for ${key} (${err?.message || err}); running in process`);
		return local();
	}
}
