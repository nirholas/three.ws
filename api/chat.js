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
import { limits } from './_lib/rate-limit.js';
import { recordEvent } from './_lib/usage.js';
import { z } from 'zod';

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

	const rl = await limits.chatUser(auth.userId);
	if (!rl.success) {
		const retryAfter = Math.max(1, Math.ceil((rl.reset - Date.now()) / 1000));
		res.setHeader('retry-after', String(retryAfter));
		return error(res, 429, 'rate_limited', 'too many messages — slow down', {
			retry_after: retryAfter,
		});
	}

	const body = parse(chatBody, await readJson(req));
	const model = process.env.CHAT_MODEL || DEFAULT_MODEL;
	const maxTokens = clampInt(
		parseInt(process.env.CHAT_MAX_TOKENS || '', 10) || DEFAULT_MAX_TOKENS,
		128,
		HARD_MAX_TOKENS,
	);

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
				system: buildSystemPrompt(body.context),
				messages,
				tools: ACTION_TOOLS,
			}),
		});
	} catch (err) {
		console.warn('[chat] upstream fetch failed:', err.message);
		return error(res, 502, 'upstream_unavailable', 'chat backend unreachable');
	}

	if (!upstream.ok) {
		const text = await upstream.text().catch(() => '');
		console.warn('[chat] anthropic', upstream.status, text.slice(0, 400));
		const status = upstream.status === 429 ? 429 : 502;
		return error(res, status, 'upstream_error', `chat backend returned ${upstream.status}`);
	}

	const data = await upstream.json();
	const { reply, actions } = normalize(data);
	const latencyMs = Date.now() - started;

	recordEvent({
		userId: auth.userId,
		apiKeyId: auth.apiKeyId,
		clientId: auth.clientId,
		kind: 'chat',
		tool: model,
		latencyMs,
		meta: {
			input_tokens: data.usage?.input_tokens,
			output_tokens: data.usage?.output_tokens,
			actions: actions.map((a) => a.type),
			has_context: Boolean(body.context?.modelName),
		},
	});

	return json(res, 200, { reply, actions, model });
});

function buildSystemPrompt(ctx = {}) {
	const loaded = ctx.modelName
		? `A model named "${ctx.modelName}" is loaded. Stats: ${fmt(ctx.vertices)} vertices, ${fmt(ctx.triangles)} triangles, ${fmt(ctx.materials)} materials, ${ctx.animations ?? 0} animations.`
		: 'No model is currently loaded in the viewer.';
	const validation =
		ctx.validationErrors != null
			? `Validation has been run: ${ctx.validationErrors} errors, ${ctx.validationWarnings ?? 0} warnings.`
			: 'glTF validation has not been run yet for this model.';
	const settings = `Viewer settings — wireframe:${fmtBool(ctx.wireframe)}, skeleton:${fmtBool(ctx.skeleton)}, grid:${fmtBool(ctx.grid)}, autoRotate:${fmtBool(ctx.autoRotate)}, transparentBg:${fmtBool(ctx.transparentBg)}, bgColor:${ctx.bgColor || '?'}, environment:${ctx.currentEnvironment || '?'}.`;

	return [
		'You are the three.ws — an embodied AI assistant embedded inside a browser-native glTF/GLB viewer at three.ws.',
		'Your job is to help the user inspect, understand, and modify the 3D scene. You have deep glTF 2.0, PBR materials, and three.js expertise.',
		'When the user asks you to change the viewer (e.g. "enable wireframe", "make the background dark blue", "turn on auto rotate"), USE the provided tools to perform the change — do not just describe it.',
		'When asked about the loaded model, use the context below as ground truth. Do not invent stats.',
		'Keep replies tight: 1–3 sentences. Plain text, no markdown headers, no emoji.',
		'',
		loaded,
		validation,
		settings,
	].join('\n');
}

function normalize(data) {
	let reply = '';
	const actions = [];
	for (const block of data.content || []) {
		if (block.type === 'text') {
			reply += block.text;
		} else if (block.type === 'tool_use' && ACTION_NAMES.has(block.name)) {
			actions.push({ type: block.name, ...(block.input || {}) });
		}
	}
	return { reply: reply.trim(), actions };
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
