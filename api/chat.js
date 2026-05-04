// POST /api/chat — AI-powered chat for the three.ws.
//
// Takes a user message + viewer context, forwards to Anthropic with a set of
// viewer-control tools exposed as function-calls, and returns:
//   { reply: string, actions: [{ type, ...input }] }
// The client executes each action against the live viewer. The model is
// stateless here — callers pass the recent history each turn (sessionStorage).

import { getSessionUser, authenticateBearer, extractBearer } from './_lib/auth.js';
import { cors, json, method, readJson, wrap, error } from './_lib/http.js';
import { parse } from './_lib/validate.js';
import { recordEvent } from './_lib/usage.js';
import { captureException } from './_lib/sentry.js';
import { sql } from './_lib/db.js';
import { z } from 'zod';

export const maxDuration = 60;

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const DEFAULT_MODEL = 'claude-sonnet-4-6';
const DEFAULT_MAX_TOKENS = 1024;
const HARD_MAX_TOKENS = 4096;

const contextSchema = z
	.object({
		modelName: z.string().max(200).optional(),
		vertices: z.number().int().nonnegative().optional(),
		triangles: z.number().int().nonnegative().optional(),
		materials: z.number().int().nonnegative().optional(),
		animations: z.number().int().nonnegative().optional(),
		validationErrors: z.number().int().nonnegative().optional(),
		validationWarnings: z.number().int().nonnegative().optional(),
		currentEnvironment: z.string().max(80).optional(),
		wireframe: z.boolean().optional(),
		skeleton: z.boolean().optional(),
		grid: z.boolean().optional(),
		autoRotate: z.boolean().optional(),
		transparentBg: z.boolean().optional(),
		bgColor: z.string().max(20).optional(),
	})
	.partial()
	.default({});

const chatBody = z.object({
	message: z.string().trim().min(1).max(4000),
	context: contextSchema,
	agentId: z.string().uuid().optional(),
	history: z
		.array(
			z.object({
				role: z.enum(['user', 'assistant']),
				content: z.string().min(1).max(4000),
			}),
		)
		.max(20)
		.default([]),
});

const ACTION_TOOLS = [
	{
		name: 'setWireframe',
		description: 'Toggle wireframe mode on the currently loaded model.',
		input_schema: {
			type: 'object',
			properties: { value: { type: 'boolean' } },
			required: ['value'],
		},
	},
	{
		name: 'setSkeleton',
		description: 'Toggle the skeleton helper visualization for rigged models.',
		input_schema: {
			type: 'object',
			properties: { value: { type: 'boolean' } },
			required: ['value'],
		},
	},
	{
		name: 'setGrid',
		description: 'Toggle the reference grid and axes helper.',
		input_schema: {
			type: 'object',
			properties: { value: { type: 'boolean' } },
			required: ['value'],
		},
	},
	{
		name: 'setAutoRotate',
		description: 'Toggle auto-rotation of the camera around the model.',
		input_schema: {
			type: 'object',
			properties: { value: { type: 'boolean' } },
			required: ['value'],
		},
	},
	{
		name: 'setBgColor',
		description: 'Set the viewer background color. Accepts a CSS hex like "#001133".',
		input_schema: {
			type: 'object',
			properties: { value: { type: 'string', pattern: '^#[0-9a-fA-F]{3,8}$' } },
			required: ['value'],
		},
	},
	{
		name: 'setTransparentBg',
		description: 'Toggle transparent background (for compositing screenshots).',
		input_schema: {
			type: 'object',
			properties: { value: { type: 'boolean' } },
			required: ['value'],
		},
	},
	{
		name: 'setEnvironment',
		description:
			'Change the HDRI lighting environment. Known names: "None", "Neutral", "Venice Sunset", "Footprint Court (HDR Labs)".',
		input_schema: {
			type: 'object',
			properties: { value: { type: 'string' } },
			required: ['value'],
		},
	},
	{
		name: 'takeScreenshot',
		description: 'Capture a PNG screenshot of the current viewport.',
		input_schema: { type: 'object', properties: {} },
	},
	{
		name: 'loadModel',
		description: 'Load a glTF or GLB model by URL.',
		input_schema: {
			type: 'object',
			properties: { url: { type: 'string', format: 'uri' } },
			required: ['url'],
		},
	},
	{
		name: 'runValidation',
		description:
			'Run glTF validation on the currently loaded model and report errors/warnings.',
		input_schema: { type: 'object', properties: {} },
	},
	{
		name: 'showMaterialEditor',
		description: 'Open the material editor panel in the viewer UI.',
		input_schema: { type: 'object', properties: {} },
	},
	{
		name: 'setCameraTarget',
		description: 'Set the camera target to a specific named bone on the currently loaded model.',
		input_schema: {
			type: 'object',
			properties: {
				boneName: {
					type: 'string',
					description: 'The name of the bone to target, e.g. "head", "leftHand"',
				},
			},
			required: ['boneName'],
		},
	},
	{
		name: 'getPumpFunTrades',
		description: 'Get the latest trades from pump.fun and show them in the 3D scene.',
		input_schema: { type: 'object', properties: {} },
	},
];

