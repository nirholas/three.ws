// What a visitor sees when an owner guardrail answers instead of the agent
// (api/_lib/chat-guardrails.js). Dependency-free so the agent editor
// (src/agent-guardrails.js) previews exactly the text chat will send.

export const LIMITS = Object.freeze({ topics: 12, topicChars: 120, redirectChars: 280 });

export const REFUSALS = {
	jailbreak: "I can't change how I work or set aside my instructions, but I'm glad to help with anything else.",
	input_safety: "I can't help with that request. If there's something else you need, just ask.",
	output_safety: "I can't share that answer. Could you ask in a different way, or ask about something else?",
};

/** A readable list: "a", "a and b", "a, b and c". */
function humanList(items) {
	if (items.length <= 1) return items[0] || '';
	return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

/** The polite redirect an off-topic turn gets: the owner's own words, or one built from the topic list. */
export function topicRedirect(settings) {
	const custom = settings?.topics?.redirect?.trim();
	if (custom) return custom;
	const topics = (settings?.topics?.allowed || []).slice(0, 4).map((t) => t.replace(/[.\s]+$/, ''));
	if (!topics.length) return REFUSALS.input_safety;
	return `That's outside what I can help with here. I'm set up to help with ${humanList(topics)}. What would you like to know about those?`;
}

/** The reply the visitor gets when `check` blocks the turn. */
export function refusalFor(check, settings) {
	if (check === 'topic') return topicRedirect(settings);
	return REFUSALS[check] || REFUSALS.input_safety;
}
