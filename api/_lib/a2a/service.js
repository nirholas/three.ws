// The three.ws A2A service: one JSON-RPC endpoint (POST /api/agents/a2a-paid)
// that routes every skill on the public Agent Card.
//
// The endpoint used to accept exactly one method (`message/send`) for exactly
// one skill (the paid glTF inspector) and refused every caller that had not
// activated the payment extension, while the card advertised ten skills and
// `tasks/get`. This module is the dispatcher that makes the card true:
//
//   methods   SendMessage / GetTask / CancelTask (A2A 1.0) and message/send /
//             tasks/get / tasks/cancel (0.3), translated by ./protocol.js. The
//             streaming, push-notification, extended-card and list methods get
//             their spec error codes, never a generic "method not found".
//   skills    the registry in ./skills.js. Free skills run directly; the paid
//             skill delegates to the a2a-x402 flow (../x402/a2a-server.js),
//             which owns verification, settlement and replay protection.
//   tasks     ./task-store.js, so a GetTask lands on whatever instance serves it.
//   auth      anonymous by default; a bearer API key (sk_live_/sk_test_ or an
//             OAuth access token) raises the search cap and keys the limiter by
//             account. A presented but invalid credential is a 401, never a
//             silent downgrade to anonymous.

import { randomUUID } from 'node:crypto';

import { env } from '../env.js';
import { readBody } from '../http.js';
import { limits, clientIp } from '../rate-limit.js';
import { extractBearer, authenticateBearer } from '../auth.js';
import { searchPublicAvatars } from '../avatars.js';
import { getCatalog } from '../service-catalog/index.js';
import { inspectModelUrl } from '../../3d/inspect.js';
import { startForge, originFromReq } from '../../_mcp-studio/gpt-forge-client.js';
import { shapeSubmit, shapePoll } from '../../_mcp-studio/studio-shape.js';
import { checkPromptSafety } from '../../_mcp-studio/safety.js';
import { resolveLogoPrompt } from '../forge-director-prompts.js';
import { handleA2ARequest, A2A_X402_EXTENSION_URI } from '../x402/a2a-server.js';
import {
	A2A_EXTENSIONS_HEADER_LEGACY,
	A2A_EXTENSIONS_HEADER_V1,
	A2A_VERSION_HEADER,
	DIALECT_V1,
	RPC,
	TERMINAL_STATES,
	detectDialect,
	normalizeMessage,
	requestedExtensions,
	rpcError,
	rpcResult,
	sendMessageResult,
	sendResult,
	serializeTask,
} from './protocol.js';
import { loadTask, saveTask } from './task-store.js';
import { A2A_SKILLS, cardSkill, skillById } from './skills.js';

const MAX_BODY_BYTES = 1_000_000;
const HISTORY_CAP = 20;
const PROMPT_MIN = 3;
const PROMPT_MAX = 1000;
// Anonymous callers are capped low so the public gallery cannot be bulk
// enumerated; an authenticated account gets the same 50 the MCP tool allows.
const SEARCH_LIMIT_ANON = 10;
const SEARCH_LIMIT_AUTHED = 50;
// The forge submit is bounded so a send answers well inside a client's HTTP
// timeout: past the deadline startForge hands back a ticket handle that the
// GetTask poll collects (see gpt-forge-client.js startForge).
const FORGE_SUBMIT_BUDGET_MS = 25_000;
// Server-error range code (JSON-RPC reserves -32000..-32099 for implementations)
// for a caller over its rate limit. The HTTP status is 429 with Retry-After.
export const RPC_RATE_LIMITED = -32029;

const DISCOVERY_DOC = 'https://three.ws/.well-known/x402.json';
const PUBLIC_CARD = 'https://three.ws/.well-known/agent-card.json';
const URL_RE = /\bhttps?:\/\/[^\s"'<>]+/i;
const MODEL_URL_RE = /\bhttps?:\/\/[^\s"'<>]+?\.(?:glb|gltf)(?:\?[^\s"'<>]*)?(?=$|[\s"'<>),.;!])/i;

class RateLimitedError extends Error {
	constructor(message, limit) {
		super(message);
		this.limit = limit;
	}
}

function retryAfterSeconds(limit) {
	const reset = Number(limit?.reset);
	const secs = Number.isFinite(reset) ? Math.ceil((reset - Date.now()) / 1000) : 30;
	return Math.max(1, secs);
}

// ── message helpers ─────────────────────────────────────────────────────────

