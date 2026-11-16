// PDF knowledge uploads as stepped jobs.
//
// Reading a PDF as layout (api/_lib/pdf-extract.js: NVIDIA NeMo Retriever page
// elements, table structure, graphic elements and OCR) takes seconds per page,
// longer than an upload request should hang. Cloud Run throttles CPU outside
// requests and no queue is configured, so the job is advanced by requests:
//
//   createPdfJob   validate, count pages, enforce the per-plan page cap, hold
//                  the bytes in agent_knowledge_jobs, answer 202
//   stepJob        claim a lease, extract pages until the time budget is spent
//                  (at least one), save blocks + table previews + progress;
//                  once every page is read, chunk (chunkPdfBlocks) and store
//                  (storeDocument), then drop the bytes
//   resumeStalled  the cron's entry: steps jobs whose browser went away
//
// Fallback contract: any failure of the NVIDIA path (model retired, upstream
// down, page timeout, unreadable render) switches the whole document to the
// previous extractor: MarkItDown when configured, else the PDF text layer.
// The upload still succeeds; meta.extractor and meta.fallback_reason record
// what happened. KNOWLEDGE_PDF_EXTRACTOR=text forces the text path.

import { sql } from './db.js';
import { shortId } from './ids.js';
import {
	KnowledgeError,
	FORMATS,
	MAX_UPLOAD_BYTES,
	preflightUpload,
	storeDocument,
	markitdownConfigured,
	convertWithMarkItDown,
	presentDoc,
} from './agent-knowledge.js';
import { chunkDocument, chunkPdfBlocks } from './knowledge-chunker.js';
import { openPdf, closePdf, pdfPageTexts } from './pdf-render.js';
import { extractPage } from './pdf-extract.js';
import { nvidiaExtractConfigured, MODELS } from './nvidia-doc-extract.js';

export const PAGE_LIMITS = Object.freeze({ free: 60, paid: 300, enterprise: 1000 });
const PAID_PLANS = new Set(['pro', 'team']);
const STEP_BUDGET_MS = 20_000;
const PAGE_TIMEOUT_MS = 90_000;
const LEASE_S = 150;
const PAGE_CONCURRENCY = 2;
const MAX_ATTEMPTS = 3;
const MAX_PREVIEW_TABLES = 24;
const PREVIEW_CHARS = 4_000;
const ACTIVE = ['queued', 'extracting', 'indexing'];
const PDF_FORMAT = FORMATS.find((f) => f.kind === 'pdf');

/** Which extractor PDF uploads use: 'nemotron' (layout) or 'text'. */
export function pdfExtractorMode() {
	const forced = String(process.env.KNOWLEDGE_PDF_EXTRACTOR || '').trim().toLowerCase();
	if (forced === 'text' || forced === 'markitdown') return 'text';
	return nvidiaExtractConfigured() ? 'nemotron' : 'text';
}

/** Pages one upload may have on `plan` (users.plan). */
export function pageLimitForPlan(plan) {
	const p = String(plan || '').toLowerCase();
	if (p === 'enterprise') return PAGE_LIMITS.enterprise;
	if (PAID_PLANS.has(p)) return PAGE_LIMITS.paid;
	return PAGE_LIMITS.free;
}

const JOB_COLUMNS = sql`
	id, agent_id, user_id, name, sha256, byte_size, status, page_count, pages_done, tables,
	stats, extractor, fallback_reason, error_code, error, attempts, doc_id, created_at, updated_at
`;

export function presentJob(row, doc = null) {
	return {
		id: row.id,
		name: row.name,
		status: row.status,
		page_count: Number(row.page_count),
		pages_done: Number(row.pages_done),
		tables: Array.isArray(row.tables) ? row.tables : [],
		stats: row.stats || {},
		extractor: row.extractor,
		fallback_reason: row.fallback_reason || null,
		error: row.status === 'failed' ? { code: row.error_code || 'failed', message: row.error || 'Reading the PDF failed.' } : null,
		doc_id: row.doc_id || null,
		doc,
		created_at: row.created_at,
		updated_at: row.updated_at,
	};
}

