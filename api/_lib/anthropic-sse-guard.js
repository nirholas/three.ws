// Owner guardrails on the Anthropic-shaped embed proxy (api/llm/anthropic.js).
//
// Embedded <agent-3d> agents talk Anthropic Messages SSE, so a guard there has
// to stop and replace a reply without ever emitting an invalid stream: every
// content block that was started gets stopped, and the message always ends
// with message_delta + message_stop. This module wraps createOutputGate for
// that protocol, and builds the complete synthetic message an input block
// answers with.

import { createOutputGate } from './chat-guardrails.js';

function frame(obj) {
	return `event: ${obj.type}\ndata: ${JSON.stringify(obj)}\n\n`;
}

function parseFrame(text) {
	const dataLine = text.split('\n').find((l) => l.startsWith('data:'));
	if (!dataLine) return null;
	try {
		return JSON.parse(dataLine.slice(5).trim());
	} catch {
		return null;
	}
}

/** The visitor's turn this request answers: the text of the last user message, or '' when it carries only tool results. */
export function lastVisitorText(messages) {
	const last = Array.isArray(messages) ? messages[messages.length - 1] : null;
	if (!last || last.role !== 'user') return '';
	if (typeof last.content === 'string') return last.content;
	if (!Array.isArray(last.content)) return '';
	return last.content
		.filter((b) => b && b.type === 'text' && typeof b.text === 'string')
		.map((b) => b.text)
		.join('\n');
}

/** Prior turns as plain {role, content} text, for the topic check's context. */
export function textHistory(messages) {
	return (Array.isArray(messages) ? messages.slice(0, -1) : [])
		.map((m) => ({
			role: m?.role,
			content: typeof m?.content === 'string' ? m.content : Array.isArray(m?.content) ? m.content.filter((b) => b?.type === 'text').map((b) => b.text).join('\n') : '',
		}))
		.filter((m) => (m.role === 'user' || m.role === 'assistant') && m.content);
}

/** A whole Anthropic SSE message carrying only `text`: what an input block streams back. */
export function syntheticSseMessage(text, model) {
	const id = `msg_guard_${Date.now()}`;
	return [
		frame({
			type: 'message_start',
			message: { id, type: 'message', role: 'assistant', content: [], model, stop_reason: null, stop_sequence: null, usage: { input_tokens: 0, output_tokens: 0 } },
		}),
		frame({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }),
		frame({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } }),
		frame({ type: 'content_block_stop', index: 0 }),
		frame({ type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 0 } }),
		frame({ type: 'message_stop' }),
	].join('');
}

/** The non-streaming equivalent. */
export function syntheticJsonMessage(text, model) {
	return {
		id: `msg_guard_${Date.now()}`,
		type: 'message',
		role: 'assistant',
		model,
		content: [{ type: 'text', text }],
		stop_reason: 'end_turn',
		stop_sequence: null,
		usage: { input_tokens: 0, output_tokens: 0 },
	};
}

/**
 * A writable sink for an Anthropic SSE stream that screens its text before it
 * reaches `res`. Feed it with write(text) (raw SSE, any chunking); call
 * close() once the upstream ends. On an unsafe verdict it stops emitting,
 * aborts `onBlock`'s caller, and close() ends the message with `replacement`.
 *
 * @param {object} o
 * @param {{ write: (s: string) => void, end: () => void }} o.res
 * @param {string} o.userMessage
 * @param {string} o.replacement
 * @param {Function} o.classify
 * @param {() => void} [o.onBlock]
 */
export function createAnthropicSseGuard({ res, userMessage, replacement, classify, onBlock = () => {} }) {
	let buf = '';
	let started = false;
	let openText = null;
	let maxIndex = -1;
	let releasedText = '';

	const emitRaw = ({ text, evt }) => {
		if (evt?.type === 'message_start') started = true;
		if (Number.isInteger(evt?.index)) maxIndex = Math.max(maxIndex, evt.index);
		if (evt?.type === 'content_block_start' && evt.content_block?.type === 'text') openText = evt.index;
		if (evt?.type === 'content_block_stop' && evt.index === openText) openText = null;
		res.write(text);
	};
	const gate = createOutputGate({
		userMessage,
		classify,
		onBlock,
		emitRaw,
		emitText: (text) => {
			releasedText += text;
			res.write(frame({ type: 'content_block_delta', index: openText ?? 0, delta: { type: 'text_delta', text } }));
		},
	});

	function handleFrame(text) {
		if (!text.trim()) return;
		const evt = parseFrame(text);
		if (evt?.type === 'content_block_delta' && evt.delta?.type === 'text_delta') {
			gate.text(evt.delta.text);
			return;
		}
		gate.raw({ text: `${text}\n\n`, evt });
	}

	return {
		write(chunk) {
			if (gate.blocked) return;
			buf += chunk;
			let cut;
			while ((cut = buf.indexOf('\n\n')) >= 0) {
				const one = buf.slice(0, cut);
				buf = buf.slice(cut + 2);
				handleFrame(one);
			}
		},
		get blocked() {
			return gate.blocked;
		},
		/** Upstream ended: wait for every verdict, close the message, end the response. */
		async close() {
			if (buf.trim() && !gate.blocked) handleFrame(buf);
			buf = '';
			const result = await gate.finish();
			if (result.blocked) {
				if (!started) {
					res.write(
						frame({
							type: 'message_start',
							message: { id: `msg_guard_${Date.now()}`, type: 'message', role: 'assistant', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 0, output_tokens: 0 } },
						}),
					);
				}
				let index = openText;
				if (index == null) {
					index = maxIndex + 1;
					res.write(frame({ type: 'content_block_start', index, content_block: { type: 'text', text: '' } }));
				}
				const text = releasedText ? `\n\n${replacement}` : replacement;
				res.write(frame({ type: 'content_block_delta', index, delta: { type: 'text_delta', text } }));
				res.write(frame({ type: 'content_block_stop', index }));
				res.write(frame({ type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 0 } }));
				res.write(frame({ type: 'message_stop' }));
			}
			res.end();
			return result;
		},
	};
}
