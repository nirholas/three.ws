// Bot-to-bot: when a known xAI account (@grok, @bot) tags one of our accounts,
// the request is treated as made by the human at the root of the conversation.
//
//   - The bot's text goes through the same pure parser as any mention.
//   - The human is the author of the conversation's root post. If the bot
//     started the conversation itself there is no human to attribute, and the
//     mention is skipped.
//   - The human's reply allowance applies, not the bot's: mentions the human
//     wrote and mentions a bot wrote for them share one count.
//   - One reply, to the bot's post, in a machine-friendly shape: a line of what
//     we made, the viewer link, the GLB link, and how to add three.ws to Grok
//     Bot as an MCP connector.
//   - Loop cap: one reply per conversation to bot authors, ever, and never an
//     answer to a bot's reply to our reply.
//
// Only a generation request is actionable. A bot can never cause chat, a
// launch or anything that moves funds: those intents are skipped. All post
// text is untrusted data; the only action it can cause is one reply.

import { selfOrigin } from './self-origin.js';
import { weightedLength, X_POST_MAX_WEIGHT } from './x-text-weight.js';
import { lookupPostAuthor } from './x-mentions.js';
import { MIN_AUTHOR_AGE_SECONDS, CONVERSATION_MAX_REPLIES, loadBlocklist, ownIdentities } from './x-mention-guard.js';
import { checkPromptSafety } from '../_mcp-studio/safety.js';
import { startForge, pollJob, viewerUrl } from '../_mcp-studio/gpt-forge-client.js';

export const CONNECTOR_PATH = '/api/mcp-grok';
export const BOT_LOOP_CAP = 1;
const DEFAULT_BUDGET_MS = 90_000;
const ECHO_MAX = 40;

/** Intents a bot may cause. Everything else is skipped, never answered. */
export const ACTIONABLE_INTENTS = Object.freeze(['make']);

const UNSAFE_REPLY = 'Cannot make that one. Try a creature, prop or scene, like "a low poly fox".';

export const botMakeBudgetMs = (env = process.env) => {
	const n = Number(env.X_BOT_MAKE_BUDGET_MS);
	return Number.isFinite(n) && n > 0 ? n : DEFAULT_BUDGET_MS;
};

