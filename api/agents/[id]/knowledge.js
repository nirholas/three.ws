/**
 * Documents an agent learns from (Word, PowerPoint, Excel, PDF, Outlook).
 *
 * Routes (vercel.json rewrites map /api/agents/:id/knowledge... to this file):
 *   GET    /api/agents/:id/knowledge             docs with chunk counts, limits, formats
 *   POST   /api/agents/:id/knowledge             upload one file: raw bytes as the body,
 *                                                X-File-Name: <url-encoded name>,
 *                                                Content-Type: the file's MIME type
 *                                                PDFs answer 202 with a job (below);
 *                                                other formats answer 201 with the doc
 *   POST   /api/agents/:id/knowledge/search      { query } -> the chunks chat would use
 *   DELETE /api/agents/:id/knowledge/:docId      remove a doc and all of its chunks
 *   GET    /api/agents/:id/knowledge/:docId/tables   tables extracted from a PDF
 *   GET    /api/agents/:id/knowledge/jobs        PDF jobs in flight (and failures today)
 *   GET    /api/agents/:id/knowledge/jobs/:jobId progress, table previews, result
 *   POST   /api/agents/:id/knowledge/jobs/:jobId/step   advance the job by ~20s of
 *                                                page reading; the upload panel calls
 *                                                this until the job is done
 *
 * Owner-only. Browsers use the session cookie (mutations carry CSRF); API keys
 * and OAuth tokens need agents:read / agents:write. The pipeline lives in
 * api/_lib/agent-knowledge.js (PDF jobs: api/_lib/knowledge-pdf-jobs.js);
 * docs/agent-knowledge.md is the user guide.
 */

import { getRequestUser, hasScope } from '../../_lib/auth.js';
import { cors, json, wrap, error, readBody, readJson, rateLimited } from '../../_lib/http.js';
import { limits, clientIp } from '../../_lib/rate-limit.js';
import { requireCsrf } from '../../_lib/csrf.js';
import { isUuid } from '../../_lib/validate.js';
import { CustomSkillError, requireOwnedAgent } from '../../_lib/agent-custom-skills.js';
import {
	KnowledgeError,
	MAX_UPLOAD_BYTES,
	deleteDocument,
	errors,
	formatForFileName,
	ingestDocument,
	listDocumentTables,
	listDocuments,
	markitdownConfigured,
	searchKnowledge,
} from '../../_lib/agent-knowledge.js';
import { createPdfJob, getJob, listActiveJobs, pdfExtractorMode, stepJob } from '../../_lib/knowledge-pdf-jobs.js';

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,POST,DELETE,OPTIONS', credentials: true })) return;

	const url = new URL(req.url, 'http://x');
	const parts = url.pathname.split('/').filter(Boolean);
	const agentId = url.searchParams.get('id') || parts[2] || null;
	const docId = url.searchParams.get('doc_id') || null;
	const action = url.searchParams.get('action') || null;
	const jobId = url.searchParams.get('job_id') || null;

	if (!agentId || !isUuid(agentId)) return error(res, 400, 'validation_error', 'valid agent id required');

	const isSearch = req.method === 'POST' && action === 'search';
	const write = req.method !== 'GET' && !isSearch;
	const user = await getRequestUser(req, res);
	if (!user) return error(res, 401, 'unauthorized', 'sign in or send a bearer token');
	if (user.source === 'bearer' && !hasScope(user.scope, write ? 'agents:write' : 'agents:read')) {
		return error(res, 403, 'insufficient_scope', `this token needs ${write ? 'agents:write' : 'agents:read'}`);
	}

	if (req.method !== 'GET') {
		// Job steps repeat every few seconds while a PDF is read and only advance
		// work the caller already started (lease-guarded), so they ride the
		// generous authed-read bucket instead of the strict write one.
		const isStep = !!jobId && action === 'step';
		const rl = await (isStep ? limits.authedReadIp(clientIp(req)) : limits.authIp(clientIp(req)));
		if (!rl.success) return rateLimited(res, rl);
		if (!(await requireCsrf(req, res, user.id))) return;
	}

	try {
		await requireOwnedAgent(agentId, user.id);

		if (jobId) return await handleJob(req, res, agentId, jobId, action);
		if (req.method === 'GET' && action === 'jobs') return json(res, 200, { data: { jobs: await listActiveJobs(agentId) } });
		if (req.method === 'GET' && docId && action === 'tables') {
			return json(res, 200, { data: { doc_id: docId, tables: await listDocumentTables(agentId, docId) } });
		}
		if (req.method === 'GET' && !docId) {
			const listing = await listDocuments(agentId);
			return json(res, 200, { data: { ...listing, jobs: await listActiveJobs(agentId) } });
		}
		if (isSearch) return await handleSearch(req, res, agentId);
		if (req.method === 'POST' && !docId) return await handleUpload(req, res, agentId, user.id);
		if (req.method === 'DELETE' && docId) {
			if (!(await deleteDocument(agentId, docId))) return error(res, 404, 'not_found', 'document not found');
			return json(res, 200, { data: { deleted: true, id: docId, ...(await listDocuments(agentId)) } });
		}
		return error(res, 405, 'method_not_allowed', 'method not allowed');
	} catch (err) {
		if (err instanceof KnowledgeError || err instanceof CustomSkillError) {
			return error(res, err.status, err.code, err.message, err.extra);
		}
		throw err;
	}
});