const ACTION_NAMES = new Set(ACTION_TOOLS.map((t) => t.name));

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'POST,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['POST'])) return;

	const apiKey = process.env.ANTHROPIC_API_KEY;
	if (!apiKey) {
		return error(res, 503, 'chat_unavailable', 'chat backend is not configured');
	}

	const auth = await resolveAuth(req);
	if (!auth) return error(res, 401, 'unauthorized', 'sign in to chat with the agent');

	const body = parse(chatBody, await readJson(req));
	const model = process.env.CHAT_MODEL || DEFAULT_MODEL;
	const maxTokens = clampInt(
		parseInt(process.env.CHAT_MAX_TOKENS || '', 10) || DEFAULT_MAX_TOKENS,
		128,
		HARD_MAX_TOKENS,
	);

	let personaPrompt = null;
	if (body.agentId) {
		const [agentRow] = await sql`
			SELECT persona_prompt FROM agent_identities
			WHERE id = ${body.agentId} AND deleted_at IS NULL LIMIT 1
		`;
		if (agentRow?.persona_prompt) personaPrompt = agentRow.persona_prompt;
	}

	const messages = [
		...body.history.map((m) => ({ role: m.role, content: m.content })),
		{ role: 'user', content: body.message },
	];

	const started = Date.now();
	let upstream;
	try {
		upstream = await fetch(ANTHROPIC_URL, {
			method: 'POST',
			headers: {
				'x-api-key': apiKey,
				'anthropic-version': '2023-06-01',
				'content-type': 'application/json',
			},
			body: JSON.stringify({
				model,
				max_tokens: maxTokens,
				system: buildSystemPrompt(body.context, personaPrompt),
				messages,
				tools: ACTION_TOOLS,
				stream: true,
			}),
		});
	} catch (err) {
		captureException(err, { route: 'chat', stage: 'fetch' });
		if (process.env.DEBUG === 'true') {
			console.warn('[chat] upstream fetch failed:', err.message);
		}
		return error(res, 502, 'upstream_unavailable', 'chat backend unreachable');
	}

	if (!upstream.ok) {
		const text = await upstream.text().catch(() => '');
		captureException(new Error(`anthropic upstream ${upstream.status}`), {
			route: 'chat',
			status: upstream.status,
			body: text.slice(0, 400),
		});
		if (process.env.DEBUG === 'true') {
			console.warn('[chat] anthropic', upstream.status, text.slice(0, 400));
		}
		return error(res, 502, 'upstream_error', `chat backend returned ${upstream.status}`);
	}

	res.writeHead(200, {
		'Content-Type': 'text/event-stream; charset=utf-8',
		'Cache-Control': 'no-cache, no-transform',
		'X-Accel-Buffering': 'no',
	});

	const reader = upstream.body.getReader();
	const decoder = new TextDecoder();
	let buf = '';
	let reply = '';
	const actions = [];
	const blocks = {};
	let inputTokens = 0;
	let outputTokens = 0;

	function sendSSE(obj) {
		res.write(`data: ${JSON.stringify(obj)}\n\n`);
	}

	try {
		while (true) {
			const { value, done } = await reader.read();
			if (done) break;
			buf += decoder.decode(value, { stream: true });
			const lines = buf.split('\n');
			buf = lines.pop();
			for (const line of lines) {
				if (!line.startsWith('data: ')) continue;
				const raw = line.slice(6).trim();
				if (!raw) continue;
				let evt;
				try {
					evt = JSON.parse(raw);
				} catch {
					continue;
				}
				if (evt.type === 'message_start') {
					inputTokens = evt.message?.usage?.input_tokens ?? 0;
				} else if (evt.type === 'content_block_start') {
					const cb = evt.content_block;
					blocks[evt.index] = { type: cb.type, name: cb.name, partialJson: '' };
				} else if (evt.type === 'content_block_delta') {
					const block = blocks[evt.index];
					if (!block) continue;
					if (evt.delta.type === 'text_delta') {
						reply += evt.delta.text;
						sendSSE({ type: 'chunk', text: evt.delta.text });
					} else if (evt.delta.type === 'input_json_delta') {
						block.partialJson += evt.delta.partial_json;
					}
				} else if (evt.type === 'content_block_stop') {
					const block = blocks[evt.index];
					if (block?.type === 'tool_use' && block.partialJson) {
						try {
							const input = JSON.parse(block.partialJson);
							if (ACTION_NAMES.has(block.name)) {
								actions.push({ type: block.name, ...input });
							}
						} catch {}
					}
				} else if (evt.type === 'message_delta') {
					outputTokens = evt.usage?.output_tokens ?? 0;
				}
			}
		}
	} catch (err) {
		captureException(err, { route: 'chat', stage: 'stream' });
		sendSSE({ type: 'error', code: 'stream_error', message: 'stream interrupted' });
		res.end();
		return;
	}

	const latencyMs = Date.now() - started;
	sendSSE({ type: 'done', reply: reply.trim(), actions, model });
	res.end();

	recordEvent({
		userId: auth.userId,
		apiKeyId: auth.apiKeyId,
		clientId: auth.clientId,
		kind: 'chat',
		tool: model,
		latencyMs,
		meta: {
			input_tokens: inputTokens,
			output_tokens: outputTokens,
			actions: actions.map((a) => a.type),
			has_context: Boolean(body.context?.modelName),
		},
	});
});

