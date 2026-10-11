// Run receipts: the I/O half. Signing key, persistence, rig inspection, stats.
// The pure record (stages, verdicts, canonical bytes, signature) lives in
// run-receipt.js; this module is everything that touches the network, the
// database or the environment.
//
// Fail-open throughout, like every other forge instrumentation module: a
// receipt is a record OF the run, never a gate ON it. No database, no signing
// key, an unreadable file, a slow write: each degrades to a receipt that says
// so (unsigned, unstored, "could not verify"), and the generation the caller
// asked for is returned exactly as before.
//
// Schema: api/_lib/migrations/20261014000000_run_receipts.sql.

import { sql } from './db.js';
import { BACKENDS } from './forge-tiers.js';
import { analyzeGlb } from '../../src/rig-report.js';
import { isReceiptId, signReceipt, receiptHash, verifyReceipt } from './run-receipt.js';

// A write gets this long before the tool answers without waiting for it. The
// row still lands; the caller just does not sit behind a slow database.
const WRITE_WAIT_MS = 2_500;
// The glTF JSON chunk sits at the head of the file. 512 KB covers it for every
// rigged avatar the pipeline produces; anything larger is read in full up to
// the cap below.
const RIG_PREFIX_BYTES = 512 * 1024;
const RIG_MAX_BYTES = 48 * 1024 * 1024;
const RIG_INSPECT_TIMEOUT_MS = 10_000;

// ── signing ──────────────────────────────────────────────────────────────────

// The same issuer key that signs 3D provenance credentials. Run receipts carry
// their own domain tag (three-run-receipt/v1), so a signature from one scheme
// can never be replayed as the other. Loaded lazily: the decoder lives beside
// the Solana attestation stack, which no generation should pay to import.
let keyPromise;
function signingKey() {
	if (!keyPromise) {
		keyPromise = (async () => {
			const raw = process.env.ATTEST_AGENT_SECRET_KEY || '';
			if (!raw.trim()) return null;
			try {
				const { decodeAttesterSecret } = await import('./attest-event.js');
				return decodeAttesterSecret(raw);
			} catch (err) {
				console.warn('[run-receipt] signing key unreadable, receipts ship unsigned:', err?.message || err);
				return null;
			}
		})();
	}
	return keyPromise;
}

/** Test seam: forget the cached key so a test can swap the env. */
export function resetSigningKeyCache() {
	keyPromise = undefined;
}

/** Seal a finished receipt: signed when the issuer key is configured, hashed always. */
export async function sealReceipt(receipt) {
	const key = await signingKey();
	if (key) {
		try {
			return signReceipt(receipt, key);
		} catch (err) {
			console.warn('[run-receipt] sign failed, sealing unsigned:', err?.message || err);
		}
	}
	return { receipt, sha256: receiptHash(receipt), signature: null, signer: null };
}

/** The public half of the issuer key, for pinning. Null when unsigned. */
export async function receiptSignerPublicKey() {
	const key = await signingKey();
	if (!key) return null;
	const { ed25519 } = await import('@noble/curves/ed25519.js');
	const bs58 = (await import('bs58')).default;
	return bs58.encode(ed25519.getPublicKey(key.slice(0, 32)));
}

// ── persistence ──────────────────────────────────────────────────────────────

function bounded(promise, ms) {
	let timer;
	return Promise.race([
		promise.then(
			() => true,
			(err) => {
				console.warn('[run-receipt] write failed:', err?.message || err);
				return false;
			},
		),
		new Promise((resolve) => {
			timer = setTimeout(() => resolve(false), ms);
		}),
	]).finally(() => clearTimeout(timer));
}

/**
 * Upsert a sealed receipt. Resolves true once stored, false when the database
 * is absent, failed, or slower than the wait budget (the write keeps going).
 */