function textOf(message) {
	return (message.parts || [])
		.filter((p) => p.kind === 'text')
		.map((p) => p.text)
		.join('\n')
		.trim();
}

function dataOf(message) {
	const out = {};
	for (const p of message.parts || []) {
		if (p.kind === 'data' && p.data && typeof p.data === 'object' && !Array.isArray(p.data)) {
			Object.assign(out, p.data);
		}
	}
	return out;
}

function str(v) {
	return typeof v === 'string' && v.trim() ? v.trim() : null;
}

function agentMessage(taskId, contextId, text, extraParts = []) {
	return {
		kind: 'message',
		role: 'agent',
		messageId: randomUUID(),
		taskId,
		contextId,
		parts: [{ kind: 'text', text }, ...extraParts],
	};
}

function now() {
	return new Date().toISOString();
}

// ── skill selection ─────────────────────────────────────────────────────────

/**
 * Which skill a send addresses. Explicit beats inferred: a stored task keeps its
 * skill, then message metadata, then a data part, then the payment extension,
 * then intent read from the text. Returns { skill } or { error } or {} (no
 * skill could be identified: the caller answers with the skill list).
 */
export function selectSkill(message, { record, extensions } = {}) {
	if (record?.skillId) return { skill: skillById(record.skillId) };
	const data = dataOf(message);
	const explicit =
		str(message.metadata?.skillId) || str(message.metadata?.skill) || str(data.skillId) || str(data.skill);
	if (explicit) {
		const skill = skillById(explicit);
		if (!skill) {
			return {
				error: {
					code: RPC.INVALID_PARAMS,
					message: `Unknown skill "${explicit}". Skills: ${A2A_SKILLS.map((s) => s.id).join(', ')}`,
				},
			};
		}
		return { skill };
	}
	const paid = A2A_SKILLS.find((s) => s.pricing === 'x402');
	if (paid && (extensions?.has(A2A_X402_EXTENSION_URI) || message.metadata?.['x402.payment.payload'])) {
		return { skill: paid };
	}
	const text = textOf(message).toLowerCase();
	const hasModelUrl = MODEL_URL_RE.test(text) || typeof data.url === 'string' || hasFilePart(message);
	if (hasModelUrl && !/\b(generate|create|make)\b/.test(text)) return { skill: skillById('validate-model') };
	if (/\b(search|find|browse|look\s*up|show)\b/.test(text) && /\b(avatars?|characters?|gallery)\b/.test(text)) {
		return { skill: skillById('search-avatars') };
	}
	if (typeof data.q === 'string' || typeof data.query === 'string' || typeof data.tag === 'string') {
		return { skill: skillById('search-avatars') };
	}
	if (/\b(catalog|x402|paid services?|services)\b/.test(text)) return { skill: skillById('x402-service-catalog') };
	if (typeof data.prompt === 'string' || /\b(generate|create|make|model|3d|sculpt|forge)\b/.test(text)) {
		return { skill: skillById('generate-3d-model') };
	}
	return {};
}

function hasFilePart(message) {
	return (message.parts || []).some((p) => p.kind === 'file' && typeof p.file?.uri === 'string');
}

function helpText() {
	const lines = A2A_SKILLS.map((s) => `- ${s.id}: ${s.name}. ${s.examples?.[0] ? `Try: "${s.examples[0]}"` : ''}`.trim());
	return (
		'I could not tell which skill this message is for. Name one in message.metadata.skillId, ' +
		'or describe the job in plain words. Skills:\n' +
		lines.join('\n') +
		`\nFull card: ${PUBLIC_CARD}`
	);
}

// ── free skills ─────────────────────────────────────────────────────────────
//
// Each returns an outcome:
//   { state, text, artifacts?, data?, continuation? }
// `continuation` is skill-private data kept in the task record for the next
// GetTask (the forge job handle) or the next message (a URL still to come).

function modelUrlFrom(message) {
	const data = dataOf(message);
	if (typeof data.url === 'string' && data.url.trim()) return data.url.trim();
	for (const p of message.parts || []) {
		if (p.kind === 'file' && typeof p.file?.uri === 'string') return p.file.uri;
	}
	const text = textOf(message);
	const model = MODEL_URL_RE.exec(text);
	if (model) return model[0];
	const any = URL_RE.exec(text);
	return any ? any[0].replace(/[),.;!]+$/, '') : null;
}