async function countPages(bytes) {
	let doc;
	try {
		doc = await openPdf(bytes);
		return doc.numPages;
	} catch (err) {
		if (err?.name === 'PasswordException') {
			throw new KnowledgeError(422, 'encrypted_pdf', 'This PDF is password protected. Remove the password and upload it again.');
		}
		throw new KnowledgeError(422, 'unreadable_pdf', 'This file could not be opened as a PDF. Check that it is a valid, complete PDF.');
	} finally {
		await closePdf(doc);
	}
}

/**
 * Start a PDF upload. Answers with the existing doc for a duplicate file, the
 * running job for a duplicate in flight, or a new queued job.
 * @returns {Promise<{ duplicate?: boolean, doc?: object, job?: object }>}
 */
export async function createPdfJob({ agentId, userId, name, bytes }) {
	if (bytes?.length > MAX_UPLOAD_BYTES) throw new KnowledgeError(413, 'file_too_large', `Files can be up to ${MAX_UPLOAD_BYTES / (1024 * 1024)} MB.`);
	const [{ pending }] = await sql`
		SELECT count(*)::int AS pending FROM agent_knowledge_jobs WHERE agent_id = ${agentId} AND status = ANY(${ACTIVE}::text[])
	`;
	const { sha256, existing } = await preflightUpload({ agentId, bytes, pending });
	if (existing) return { duplicate: true, doc: existing };

	const [running] = await sql`
		SELECT ${JOB_COLUMNS} FROM agent_knowledge_jobs
		WHERE agent_id = ${agentId} AND sha256 = ${sha256} AND status = ANY(${ACTIVE}::text[])
	`;
	if (running) return { duplicate: true, job: presentJob(running) };

	const pageCount = await countPages(bytes);
	const [user] = await sql`SELECT plan FROM users WHERE id = ${userId}`;
	const limit = pageLimitForPlan(user?.plan);
	if (pageCount > limit) {
		throw new KnowledgeError(
			413,
			'too_many_pages',
			`This PDF has ${pageCount} pages. Your plan reads up to ${limit} pages per upload: split the file into parts of ${limit} pages or fewer${limit < PAGE_LIMITS.paid ? ', or upgrade to read up to ' + PAGE_LIMITS.paid : ''}.`,
			{ page_count: pageCount, page_limit: limit },
		);
	}

	const id = shortId('akj');
	const [row] = await sql`
		INSERT INTO agent_knowledge_jobs (id, agent_id, user_id, name, sha256, byte_size, file, page_count, extractor)
		VALUES (${id}, ${agentId}, ${userId}, ${String(name).slice(0, 255)}, ${sha256}, ${bytes.length}, ${Buffer.from(bytes)},
		        ${pageCount}, ${pdfExtractorMode()})
		RETURNING ${JOB_COLUMNS}
	`;
	return { job: presentJob(row) };
}

export async function getJob(agentId, jobId) {
	const [row] = await sql`SELECT ${JOB_COLUMNS} FROM agent_knowledge_jobs WHERE id = ${jobId} AND agent_id = ${agentId}`;
	if (!row) return null;
	return presentJob(row, row.doc_id ? await docFor(row.doc_id) : null);
}

async function docFor(docId) {
	const [d] = await sql`
		SELECT id, agent_id, uploaded_by, name, kind, mime, byte_size, sha256, title, meta, chunk_count, token_count, embedder, created_at
		FROM agent_knowledge_docs WHERE id = ${docId}
	`;
	return d ? presentDoc(d) : null;
}

