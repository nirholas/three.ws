#!/usr/bin/env node
// A talking 3D avatar with Grok as its brain, in one small server.
//
// The server keeps the xAI key and proxies chat to the Responses API, asking
// Grok for a reply plus a mood in a fixed JSON shape. The page embeds the
// three.ws <agent-3d> element and turns each mood into an expression and an
// emote through its documented API.
//
//   XAI_API_KEY=... node server.mjs        then open http://localhost:3277
//
// Zero dependencies. The key is read from the environment only and never sent
// to the browser.

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = Number(process.env.PORT) || 3277;
const MODEL = process.env.XAI_MODEL || 'grok-4.7';
const XAI_URL = 'https://api.x.ai/v1/responses';
const PUBLIC_DIR = fileURLToPath(new URL('./public/', import.meta.url));
const MAX_BODY_BYTES = 32 * 1024;
const MAX_TURNS = 12;
const MAX_MESSAGE_CHARS = 2000;
const RATE = { windowMs: 60_000, max: 20 };

export const MOODS = ['happy', 'excited', 'thoughtful', 'sad', 'surprised', 'neutral'];

export const REPLY_SCHEMA = {
	type: 'object',
	additionalProperties: false,
	required: ['reply', 'mood'],
	properties: {
		reply: { type: 'string', description: 'What the avatar says: one to three short sentences.' },
		mood: { type: 'string', enum: MOODS, description: 'The feeling behind the reply, shown on the avatar.' },
	},
};

const INSTRUCTIONS =
	'You are Nova, a friendly 3D character living on a web page. You speak through an animated avatar, so keep every ' +
	'reply to one to three short, warm sentences. Pick the mood that matches how you feel saying it: happy, excited, ' +
	'thoughtful, sad, surprised or neutral.';

const xaiKey = () => process.env.XAI_API_KEY || process.env.GROK_API_KEY || '';

// Each turn is { role: 'user' | 'assistant', content: string }; the last one is the user's.
export function validateMessages(messages) {
	if (!Array.isArray(messages) || messages.length === 0) return 'messages must be a non-empty array';
	if (messages.length > MAX_TURNS * 2) return `send at most ${MAX_TURNS * 2} messages`;
	for (const m of messages) {
		if (!m || (m.role !== 'user' && m.role !== 'assistant')) return 'each message needs role "user" or "assistant"';
		if (typeof m.content !== 'string' || !m.content.trim()) return 'each message needs text content';
		if (m.content.length > MAX_MESSAGE_CHARS) return `keep each message under ${MAX_MESSAGE_CHARS} characters`;
	}
	if (messages.at(-1).role !== 'user') return 'the last message must be from the user';
	return null;
}

export function buildRequest(messages) {
	return {
		model: MODEL,
		instructions: INSTRUCTIONS,
		input: messages.map((m) => ({ role: m.role, content: m.content })),
		text: { format: { type: 'json_schema', name: 'avatar_reply', schema: REPLY_SCHEMA, strict: true } },
		store: false,
	};
}

export function readReply(response) {
	const text = (response.output || [])
		.filter((item) => item.type === 'message')
		.flatMap((item) => item.content || [])
		.filter((c) => c.type === 'output_text')
		.map((c) => c.text)
		.join('');
	const parsed = JSON.parse(text);
	const reply = typeof parsed.reply === 'string' ? parsed.reply.trim() : '';
	if (!reply) throw new Error('Grok answered without a reply');
	return { reply, mood: MOODS.includes(parsed.mood) ? parsed.mood : 'neutral' };
}

const hits = new Map();
function rateLimited(ip) {
	const now = Date.now();
	const recent = (hits.get(ip) || []).filter((t) => now - t < RATE.windowMs);
	recent.push(now);
	hits.set(ip, recent);
	return recent.length > RATE.max;
}

function sendJson(res, status, body) {
	res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
	res.end(JSON.stringify(body));
}

