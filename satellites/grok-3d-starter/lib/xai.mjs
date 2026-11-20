// The xAI half: build a Responses API request with the three.ws MCP tool,
// open its stream, and translate xAI's stream events into the starter's own
// small event vocabulary. Request fields:
// https://docs.x.ai/developers/rest-api-reference/inference/responses
// Remote MCP tool: https://docs.x.ai/developers/tools/remote-mcp

import { createHash } from 'node:crypto';
import { readSSE } from '../shared/sse.js';
import { ALLOWED_TOOLS, SERVER_LABEL } from './config.mjs';
import { mapXaiError, xaiStreamFailed, xaiUnreachable } from './errors.mjs';
import { bareToolName } from './tool-results.mjs';

export const SYSTEM_PROMPT = [
	'You turn a chat into a 3D model shown on a web page, using the three.ws tools.',
	'For a common, ready-made object (a chair, a lamp, a tree, a car), first call search_catalog with a short query and pick the best match; the page shows the results.',
	'Otherwise call forge_free with a clear, concrete description and tier "draft".',
	'When the user asks to change the model that is on the stage ("make it chrome", "add a hat"), call refine_model with glb_url set to the stage model\'s GLB link, instruction set to the change, and parent_prompt set to what the model is, if known.',
	'When a tool answers that a render is still running, say so in one short sentence and stop. The page follows the job and asks you to collect it with check_job when it is done.',
	'Keep replies to one or two short sentences. Never invent links; the page shows the real viewer link and download.',
].join(' ');

/** A stable, non-reversible id for the visitor, sent as safety_identifier. */
export function visitorId(address) {
	return createHash('sha256').update(`grok-3d-starter:${address}`).digest('hex').slice(0, 32);
}

export function mcpTool(config) {
	return {
		type: 'mcp',
		server_url: config.mcpUrl,
		server_label: SERVER_LABEL,
		server_description: 'three.ws: search ready-made 3D assets, generate a textured GLB from text, refine a model, and collect long renders.',
		allowed_tools: [...ALLOWED_TOOLS],
		authorization: config.threeWsApiKey,
	};
}

/** The text sent as the user turn: the stage note first, when a model is on the page. */
export function userTurnText(message, stage) {
	if (!stage) return message;
	const label = stage.label ? ` (${stage.label})` : '';
	return `[Model on the stage${label}: glb_url ${stage.glbUrl}]\n${message}`;
}

/**
 * The Responses API request body. `instructions` goes only on a conversation's
 * first request: xAI rejects it alongside previous_response_id and keeps the
 * first request's system prompt for the rest of the conversation.
 */
export function buildRequest({ config, text, previousResponseId = null, safetyIdentifier = null }) {
	return {
		model: config.model,
		input: [{ role: 'user', content: text }],
		...(previousResponseId ? { previous_response_id: previousResponseId } : { instructions: SYSTEM_PROMPT }),
		tools: [mcpTool(config)],
		reasoning: { effort: config.reasoningEffort },
		max_turns: 8,
		store: true,
		stream: true,
		...(safetyIdentifier ? { safety_identifier: safetyIdentifier } : {}),
	};
}

/** POST the request; resolves to the streaming Response or throws a mapped AppError. */
export async function openResponseStream({ config, body, signal, fetchImpl = fetch }) {
	let res;
	try {
		res = await fetchImpl(config.xaiUrl, {
			method: 'POST',
			headers: {
				'content-type': 'application/json',
				accept: 'text/event-stream',
				...(config.xaiApiKey ? { authorization: `Bearer ${config.xaiApiKey}` } : {}),
			},
			body: JSON.stringify(body),
			signal,
		});
	} catch (err) {
		if (signal?.aborted) throw err;
		throw xaiUnreachable(err);
	}
	if (!res.ok) {
		const text = await res.text().catch(() => '');
		throw mapXaiError(res.status, text, res.headers);
	}
	return res;
}

function parseArguments(raw) {
	if (raw && typeof raw === 'object') return raw;
	if (typeof raw !== 'string' || !raw.trim()) return {};
	try {
		return JSON.parse(raw);
	} catch {
		return { raw };
	}
}

/** Fresh per-round translation state. */
export function createStreamState() {
	return { responseId: null, text: '', calls: new Map(), finished: false, failure: null };
}

function callFromItem(item, state) {
	const id = item.id || item.call_id || `call_${state.calls.size + 1}`;
	const existing = state.calls.get(id) || { id, name: '', arguments: {}, argText: '', output: undefined, error: undefined, done: false };
	if (item.name) existing.name = item.name;
	if (item.arguments !== undefined) existing.arguments = parseArguments(item.arguments);
	if (item.output !== undefined && item.output !== null) existing.output = item.output;
	if (item.error !== undefined && item.error !== null) existing.error = item.error;
	state.calls.set(id, existing);
	return existing;
}