// Claim the job for this stepper. Another stepper holding a live lease wins;
// this call then just reports progress.
async function claim(jobId, agentId) {
	const [row] = await sql`
		UPDATE agent_knowledge_jobs
		SET lease_until = now() + make_interval(secs => ${LEASE_S}),
		    status = CASE WHEN status = 'queued' THEN 'extracting' ELSE status END,
		    updated_at = now()
		WHERE id = ${jobId} AND (${agentId}::uuid IS NULL OR agent_id = ${agentId}::uuid)
		  AND status = ANY(${ACTIVE}::text[]) AND (lease_until IS NULL OR lease_until < now())
		RETURNING ${JOB_COLUMNS}, file, blocks
	`;
	return row || null;
}

async function release(jobId, fields = {}) {
	const status = fields.status ?? null;
	const finished = status === 'done' || status === 'failed';
	await sql`
		UPDATE agent_knowledge_jobs
		SET lease_until = NULL,
		    updated_at = now(),
		    status = COALESCE(${status}, status),
		    doc_id = COALESCE(${fields.doc_id ?? null}, doc_id),
		    error_code = COALESCE(${fields.error_code ?? null}, error_code),
		    error = COALESCE(${fields.error ?? null}, error),
		    attempts = attempts + ${fields.failed_attempt ? 1 : 0},
		    file = CASE WHEN ${finished} THEN NULL ELSE file END,
		    blocks = CASE WHEN ${finished} THEN '[]'::jsonb ELSE blocks END
		WHERE id = ${jobId}
	`;
}

function withTimeout(promise, ms, label) {
	let timer;
	return Promise.race([
		promise.finally(() => clearTimeout(timer)),
		new Promise((_, reject) => {
			timer = setTimeout(() => reject(new Error(`${label} took longer than ${ms / 1000}s`)), ms);
		}),
	]);
}

function tablePreviews(blocks) {
	return blocks
		.filter((b) => b.type === 'table')
		.map((b) => ({
			page: b.page,
			caption: b.caption || null,
			markdown: String(b.markdown || b.text).slice(0, PREVIEW_CHARS),
			rows: b.cells ? b.cells.length : null,
			columns: b.cells?.[0] ? b.cells[0].length : null,
			truncated: String(b.markdown || b.text).length > PREVIEW_CHARS,
		}));
}

/**
 * Advance a job by up to `budgetMs` of work. Safe to call concurrently: only
 * the lease holder works, everyone else gets the current progress.
 * `agentId` null is the cron (any agent).
 * @returns {Promise<object|null>} the job, presented
 */
export async function stepJob(jobId, { agentId = null, budgetMs = STEP_BUDGET_MS } = {}) {
	const row = await claim(jobId, agentId);
	if (!row) {
		const [cur] = await sql`
			SELECT ${JOB_COLUMNS} FROM agent_knowledge_jobs
			WHERE id = ${jobId} AND (${agentId}::uuid IS NULL OR agent_id = ${agentId}::uuid)
		`;
		return cur ? presentJob(cur, cur.doc_id ? await docFor(cur.doc_id) : null) : null;
	}
	const started = Date.now();
	try {
		if (row.status === 'extracting' && row.extractor === 'nemotron') {
			const outcome = await extractPages(row, started, budgetMs);
			if (outcome === 'fallback') return await finishWithText(row);
			if (outcome === 'more') {
				await release(row.id);
				return getJob(row.agent_id, row.id);
			}
		}
		if (row.extractor !== 'nemotron') return await finishWithText(row);
		return await finishLayout(row);
	} catch (err) {
		return fail(row, err);
	}
}