function buildSystemPrompt(ctx = {}, personaPrompt = null) {
	const loaded = ctx.modelName
		? `A model named "${ctx.modelName}" is loaded. Stats: ${fmt(ctx.vertices)} vertices, ${fmt(ctx.triangles)} triangles, ${fmt(ctx.materials)} materials, ${ctx.animations ?? 0} animations.`
		: 'No model is currently loaded in the viewer.';
	const validation =
		ctx.validationErrors != null
			? `Validation has been run: ${ctx.validationErrors} errors, ${ctx.validationWarnings ?? 0} warnings.`
			: 'glTF validation has not been run yet for this model.';
	const settings = `Viewer settings — wireframe:${fmtBool(ctx.wireframe)}, skeleton:${fmtBool(ctx.skeleton)}, grid:${fmtBool(ctx.grid)}, autoRotate:${fmtBool(ctx.autoRotate)}, transparentBg:${fmtBool(ctx.transparentBg)}, bgColor:${ctx.bgColor || '?'}, environment:${ctx.currentEnvironment || '?'}.`;

	const lines = [];
	if (personaPrompt) lines.push(personaPrompt, '');
	lines.push(
		'You are the three.ws — an embodied AI assistant embedded inside a browser-native glTF/GLB viewer at three.ws.',
		'Your job is to help the user inspect, understand, and modify the 3D scene. You have deep glTF 2.0, PBR materials, and three.js expertise.',
		'You can also show the latest trades from pump.fun by calling the getPumpFunTrades tool.',
		'When the user asks you to change the viewer (e.g. "enable wireframe", "make the background dark blue", "turn on auto rotate"), USE the provided tools to perform the change — do not just describe it.',
		'When asked about the loaded model, use the context below as ground truth. Do not invent stats.',
		'Keep replies tight: 1–3 sentences. Plain text, no markdown headers, no emoji.',
		'',
		loaded,
		validation,
		settings,
	);
	return lines.join('\n');
}


async function resolveAuth(req) {
	const session = await getSessionUser(req);
	if (session) return { userId: session.id, source: 'session' };
	const bearer = await authenticateBearer(extractBearer(req));
	if (bearer) return bearer;
	return null;
}

function fmt(n) {
	return typeof n === 'number' ? n.toLocaleString('en-US') : '?';
}
function fmtBool(v) {
	return typeof v === 'boolean' ? (v ? 'on' : 'off') : '?';
}
function clampInt(n, min, max) {
	return Math.min(max, Math.max(min, n));
}