async function runValidateModel({ message }) {
	const url = modelUrlFrom(message);
	if (!url) {
		return {
			state: 'input-required',
			text: 'Send the public URL of the glTF or GLB model to validate (a text part, a data part { url }, or a file part with a url).',
		};
	}
	let report;
	try {
		report = await inspectModelUrl(url);
	} catch (err) {
		return { state: 'failed', text: `Could not validate ${url}: ${err?.message || 'the model could not be read'}` };
	}
	const v = report.validation || {};
	// api/3d/inspect.js reports the Khronos counts as numErrors, numWarnings,
	// numInfos and numHints; no counts means the validator did not run.
	const counts = [
		['numErrors', 'errors'],
		['numWarnings', 'warnings'],
		['numInfos', 'infos'],
		['numHints', 'hints'],
	]
		.filter(([key]) => Number.isFinite(v[key]))
		.map(([key, label]) => `${v[key]} ${label}`)
		.join(', ');
	const s = report.stats || {};
	const text =
		`${report.valid ? 'Valid' : 'Not valid'} glTF: ${report.url} (${report.sizeBytes} bytes). ` +
		(counts ? `Validator: ${counts}. ` : 'The Khronos validator was unavailable; the model parsed structurally. ') +
		`${s.triangles ?? '?'} triangles, ${s.meshes ?? '?'} meshes, ${s.materials ?? '?'} materials. ` +
		`${(report.recommendations || []).length} recommendation(s).`;
	return {
		state: 'completed',
		text,
		artifacts: [
			{
				artifactId: randomUUID(),
				name: 'gltf-validation.json',
				description: 'Khronos glTF-Validator result, structural stats and optimization recommendations.',
				parts: [{ kind: 'data', data: report }],
			},
		],
	};
}

const SEARCH_FILLER = new Set([
	'find', 'search', 'browse', 'show', 'me', 'look', 'up', 'lookup', 'for', 'the', 'a', 'an', 'some', 'any',
	'avatar', 'avatars', 'character', 'characters', 'gallery', 'public', 'matching', 'match', 'that',
	'like', 'called', 'named', 'with', 'of', 'in', 'on', 'please', 'model', 'models', '3d',
]);

export function searchQueryFrom(message) {
	const data = dataOf(message);
	const q = str(data.q) || str(data.query);
	const tag = str(data.tag);
	if (q || tag) return { q: q || undefined, tag: tag || undefined };
	const text = textOf(message);
	const quoted = /["'‘’“”]([^"'‘’“”]{1,80})["'‘’“”]/.exec(text);
	if (quoted) return { q: quoted[1].trim() };
	const words = text
		.toLowerCase()
		.replace(/[^a-z0-9\s-]/g, ' ')
		.split(/\s+/)
		.filter((w) => w && !SEARCH_FILLER.has(w));
	return { q: words.join(' ').slice(0, 80) || undefined };
}

async function runSearchAvatars({ message, auth, origin }) {
	const { q, tag } = searchQueryFrom(message);
	const data = dataOf(message);
	const cap = auth ? SEARCH_LIMIT_AUTHED : SEARCH_LIMIT_ANON;
	const asked = Number.parseInt(data.limit, 10);
	const limit = Math.min(Number.isFinite(asked) && asked > 0 ? asked : 10, cap);
	const result = await searchPublicAvatars({ q, tag, limit });
	const avatars = (result.avatars || []).map((a) => ({
		id: a.id,
		name: a.name,
		description: a.description || null,
		tags: a.tags || [],
		glbUrl: a.model_url,
		thumbnailUrl: a.thumbnail_url || null,
		pageUrl: `${origin}/avatars/${encodeURIComponent(a.id)}`,
	}));
	const what = q ? `"${q}"` : tag ? `tag "${tag}"` : 'the newest public avatars';
	const text = avatars.length
		? `Found ${avatars.length} avatar(s) for ${what}:\n` +
			avatars.map((a) => `- ${a.name}: ${a.pageUrl}${a.glbUrl ? ` (GLB ${a.glbUrl})` : ''}`).join('\n')
		: `No public avatars match ${what}. Try a broader word (for example "robot" or "knight"), or generate one with the generate-3d-model skill.`;
	return {
		state: 'completed',
		text,
		artifacts: [
			{
				artifactId: randomUUID(),
				name: 'avatar-search.json',
				description: 'Matching public three.ws avatars.',
				parts: [{ kind: 'data', data: { query: q || null, tag: tag || null, limit, avatars } }],
			},
		],
	};
}

