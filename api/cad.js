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
 *       configuration link builds once. → { ok:true, variant, cached }, or
 *       { ok:false, message, buildError } when the kernel rejects the values.
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
import { CadForgeError } from './_lib/cad/forge.js';
import { bumpViews, getDesign, getLineage, getVariant, listDesigns } from './_lib/cad/store.js';
import { UUID_RE, cadAvailable, cleanPrompt, createDesign, loadParent, publicDesign, rebuildVariant } from './_lib/cad/service.js';
import { applyParams } from '../src/cad/params.js';

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
			{ designs, available: cadAvailable() },
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

function sendError(res, err, stream) {
	const known = err instanceof CadForgeError;
	if (!known) console.error('[cad] request failed:', err?.message);
	const status = known ? err.status : 500;
	const out = {
		error: known ? err.code : 'internal_error',
		message: known ? err.message : 'Something went wrong building this part. Try again.',
		...(known && err.code === 'design_failed' ? { lastError: err.detail?.lastError || null } : {}),
		...(known && err.code === 'rebuild_failed' ? { buildError: err.detail || null } : {}),
	};
	if (stream) {
		stream.send('error', { status, ...out });
		stream.close();
		return;
	}
	return json(res, status, out);
}

async function handleGenerate(req, res, body) {
	let prompt;
	let parent;
	try {
		prompt = cleanPrompt(body.prompt);
		if (!cadAvailable()) throw new CadForgeError('cad_unavailable', 'CAD Forge is not configured on this deployment.', 503);
		parent = await loadParent(body.parentId);
	} catch (err) {
		return sendError(res, err, null);
	}

	const ip = clientIp(req);
	const rl = await limits.cadForgeIp(ip);
	if (!rl.success) return rateLimited(res, rl, 'Design limit reached. Try again in a few minutes.');
	const globalRl = await limits.cadForgeGlobal();
	if (!globalRl.success) return rateLimited(res, globalRl, 'CAD Forge is at capacity. Try again shortly.');

	const user = await getSessionUser(req).catch(() => null);
	const stream = body.stream === true ? openStream(res) : null;
	try {
		const payload = await createDesign({
			prompt,
			parent,
			values: body.values,
			user,
			onEvent: (event) => stream?.send('stage', event),
		});
		if (stream) {
			stream.send('done', payload);
			stream.close();
			return;
		}
		return json(res, 201, payload);
	} catch (err) {
		return sendError(res, err, stream);
	}
}

async function handleRebuild(req, res, body) {
	try {
		const { variant, cached } = await rebuildVariant({
			id: body.id,
			values: body.values,
			beforeBuild: async () => {
				const rl = await limits.cadRebuildIp(clientIp(req));
				if (!rl.success) throw Object.assign(new CadForgeError('rate_limited', 'Rebuilding too fast. Give it a moment.', 429), { rl });
			},
		});
		return json(res, 200, { ok: true, variant, cached });
	} catch (err) {
		if (err?.rl) return rateLimited(res, err.rl, err.message);
		// The kernel refusing a value set is an answer, not a failed request:
		// the page shows the reason beside the sliders.
		if (err instanceof CadForgeError && err.code === 'rebuild_failed') {
			return json(res, 200, { ok: false, error: err.code, message: err.message, buildError: err.detail || null });
		}
		return sendError(res, err, null);
	}
}
