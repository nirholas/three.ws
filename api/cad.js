/**
 * CAD Forge: a sentence becomes a real, dimensioned, manufacturable part.
 *
 *   POST /api/cad { action:'generate', prompt, parentId?, values?, stream? }
 *       A model writes a parametric build123d program, workers/cad-forge builds
 *       it on the OpenCascade kernel, and kernel errors go back to the model for
 *       repair until the part builds. With parentId the parent's program (at
 *       `values`, if given) is refined instead of starting fresh. The design is
 *       saved with its STEP, STL, GLB and SVG drawing files.
 *       stream:true answers text/event-stream: `stage` events (writing,
 *       building, repairing, built, saving) then one `done` { design } or
 *       `error` { error, message }. Otherwise one JSON body { design }.
 *
 *   POST /api/cad { action:'rebuild', id, values }
 *       Rebuilds a saved design's own program with new parameter values (no
 *       model involved). Each distinct value set is cached, so a shared
 *       configuration link builds once. → { variant }
 *
 *   GET  /api/cad?id=<uuid>[&v=<key>]       → { design, lineage, variant? }
 *   GET  /api/cad?id=<uuid>&format=py[&v=]  → the program as a .py download
 *   GET  /api/cad?list=recent|featured[&q=][&limit=] → { designs }
 *
 * No mocks: when the builder or the writer is unreachable the caller gets a
 * designed 503, never a fabricated part. Every part returned has been accepted
 * by the geometry kernel.
 */

import { cors, json, method, readJson, wrap, rateLimited } from './_lib/http.js';
import { limits, clientIp } from './_lib/rate-limit.js';
import { getSessionUser } from './_lib/auth.js';
import { CadForgeError, buildProgram, cadWorkerConfigured, forgeDesign } from './_lib/cad/forge.js';
import {
	bumpViews,
	cadStoreEnabled,
	getDesign,
	getLineage,
	getVariant,
	listDesigns,
	newDesignId,
	saveDesign,
	saveVariant,
	uploadArtifacts,
} from './_lib/cad/store.js';
import { MAX_PROMPT_LEN, applyParams, paramsKey } from '../src/cad/params.js';

const SITE = process.env.PUBLIC_BASE_URL || 'https://three.ws';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VARIANT_RE = /^[0-9a-z]{1,16}$/;
const KEEPALIVE_MS = 15_000;

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,POST,OPTIONS' })) return;
	if (!method(req, res, ['GET', 'POST'])) return;
	if (req.method === 'GET') return handleGet(req, res);

	const body = await readJson(req, 64_000).catch(() => null);
	if (!body || typeof body !== 'object') {
		return json(res, 400, { error: 'invalid_body', message: 'Send a JSON body.' });
	}
	if (body.action === 'generate') return handleGenerate(req, res, body);
	if (body.action === 'rebuild') return handleRebuild(req, res, body);
	return json(res, 400, { error: 'unknown_action', message: 'action must be "generate" or "rebuild".' });
});

function unavailable(res) {
	return json(res, 503, {
		error: 'cad_unavailable',
		message: 'CAD Forge is not configured on this deployment.',
	});
}

function designUrl(id, key) {
	return `${SITE}/cad/${id}${key ? `?v=${key}` : ''}`;
}

function publicDesign(design) {
	return { ...design, url: designUrl(design.id) };
}

async function handleGet(req, res) {
	const url = new URL(req.url, 'http://x');
	const id = url.searchParams.get('id');
	const list = url.searchParams.get('list');

	if (id) {
		if (!UUID_RE.test(id)) return json(res, 400, { error: 'invalid_id', message: 'Malformed design id.' });
		const design = await getDesign(id);
		if (!design) return json(res, 404, { error: 'not_found', message: 'No design with that id.' });
		const key = url.searchParams.get('v');
		const variant = key && VARIANT_RE.test(key) ? await getVariant(id, key) : null;

		if (url.searchParams.get('format') === 'py') {
			const code = variant ? applyParams(design.code, variant.values).code : design.code;
			const slug = design.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'part';
			res.statusCode = 200;
			res.setHeader('content-type', 'text/x-python; charset=utf-8');
			res.setHeader('content-disposition', `attachment; filename="${slug}.py"`);
			res.setHeader('cache-control', 'public, max-age=300');
			res.end(code.endsWith('\n') ? code : `${code}\n`);
			return;
		}

		bumpViews(id);
		const lineage = await getLineage(id);
		return json(
			res,
			200,
			{ design: publicDesign(design), lineage, variant },
			{ 'cache-control': 'public, max-age=15, s-maxage=60' },
		);
	}

	if (list !== null) {
		const scope = list === 'featured' ? 'featured' : 'recent';
		const designs = await listDesigns({
			scope,
			limit: Number(url.searchParams.get('limit')) || 24,
			q: url.searchParams.get('q') || undefined,
		});
		return json(
			res,
			200,
			{ designs, available: cadStoreEnabled() && cadWorkerConfigured() },
			{ 'cache-control': 'public, max-age=20, s-maxage=60' },
		);
	}

	return json(res, 400, { error: 'bad_request', message: 'Pass ?id= or ?list=.' });
}