async function runServiceCatalog() {
	const catalog = await getCatalog();
	const paid = catalog.filter((e) => e.source === 'x402' && e.status === 'live');
	const byCategory = new Map();
	for (const e of paid) byCategory.set(e.category, (byCategory.get(e.category) || 0) + 1);
	const categories = [...byCategory.entries()]
		.sort((a, b) => b[1] - a[1])
		.map(([category, count]) => ({ category, count }));
	const text =
		`${paid.length} live pay-per-call services: ` +
		categories.map((c) => `${c.category} (${c.count})`).join(', ') +
		`. Prices, input schemas and output examples are in ${DISCOVERY_DOC}.`;
	return {
		state: 'completed',
		text,
		artifacts: [
			{
				artifactId: randomUUID(),
				name: 'x402-service-catalog.json',
				description: 'Live paid-service counts by category, with the discovery document URL.',
				parts: [
					{
						kind: 'data',
						data: {
							total: paid.length,
							categories,
							discovery: DISCOVERY_DOC,
							services: paid.map((e) => ({
								id: e.id,
								category: e.category,
								endpoint: e.endpoint,
								method: e.method,
								priceUsd: e.price?.usd ?? null,
							})),
						},
					},
				],
			},
		],
	};
}

function generatedArtifacts(done, prompt) {
	const name = `${(prompt || 'model').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48) || 'model'}.glb`;
	return [
		{
			artifactId: randomUUID(),
			name,
			description: 'The generated 3D model, with a browser viewer and an augmented-reality link.',
			parts: [
				{ kind: 'file', file: { uri: done.glbUrl, mimeType: 'model/gltf-binary', name } },
				{
					kind: 'data',
					data: {
						glbUrl: done.glbUrl,
						viewerUrl: done.viewerUrl,
						arUrl: done.arUrl,
						format: done.format,
						...(done.previewImageUrl ? { previewImageUrl: done.previewImageUrl } : {}),
						...(done.tier ? { tier: done.tier } : {}),
					},
				},
			],
		},
	];
}

function pendingData(shaped) {
	return {
		kind: 'data',
		data: {
			status: 'pending',
			...(shaped.watchUrl ? { watchUrl: shaped.watchUrl } : {}),
			...(shaped.previewImageUrl ? { previewImageUrl: shaped.previewImageUrl } : {}),
			...(shaped.etaSeconds ? { etaSeconds: shaped.etaSeconds } : {}),
			...(shaped.tier ? { tier: shaped.tier } : {}),
		},
	};
}

function laneFailureText(err) {
	switch (err?.code) {
		case 'not_configured':
			return '3D generation is temporarily unavailable on this deployment. Try again later.';
		case 'busy':
			return err.message || 'The free 3D generator is momentarily saturated. Try again shortly.';
		case 'timeout':
			return err.message || 'The 3D generator took too long to accept the job. Try again.';
		default:
			return err?.message || 'The 3D generator could not start this job. Try again.';
	}
}

async function runGenerate({ message, ip, base }) {
	const data = dataOf(message);
	const prompt = (str(data.prompt) || textOf(message)).slice(0, PROMPT_MAX + 1);
	if (prompt.length < PROMPT_MIN) {
		return {
			state: 'input-required',
			text: 'Describe the one object or character to generate, for example "a small ceramic robot figurine".',
		};
	}
	if (prompt.length > PROMPT_MAX) {
		return { state: 'rejected', text: `The description must be ${PROMPT_MAX} characters or fewer.` };
	}
	const rawTier = data.tier === undefined ? 'standard' : data.tier;
	const tier = rawTier === 'draft' || rawTier === 'standard' || rawTier === 'high' ? rawTier : null;
	if (!tier) return { state: 'rejected', text: 'tier must be "draft", "standard" or "high" (default "standard").' };

	// Age-13+ content gate before any quota spend or GPU work, as on /api/3d/studio.
	const safety = checkPromptSafety(prompt);
	if (!safety.allowed) return { state: 'rejected', text: safety.message };

	// The same per-IP free-lane bucket /api/3d/studio and /api/3d/generate draw
	// from, so this surface adds no new unmetered capacity.
	const rl = await limits.mcp3dGenerateFree(ip);
	if (!rl.success) throw new RateLimitedError('Free 3D generation limit reached. Try again in a little while.', rl);

	const knownMark = resolveLogoPrompt(prompt);
	const subject = knownMark ? knownMark.prompt : prompt;
	let job;
	try {
		job = await startForge(
			base,
			knownMark?.imagePath
				? { prompt: subject, imageUrls: [`${base}${knownMark.imagePath}`], tier }
				: { prompt: subject, path: 'image', tier, ...(tier === 'high' ? { internal: true } : {}) },
			{ deadline: Date.now() + FORGE_SUBMIT_BUDGET_MS },
		);
	} catch (err) {
		return { state: 'failed', text: laneFailureText(err) };
	}
	const shaped = shapeSubmit(job, base, prompt);
	if (shaped.status === 'done') {
		return {
			state: 'completed',
			text: `Generated "${prompt}". GLB: ${shaped.glbUrl} . View it at ${shaped.viewerUrl} or in your room at ${shaped.arUrl} .`,
			artifacts: generatedArtifacts(shaped, prompt),
		};
	}
	if (!shaped.job) return { state: 'failed', text: 'The 3D generator accepted the job but returned no handle. Try again.' };
	return {
		state: 'working',
		text:
			`Generating "${prompt}". Poll this task with GetTask (tasks/get on 0.3)` +
			`${shaped.etaSeconds ? `; about ${shaped.etaSeconds}s left` : ''}.` +
			`${shaped.watchUrl ? ` Watch it live: ${shaped.watchUrl}` : ''}`,
		parts: [pendingData(shaped)],
		continuation: { job: shaped.job, prompt },
	};
}

