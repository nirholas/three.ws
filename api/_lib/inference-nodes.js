/**
 * Inference node network: shared data layer for the phase 4 open inference
 * endpoints. Owns the node registry, the job queue, and signature
 * verification, so the three route handlers (register / poll / result) stay
 * thin and the contract has exactly one home.
 *
 * Wire contract (the authoritative write-up is specs/inference-nodes.md):
 *
 *   register : POST /api/nodes/register
 *              { publicKey, label?, capabilities, registeredAt, signature }
 *              signature = ed25519(`threews-node-register:{publicKey}:{registeredAt}`)
 *
 *   poll     : GET /api/nodes/jobs?node=<pk>&capability=<c>&ts=<ms>&sig=<s>
 *              sig = ed25519(`threews-node-poll:{pk}:{ts}`)
 *
 *   result   : POST /api/nodes/jobs/{jobId}/result
 *              success: { node, output, startedAt, finishedAt, receipt }
 *              failure: { node, failed: true, error, startedAt, finishedAt, ts, signature }
 *              receipt.payload = sha256(jobId).sha256(model).sha256(prompt).sha256(output).start.end
 *
 * Storage: Redis when UPSTASH is configured (production), with a lazy
 * Postgres table as the durable record of registered nodes so a Redis flush
 * never strands a node identity. The job queue itself is Redis-only by
 * design: jobs are ephemeral (claim TTL, one-shot), which matches the
 * agent-screen task queue's model.
 */

import { createRequire } from 'node:module';
import { getRedis } from './redis.js';
import { sql } from './db.js';

const require = createRequire(import.meta.url);
const nacl = require('tweetnacl');

const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

const NODE_PREFIX = 'inode:';           // registry hash per node pubkey
const JOB_PREFIX = 'ijob:';             // job hash per job id
const QUEUE_PREFIX = 'iqueue:';         // list of pending job ids per capability
const NODE_TTL_S = 30 * 24 * 3600;      // registry entry refreshes on each register
const JOB_TTL_S = 3600;                 // unclaimed jobs die after an hour

/** Decode a base58 Solana public key to 32 bytes; throws on malformed input. */
export function nodePubkeyToBytes(pubkey) {
	if (typeof pubkey !== 'string' || pubkey.length < 32 || pubkey.length > 44) {
		throw new Error('invalid node public key');
	}
	const bytes = [0];
	for (const ch of pubkey) {
		const idx = B58.indexOf(ch);
		if (idx < 0) throw new Error('invalid node public key');
		let carry = idx;
		for (let i = 0; i < bytes.length; i++) {
			carry += bytes[i] * 58;
			bytes[i] = carry & 0xff;
			carry >>= 8;
		}
		while (carry > 0) { bytes.push(carry & 0xff); carry >>= 8; }
	}
	for (const ch of pubkey) { if (ch === '1') bytes.push(0); else break; }
	const out = Uint8Array.from(bytes.reverse());
	if (out.length !== 32) throw new Error('invalid node public key');
	return out;
}

/** Verify an ed25519 signature over a UTF-8 message against a base58 pubkey. */
export function verifyNodeSignature(pubkey, message, signatureB64) {
	try {
		return nacl.sign.detached.verify(
			new TextEncoder().encode(message),
			Uint8Array.from(Buffer.from(String(signatureB64 || ''), 'base64')),
			nodePubkeyToBytes(pubkey),
		);
	} catch {
		return false;
	}
}

/** Hex SHA-256 (WebCrypto, so the browser verifier reproduces it exactly). */
async function sha256Hex(input) {
	const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : input;
	return Buffer.from(await crypto.subtle.digest('SHA-256', bytes)).toString('hex');
}