function openStream(res) {
	res.statusCode = 200;
	res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
	res.setHeader('Cache-Control', 'no-cache, no-store');
	res.setHeader('Connection', 'keep-alive');
	res.setHeader('X-Accel-Buffering', 'no');
	res.flushHeaders?.();
	const send = (event, data) => {
		if (res.writableEnded) return;
		res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
	};
	// A design can spend a minute or more inside one model call; comments keep
	// proxies from timing the idle connection out.
	const keepalive = setInterval(() => {
		if (!res.writableEnded) res.write(': keepalive\n\n');
	}, KEEPALIVE_MS);
	const close = () => {
		clearInterval(keepalive);
		if (!res.writableEnded) res.end();
	};
	return { send, close };
}

async function handleGenerate(req, res, body) {
	const prompt = String(body.prompt ?? '').slice(0, MAX_PROMPT_LEN).trim();
	if (prompt.length < 3) {
		return json(res, 400, { error: 'prompt_required', message: 'Describe the part you need.' });
	}
	if (!cadWorkerConfigured() || !cadStoreEnabled()) return unavailable(res);

	let parent = null;
	if (body.parentId != null) {
		if (!UUID_RE.test(String(body.parentId))) {
			return json(res, 400, { error: 'invalid_parent', message: 'Malformed parent design id.' });
		}
		parent = await getDesign(String(body.parentId));
		if (!parent) return json(res, 404, { error: 'parent_not_found', message: 'The design you are refining no longer exists.' });
	}

	const ip = clientIp(req);
	const rl = await limits.cadForgeIp(ip);
	if (!rl.success) return rateLimited(res, rl, 'Design limit reached. Try again in a few minutes.');
	const globalRl = await limits.cadForgeGlobal();
	if (!globalRl.success) return rateLimited(res, globalRl, 'CAD Forge is at capacity. Try again shortly.');

	const sessionUser = await getSessionUser(req).catch(() => null);
	const baseCode = parent ? applyParams(parent.code, body.values || {}).code : null;
	const stream = body.stream === true ? openStream(res) : null;

	try {
		const forged = await forgeDesign({
			prompt,
			baseCode,
			track: { userId: sessionUser?.id ?? null },
			onEvent: (event) => stream?.send('stage', event),
		});
		stream?.send('stage', { stage: 'saving' });
		const id = newDesignId();
		const files = await uploadArtifacts(`cad/${id}`, forged.build.artifacts);
		const saved = await saveDesign({
			id,
			parentId: parent?.id || null,
			title: forged.title,
			summary: forged.summary,
			prompt,
			code: forged.code,
			params: forged.params,
			metrics: forged.build.metrics,
			files,
			adjustments: forged.build.adjustments || [],
			model: forged.model,
			userId: sessionUser?.id ?? null,
		});
		if (!saved) throw new CadForgeError('save_failed', 'The part built but could not be saved. Try again.', 500);
		const design = publicDesign({ ...saved, creatorUsername: sessionUser?.username || null });
		const payload = { design, attempts: forged.attempts.length };
		if (stream) {
			stream.send('done', payload);
			stream.close();
			return;
		}
		return json(res, 201, payload);
	} catch (err) {
		const known = err instanceof CadForgeError;
		if (!known) console.error('[cad] generate failed:', err?.message);
		const status = known ? err.status : 500;
		const out = {
			error: known ? err.code : 'internal_error',
			message: known ? err.message : 'Something went wrong building this part. Try again.',
			...(known && err.code === 'design_failed' ? { lastError: err.detail?.lastError || null } : {}),
		};
		if (stream) {
			stream.send('error', { status, ...out });
			stream.close();
			return;
		}
		return json(res, status, out);
	}
}

async function handleRebuild(req, res, body) {
	const id = String(body.id ?? '');
	if (!UUID_RE.test(id)) return json(res, 400, { error: 'invalid_id', message: 'Malformed design id.' });
	if (!cadWorkerConfigured() || !cadStoreEnabled()) return unavailable(res);
	const design = await getDesign(id);
	if (!design) return json(res, 404, { error: 'not_found', message: 'No design with that id.' });

	const { code, applied } = applyParams(design.code, body.values || {});
	const key = paramsKey(applied);
	const cached = await getVariant(id, key);
	if (cached) return json(res, 200, { variant: { ...cached, url: designUrl(id, key) }, cached: true });

	const rl = await limits.cadRebuildIp(clientIp(req));
	if (!rl.success) return rateLimited(res, rl, 'Rebuilding too fast. Give it a moment.');

	let build;
	try {
		build = await buildProgram(code);
	} catch (err) {
		if (err instanceof CadForgeError) return json(res, err.status, { error: err.code, message: err.message });
		throw err;
	}
	if (!build?.ok) {
		return json(res, 422, {
			error: 'rebuild_failed',
			message: 'These values do not make a valid part. Try values closer to the original.',
			buildError: build?.error || null,
		});
	}
	const files = await uploadArtifacts(`cad/${id}/v/${key}`, build.artifacts);
	const variant = await saveVariant({
		designId: id,
		key,
		values: applied,
		metrics: build.metrics,
		files,
		adjustments: build.adjustments || [],
	});
	if (!variant) return json(res, 500, { error: 'save_failed', message: 'The part rebuilt but could not be saved. Try again.' });
	return json(res, 200, { variant: { ...variant, url: designUrl(id, key) }, cached: false });
}