// Extract pages until the budget is spent. Returns 'done' when every page is
// read, 'more' when pages remain, 'fallback' when the NVIDIA path failed.
async function extractPages(row, started, budgetMs) {
	let pagesDone = Number(row.pages_done);
	const total = Number(row.page_count);
	if (pagesDone >= total) return 'done';
	let doc;
	try {
		doc = await openPdf(row.file);
		while (pagesDone < total) {
			const batch = [];
			for (let p = pagesDone + 1; p <= total && batch.length < PAGE_CONCURRENCY; p++) batch.push(p);
			const results = await Promise.all(batch.map((p) => withTimeout(extractPage(doc, p), PAGE_TIMEOUT_MS, `Reading page ${p}`)));
			const blocks = results.flatMap((r) => r.blocks);
			const scanned = results.filter((r) => r.scanned).length;
			const tablesFound = blocks.filter((b) => b.type === 'table').length;
			const chartsFound = blocks.filter((b) => b.type === 'chart').length;
			pagesDone += batch.length;
			await sql`
				UPDATE agent_knowledge_jobs
				SET blocks = blocks || ${JSON.stringify(blocks)}::jsonb,
				    tables = (
				      SELECT COALESCE(jsonb_agg(e ORDER BY i), '[]'::jsonb)
				      FROM jsonb_array_elements(tables || ${JSON.stringify(tablePreviews(blocks))}::jsonb) WITH ORDINALITY AS t(e, i)
				      WHERE i <= ${MAX_PREVIEW_TABLES}),
				    pages_done = ${pagesDone},
				    stats = jsonb_build_object(
				      'tables', COALESCE((stats->>'tables')::int, 0) + ${tablesFound},
				      'charts', COALESCE((stats->>'charts')::int, 0) + ${chartsFound},
				      'scanned_pages', COALESCE((stats->>'scanned_pages')::int, 0) + ${scanned}),
				    status = CASE WHEN ${pagesDone >= total} THEN 'indexing' ELSE status END,
				    lease_until = now() + make_interval(secs => ${LEASE_S}),
				    updated_at = now()
				WHERE id = ${row.id}
			`;
			if (Date.now() - started >= budgetMs) break;
		}
	} catch (err) {
		console.warn(`[knowledge-pdf-jobs] ${row.id} layout extraction failed, falling back to text:`, err?.message);
		row.fallback_reason = String(err?.message || err).slice(0, 300);
		return 'fallback';
	} finally {
		await closePdf(doc);
	}
	return pagesDone >= total ? 'done' : 'more';
}

async function finishLayout(row) {
	const [full] = await sql`SELECT blocks, tables, stats FROM agent_knowledge_jobs WHERE id = ${row.id}`;
	const blocks = Array.isArray(full?.blocks) ? full.blocks : [];
	const title = blocks.find((b) => b.page === 1 && b.type === 'title')?.text?.slice(0, 300) || null;
	const chunks = chunkPdfBlocks(blocks, { title: title || row.name });
	if (!chunks.length) {
		row.fallback_reason = 'layout extraction found no text';
		return finishWithText(row);
	}
	const stats = full.stats || {};
	const doc = await storeDocument({
		agentId: row.agent_id,
		userId: row.user_id,
		name: row.name,
		format: PDF_FORMAT,
		byteSize: Number(row.byte_size),
		sha256: row.sha256,
		title,
		meta: {
			pages: Number(row.page_count),
			extractor: 'nemotron',
			models: [MODELS.pageElements, MODELS.tableStructure, MODELS.graphicElements, MODELS.ocr, MODELS.chartReader],
			tables: Number(stats.tables) || 0,
			charts: Number(stats.charts) || 0,
			scanned_pages: Number(stats.scanned_pages) || 0,
		},
		chunks,
	});
	await release(row.id, { status: 'done', doc_id: doc.id });
	return presentJob({ ...row, status: 'done', doc_id: doc.id, pages_done: row.page_count, tables: full.tables, stats }, doc);
}

