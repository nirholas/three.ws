// AG-UI event encoder for the agent run stream.
//
// AG-UI (https://docs.ag-ui.com, MIT, protocol 1.0, @ag-ui/core 1.0.3) is the
// open event protocol that CopilotKit, assistant-ui and the LangChain front
// ends speak. POST /api/agent/run?protocol=ag-ui drives the same server-side
// agent loop as the default OpenAI stream and renders its progress through this
// encoder instead. Each frame is `data: <json>\n\n`; the `type` field carries
// the event name.
//
// The encoder is a small state machine over the loop's own events
// (api/_lib/agent-loop.js onContent / onEvent). It owns the pairing rules the
// protocol requires: a text message opens lazily on the first delta and closes
// before any tool call starts or the run ends, and every TOOL_CALL_START is
// matched by ARGS, END and (once the tool returns) RESULT.
//
// Embodiment rides a CUSTOM event named EMBODIMENT_EVENT so an AG-UI front end
// can drive a three.ws avatar. Its value mirrors the Agent Action Protocol in
// src/agent-protocol.js: `{ type: 'think' | 'gesture' | 'emote', ... }`.

export const AG_UI_PROTOCOL_VERSION = '1.0';
export const EMBODIMENT_EVENT = 'three.ws.embodiment';
export const AG_UI_ACCEPT = 'application/vnd.ag-ui.event+stream';

/** True when the request asks for AG-UI: `?protocol=ag-ui` or the AG-UI Accept type. */
export function wantsAgUi(req) {
	const url = String(req?.url || '');
	const q = url.indexOf('?');
	if (q >= 0) {
		const proto = new URLSearchParams(url.slice(q + 1)).get('protocol');
		if (proto && proto.toLowerCase() === 'ag-ui') return true;
	}
	return String(req?.headers?.accept || '').toLowerCase().includes(AG_UI_ACCEPT);
}

/**
 * Normalize an AG-UI RunAgentInput into the body the run endpoint reads.
 * `threadId`/`runId` are kept for the encoder; `forwardedProps.agent_id` (or
 * `agentId`) selects the agent the run speaks as, like `agent_id` on the
 * default route. Message content that is a list of text parts is flattened.
 */
export function agUiRunInput(body) {
	const input = body && typeof body === 'object' ? body : {};
	const props = input.forwardedProps && typeof input.forwardedProps === 'object' ? input.forwardedProps : {};
	const messages = Array.isArray(input.messages)
		? input.messages.map((m) => (m && typeof m === 'object' ? { ...m, content: flattenContent(m.content) } : m))
		: input.messages;
	const agentId = input.agent_id ?? props.agent_id ?? props.agentId;
	return {
		threadId: typeof input.threadId === 'string' && input.threadId ? input.threadId.slice(0, 120) : null,
		runId: typeof input.runId === 'string' && input.runId ? input.runId.slice(0, 120) : null,
		body: { ...input, messages, ...(agentId ? { agent_id: agentId } : {}), stream: true },
	};
}

function flattenContent(content) {
	if (!Array.isArray(content)) return content;
	return content
		.map((part) => (part && typeof part === 'object' && part.type === 'text' ? String(part.text ?? '') : ''))
		.join('');
}

const frame = (event) => `data: ${JSON.stringify({ ...event, timestamp: Date.now() })}\n\n`;

function argsKey(tool, args) {
	return `${tool}\u0000${JSON.stringify(args ?? {})}`;
}

/**
 * @param {{ threadId: string, runId: string }} ids
 * @returns encoder whose methods each return the SSE text to write (possibly '').
 */
export function createAgUiEncoder({ threadId, runId }) {
	let started = false;
	let ended = false;
	let textId = null;
	let seq = 0;
	// tool name + serialized args -> FIFO of open tool call ids, so a result
	// finds its call even when the loop runs a batch of same-named tools.
	const open = new Map();
	const nextId = (prefix) => `${prefix}-${runId}-${++seq}`;

	const closeText = () => {
		if (!textId) return '';
		const out = frame({ type: 'TEXT_MESSAGE_END', messageId: textId });
		textId = null;
		return out;
	};

	const embodiment = (value) => frame({ type: 'CUSTOM', name: EMBODIMENT_EVENT, value });

	return {
		threadId,
		runId,

		start() {
			if (started) return '';
			started = true;
			return frame({ type: 'RUN_STARTED', threadId, runId, protocolVersion: AG_UI_PROTOCOL_VERSION });
		},

		text(delta) {
			if (ended || !delta) return '';
			let out = '';
			if (!textId) {
				textId = nextId('msg');
				out += frame({ type: 'TEXT_MESSAGE_START', messageId: textId, role: 'assistant' });
			}
			return out + frame({ type: 'TEXT_MESSAGE_CONTENT', messageId: textId, delta });
		},

		/** Map one agent-loop event (tool_call / tool_blocked / tool_result) to AG-UI frames. */
		loopEvent(event) {
			if (ended || !event) return '';
			if (event.kind === 'tool_call') {
				let out = closeText();
				const id = event.id || nextId('call');
				const key = argsKey(event.tool, event.args);
				if (!open.has(key)) open.set(key, []);
				open.get(key).push(id);
				out += frame({ type: 'TOOL_CALL_START', toolCallId: id, toolCallName: event.tool });
				out += frame({ type: 'TOOL_CALL_ARGS', toolCallId: id, delta: JSON.stringify(event.args ?? {}) });
				out += frame({ type: 'TOOL_CALL_END', toolCallId: id });
				out += embodiment({ type: 'think', phase: 'tool', tool: event.tool });
				return out;
			}
			if (event.kind === 'tool_result') {
				const queue = open.get(argsKey(event.tool, event.args));
				const id = queue?.shift();
				if (!id) return '';
				const failed = Boolean(event.error);
				const content = JSON.stringify(failed ? { error: event.error } : (event.result ?? null));
				let out = frame({ type: 'TOOL_CALL_RESULT', messageId: nextId('res'), toolCallId: id, content, role: 'tool' });
				if (failed) out += embodiment({ type: 'emote', emotion: 'concern', reason: 'tool_error', tool: event.tool });
				return out;
			}
			if (event.kind === 'tool_blocked') {
				return embodiment({ type: 'emote', emotion: 'concern', reason: 'tool_blocked', tool: event.tool });
			}
			return '';
		},

		/** A custom embodiment cue from any caller: `{ type: 'gesture', name }` or `{ type: 'emote', emotion }`. */
		embodiment(value) {
			return ended ? '' : embodiment(value);
		},

		/** Any other CUSTOM event, e.g. the sandbox workspace id a client continues next turn. */
		custom(name, value) {
			return ended ? '' : frame({ type: 'CUSTOM', name, value });
		},

		finish(result) {
			if (ended) return '';
			ended = true;
			return closeText() + frame({ type: 'RUN_FINISHED', threadId, runId, ...(result ? { result } : {}) });
		},

		error(message, code) {
			if (ended) return '';
			ended = true;
			return closeText() + frame({ type: 'RUN_ERROR', message: String(message || 'agent run failed').slice(0, 500), ...(code ? { code } : {}) });
		},
	};
}