/** Recompute the canonical receipt payload and verify its signature. */
export async function verifyResultReceipt({ jobId, model, prompt, output, startedAt, finishedAt }, receipt) {
	if (!receipt || receipt.algorithm !== 'ed25519' || !receipt.publicKey || !receipt.signature) return false;
	const payload = [
		await sha256Hex(String(jobId)),
		await sha256Hex(String(model)),
		await sha256Hex(String(prompt)),
		await sha256Hex(typeof output === 'string' ? output : JSON.stringify(output)),
		String(startedAt),
		String(finishedAt),
	].join('.');
	if (payload !== receipt.payload) return false;
	return verifyNodeSignature(receipt.publicKey, payload, receipt.signature);
}

/**
 * Read a JSON record back out of Redis.
 *
 * The Upstash REST client deserializes on the way out: a value stored as a
 * JSON string comes back already parsed as an object. Calling JSON.parse on
 * that object stringifies it to "[object Object]" first and throws, which
 * took out getNode's Redis fallback, claimJob and getJob (every read path in
 * the queue). Accept either shape so the record survives whichever form the
 * client hands back.
 */
function parseRecord(raw) {
	if (raw === null || raw === undefined) return null;
	if (typeof raw === 'object') return raw;
	try {
		return JSON.parse(raw);
	} catch {
		return null;
	}
}

// ── Durable node registry (Postgres) ─────────────────────────────────────────

let _ensured = null;
async function ensureNodeTable() {
	if (_ensured) return _ensured;
	_ensured = (async () => {
		await sql`
			create table if not exists inference_nodes (
				public_key text primary key,
				label text,
				capabilities jsonb not null default '[]',
				registered_at timestamptz not null default now(),
				last_seen_at timestamptz not null default now(),
				jobs_completed integer not null default 0,
				jobs_failed integer not null default 0
			)`;
	})();
	return _ensured;
}

/**
 * Register (idempotent upsert on public key) a node. Returns the stored row.
 * Falls back to Redis-only when the database is not reachable so a dev node
 * can still register against a bare local stack.
 */
export async function registerNode({ publicKey, label, capabilities }) {
	nodePubkeyToBytes(publicKey); // throws early on a malformed key
	const caps = Array.isArray(capabilities) ? capabilities.slice(0, 16) : [];
	try {
		await ensureNodeTable();
		const rows = await sql`
			insert into inference_nodes (public_key, label, capabilities)
			values (${publicKey}, ${label || null}, ${JSON.stringify(caps)})
			on conflict (public_key) do update
				set label = coalesce(excluded.label, inference_nodes.label),
					capabilities = excluded.capabilities,
					last_seen_at = now()
			returning public_key, label, capabilities, registered_at`;
		return rows[0];
	} catch (err) {
		// DB down: keep the node in Redis so local dev without Postgres works.
		const r = getRedis();
		if (!r) throw err;
		const node = { public_key: publicKey, label: label || null, capabilities: caps, registered_at: new Date().toISOString() };
		await r.set(`${NODE_PREFIX}${publicKey}`, JSON.stringify(node), { ex: NODE_TTL_S });
		return node;
	}
}

/** Look up a registered node, or null. */
export async function getNode(publicKey) {
	try {
		await ensureNodeTable();
		const rows = await sql`select public_key, label, capabilities, registered_at from inference_nodes where public_key = ${publicKey}`;
		if (rows[0]) return rows[0];
	} catch { /* fall through to Redis */ }
	const r = getRedis();
	if (!r) return null;
	return parseRecord(await r.get(`${NODE_PREFIX}${publicKey}`));
}

// ── Job queue ────────────────────────────────────────────────────────────────

/**
 * Enqueue an inference job for a capability. Called by the platform's agent
 * runtime (and by the local harness) when work needs a node. Returns the job.
 */
export async function enqueueJob({ capability, model, input, jobId }) {
	const r = getRedis();
	if (!r) throw new Error('job queue unavailable: Redis not configured');
	const id = jobId || `job_${crypto.randomUUID()}`;
	const job = {
		id,
		capability,
		model,
		input,
		status: 'queued',
		enqueuedAt: Date.now(),
		deadlineAt: Date.now() + JOB_TTL_S * 1000,
	};
	await r.set(`${JOB_PREFIX}${id}`, JSON.stringify(job), { ex: JOB_TTL_S });
	await r.rpush(`${QUEUE_PREFIX}${capability}`, id);
	return job;
}