async function readJson(req) {
	let size = 0;
	const chunks = [];
	for await (const chunk of req) {
		size += chunk.length;
		if (size > MAX_BODY_BYTES) throw Object.assign(new Error('request body too large'), { status: 413 });
		chunks.push(chunk);
	}
	try {
		return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
	} catch {
		throw Object.assign(new Error('request body is not JSON'), { status: 400 });
	}
}

async function chat(req, res) {
	const ip = req.socket.remoteAddress || 'local';
	if (rateLimited(ip)) return sendJson(res, 429, { error: 'rate_limited', message: `Up to ${RATE.max} messages a minute. Wait a moment and send again.` });
	if (!xaiKey()) {
		return sendJson(res, 503, {
			error: 'no_key',
			message: 'This server has no xAI key. Stop it, then start it again with XAI_API_KEY=... node server.mjs (keys: https://console.x.ai).',
		});
	}
	const body = await readJson(req);
	const problem = validateMessages(body.messages);
	if (problem) return sendJson(res, 400, { error: 'bad_request', message: problem });

	let upstream;
	try {
		upstream = await fetch(XAI_URL, {
			method: 'POST',
			headers: { 'content-type': 'application/json', authorization: `Bearer ${xaiKey()}` },
			body: JSON.stringify(buildRequest(body.messages)),
			signal: AbortSignal.timeout(60_000),
		});
	} catch (err) {
		return sendJson(res, 502, { error: 'xai_unreachable', message: `Could not reach xAI: ${err.message}. Check the network and send again.` });
	}
	const text = await upstream.text();
	if (!upstream.ok) {
		let detail = text.slice(0, 300);
		try {
			detail = JSON.parse(text).error || detail;
		} catch {}
		console.error(`xai      HTTP ${upstream.status}: ${detail}`);
		return sendJson(res, 502, { error: 'xai_error', status: upstream.status, message: `xAI answered ${upstream.status}: ${detail}` });
	}
	try {
		return sendJson(res, 200, readReply(JSON.parse(text)));
	} catch (err) {
		return sendJson(res, 502, { error: 'xai_bad_reply', message: `${err.message}. Send the message again.` });
	}
}

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml' };

async function serveStatic(pathname, res) {
	const rel = normalize(decodeURIComponent(pathname === '/' ? '/index.html' : pathname)).replace(/^([/\\])+/, '');
	const file = join(PUBLIC_DIR, rel);
	if (!file.startsWith(PUBLIC_DIR) || rel.split(sep).includes('..')) return sendJson(res, 404, { error: 'not_found' });
	try {
		const bytes = await readFile(file);
		res.writeHead(200, {
			'content-type': TYPES[extname(file)] || 'application/octet-stream',
			'x-content-type-options': 'nosniff',
			'referrer-policy': 'strict-origin-when-cross-origin',
		});
		res.end(bytes);
	} catch {
		sendJson(res, 404, { error: 'not_found' });
	}
}

export const server = createServer(async (req, res) => {
	const { pathname } = new URL(req.url, 'http://localhost');
	try {
		if (pathname === '/api/health' && req.method === 'GET') {
			return sendJson(res, 200, { ok: true, model: MODEL, key: Boolean(xaiKey()) });
		}
		if (pathname === '/api/chat') {
			if (req.method !== 'POST') return sendJson(res, 405, { error: 'method_not_allowed', message: 'POST { messages } here' });
			return await chat(req, res);
		}
		if (req.method !== 'GET' && req.method !== 'HEAD') return sendJson(res, 405, { error: 'method_not_allowed' });
		return await serveStatic(pathname, res);
	} catch (err) {
		sendJson(res, err.status || 500, { error: 'server_error', message: err.message });
	}
});

if (import.meta.url === `file://${process.argv[1]}`) {
	server.listen(PORT, () => {
		console.log(`avatar   http://localhost:${PORT}  (model ${MODEL}, xAI key ${xaiKey() ? 'set' : 'NOT set: chat answers 503 until you add XAI_API_KEY'})`);
	});
}