export function saveReceipt(envelope, { jobRef = null } = {}) {
	const r = envelope?.receipt;
	if (!r || !isReceiptId(r.id)) return Promise.resolve(false);
	const write = sql`
		insert into run_receipts (id, tool, outcome, job_ref, body, sha256, signature, signer)
		values (
			${r.id}, ${r.tool}, ${r.outcome}, ${jobRef},
			${JSON.stringify(r)}::jsonb, ${envelope.sha256},
			${envelope.signature}, ${envelope.signer}
		)
		on conflict (id) do update set
			outcome = excluded.outcome,
			job_ref = coalesce(excluded.job_ref, run_receipts.job_ref),
			body = excluded.body,
			sha256 = excluded.sha256,
			signature = excluded.signature,
			signer = excluded.signer,
			updated_at = now()
	`;
	return bounded(write, WRITE_WAIT_MS);
}

function rowToEnvelope(row) {
	if (!row) return null;
	const receipt = typeof row.body === 'string' ? JSON.parse(row.body) : row.body;
	return { receipt, sha256: row.sha256, signature: row.signature || null, signer: row.signer || null };
}

export async function loadReceipt(id) {
	if (!isReceiptId(id)) return null;
	const [row] = await sql`select body, sha256, signature, signer from run_receipts where id = ${id} limit 1`;
	return rowToEnvelope(row);
}

/**
 * The receipt of the tool call that handed out this job: still pending (so
 * check_job completes it) or already completed by an earlier check (so a repeat
 * check links the same record instead of losing it).
 */
export async function loadReceiptForJob(ref) {
	if (!ref) return null;
	try {
		const [row] = await sql`
			select body, sha256, signature, signer from run_receipts
			where job_ref = ${ref}
			order by created_at desc limit 1
		`;
		return rowToEnvelope(row);
	} catch (err) {
		console.warn('[run-receipt] pending lookup failed:', err?.message || err);
		return null;
	}
}

/** Re-check a stored envelope with the pure verifier, pinned to our live key when we have one. */
export async function verifyStoredReceipt(envelope) {
	const trustedSigner = await receiptSignerPublicKey();
	return verifyReceipt(envelope, trustedSigner ? { trustedSigner } : {});
}

export const STATS_MIN_DAYS = 1;
export const STATS_MAX_DAYS = 90;

/**
 * Aggregate view across every receipt in the window: outcomes per tool,
 * verdicts per stage, and the most common causes behind a recovered or missed
 * stage. Counts only; no prompt, file or id leaves this query.
 */
export async function receiptStats({ days = 7 } = {}) {
	const d = Math.min(STATS_MAX_DAYS, Math.max(STATS_MIN_DAYS, Math.floor(Number(days)) || 7));
	const since = new Date(Date.now() - d * 86_400_000).toISOString();
	const [outcomes, stages, causes] = await Promise.all([
		sql`
			select tool, outcome, count(*)::int as n,
				count(*) filter (where jsonb_array_length(coalesce(body->'issues', '[]'::jsonb)) = 0)::int as clean
			from run_receipts where created_at >= ${since}
			group by tool, outcome
		`,
		sql`
			select s->>'id' as stage, s->>'label' as label, s->>'verdict' as verdict, count(*)::int as n
			from run_receipts, jsonb_array_elements(body->'stages') s
			where created_at >= ${since}
			group by 1, 2, 3
		`,
		sql`
			select s->>'id' as stage, s->>'label' as label, s->>'verdict' as verdict, s->>'cause' as cause, count(*)::int as n
			from run_receipts, jsonb_array_elements(body->'stages') s
			where created_at >= ${since} and s->>'verdict' in ('missed', 'recovered') and s->>'cause' is not null
			group by 1, 2, 3, 4
			order by n desc
			limit 12
		`,
	]);
	return summarizeStats({ days: d, outcomes, stages, causes });
}

// Stage display order follows the pipeline, so the page reads top to bottom
// the way a run actually happens.
const STAGE_ORDER = ['input', 'subject', 'brief', 'mesh', 'geometry', 'visual', 'rig', 'delivery'];