/**
 * Claim the next queued job for a capability that this node can run.
 * Returns the claimed job (status flipped to 'running', node stamped), or
 * null when the queue is empty. Claim is a single atomic rpop + set so two
 * nodes never take the same job.
 */
export async function claimJob({ capability, publicKey }) {
	const r = getRedis();
	if (!r) return null;
	const id = await r.rpop(`${QUEUE_PREFIX}${capability}`);
	if (!id) return null;
	const job = parseRecord(await r.get(`${JOB_PREFIX}${id}`));
	if (!job) return null; // expired between push and pop
	if (job.status !== 'queued') return null;
	job.status = 'running';
	job.claimedBy = publicKey;
	job.claimedAt = Date.now();
	await r.set(`${JOB_PREFIX}${id}`, JSON.stringify(job), { ex: JOB_TTL_S });
	return job;
}

/** Read a job's current record. */
export async function getJob(jobId) {
	const r = getRedis();
	if (!r) return null;
	return parseRecord(await r.get(`${JOB_PREFIX}${jobId}`));
}

/**
 * Record a verified result on a job. Only the node that claimed the job can
 * close it, and only from the 'running' state, so a late or replayed submit
 * can never overwrite a result.
 */
export async function completeJob(jobId, { publicKey, output, receipt, startedAt, finishedAt }) {
	const r = getRedis();
	if (!r) throw new Error('job queue unavailable');
	const job = await getJob(jobId);
	if (!job) return { ok: false, status: 404, error: 'job_not_found' };
	if (job.claimedBy !== publicKey) return { ok: false, status: 403, error: 'not_job_owner' };
	if (job.status !== 'running') return { ok: false, status: 409, error: 'job_not_running' };
	job.status = 'done';
	job.output = output;
	job.receipt = receipt;
	job.startedAt = startedAt;
	job.finishedAt = finishedAt;
	job.completedAt = Date.now();
	await r.set(`${JOB_PREFIX}${jobId}`, JSON.stringify(job), { ex: JOB_TTL_S });
	bumpNodeCounter(publicKey, 'jobs_completed');
	return { ok: true, job };
}

/** Record a node-reported failure so the platform can requeue or refund. */
export async function failJob(jobId, { publicKey, error: errMsg }) {
	const r = getRedis();
	if (!r) throw new Error('job queue unavailable');
	const job = await getJob(jobId);
	if (!job) return { ok: false, status: 404, error: 'job_not_found' };
	if (job.claimedBy !== publicKey) return { ok: false, status: 403, error: 'not_job_owner' };
	if (job.status !== 'running') return { ok: false, status: 409, error: 'job_not_running' };
	job.status = 'failed';
	job.error = String(errMsg || '').slice(0, 500);
	job.completedAt = Date.now();
	await r.set(`${JOB_PREFIX}${jobId}`, JSON.stringify(job), { ex: JOB_TTL_S });
	bumpNodeCounter(publicKey, 'jobs_failed');
	return { ok: true, job };
}

function bumpNodeCounter(publicKey, column) {
	// Best-effort: the Redis result is authoritative; the counter is a rollup.
	// The single `.catch()` this used to carry did not make it best-effort. The
	// column name was interpolated with `sql(column)`, and each of those
	// fragment calls produces its OWN promise, which rejects on a host with no
	// DATABASE_URL and was attached to nothing. Two unhandled rejections
	// escaped per completed job. Naming both columns statically removes the
	// fragment promises entirely (and the dynamic identifier with them), so the
	// one remaining promise is the one the catch covers.
	try {
		const query = column === 'jobs_failed'
			? sql`update inference_nodes set jobs_failed = jobs_failed + 1, last_seen_at = now() where public_key = ${publicKey}`
			: sql`update inference_nodes set jobs_completed = jobs_completed + 1, last_seen_at = now() where public_key = ${publicKey}`;
		Promise.resolve(query).catch(() => {});
	} catch { /* no database configured: the rollup is optional, the result is not */ }
}