function toolEvent(call, status) {
	return { type: 'tool', id: call.id, name: bareToolName(call.name), rawName: call.name, arguments: call.arguments, status };
}

function isToolItem(item) {
	return item && (item.type === 'mcp_call' || item.type === 'mcp_tool_call');
}

/**
 * One xAI stream event in, zero or more app events out. App events:
 *   { type: 'response', id }                      the conversation id to continue from
 *   { type: 'text', delta }                       reply text
 *   { type: 'thinking' }                          Grok is reasoning
 *   { type: 'tool', id, name, arguments, status } a tool call started ('running') or finished ('done')
 *   { type: 'tool_output', id, name, output, error } a finished call's raw output
 */
export function translateEvent(evt, state) {
	const type = evt?.type || '';
	const out = [];
	switch (type) {
		case 'response.created':
		case 'response.in_progress': {
			const id = evt.response?.id;
			if (id && id !== state.responseId) {
				state.responseId = id;
				out.push({ type: 'response', id });
			}
			break;
		}
		case 'response.output_text.delta': {
			if (typeof evt.delta === 'string' && evt.delta) {
				state.text += evt.delta;
				out.push({ type: 'text', delta: evt.delta });
			}
			break;
		}
		case 'response.reasoning_summary_text.delta':
		case 'response.reasoning_text.delta':
			out.push({ type: 'thinking' });
			break;
		case 'response.output_item.added': {
			if (isToolItem(evt.item)) {
				const call = callFromItem(evt.item, state);
				out.push(toolEvent(call, 'running'));
			} else if (evt.item?.type === 'reasoning') {
				out.push({ type: 'thinking' });
			}
			break;
		}
		case 'response.mcp_call_arguments.delta':
		case 'response.mcp_call.arguments.delta': {
			const call = state.calls.get(evt.item_id);
			if (call && typeof evt.delta === 'string') call.argText += evt.delta;
			break;
		}
		case 'response.mcp_call_arguments.done':
		case 'response.mcp_call.arguments.done': {
			const call = state.calls.get(evt.item_id);
			if (call) {
				call.arguments = parseArguments(evt.arguments ?? call.argText);
				out.push(toolEvent(call, 'running'));
			}
			break;
		}
		case 'response.output_item.done': {
			if (isToolItem(evt.item)) out.push(...finishCall(callFromItem(evt.item, state)));
			break;
		}
		case 'response.completed':
		case 'response.incomplete': {
			state.finished = true;
			const response = evt.response || {};
			if (response.id && response.id !== state.responseId) {
				state.responseId = response.id;
				out.push({ type: 'response', id: response.id });
			}
			// The final output list is authoritative: pick up any call whose
			// done event this stream did not carry.
			for (const item of Array.isArray(response.output) ? response.output : []) {
				if (isToolItem(item)) out.push(...finishCall(callFromItem(item, state)));
			}
			if (!state.text) {
				const text = outputText(response.output);
				if (text) {
					state.text = text;
					out.push({ type: 'text', delta: text });
				}
			}
			break;
		}
		case 'response.failed': {
			state.finished = true;
			state.failure = xaiStreamFailed(evt.response?.error || evt.error || {});
			break;
		}
		case 'error': {
			state.finished = true;
			state.failure = xaiStreamFailed(evt.error && typeof evt.error === 'object' ? evt.error : evt);
			break;
		}
		default:
			break;
	}
	return out;
}

function finishCall(call) {
	if (call.done) return [];
	if (call.output === undefined && call.error === undefined) return [];
	call.done = true;
	return [toolEvent(call, 'done'), { type: 'tool_output', id: call.id, name: bareToolName(call.name), output: call.output, error: call.error }];
}

/** The assistant text in a Responses output list. */
export function outputText(output) {
	if (!Array.isArray(output)) return '';
	return output
		.filter((item) => item && item.type === 'message')
		.flatMap((item) => (Array.isArray(item.content) ? item.content : []))
		.filter((part) => part && (part.type === 'output_text' || part.type === 'text') && typeof part.text === 'string')
		.map((part) => part.text)
		.join('');
}

/** Every app event in one xAI round, in order. Throws the stream's failure, if any. */
export async function* streamRound({ config, body, signal, fetchImpl }) {
	const res = await openResponseStream({ config, body, signal, fetchImpl });
	const state = createStreamState();
	for await (const sse of readSSE(res.body)) {
		if (sse.data === '[DONE]') break;
		let evt;
		try {
			evt = JSON.parse(sse.data);
		} catch {
			continue;
		}
		if (!evt.type && sse.event && sse.event !== 'message') evt.type = sse.event;
		for (const appEvent of translateEvent(evt, state)) yield appEvent;
		if (state.failure) throw state.failure;
	}
	if (state.failure) throw state.failure;
	if (!state.finished && !state.responseId) throw xaiStreamFailed({ message: 'the stream closed before Grok answered' });
}