/** Pure reshaping of the three stat queries. Exported for tests. */
export function summarizeStats({ days, outcomes = [], stages = [], causes = [] }) {
	const total = outcomes.reduce((s, r) => s + r.n, 0);
	const byOutcome = {};
	const byTool = {};
	// A clean run delivered with no stage recovered or missed. The `delivered`
	// outcome alone still allows a named fallback, so it is not the same thing.
	let clean = 0;
	for (const r of outcomes) {
		if (r.outcome === 'delivered') clean += r.clean ?? r.n;
		byOutcome[r.outcome] = (byOutcome[r.outcome] || 0) + r.n;
		byTool[r.tool] ??= { total: 0, outcomes: {} };
		byTool[r.tool].total += r.n;
		byTool[r.tool].outcomes[r.outcome] = (byTool[r.tool].outcomes[r.outcome] || 0) + r.n;
	}
	const stageMap = new Map();
	for (const r of stages) {
		const s = stageMap.get(r.stage) || { id: r.stage, label: r.label, total: 0, verdicts: {} };
		s.total += r.n;
		s.verdicts[r.verdict] = (s.verdicts[r.verdict] || 0) + r.n;
		stageMap.set(r.stage, s);
	}
	const rank = (id) => {
		const i = STAGE_ORDER.indexOf(id);
		return i < 0 ? STAGE_ORDER.length : i;
	};
	const stageList = [...stageMap.values()].sort((a, b) => rank(a.id) - rank(b.id));
	const ran = stageList.map((s) => {
		const judged = s.total - (s.verdicts.skipped || 0) - (s.verdicts.pending || 0);
		return {
			...s,
			judged,
			met_rate: judged ? Math.round(((s.verdicts.met || 0) / judged) * 1000) / 1000 : null,
		};
	});
	const delivered = (byOutcome.delivered || 0) + (byOutcome.delivered_with_issues || 0) + (byOutcome.partial || 0);
	const finished = total - (byOutcome.pending || 0) - (byOutcome.refused || 0);
	return {
		days,
		total,
		outcomes: byOutcome,
		delivery_rate: finished ? Math.round((delivered / finished) * 1000) / 1000 : null,
		clean_rate: finished ? Math.round((clean / finished) * 1000) / 1000 : null,
		tools: byTool,
		stages: ran,
		top_causes: causes.map((c) => ({ stage: c.stage, label: c.label, verdict: c.verdict, cause: c.cause, count: c.n })),
	};
}

// ── observation helpers ──────────────────────────────────────────────────────

/** Public catalog label for an engine id; unknown ids get a neutral name, never the raw id. */
export function engineLabel(backendId) {
	const b = backendId ? BACKENDS[backendId] : null;
	return b?.label || 'a backup engine';
}

async function readHead(url, bytes) {
	const res = await fetch(url, {
		headers: { Range: `bytes=0-${bytes - 1}` },
		signal: AbortSignal.timeout(RIG_INSPECT_TIMEOUT_MS),
	});
	if (!res.ok) throw new Error(`the file answered ${res.status}`);
	const len = Number(res.headers?.get?.('content-length'));
	if (Number.isFinite(len) && len > RIG_MAX_BYTES) throw new Error('the file is too large to inspect');
	return res.arrayBuffer();
}

/**
 * Read the delivered rigged file and run Rig Doctor's analysis on it. Only the
 * glTF JSON chunk is needed, so a ranged read normally suffices; when the
 * chunk is longer than the first read, exactly enough more is fetched.
 *
 * @returns {Promise<{ report: object|null, error: string|null, ms: number }>}
 */
export async function inspectRiggedGlb(url) {
	const t0 = Date.now();
	if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) return { report: null, error: 'no file URL to inspect', ms: 0 };
	try {
		let buf = await readHead(url, RIG_PREFIX_BYTES);
		const view = buf.byteLength >= 20 ? new DataView(buf) : null;
		const need = view ? 20 + view.getUint32(12, true) + 8 : 0;
		if (view && need > buf.byteLength && need <= RIG_MAX_BYTES) buf = await readHead(url, need);
		return { report: analyzeGlb(buf), error: null, ms: Date.now() - t0 };
	} catch (err) {
		return { report: null, error: err?.message || String(err), ms: Date.now() - t0 };
	}
}

/** The public page for one receipt. */
export function receiptUrl(base, id) {
	return `${base}/runs/${encodeURIComponent(id)}`;
}