// ── Liveness ─────────────────────────────────────────────────────────────────

const LIVE_PREFIX = 'inode:live:';      // JSON { pubkey: lastPollMs } per capability
const LIVE_WINDOW_MS = 60_000;

/**
 * Record that a node just polled for a capability. The roster is one small JSON
 * value per capability; a racing write can drop an entry for one poll interval,
 * which the node's next poll restores, so it is a liveness hint and never an
 * authority on who may claim a job.
 */
export async function touchNode({ publicKey, capability }) {
	const r = getRedis();
	if (!r) return;
	const key = `${LIVE_PREFIX}${capability}`;
	const now = Date.now();
	const roster = parseRecord(await r.get(key)) || {};
	roster[publicKey] = now;
	for (const [pk, ts] of Object.entries(roster)) {
		if (now - ts > LIVE_WINDOW_MS) delete roster[pk];
	}
	await r.set(key, JSON.stringify(roster), { ex: 120 });
}

/** Public keys of nodes that polled for this capability within the last 60 seconds. */
export async function liveNodesFor(capability) {
	const r = getRedis();
	if (!r) return [];
	const roster = parseRecord(await r.get(`${LIVE_PREFIX}${capability}`)) || {};
	const now = Date.now();
	return Object.entries(roster)
		.filter(([, ts]) => now - ts <= LIVE_WINDOW_MS)
		.map(([pk]) => pk);
}

// ── Buyer path ───────────────────────────────────────────────────────────────

/**
 * Atomics of USDC (6 decimals) the buyer pays per job, by capability. The x402
 * challenge is issued before the body is read, so the route advertises the
 * highest of these and every capability is billed that flat rate.
 */
export const CAPABILITY_PRICES_ATOMICS = Object.freeze({
	'text-embedding': '1000',
	'text-generation': '5000',
});
export const DEFAULT_CAPABILITY_PRICE_ATOMICS = '5000';

export function priceForCapability(capability) {
	return CAPABILITY_PRICES_ATOMICS[capability] || DEFAULT_CAPABILITY_PRICE_ATOMICS;
}

/**
 * Wait for a job to leave the queued/running states. Polls the Redis record on
 * an interval (never a busy loop). Resolves to the final job record, or to the
 * last seen record with `timedOut: true`.
 */
export async function waitForJob(jobId, { timeoutMs = 25_000, intervalMs = 400 } = {}) {
	const deadline = Date.now() + timeoutMs;
	let job = await getJob(jobId);
	while (job && (job.status === 'queued' || job.status === 'running')) {
		if (Date.now() >= deadline) return { ...job, timedOut: true };
		await new Promise((resolve) => setTimeout(resolve, intervalMs));
		job = await getJob(jobId);
	}
	return job;
}

/**
 * Close a job the buyer stopped waiting for. A node that returns the result
 * later gets 409 job_not_running from completeJob, so a late result can never
 * become an earning.
 */
export async function expireJob(jobId) {
	const r = getRedis();
	if (!r) return null;
	const job = await getJob(jobId);
	if (!job || (job.status !== 'queued' && job.status !== 'running')) return job;
	job.status = 'expired';
	job.completedAt = Date.now();
	await r.set(`${JOB_PREFIX}${jobId}`, JSON.stringify(job), { ex: JOB_TTL_S });
	return job;
}

/** Re-verify a finished job's receipt against the server's own record of it. */
export async function verifyFinishedJob(job) {
	if (!job || job.status !== 'done' || !job.receipt) return false;
	const prompt = typeof job.input === 'string' ? job.input : job.input?.text ?? '';
	const model = job.output?.model || job.model;
	return (
		job.receipt.publicKey === job.claimedBy &&
		(await verifyResultReceipt(
			{ jobId: job.id, model, prompt, output: job.output, startedAt: job.startedAt, finishedAt: job.finishedAt },
			job.receipt,
		))
	);
}

// ── Earnings ledger ──────────────────────────────────────────────────────────