// GetTask on a working generation: one poll of the forge job behind it.
async function refreshGenerate(record, { ip, base }) {
	const { job, prompt } = record.state || {};
	if (!job) return null;
	const rl = await limits.mcp3dStatus(ip);
	if (!rl.success) throw new RateLimitedError('Polling too fast. Slow down and retry.', rl);
	let upstream;
	let data = {};
	try {
		upstream = await fetch(`${base}/api/gpt-forge?job=${encodeURIComponent(job)}`, {
			headers: { accept: 'application/json' },
			signal: AbortSignal.timeout(15_000),
		});
		data = await upstream.json().catch(() => ({}));
	} catch {
		// A blip on the self-call is not a job failure: stay working, the next poll retries.
		return null;
	}
	if (
		(upstream.status === 503 || upstream.status === 501) &&
		(data?.error === 'unconfigured' || data?.error === 'backend_unconfigured')
	) {
		return { state: 'failed', text: '3D generation is temporarily unavailable, so this job cannot be finished here.' };
	}
	if (upstream.status === 400) return { state: 'failed', text: data?.message || 'The generation job is unknown upstream.' };
	if (!upstream.ok) return null;
	const shaped = shapePoll(data, base, job, prompt);
	if (shaped.status === 'done') {
		return {
			state: 'completed',
			text: `Generated "${prompt}". GLB: ${shaped.glbUrl} . View it at ${shaped.viewerUrl} or in your room at ${shaped.arUrl} .`,
			artifacts: generatedArtifacts(shaped, prompt),
		};
	}
	if (shaped.status === 'error') return { state: 'failed', text: shaped.error };
	return {
		state: 'working',
		text: `Still generating "${prompt}"${shaped.etaSeconds ? `, about ${shaped.etaSeconds}s left` : ''}.`,
		parts: [pendingData(shaped)],
		continuation: record.state,
	};
}

const FREE_RUNNERS = {
	'generate-3d-model': runGenerate,
	'validate-model': runValidateModel,
	'search-avatars': runSearchAvatars,
	'x402-service-catalog': runServiceCatalog,
};

// ── task bookkeeping ────────────────────────────────────────────────────────

function applyOutcome(task, outcome) {
	const status = agentMessage(task.id, task.contextId, outcome.text, outcome.parts || []);
	task.status = { state: outcome.state, message: status, timestamp: now() };
	if (outcome.artifacts?.length) task.artifacts = [...(task.artifacts || []), ...outcome.artifacts];
	task.history = [...(task.history || []), status].slice(-HISTORY_CAP);
	return task;
}

function newTask(message) {
	const id = randomUUID();
	const contextId = message.contextId || randomUUID();
	return { kind: 'task', id, contextId, status: { state: 'submitted', timestamp: now() }, history: [] };
}

function withUserMessage(task, message) {
	const m = { ...message, taskId: task.id, contextId: task.contextId, messageId: message.messageId || randomUUID() };
	task.history = [...(task.history || []), m].slice(-HISTORY_CAP);
	return task;
}

