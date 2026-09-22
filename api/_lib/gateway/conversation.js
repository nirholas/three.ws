// One chat message -> one copilot turn, delivered back to the chat.
//
// The turn is the same one the web copilot runs (api/_lib/copilot-engine.js)
// over the agent's cross-channel thread (api/_lib/agent-thread.js), so a
// conversation started on the web continues here and the other way round. While
// the agent works, the chat shows a typing indicator and one compact status
// line ("working: get_quote") edited in place. Every trade or limit change the
// agent proposes becomes a preview with Approve and Cancel buttons; nothing in
// the reply text can execute one.

import { runCopilotTurn } from '../copilot-engine.js';
import { appendThreadMessage, threadHistoryForModel } from '../agent-thread.js';
import { resolveChatAgent, listAccountAgents } from './agents.js';
import { createPreview, setPreviewMessageRef, PREVIEW_TTL_MINUTES } from './store.js';
import { chunkText, describeProposal, plainText, MAX_TEXT, PLATFORM_LABEL, appOrigin } from './format.js';

export const APPROVE = 'gw:ap:';
export const CANCEL = 'gw:cx:';
const TYPING_EVERY_MS = 4500;

function surfaceNote(platform) {
	const where = PLATFORM_LABEL[platform] || platform;
	return [
		`SURFACE: you are replying in a ${where} chat with your owner. Write plain text: no tables, no headings, no code blocks. Keep it short.`,
		'Every propose_* card you surface reaches the owner as a preview message with Approve and Cancel buttons. Tell them to press Approve to execute it or Cancel to discard it, and that it expires in ten minutes. Never claim a trade happened.',
	].join('\n');
}

/** Keep the platform's typing indicator alive until stop() is called. */
function keepTyping(gw, chatId) {
	let stopped = false;
	const tick = () => { if (!stopped) Promise.resolve(gw.typing(chatId)).catch(() => {}); };
	tick();
	const timer = setInterval(tick, TYPING_EVERY_MS);
	return () => { stopped = true; clearInterval(timer); };
}

/**
 * The status line: sent on the first tool call, edited on every one after, and
 * left behind as a compact record of what the agent looked at.
 */
function statusLine(gw, chatId) {
	let ref = null;
	let chain = Promise.resolve();
	const used = [];
	const put = (text) => {
		chain = chain.then(async () => {
			if (ref) await gw.editMessage(ref, text);
			else ref = await gw.sendText(chatId, text);
		}).catch(() => {});
	};
	return {
		working(name) {
			if (!used.includes(name)) used.push(name);
			put(`working: ${name}`);
		},
		async finish() {
			if (used.length) put(`used: ${used.join(', ')}`);
			await chain;
		},
	};
}

function choicesFor(preview, proposal) {
	const blocked = proposal.kind === 'buy' && proposal.safety?.verdict === 'block';
	const unpriced = (proposal.kind === 'buy' || proposal.kind === 'sell') && (!proposal.quote || proposal.quote.error);
	if (blocked || unpriced) return [{ id: `${CANCEL}${preview.id}`, label: 'Dismiss', style: 'secondary' }];
	return [
		{ id: `${APPROVE}${preview.id}`, label: 'Approve', style: 'primary' },
		{ id: `${CANCEL}${preview.id}`, label: 'Cancel', style: 'danger' },
	];
}

export function previewText(proposal) {
	const blocked = proposal.kind === 'buy' && proposal.safety?.verdict === 'block';
	const tail = blocked
		? 'The safety firewall blocked this buy, so it cannot be approved.'
		: `Approve to execute, Cancel to discard. Expires in ${PREVIEW_TTL_MINUTES} minutes.`;
	return `${describeProposal(proposal)}\n\n${tail}`;
}

async function sendPreviews({ gw, event, link, agent, proposals }) {
	for (const p of proposals) {
		const preview = await createPreview({ linkId: link.id, userId: link.user_id, agentId: agent.id, kind: p.kind, proposal: p });
		const ref = await gw.sendChoice(event.chatId, previewText(p), choicesFor(preview, p));
		if (ref) await setPreviewMessageRef(preview.id, ref);
	}
}

async function sendReply(gw, chatId, text) {
	for (const part of chunkText(text, MAX_TEXT[gw.platform] || 1900)) await gw.sendText(chatId, part);
}

/**
 * Run one turn for `text` in a paired chat.
 * @param {{ gw:object, event:object, link:object, text:string }} ctx
 */
export async function converse({ gw, event, link, text }) {
	const agent = await resolveChatAgent(link);
	if (!agent) {
		const agents = await listAccountAgents(link.user_id);
		return gw.sendText(event.chatId, agents.length
			? 'Pick which agent this chat talks to first: send /agents, then /use <number>.'
			: `Your account has no agents yet. Create one at ${appOrigin()}/create, then come back and say hi.`);
	}

	const channel = event.platform;
	const history = await threadHistoryForModel({ agentId: agent.id, userId: link.user_id, since: link.context_reset_at, limit: 23 });
	history.push({ role: 'user', content: text.slice(0, 4000) });
	await appendThreadMessage({ agentId: agent.id, userId: link.user_id, role: 'user', content: text, channel });

	const stopTyping = keepTyping(gw, event.chatId);
	const status = statusLine(gw, event.chatId);
	let turn;
	try {
		turn = await runCopilotTurn({
			agent,
			history,
			network: 'mainnet',
			surfaceNote: surfaceNote(event.platform),
			emit: (name, data) => { if (name === 'tool_start') status.working(data.name); },
		});
	} catch (e) {
		stopTyping();
		await status.finish();
		const msg = e?.code === 'llm_unavailable'
			? 'Your agent cannot think right now: no language model is reachable. Try again shortly.'
			: 'Your agent hit an error answering that. Try again in a moment.';
		console.error('[gateway] turn failed', e?.message);
		return gw.sendText(event.chatId, msg);
	}
	stopTyping();
	await status.finish();

	const reply = plainText(turn.reply) || (turn.proposals.length ? 'Here is what I prepared:' : 'I have nothing to add to that.');
	await sendReply(gw, event.chatId, reply);
	if (turn.proposals.length) await sendPreviews({ gw, event, link, agent, proposals: turn.proposals });

	await appendThreadMessage({
		agentId: agent.id, userId: link.user_id, role: 'assistant', content: turn.reply || reply, channel,
		toolCalls: turn.toolCalls,
	});
	return turn;
}