// The previous extractor for the whole document: MarkItDown when the worker
// is configured, else pdf.js's text layer split into pages.
async function finishWithText(row) {
	const reason = row.fallback_reason || (row.extractor === 'nemotron' ? null : 'layout extraction disabled');
	// Recorded before converting, so a retry after a transient failure stays on
	// the text path instead of re-indexing partial layout blocks. Tables and
	// stats from pages read before the failure no longer describe the indexed
	// document, so they are cleared with the blocks.
	if (reason) {
		await sql`
			UPDATE agent_knowledge_jobs
			SET fallback_reason = ${reason}, extractor = 'text', status = 'indexing',
			    blocks = '[]'::jsonb, tables = '[]'::jsonb, stats = '{}'::jsonb, updated_at = now()
			WHERE id = ${row.id}
		`;
	}
	let markdown = '';
	let extractor = 'text-layer';
	if (markitdownConfigured()) {
		const converted = await convertWithMarkItDown({ bytes: row.file, name: row.name, mime: PDF_FORMAT.mime });
		markdown = converted.markdown;
		extractor = 'markitdown';
	} else {
		markdown = (await pdfPageTexts(row.file)).join('\f');
	}
	const chunks = chunkDocument(markdown, { kind: 'pdf', title: row.name });
	if (!chunks.length) {
		throw new KnowledgeError(
			422,
			'no_text',
			'No readable text was found in this PDF. It looks scanned, and the page reader that handles scanned pages is unavailable right now. Try again later.',
		);
	}
	const doc = await storeDocument({
		agentId: row.agent_id,
		userId: row.user_id,
		name: row.name,
		format: PDF_FORMAT,
		byteSize: Number(row.byte_size),
		sha256: row.sha256,
		title: null,
		meta: { pages: Number(row.page_count), extractor, ...(reason ? { fallback_reason: reason } : {}) },
		chunks,
	});
	await release(row.id, { status: 'done', doc_id: doc.id });
	return presentJob(
		{ ...row, status: 'done', doc_id: doc.id, pages_done: row.page_count, fallback_reason: reason, extractor: 'text', tables: [], stats: {} },
		doc,
	);
}

// Permanent errors (no text, bad file) fail at once; transient ones (embedder
// or converter down) release the lease so the next step or the cron retries,
// up to MAX_ATTEMPTS.
async function fail(row, err) {
	const status = err instanceof KnowledgeError ? err.status : 500;
	const transient = status >= 500 && Number(row.attempts) + 1 < MAX_ATTEMPTS;
	console.error(`[knowledge-pdf-jobs] ${row.id} ${transient ? 'retrying after' : 'failed'}:`, err?.message);
	if (transient) {
		await release(row.id, { failed_attempt: true });
	} else {
		await release(row.id, {
			status: 'failed',
			failed_attempt: true,
			error_code: err?.code || 'failed',
			error: err instanceof KnowledgeError ? err.message : 'Reading the PDF failed. Try uploading it again.',
		});
	}
	return getJob(row.agent_id, row.id);
}

/**
 * Cron entry: step every active job nobody has touched for `idleS` seconds.
 * @returns {Promise<{ id: string, status: string, pages_done: number }[]>}
 */
export async function resumeStalled({ idleS = 45, limit = 4, budgetMs = 45_000 } = {}) {
	const rows = await sql`
		SELECT id FROM agent_knowledge_jobs
		WHERE status = ANY(${ACTIVE}::text[]) AND updated_at < now() - make_interval(secs => ${idleS})
		  AND (lease_until IS NULL OR lease_until < now())
		ORDER BY updated_at
		LIMIT ${limit}
	`;
	const out = [];
	for (const { id } of rows) {
		const job = await stepJob(id, { budgetMs });
		if (job) out.push({ id, status: job.status, pages_done: job.pages_done });
	}
	return out;
}

/** Recent jobs for an agent (the panel shows in-flight ones after a reload). */
export async function listActiveJobs(agentId) {
	const rows = await sql`
		SELECT ${JOB_COLUMNS} FROM agent_knowledge_jobs
		WHERE agent_id = ${agentId} AND (status = ANY(${ACTIVE}::text[]) OR (status = 'failed' AND updated_at > now() - interval '1 day'))
		ORDER BY created_at DESC
		LIMIT 20
	`;
	return rows.map((r) => presentJob(r));
}
