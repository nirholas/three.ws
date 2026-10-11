/**
 * Anatomy: describe a machine in one line and get it back as an interactive
 * isometric cutaway with moving parts, shader effects and a guided tour.
 *
 *   POST /api/anatomy { action:'generate', prompt, stream? }
 *       Claude writes an Anatomy spec (src/anatomy/spec.js). stream:true
 *       answers text/event-stream so the page can draw the machine while it is
 *       written: `stage` { stage }, `delta` { text }, `reset` (discard the text
 *       so far), then one `done` { design, warnings } or `error`. Otherwise
 *       one JSON body { design, warnings }.
 *
 *   POST /api/anatomy { action:'publish', spec, prompt? }
 *       Saves a spec an agent wrote itself (the anatomy skill, MCP) and
 *       returns its permalink. No model call. → { design, warnings }
 *
 *   GET  /api/anatomy?id=<uuid>               → { design }
 *   GET  /api/anatomy?list=recent[&q=][&limit=] → { designs }, newest first
 *
 * No mocks: when no model answers, the caller gets a designed 503, never a
 * canned machine.
 */

import { cors, json, method, readJson, wrap, rateLimited } from './_lib/http.js';
import { limits, clientIp } from './_lib/rate-limit.js';
import { getSessionUser } from './_lib/auth.js';
import { AnatomyWriterError } from './_lib/anatomy/writer.js';
import { anatomyStoreEnabled, bumpViews, listDesigns } from './_lib/anatomy/store.js';
import { AnatomyError, MAX_SPEC_BYTES, cleanPrompt, generateDesign, loadDesign, publishDesign } from './_lib/anatomy/service.js';

const KEEPALIVE_MS = 15_000;
// Model text arrives a few tokens at a time; coalescing it keeps the event
// count (and the page's re-render rate) sane without visible lag.
const DELTA_FLUSH_MS = 60;

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,POST,OPTIONS' })) return;
	if (!method(req, res, ['GET', 'POST'])) return;
	if (req.method === 'GET') return handleGet(req, res);

	const body = await readJson(req, MAX_SPEC_BYTES * 2).catch(() => null);
	if (!body || typeof body !== 'object') {
		return json(res, 400, { error: 'invalid_body', message: 'Send a JSON body.' });
	}
	if (body.action === 'generate') return handleGenerate(req, res, body);
	if (body.action === 'publish') return handlePublish(req, res, body);
	return json(res, 400, { error: 'unknown_action', message: 'action must be "generate" or "publish".' });
});

async function handleGet(req, res) {
	const url = new URL(req.url, 'http://x');
	const id = url.searchParams.get('id');
	const list = url.searchParams.get('list');

	if (id) {
		try {
			const design = await loadDesign(id);
			bumpViews(id);
			return json(res, 200, { design }, { 'cache-control': 'public, max-age=15, s-maxage=60' });
		} catch (err) {
			return sendError(res, err, null);
		}
	}

	if (list !== null) {
		const designs = await listDesigns({
			limit: Number(url.searchParams.get('limit')) || 24,
			q: url.searchParams.get('q') || undefined,
		});
		return json(
			res,
			200,
			{ designs, storage: anatomyStoreEnabled() },
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
	const write = (event, data) => {
		if (res.writableEnded) return;
		res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
	};
	let pending = '';
	let flushTimer = null;
	const flush = () => {
		clearTimeout(flushTimer);
		flushTimer = null;
		if (pending) write('delta', { text: pending });
		pending = '';
	};
	const send = (event, data) => {
		if (event === 'delta') {
			pending += data.text;
			flushTimer ??= setTimeout(flush, DELTA_FLUSH_MS);
			return;
		}
		if (event === 'reset') pending = '';
		flush();
		write(event, data);
	};
	// Before the first token a long model call is silent; comments keep proxies
	// from timing the idle connection out.
	const keepalive = setInterval(() => {
		if (!res.writableEnded) res.write(': keepalive\n\n');
	}, KEEPALIVE_MS);
	const close = () => {
		flush();
		clearInterval(keepalive);
		if (!res.writableEnded) res.end();
	};
	return { send, close };
}

function sendError(res, err, stream) {
	const known = err instanceof AnatomyError;
	const writer = err instanceof AnatomyWriterError;
	if (!known) console.error('[anatomy] request failed:', err?.message, writer ? err.failures : '');
	const status = known ? err.status : writer ? 503 : 500;
	const out = {
		error: known || writer ? err.code : 'internal_error',
		message: known || writer ? err.message : 'Something went wrong building this machine. Try again.',
		...(known && err.detail ? { detail: err.detail } : {}),
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
	try {
		prompt = cleanPrompt(body.prompt);
	} catch (err) {
		return sendError(res, err, null);
	}

	const rl = await limits.anatomyIp(clientIp(req));
	if (!rl.success) return rateLimited(res, rl, 'Machine limit reached. Try again in a few minutes.');
	const globalRl = await limits.anatomyGlobal();
	if (!globalRl.success) return rateLimited(res, globalRl, 'Anatomy is at capacity. Try again shortly.');

	const user = await getSessionUser(req).catch(() => null);
	const stream = body.stream === true ? openStream(res) : null;
	try {
		const payload = await generateDesign({
			prompt,
			user,
			onEvent: ({ type, ...data }) => stream?.send(type, data),
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

async function handlePublish(req, res, body) {
	const rl = await limits.anatomyPublishIp(clientIp(req));
	if (!rl.success) return rateLimited(res, rl, 'Publishing too fast. Give it a moment.');
	const user = await getSessionUser(req).catch(() => null);
	try {
		const payload = await publishDesign({ spec: body.spec, prompt: body.prompt, user });
		return json(res, 201, payload);
	} catch (err) {
		return sendError(res, err, null);
	}
}
