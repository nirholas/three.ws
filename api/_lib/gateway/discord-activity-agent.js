// The three.ws agent's reaction line inside the shared Discord Activity Forge
// room (work order 088-partners-05). One short sentence, written by the
// platform LLM chain from the event that just happened and nothing else, the
// same validated-note pattern api/_lib/scout-notes.js uses for the Sentiment
// Scout: a model will happily invent a detail, so a line that fails the checks
// below is dropped and the deterministic template runs instead. Kept free of
// $THREE or any other coin/wallet mention: this room ships with no purchases.

import { llmComplete } from '../llm.js';

export const MAX_LINE_CHARS = 180;
const REACT_TIMEOUT_MS = 12_000;

const PROMISE_RE = /\b(guarantee[ds]?|guaranteed|risk[- ]free|can'?t lose|cannot lose|buy now|not financial advice|nfa)\b/i;
const URL_RE = /(https?:\/\/|www\.)/i;
const TICKER_RE = /\$[A-Za-z][A-Za-z0-9]{1,15}\b/;
const WALLET_RE = /\b(wallet|mint|token|coin|airdrop|solana|sol\b)\b/i;

export const REACTION_SYSTEM = `You are the three.ws agent sitting in a Discord voice-channel group Activity where the group is generating a shared 3D model together with Forge.

Write ONE short reaction sentence, under ${MAX_LINE_CHARS - 20} characters, in a warm and encouraging voice. React only to the fact you are given. Do not invent any detail (no object count, no technical claim) that is not in the fact. Never mention money, a coin, a token, a wallet or a price. No links, no hashtags, no emoji spam (zero or one is fine).

Reply with the sentence and nothing else.`;

function validateReaction(text) {
	if (typeof text !== 'string') return false;
	const trimmed = text.trim();
	if (!trimmed || trimmed.length > MAX_LINE_CHARS) return false;
	if (PROMISE_RE.test(trimmed) || URL_RE.test(trimmed) || TICKER_RE.test(trimmed) || WALLET_RE.test(trimmed)) return false;
	return true;
}

function fallbackReaction(event) {
	if (event.kind === 'prompt') return `Generating "${event.prompt.slice(0, 60)}" now, hang tight.`;
	if (event.kind === 'creation') return `Here it is! What does everyone think?`;
	if (event.kind === 'vote') return `${event.voteCount} vote${event.voteCount === 1 ? '' : 's'} so far.`;
	return 'Nice work, everyone.';
}

/**
 * One reaction line for a room event. Never throws: an LLM failure or a line
 * that fails validation falls back to the deterministic template above, so the
 * room always has something to show. `complete` is injectable for tests.
 */
export async function reactToEvent(event, { complete = llmComplete } = {}) {
	const fallback = fallbackReaction(event);
	let fact;
	if (event.kind === 'prompt') fact = `Someone just asked Forge to make: "${event.prompt}".`;
	else if (event.kind === 'creation') fact = `Forge just finished generating the model for the prompt: "${event.prompt}".`;
	else if (event.kind === 'vote') fact = `The group's current model now has ${event.voteCount} vote${event.voteCount === 1 ? '' : 's'}.`;
	else fact = 'Something happened in the room.';

	try {
		const res = await complete({
			system: REACTION_SYSTEM,
			user: fact,
			maxTokens: 80,
			timeoutMs: REACT_TIMEOUT_MS,
			track: { tool: 'discord_activity_agent' },
		});
		const text = res?.text?.trim();
		if (validateReaction(text)) return { text, model: res?.model || null, provider: res?.provider || null };
	} catch {
		// fall through to the deterministic line
	}
	return { text: fallback, model: null, provider: null };
}