async function handleUpload(req, res, agentId, userId) {
	const name = decodeName(req.headers['x-file-name']);
	if (!name) return error(res, 400, 'missing_file_name', 'Send the original file name in the X-File-Name header.');
	if (!formatForFileName(name)) throw errors.unsupported();

	// Refuse an oversized upload from its declared length before reading a byte.
	const declared = Number(req.headers['content-length']);
	if (Number.isFinite(declared) && declared > MAX_UPLOAD_BYTES) throw errors.tooLarge();
	// PDFs are read by the layout job (or its text-layer fallback), which needs
	// no converter. Every other format goes through MarkItDown.
	const isPdf = formatForFileName(name).kind === 'pdf';
	if (!isPdf && !markitdownConfigured()) {
		throw new KnowledgeError(503, 'converter_unavailable', 'Document conversion is not configured on this server (GCP_MARKITDOWN_URL).');
	}

	let bytes;
	try {
		bytes = await readBody(req, MAX_UPLOAD_BYTES);
	} catch (err) {
		if (err?.status === 413) throw errors.tooLarge();
		throw err;
	}
	if (!bytes?.length) return error(res, 400, 'empty_file', 'The file is empty.');

	if (isPdf && (pdfExtractorMode() === 'nemotron' || !markitdownConfigured())) {
		const out = await createPdfJob({ agentId, userId, name, bytes });
		if (out.doc) return json(res, 200, { data: { doc: out.doc, duplicate: true } });
		return json(res, out.duplicate ? 200 : 202, { data: { job: out.job, duplicate: !!out.duplicate } });
	}

	const { doc, duplicate } = await ingestDocument({ agentId, userId, name, bytes });
	return json(res, duplicate ? 200 : 201, { data: { doc, duplicate } });
}

async function handleJob(req, res, agentId, jobId, action) {
	if (req.method === 'POST' && action === 'step') {
		const job = await stepJob(jobId, { agentId });
		if (!job) return error(res, 404, 'not_found', 'job not found');
		return json(res, 200, { data: { job } });
	}
	if (req.method === 'GET') {
		const job = await getJob(agentId, jobId);
		if (!job) return error(res, 404, 'not_found', 'job not found');
		return json(res, 200, { data: { job } });
	}
	return error(res, 405, 'method_not_allowed', 'method not allowed');
}

async function handleSearch(req, res, agentId) {
	const body = await readJson(req);
	const query = typeof body?.query === 'string' ? body.query.trim() : '';
	if (query.length < 2) return error(res, 400, 'validation_error', 'query must be at least 2 characters');
	const topK = Math.max(1, Math.min(10, Number(body?.top_k) || 5));
	return json(res, 200, { data: { query, ...(await searchKnowledge(agentId, query, { topK })) } });
}

function decodeName(raw) {
	if (typeof raw !== 'string' || !raw.trim()) return '';
	let name;
	try {
		name = decodeURIComponent(raw);
	} catch {
		name = raw;
	}
	return name.replace(/[\u0000-\u001f]/g, '').split(/[\\/]/).pop().trim().slice(0, 255);
}
