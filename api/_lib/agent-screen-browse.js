// Browse jobs for the agent-screen pool: an agent's owner (or the browse_web
// MCP tool) queues a goal, a pool worker claims it, drives a real Chromium
// page through the observe/decide/act loop in workers/agent-screen-pool/tasks,
// and reports each step back. State lives in Redis so the API and the pool
// need no shared process. The worker enforces the safety policy; this module
// validates and bounds the request so a bad job is refused before it queues.

import crypto from 'node:crypto';
import { getRedis } from './redis.js';
import { sql } from './db.js';
import { isNavAllowed } from '../../src/shared/agent-screen-control.js';

const QUEUE = 'agent:screen:browse:queue';
const JOB_TTL_S = 3600;
const MAX_STEPS = 30;
const MAX_DOMAINS = 20;

export const jobKey = (id) => `agent:screen:browse:job:${id}`;
const activeKey = (agentId) => `agent:screen:${agentId}:browse:active`;

export class BrowseError extends Error {
	constructor(code, message, status = 400) {
		super(message);
		this.code = code;
		this.status = status;
	}
}

function domainsFrom(list, startHost) {
	const out = new Set();
	for (const raw of Array.isArray(list) ? list : []) {
		const s = String(raw || '').trim().toLowerCase();
		if (!s) continue;
		try {
			const h = new URL(/^[a-z]+:\/\//.test(s) ? s : `https://${s}`).hostname.replace(/^www\./, '');
			if (h) out.add(h);
		} catch { /* skip unparseable entries */ }
	}
	if (!out.size && startHost) out.add(startHost.replace(/^www\./, ''));
	return [...out].slice(0, MAX_DOMAINS);
}

export async function enqueueBrowse({ userId, agentId, goal, startUrl, allowedDomains, maxSteps }) {
	const r = getRedis();
	if (!r) throw new BrowseError('redis_unavailable', 'browse queue offline', 503);
	const g = String(goal || '').trim();
	if (g.length < 5 || g.length > 500) throw new BrowseError('bad_goal', 'goal must be 5 to 500 characters');
	let url;
	try { url = new URL(String(startUrl || '')); } catch { throw new BrowseError('bad_start_url', 'start_url must be an absolute http(s) URL'); }
	if (!isNavAllowed(url.href)) throw new BrowseError('bad_start_url', 'start_url must be a public http(s) address');
	if (!agentId || typeof agentId !== 'string') throw new BrowseError('missing_agent_id', 'agent_id is required');

	const [own] = await sql`
		SELECT id FROM agent_identities
		WHERE id = ${agentId} AND user_id = ${userId} AND deleted_at IS NULL LIMIT 1
	`.catch(() => []);
	if (!own) throw new BrowseError('forbidden', 'you do not own this agent', 403);

	const claimed = await r.set(activeKey(agentId), '1', { nx: true, ex: 900 });
	if (!claimed) throw new BrowseError('busy', 'this agent is already on a browse run', 409);

	const id = crypto.randomUUID();
	const job = {
		id, agentId, userId, goal: g, startUrl: url.href,
		allowedDomains: domainsFrom(allowedDomains, url.hostname),
		maxSteps: Math.min(MAX_STEPS, Math.max(1, Math.floor(Number(maxSteps)) || 12)),
		status: 'queued', steps: [], result: null, createdAt: Date.now(),
	};
	await r.set(jobKey(id), job, { ex: JOB_TTL_S });
	await r.rpush(QUEUE, id);
	return job;
}

// Pool worker: pop the oldest queued job and mark it running.
export async function claimBrowse() {
	const r = getRedis();
	if (!r) throw new BrowseError('redis_unavailable', 'browse queue offline', 503);
	for (let i = 0; i < 5; i++) {
		const id = await r.lpop(QUEUE);
		if (!id) return null;
		const job = await r.get(jobKey(id));
		if (!job || job.status !== 'queued') continue;
		job.status = 'running';
		job.startedAt = Date.now();
		await r.set(jobKey(id), job, { ex: JOB_TTL_S });
		return job;
	}
	return null;
}

const FINAL = new Set(['done', 'yielded', 'step_cap', 'time_cap', 'token_cap', 'policy_stop', 'denied', 'aborted', 'error']);

export async function reportBrowse({ jobId, status, steps, result }) {
	const r = getRedis();
	if (!r) throw new BrowseError('redis_unavailable', 'browse queue offline', 503);
	const job = await r.get(jobKey(jobId));
	if (!job) throw new BrowseError('not_found', 'job expired or unknown', 404);
	if (Array.isArray(steps)) job.steps = steps.slice(-60).map((s) => ({ ...s, note: s.note ? String(s.note).slice(0, 160) : undefined }));
	if (typeof result === 'string') job.result = result.slice(0, 2000);
	if (FINAL.has(status)) {
		job.status = status;
		job.finishedAt = Date.now();
		await r.del(activeKey(job.agentId)).catch(() => {});
	} else {
		await r.expire(activeKey(job.agentId), 900).catch(() => {});
	}
	await r.set(jobKey(jobId), job, { ex: JOB_TTL_S });
	return job;
}

export async function readBrowse({ jobId, userId }) {
	const r = getRedis();
	if (!r) throw new BrowseError('redis_unavailable', 'browse queue offline', 503);
	const job = await r.get(jobKey(jobId));
	if (!job || job.userId !== userId) throw new BrowseError('not_found', 'no such browse run', 404);
	const { userId: _omit, ...view } = job;
	return view;
}