function taskIdFromParams(params) {
	if (!params || typeof params !== 'object') return null;
	if (typeof params.id === 'string' && params.id.trim()) return params.id.trim();
	// 1.0 resource-name form: "tasks/{id}".
	if (typeof params.name === 'string' && params.name.startsWith('tasks/')) return params.name.slice(6) || null;
	return null;
}

// ── the service ─────────────────────────────────────────────────────────────

/**
 * Build the HTTP handler. Takes the same spec as a2aPaidEndpoint() so the paid
 * skill's settings carry over unchanged: { route, description, priceAtomics,
 * networks, payTo?, services, prompt, handler, mimeType? }. Every field but
 * `route` configures the a2a-x402 skill; the free skills need no settings.
 */
export function createA2AService(paid) {
	const { route } = paid || {};
	if (!route) throw new Error('createA2AService: route is required');
	if (typeof paid.handler !== 'function') throw new Error('createA2AService: handler is required');
	const paidSkill = A2A_SKILLS.find((s) => s.pricing === 'x402');

	async function delegatePaid({ req, id, message, record, dialect }) {
		const reply = await handleA2ARequest({
			req,
			body: { jsonrpc: '2.0', id, method: 'message/send', params: { message } },
			route,
			resourceUrl: `${env.APP_ORIGIN}${route}`,
			description: paid.description,
			mimeType: paid.mimeType || 'application/json',
			priceAtomics: paid.priceAtomics,
			networks: paid.networks,
			payTo: paid.payTo,
			services: paid.services,
			prompt: paid.prompt,
			handler: paid.handler,
		});
		if (reply.error || !reply.result) return reply;
		const task = reply.result;
		task.contextId = record?.task?.contextId || message.contextId || task.contextId || randomUUID();
		task.status = { ...task.status, timestamp: now() };
		if (task.status.message) task.status.message = { ...task.status.message, contextId: task.contextId };
		task.history = [...(record?.task?.history || []), { ...message, taskId: task.id, contextId: task.contextId }];
		if (task.status.message) task.history.push(task.status.message);
		task.history = task.history.slice(-HISTORY_CAP);
		await saveTask(route, { task, skillId: paidSkill.id, state: {} });
		return rpcResult(id, sendResult(task, dialect));
	}

	async function onSend({ req, id, params, dialect, ctx }) {
		const normalized = normalizeMessage(params?.message);
		if (normalized.error) return rpcError(id, RPC.INVALID_PARAMS, `Invalid params: ${normalized.error}`);
		const message = normalized.message;
		const hasPayment = !!message.metadata?.['x402.payment.payload'];

		let record = null;
		if (message.taskId) {
			record = await loadTask(route, message.taskId);
			// A payment submission carries the task id the quote minted; the paid
			// flow owns that leg (including idempotent replay of a settled proof),
			// so it goes through even when this instance holds no record of it.
			if (!record && !hasPayment && !ctx.extensions.has(A2A_X402_EXTENSION_URI)) {
				return rpcError(id, RPC.TASK_NOT_FOUND, `Task not found: ${message.taskId}`);
			}
			if (record && TERMINAL_STATES.has(record.task?.status?.state) && !hasPayment) {
				return rpcError(
					id,
					RPC.UNSUPPORTED_OPERATION,
					`Task ${message.taskId} is ${record.task.status.state}; start a new task without taskId.`,
				);
			}
		}

		const picked = selectSkill(message, { record, extensions: ctx.extensions });
		if (picked.error) return rpcError(id, picked.error.code, picked.error.message);
		if (!picked.skill) {
			const reply = agentMessage(undefined, message.contextId || randomUUID(), helpText());
			delete reply.taskId;
			return rpcResult(id, sendMessageResult(reply, dialect));
		}
		if (picked.skill.pricing === 'x402') return delegatePaid({ req, id, message, record, dialect });

		const run = FREE_RUNNERS[picked.skill.id];
		const task = record?.task ? structuredClone(record.task) : newTask(message);
		withUserMessage(task, message);
		const outcome = await run({ message, auth: ctx.auth, ip: ctx.ip, base: ctx.base, origin: ctx.base });
		applyOutcome(task, outcome);
		await saveTask(route, { task, skillId: picked.skill.id, state: outcome.continuation || null });
		return rpcResult(id, sendResult(task, dialect));
	}

	async function onGet({ id, params, dialect, ctx }) {
		const taskId = taskIdFromParams(params);
		if (!taskId) return rpcError(id, RPC.INVALID_PARAMS, 'Invalid params: id is required');
		const record = await loadTask(route, taskId);
		if (!record?.task) return rpcError(id, RPC.TASK_NOT_FOUND, `Task not found: ${taskId}`);
		let task = record.task;
		if (record.skillId === 'generate-3d-model' && task.status?.state === 'working') {
			const outcome = await refreshGenerate(record, { ip: ctx.ip, base: ctx.base });
			if (outcome) {
				task = applyOutcome(structuredClone(task), outcome);
				await saveTask(route, { task, skillId: record.skillId, state: outcome.continuation || null });
			}
		}
		const historyLength = Number.isInteger(params?.historyLength) ? params.historyLength : undefined;
		return rpcResult(id, serializeTask(task, dialect, { historyLength }));
	}

	async function onCancel({ id, params, dialect }) {
		const taskId = taskIdFromParams(params);
		if (!taskId) return rpcError(id, RPC.INVALID_PARAMS, 'Invalid params: id is required');
		const record = await loadTask(route, taskId);
		if (!record?.task) return rpcError(id, RPC.TASK_NOT_FOUND, `Task not found: ${taskId}`);
		const state = record.task.status?.state;
		// Only a task waiting on the caller can be cancelled: a running GPU job
		// cannot be recalled from the lane, and a finished task is final.
		if (state !== 'input-required' && state !== 'submitted') {
			return rpcError(id, RPC.TASK_NOT_CANCELABLE, `Task ${taskId} is ${state} and cannot be canceled.`);
		}
		const task = applyOutcome(structuredClone(record.task), { state: 'canceled', text: 'Canceled at the caller\'s request.' });
		await saveTask(route, { task, skillId: record.skillId, state: null });
		return rpcResult(id, serializeTask(task, dialect, { historyLength: 0 }));
	}

	async function dispatch(req, body, ctx) {
		if (!body || typeof body !== 'object' || Array.isArray(body)) {
			return rpcError(null, RPC.INVALID_REQUEST, 'Invalid Request: send one JSON-RPC 2.0 request object (batches are not supported)');
		}
		const id = body.id ?? null;
		if (body.jsonrpc !== '2.0' || typeof body.method !== 'string') {
			return rpcError(id, RPC.INVALID_REQUEST, 'Invalid Request: jsonrpc must be "2.0" and method a string');
		}
		const resolved = detectDialect(body.method, req.headers || {});
		if (resolved.error) return rpcError(id, resolved.error.code, resolved.error.message);
		const { op, dialect } = resolved;
		const params = body.params;
		switch (op) {
			case 'send':
				return onSend({ req, id, params, dialect, ctx });
			case 'get':
				return onGet({ id, params, dialect, ctx });
			case 'cancel':
				return onCancel({ id, params, dialect });
			case 'stream':
				return rpcError(id, RPC.UNSUPPORTED_OPERATION, 'Streaming is not supported: send the message and poll the task with GetTask.');
			case 'push':
				return rpcError(id, RPC.PUSH_NOTIFICATION_NOT_SUPPORTED, 'Push notifications are not supported: poll the task with GetTask.');
			case 'extendedCard':
				return rpcError(id, RPC.EXTENDED_CARD_NOT_CONFIGURED, `This agent has no extended card; the public card is ${PUBLIC_CARD}.`);
			case 'list':
				return rpcError(id, RPC.UNSUPPORTED_OPERATION, 'ListTasks is not supported: keep the task id the send returned.');
			default:
				return rpcError(id, RPC.METHOD_NOT_FOUND, `Method not found: ${body.method}`);
		}
	}

	function cardFragment() {
		return {
			name: 'three.ws',
			description: 'Free 3D generation, glTF validation and avatar search, plus a pay-per-call glTF inspector.',
			url: `${env.APP_ORIGIN}${route}`,
			documentationUrl: PUBLIC_CARD,
			preferredTransport: 'JSONRPC',
			supportedInterfaces: [
				{ url: `${env.APP_ORIGIN}${route}`, protocolBinding: 'JSONRPC', protocolVersion: DIALECT_V1 },
			],
			capabilities: {
				streaming: false,
				pushNotifications: false,
				stateTransitionHistory: false,
				extensions: [
					{
						uri: A2A_X402_EXTENSION_URI,
						description: 'Optional: activate to pay per call for the inspect-glb-a2a skill.',
						required: false,
					},
				],
			},
			defaultInputModes: ['text/plain', 'application/json'],
			defaultOutputModes: ['application/json'],
			skills: A2A_SKILLS.map(cardSkill),
		};
	}

	function send(res, status, payload, headers = {}) {
		res.statusCode = status;
		res.setHeader('content-type', 'application/json; charset=utf-8');
		for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
		res.end(JSON.stringify(payload));
	}

	return async function a2aService(req, res) {
		res.setHeader('access-control-allow-origin', req.headers.origin || '*');
		res.setHeader('access-control-allow-methods', 'GET,POST,OPTIONS');
		res.setHeader(
			'access-control-allow-headers',
			`content-type, authorization, ${A2A_VERSION_HEADER.toLowerCase()}, ${A2A_EXTENSIONS_HEADER_V1.toLowerCase()}, ${A2A_EXTENSIONS_HEADER_LEGACY.toLowerCase()}`,
		);
		res.setHeader('access-control-expose-headers', `${A2A_EXTENSIONS_HEADER_V1}, ${A2A_EXTENSIONS_HEADER_LEGACY}, Retry-After`);
		res.setHeader('vary', 'Origin');
		if (req.method === 'OPTIONS') {
			res.statusCode = 204;
			res.end();
			return;
		}
		if (req.method === 'GET') {
			send(res, 200, cardFragment(), { 'cache-control': 'public, max-age=300' });
			return;
		}
		if (req.method !== 'POST') {
			send(res, 405, { error: 'method_not_allowed' }, { allow: 'GET,POST,OPTIONS' });
			return;
		}

		const extensions = requestedExtensions(req.headers || {});
		// Echo the payment extension when the caller activated it, under both the
		// 1.0 header name and the X- name 0.3 peers read.
		if (extensions.has(A2A_X402_EXTENSION_URI)) {
			res.setHeader(A2A_EXTENSIONS_HEADER_V1, A2A_X402_EXTENSION_URI);
			res.setHeader(A2A_EXTENSIONS_HEADER_LEGACY, A2A_X402_EXTENSION_URI);
		}
		res.setHeader('cache-control', 'no-store');

		let body;
		try {
			const buf = await readBody(req, MAX_BODY_BYTES);
			body = buf.length ? JSON.parse(buf.toString('utf8')) : {};
		} catch (err) {
			const status = err?.status === 413 ? 413 : 400;
			send(res, status, rpcError(null, RPC.PARSE_ERROR, `Parse error: invalid JSON: ${err?.message || 'unreadable body'}`));
			return;
		}

		const ip = clientIp(req);
		let auth = null;
		const token = extractBearer(req);
		if (token) {
			try {
				auth = await authenticateBearer(token, { ip });
			} catch (err) {
				console.error('[a2a] bearer check failed:', err?.message || err);
				send(res, 503, rpcError(body?.id ?? null, RPC.INTERNAL_ERROR, 'Could not check the bearer credential right now. Retry, or call without it.'), { 'retry-after': '5' });
				return;
			}
			if (!auth) {
				send(
					res,
					401,
					rpcError(body?.id ?? null, RPC.INVALID_REQUEST, 'The bearer credential is invalid, expired or revoked. Send a valid API key, or omit Authorization to call anonymously.'),
					{ 'www-authenticate': 'Bearer error="invalid_token"' },
				);
				return;
			}
		}
		const limiterKey = auth?.userId ? `user:${auth.userId}` : ip;

		// Flood guard for the whole endpoint; the generation lane has its own,
		// tighter per-IP bucket on top.
		const gate = await limits.apiIp(`a2a:${limiterKey}`, { limit: 120, window: '1 m' });
		if (!gate.success) {
			const retryAfter = retryAfterSeconds(gate);
			send(res, 429, rpcError(body?.id ?? null, RPC_RATE_LIMITED, 'Too many requests. Slow down and retry.', { retryAfter }), { 'retry-after': String(retryAfter) });
			return;
		}

		const ctx = { extensions, auth, ip, base: originFromReq(req) };
		let reply;
		try {
			reply = await dispatch(req, body, ctx);
		} catch (err) {
			if (err instanceof RateLimitedError) {
				const retryAfter = retryAfterSeconds(err.limit);
				send(res, 429, rpcError(body?.id ?? null, RPC_RATE_LIMITED, err.message, { retryAfter }), { 'retry-after': String(retryAfter) });
				return;
			}
			console.error('[a2a] dispatch failed:', err);
			send(res, 200, rpcError(body?.id ?? null, RPC.INTERNAL_ERROR, 'Internal error while handling the request. Retry shortly.'));
			return;
		}
		send(res, 200, reply);
	};
}