/** The prompt as echoed back: one line, no cashtags, hashtags or quotes, cut on a word edge. PURE. */
export function shortenPrompt(prompt, max = ECHO_MAX) {
	const text = String(prompt ?? '').replace(/[$#]\S+/g, ' ').replace(/["\u201c\u201d]/g, '').replace(/\s+/g, ' ').trim();
	const chars = [...text];
	if (chars.length <= max) return text;
	const cut = chars.slice(0, max).join('');
	const space = cut.lastIndexOf(' ');
	return `${(space > max * 0.5 ? cut.slice(0, space) : cut).replace(/[\s,;:.-]+$/, '')}...`;
}

/**
 * The machine-friendly reply. Each fact sits on its own line so a parser (or a
 * model) reads it without guessing. PURE.
 *
 * @param {'success'|'failure'|'unsafe'} kind
 * @param {{ base: string, prompt?: string, viewerLink?: string, glbUrl?: string, forgeLink?: string }} f
 */
export function composeBotReply(kind, { base, prompt = '', viewerLink = '', glbUrl = '', forgeLink = '' }) {
	if (kind === 'unsafe') return UNSAFE_REPLY;
	const connector = `Add three.ws to Grok Bot as an MCP connector: ${base}${CONNECTOR_PATH}`;
	const build = (echo) => {
		const named = echo ? ` "${echo}"` : '';
		if (kind === 'success') return [`Made your 3D model${named}.`, `Viewer: ${viewerLink}`, `GLB: ${glbUrl}`, connector].join('\n');
		return [`Could not finish your 3D model${named} this time.`, `Try it: ${forgeLink}`, connector].join('\n');
	};
	let max = ECHO_MAX;
	let text = build(shortenPrompt(prompt, max));
	while (weightedLength(text) > X_POST_MAX_WEIGHT && max > 8) {
		max -= 8;
		text = build(shortenPrompt(prompt, max));
	}
	return weightedLength(text) > X_POST_MAX_WEIGHT ? build('') : text;
}

/**
 * Resolve the human a bot mention speaks for: the author of the conversation's
 * root post. Never throws; every failure is a skip reason.
 *
 * @returns {Promise<{ ok: true, human: { id: string, username: string|null, createdAt: string|null } } | { ok: false, reason: string }>}
 */
export async function resolveHuman({ mention, request, bots, own, read, lookup = lookupPostAuthor }) {
	const conversationId = mention.conversationId || mention.chatId;
	if (!conversationId || String(conversationId) === String(mention.id)) return { ok: false, reason: 'bot_no_human_root' };

	let root = null;
	const parent = mention.repliedTo;
	if (parent?.available && String(parent.id) === String(conversationId) && parent.author?.id) {
		root = { id: String(parent.author.id), username: parent.author.username || null, createdAt: parent.author.createdAt || null };
	} else if (typeof request === 'function') {
		try {
			root = await lookup({ postId: conversationId, request });
		} catch {
			return { ok: false, reason: 'bot_root_unresolved' };
		}
	}
	if (!root) return { ok: false, reason: 'bot_root_unresolved' };
	if (own.ids.has(root.id) || bots.isKnownBot(root)) return { ok: false, reason: 'bot_root_not_human' };
	if ((await loadBlocklist(read)).has(root.id)) return { ok: false, reason: 'author_blocked' };
	const created = root.createdAt ? Date.parse(root.createdAt) : NaN;
	if (Number.isFinite(created) && (Date.now() - created) / 1000 < MIN_AUTHOR_AGE_SECONDS) return { ok: false, reason: 'new_account' };
	return { ok: true, human: root };
}

/**
 * Loop and depth rules specific to bot authors. Returns a skip reason or null.
 */
export async function botLoopReason({ mention, account, own, store }) {
	if (mention.repliedTo?.author?.id && own.ids.has(String(mention.repliedTo.author.id))) return 'bot_reply_to_own_reply';
	const conversationId = mention.conversationId || mention.chatId;
	const acct = { kind: account.kind, ref: account.ref };
	if ((await store.countBotRepliesInConversation(conversationId, { account: acct })) >= BOT_LOOP_CAP) return 'bot_loop_cap';
	if ((await store.countRepliesInConversation(conversationId, { account: acct })) >= CONVERSATION_MAX_REPLIES) return 'conversation_depth';
	return null;
}

/** The human's allowance, shared with the mentions they wrote themselves. */
export async function humanOverLimit(humanId, account, limits, store) {
	const acct = { kind: account.kind, ref: account.ref };
	if ((await store.countByPrincipal(humanId, { windowSeconds: 3600, decisions: ['reply'], account: acct })) >= limits.perHour) return 'author_hourly_limit';
	if ((await store.countByPrincipal(humanId, { windowSeconds: 86400, decisions: ['reply'], account: acct })) >= limits.perDay) return 'author_daily_limit';
	return null;
}

/**
 * Generate for a `make` request on the free studio lane. Resolves to a reply
 * shape; never throws for a generation failure.
 */
export async function generateMake({ prompt, base, env = process.env, deps = {} }) {
	const safety = checkPromptSafety(prompt);
	if (!safety.allowed) return { kind: 'unsafe', category: safety.category, text: composeBotReply('unsafe', { base }) };
	const submit = deps.startForge || startForge;
	const poll = deps.pollJob || pollJob;
	const failure = (reason) => ({
		kind: 'failure',
		reason,
		link: `${base}/forge?prompt=${encodeURIComponent(prompt)}`,
		text: composeBotReply('failure', { base, prompt, forgeLink: `${base}/forge?prompt=${encodeURIComponent(prompt)}` }),
	});
	try {
		let job = await submit(base, { prompt, path: 'image', tier: 'standard', internal: true, director: true });
		if (!(job.status === 'done' && job.glb_url)) {
			job = await poll(base, job.job_id, { timeoutMs: botMakeBudgetMs(env), intervalMs: Number(env.STUDIO_POLL_MS) || 3000 });
		}
		if (job._timedOut || !job.glb_url) return failure('make_timeout');
		const link = viewerUrl(base, job.glb_url);
		return {
			kind: 'success',
			link,
			glbUrl: job.glb_url,
			creationId: job.creation_id || null,
			text: composeBotReply('success', { base, prompt, viewerLink: link, glbUrl: job.glb_url }),
		};
	} catch (err) {
		return failure(`make_failed:${err?.code || 'error'}`);
	}
}

/**
 * Answer a known bot's actionable mention on behalf of the human at the root of
 * the conversation. Returns the decision recorded, in the shape
 * handleMention returns.
 *
 * @param {object} o
 * @param {any} o.mention
 * @param {{ intent: string, args?: any, reason?: string }} o.parsed
 * @param {{ kind: string, ref: string }} o.account
 * @param {{ perHour: number, perDay: number }} o.limits
 * @param {object} o.store         x-mention-store (or a test double)
 * @param {object} o.bots          known-bot matcher
 * @param {Function|null} o.request  X transport for the root lookup
 * @param {Function} o.adapterFactory
 * @param {Function} [o.generate]  (intent args) => reply shape; default is the free studio lane
 */
export async function answerOnBehalf({ mention, parsed, account, limits, env = process.env, store, bots, request, adapterFactory, read, generate = null, lookup }) {
	const settle = async (decision, reason) => {
		await store.updateDecision(mention.id, { decision, reason });
		return { tweetId: mention.id, intent: parsed.intent, decision, reason };
	};
	if (!ACTIONABLE_INTENTS.includes(parsed.intent)) return settle('skip', 'known_bot');

	const own = ownIdentities({ account, env });
	const loop = await botLoopReason({ mention, account, own, store });
	if (loop) return settle('skip', loop);

	const resolved = await resolveHuman({ mention, request, bots, own, read, lookup });
	if (!resolved.ok) return settle('skip', resolved.reason);
	const { human } = resolved;
	await store.mergeArgs(mention.id, { on_behalf_of: { id: human.id, username: human.username, via: mention.username || mention.author?.username || null } });

	const limited = await humanOverLimit(human.id, account, limits, store);
	if (limited) return settle('rate_limited', limited);

	const base = selfOrigin();
	const run = generate || ((args) => generateMake({ prompt: args.prompt, base, env }));
	const reply = await run(parsed.args);
	if (reply.kind === 'unsafe') {
		await store.updateDecision(mention.id, { decision: 'unsafe', reason: `safety_${reply.category}`, replyText: reply.text });
		return { tweetId: mention.id, intent: parsed.intent, decision: 'unsafe', reason: `safety_${reply.category}`, text: reply.text };
	}
	const adapter = adapterFactory({ mention, parsed, env, policyDryRun: true });
	await adapter.sendText(mention.id, reply.text);
	const reason = reply.kind === 'success' ? 'bot_make_done' : reply.reason;
	await store.updateDecision(mention.id, { reason, replyLink: reply.link, creationId: reply.creationId || undefined });
	return { tweetId: mention.id, intent: parsed.intent, decision: 'reply', reason, text: reply.text, on_behalf_of: human.id, dry_run: !adapter.live };
}