let _earningsEnsured = null;
async function ensureEarningsTable() {
	if (_earningsEnsured) return _earningsEnsured;
	_earningsEnsured = (async () => {
		await sql`
			create table if not exists inference_node_earnings (
				id bigserial primary key,
				node_public_key text not null,
				job_id text not null unique,
				capability text not null,
				model text,
				amount_atomics bigint not null,
				asset text,
				payer_signature text,
				verified_at timestamptz not null default now(),
				payout_status text not null default 'accrued',
				payout_signature text
			)`;
		await sql`create index if not exists inference_node_earnings_node_idx on inference_node_earnings (node_public_key, verified_at desc)`;
	})().catch((err) => {
		_earningsEnsured = null;
		throw err;
	});
	return _earningsEnsured;
}

/**
 * Accrue one earning for a verified, settled job. Idempotent on job_id, so a
 * retried settle hook never double-credits. Returns the inserted row, or null
 * when the job was already recorded.
 */
export async function recordNodeEarning({ nodePublicKey, jobId, capability, model, amountAtomics, asset, payerSignature }) {
	await ensureEarningsTable();
	const rows = await sql`
		insert into inference_node_earnings (node_public_key, job_id, capability, model, amount_atomics, asset, payer_signature)
		values (${nodePublicKey}, ${jobId}, ${capability}, ${model || null}, ${String(amountAtomics)}, ${asset || null}, ${payerSignature || null})
		on conflict (job_id) do nothing
		returning id, node_public_key, job_id, amount_atomics, payout_status`;
	return rows[0] || null;
}

/** Accrued, paid and per-day totals for one node. */
export async function getNodeEarnings(publicKey) {
	await ensureEarningsTable();
	const totals = await sql`
		select payout_status, count(*)::int as jobs, coalesce(sum(amount_atomics), 0)::text as atomics
		from inference_node_earnings where node_public_key = ${publicKey} group by payout_status`;
	const daily = await sql`
		select to_char(date_trunc('day', verified_at), 'YYYY-MM-DD') as day, count(*)::int as jobs, coalesce(sum(amount_atomics), 0)::text as atomics
		from inference_node_earnings where node_public_key = ${publicKey}
		group by 1 order by 1 desc limit 30`;
	const pick = (status) => totals.find((t) => t.payout_status === status) || { jobs: 0, atomics: '0' };
	return {
		accrued: { jobs: pick('accrued').jobs, atomics: pick('accrued').atomics },
		paid: { jobs: pick('paid').jobs, atomics: pick('paid').atomics },
		daily,
	};
}

/** Public node listing: no secrets, no network addresses. */
export async function listNodes() {
	await ensureNodeTable();
	const rows = await sql`
		select n.public_key, n.label, n.capabilities, n.registered_at, n.last_seen_at, n.jobs_completed, n.jobs_failed
		from inference_nodes n order by n.last_seen_at desc limit 200`;
	let earned = [];
	try {
		await ensureEarningsTable();
		earned = await sql`select node_public_key, count(*)::int as jobs from inference_node_earnings group by 1`;
	} catch { /* ledger not reachable: the listing still works */ }
	const verified = new Map(earned.map((e) => [e.node_public_key, e.jobs]));
	const now = Date.now();
	return Promise.all(
		rows.map(async (n) => {
			const caps = Array.isArray(n.capabilities) ? n.capabilities.map((c) => c?.capability).filter(Boolean) : [];
			let live = false;
			for (const cap of caps) {
				if ((await liveNodesFor(cap)).includes(n.public_key)) { live = true; break; }
			}
			return {
				publicKey: n.public_key,
				label: n.label,
				capabilities: n.capabilities,
				registeredAt: n.registered_at,
				lastSeenAt: n.last_seen_at,
				online: live,
				jobsCompleted: n.jobs_completed,
				jobsFailed: n.jobs_failed,
				verifiedEarnings: verified.get(n.public_key) || 0,
				ageMs: now - Date.parse(n.registered_at),
			};
		}),
	);
}
