// Talk to a three.ws agent from a Teams chat.
//
//   chat <agent name or link>   bind this conversation to a published agent
//   chat off | stop             unbind
//   anything else               while bound: the agent answers
//
// The answer is the agent's own persona (agent-turn.js buildAgentSystemPrompt)
// grounded in the documents its owner uploaded (agent-knowledge.js). In a
// personal chat it streams with status lines ("Searching documents", "Writing
// the answer"); in a group chat or channel it arrives as one message
// (teams-stream.js). The finished reply carries the AI label, the feedback
// buttons and a citation per document passage it used, linking back to the
// agent on three.ws (teams-ai.js), and is recorded in teams_ai_messages so
// feedback and reports on it name the agent. The reply text is not stored.
//
// The messaging endpoint must answer Teams within seconds, so a reply runs in
// its own request (POST /api/microsoft-teams/agent-reply, the same dispatch
// the 3D jobs use), or in this process on a box with no CRON_SECRET.

import { sql } from './db.js';
import { cacheDel, cacheGet, cacheSet, cacheSetIfAbsent } from './cache.js';
import { limits } from './rate-limit.js';
import { citationsFrom, hashId, numberedSources, tenantOf, withAiContent } from './teams-ai.js';
import { recordAiMessage } from './teams-ai-store.js';
import { createReplyStream } from './teams-stream.js';
import * as defaultConnector from './teams-connector.js';

export const CHAT_COMMAND = 'chat';
export const BINDING_TTL_S = 7 * 24 * 3600;
export const HISTORY_TTL_S = 30 * 60;
export const HISTORY_TURNS = 6;
export const REPLY_MAX_TOKENS = 900;
const RUN_PATH = '/api/microsoft-teams/agent-reply';
const DISPATCH_HEADER_MS = 8_000;
const NOTICE_PROBE_CHARS = 160;
const AGENT_LINK = /\/agents?\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// First words that belong to other bot commands, so a bound chat still runs them.
const OTHER_COMMANDS = new Set(['forge', 'link', 'approvals', 'help', '?']);

const FORMAT_NOTE =
	'You are answering inside a Microsoft Teams chat. Reply in plain Markdown, at most about 250 words. ' +
	'Do not include links unless a source provides one.';

const bindingKey = (conversationId) => `teams:chat:${hashId(conversationId)}`;
const historyKey = (conversationId) => `teams:chat:history:${hashId(conversationId)}`;

/** What `chat ...` asks for: { off: true }, { query }, { query: '' } for a bare command, or null. */
export function chatCommand(text) {
	const m = /^\/?chat(?:\s+([\s\S]*))?$/i.exec(String(text || '').trim());
	if (!m) {
		return /^\/?stop$/i.test(String(text || '').trim()) ? { off: true } : null;
	}
	const rest = (m[1] || '').trim();
	if (/^(off|stop|end|exit)$/i.test(rest)) return { off: true };
	return { query: rest };
}

function firstWord(text) {
	return String(text || '').trim().split(/\s+/)[0]?.replace(/^\//, '').toLowerCase() || '';
}

/** The conversation's bound agent { agentId, name }, or null. */
export async function boundAgent(conversationId) {
	if (!conversationId) return null;
	const b = await cacheGet(bindingKey(conversationId));
	return b?.agentId ? b : null;
}

async function findAgents(query) {
	const id = AGENT_LINK.exec(query)?.[1] || (UUID.test(query) ? query : null);
	if (id) {
		return sql`
			select id, name, description from agent_identities
			where id = ${id} and is_published = true and deleted_at is null
		`;
	}
	return sql`
		select id, name, description from agent_identities
		where is_published = true and deleted_at is null and name ilike ${'%' + query + '%'}
		order by (lower(name) = lower(${query})) desc, (name ilike ${query + '%'}) desc, published_at desc nulls last
		limit 5
	`;
}

/** Load one published agent with the fields a turn needs, or null. */
export async function loadPublishedAgent(agentId) {
	if (!UUID.test(String(agentId || ''))) return null;
	const [agent] = await sql`
		select id, name, description, skills, meta, embed_policy from agent_identities
		where id = ${agentId} and is_published = true and deleted_at is null
	`;
	return agent || null;
}

const CHAT_USAGE =
	'Type **chat** followed by an agent name or a three.ws agent link to talk to that agent here, for example: chat Atlas. ' +
	'Type **chat off** to stop.';

/** Answer a `chat` command with a plain (unlabelled) message. */
export async function handleChatCommand(activity, cmd) {
	const conversationId = activity.conversation.id;
	if (cmd.off) {
		const was = await boundAgent(conversationId);
		await cacheDel(bindingKey(conversationId));
		await cacheDel(historyKey(conversationId));
		return was ? `Stopped talking to ${was.name}. Type **chat** and an agent name to start again.` : CHAT_USAGE;
	}
	if (!cmd.query) return CHAT_USAGE;
	const matches = await findAgents(cmd.query.slice(0, 200));
	if (!matches.length) {
		return `No published three.ws agent matches "${cmd.query.slice(0, 60)}". Search agents from the message extension menu, or paste an agent link.`;
	}
	const exact = matches.find((a) => a.name.toLowerCase() === cmd.query.toLowerCase());
	if (!exact && matches.length > 1) {
		return `Several agents match. Type **chat** and one of: ${matches.map((a) => a.name).join(', ')}.`;
	}
	const agent = exact || matches[0];
	await cacheSet(bindingKey(conversationId), { agentId: agent.id, name: agent.name }, BINDING_TTL_S);
	await cacheDel(historyKey(conversationId));
	return `You are now talking to **${agent.name}**. Ask anything; answers are generated by AI and cite ${agent.name}'s documents when they use them. ` +
		'Use the thumbs buttons to rate an answer, and Report in the message menu (...) if one is inappropriate. Type **chat off** to stop.';
}

/** True when a message in a bound conversation should go to the agent. */
export function isAgentTurn(text) {
	const t = String(text || '').trim();
	return Boolean(t) && !OTHER_COMMANDS.has(firstWord(t));
}

/** The parts of an incoming activity a reply needs, small enough to dispatch. */
export function snapshotOf(activity, { agentId, text, origin }) {
	return {
		agentId,
		origin,
		text: String(text).slice(0, 4000),
		activity: {
			id: activity.id,
			type: activity.type,
			serviceUrl: activity.serviceUrl,
			channelId: activity.channelId,
			conversation: activity.conversation,
			from: { id: activity.from?.id, name: activity.from?.name, aadObjectId: activity.from?.aadObjectId },
			channelData: activity.channelData?.tenant ? { tenant: activity.channelData.tenant } : undefined,
		},
	};
}

/** True for a snapshot built by snapshotOf (what the reply endpoint accepts). */
export function isSnapshot(s) {
	const a = s?.activity;
	return Boolean(
		s && typeof s.agentId === 'string' && UUID.test(s.agentId)
		&& typeof s.text === 'string' && s.text.trim()
		&& a && typeof a.id === 'string' && /^https:\/\//.test(String(a.serviceUrl || ''))
		&& typeof a.conversation?.id === 'string',
	);
}

function replyTarget(activity) {
	return { serviceUrl: activity.serviceUrl, conversationId: activity.conversation.id, activityId: activity.id };
}

// Stream one completion over the agent's chain. Fails over to the next rung
// only before any text has reached the person; a rung that breaks mid-answer
// returns what it said, marked interrupted. Holds the first characters back
// long enough to catch a provider's "key out of budget" notice posing as an
// answer, which is never shown.
async function streamAnswer({ system, user, chain, onDelta, deps, anthropicModel, track }) {
	const { isProviderAccountNotice, recordEvent, costMicroUsd } = await runtime();
	const trackSpend = spendTracker(recordEvent, costMicroUsd);
	const messages = [{ role: 'system', content: system }, { role: 'user', content: user }];
	for (const provider of chain) {
		let held = '';
		let released = false;
		const t0 = deps.now();
		const onContent = (d) => {
			if (released) return onDelta(d);
			held += d;
			if (held.length >= NOTICE_PROBE_CHARS) {
				if (isProviderAccountNotice(held)) throw Object.assign(new Error('provider account notice'), { notice: true });
				released = true;
				onDelta(held);
			}
		};
		try {
			const round = await deps.streamRound(provider, { messages, onContent, maxTokens: REPLY_MAX_TOKENS });
			const text = String(round.content || '');
			if (!text.trim() || (!released && isProviderAccountNotice(text))) continue;
			if (!released) onDelta(held);
			trackSpend(provider, round.usage, messages, text, deps.now() - t0, track);
			return { text, provider: provider.name, model: provider.catalogModel || provider.model, interrupted: false };
		} catch (err) {
			if (released) {
				console.warn(`[teams-agent-chat] ${provider.name} broke mid-answer: ${err?.message || err}`);
				return { text: null, provider: provider.name, model: provider.catalogModel || provider.model, interrupted: true };
			}
			console.warn(`[teams-agent-chat] ${provider.name} failed before answering: ${err?.message || err}`);
		}
	}
	const r = await deps.complete({ system, user, maxTokens: REPLY_MAX_TOKENS, anthropicModel, track });
	onDelta(r.text);
	return { text: r.text, provider: r.provider || null, model: r.model || null, interrupted: false };
}

const spendTracker = (recordEvent, costMicroUsd) => function trackSpend(provider, usage, messages, text, latencyMs, track) {
	const estimate = (s) => Math.ceil(String(s || '').length / 4);
	const input = usage ? usage.input : estimate(messages.map((m) => m.content).join('\n'));
	const output = usage ? usage.output : estimate(text);
	recordEvent({
		kind: 'llm',
		provider: provider.name,
		model: provider.model,
		inputTokens: input,
		outputTokens: output,
		costMicroUsd: costMicroUsd({ provider: provider.name, model: provider.model, input, output, reportedCostUsd: usage?.reportedCostUsd ?? null }),
		latencyMs,
		agentId: track.agentId,
		tool: track.tool,
	});
};

// The agent runtime (persona, knowledge search, model chain, metering) loads
// on the first reply, not when the bot module loads: the bot's other paths
// (3D Studio, approvals, help) never need it.
let runtimeOnce = null;
function runtime() {
	runtimeOnce ||= Promise.all([
		import('./agent-turn.js'),
		import('./agent-model.js'),
		import('./agent-knowledge.js'),
		import('./llm-tool-chain.js'),
		import('./llm.js'),
		import('./llm-pricing.js'),
		import('./usage.js'),
	]).then((mods) => Object.assign({}, ...mods));
	return runtimeOnce;
}

const defaultDeps = {
	connector: defaultConnector,
	loadAgent: loadPublishedAgent,
	retrieve: async (agentId, text) => (await runtime()).retrieveForChat(agentId, text),
	chainFor: async (agent) => {
		const { modelChain, agentDefaultModel } = await runtime();
		return modelChain(agentDefaultModel(agent.meta)).chain;
	},
	streamRound: async (provider, opts) => (await runtime()).streamRound(provider, opts),
	complete: async (opts) => (await runtime()).llmComplete(opts),
	now: Date.now,
	sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
};

/**
 * Produce and post one agent reply. Resolves { id, streamed, labelled }.
 * Every failure ends in a message the person can act on.
 */
export async function runTeamsAgentReply(snapshot, overrides = {}) {
	const deps = { ...defaultDeps, ...overrides };
	const { activity, text, agentId } = snapshot;
	const origin = String(snapshot.origin || 'https://three.ws').replace(/\/+$/, '');
	const agent = await deps.loadAgent(agentId);
	if (!agent) {
		await cacheDel(bindingKey(activity.conversation.id));
		const res = await deps.connector.replyToActivity({
			...replyTarget(activity),
			activity: { type: 'message', text: 'That agent is no longer published on three.ws, so this chat has stopped. Type **chat** and another agent name to continue.', textFormat: 'markdown' },
		});
		return { id: res?.id || null, streamed: false, labelled: false };
	}
	const stream = createReplyStream(activity, { connector: deps.connector, now: deps.now, sleep: deps.sleep });
	await stream.informative(`Searching ${agent.name}'s documents`);
	let hits = [];
	try {
		hits = await deps.retrieve(agent.id, text);
	} catch (err) {
		console.warn(`[teams-agent-chat] knowledge search failed for ${agent.id}: ${err?.message || err}`);
	}
	await stream.informative(hits.length ? `Found ${hits.length} relevant passage${hits.length === 1 ? '' : 's'}. Writing the answer` : 'Writing the answer');

	const { buildAgentSystemPrompt, composeUserMessage, resolveTurnModel } = await runtime();
	const persona = await buildAgentSystemPrompt(agent, {});
	const system = [persona, numberedSources(hits), FORMAT_NOTE].filter(Boolean).join('\n\n');
	const history = (await cacheGet(historyKey(activity.conversation.id)).catch(() => null)) || [];
	const user = composeUserMessage(text, history);
	const track = { agentId: agent.id, tool: 'teams.agent_chat' };

	let answer;
	try {
		answer = await streamAnswer({
			system, user, chain: await deps.chainFor(agent), deps, track,
			anthropicModel: resolveTurnModel(agent),
			onDelta: (d) => { stream.append(d); },
		});
	} catch (err) {
		console.error(`[teams-agent-chat] no provider answered for ${agent.id}: ${err?.message || err}`);
		const posted = await stream.finish({
			type: 'message',
			text: `${agent.name} cannot answer right now because every AI model provider is unavailable. Try again in a few minutes.`,
		});
		return { ...posted, labelled: false };
	}

	const said = answer.text ?? stream.text;
	const body = answer.interrupted
		? `${said.trim()}\n\n_The answer was cut off because the model stopped responding. Ask again to get the rest._`
		: said;
	const citations = citationsFrom(hits, { agentId: agent.id, origin, text: said });
	const posted = await stream.finish(withAiContent({ type: 'message', textFormat: 'markdown', text: body }, { citations }));
	if (posted.id) {
		const cited = citations.map((c) => hits[c.position - 1]?.doc_id).filter(Boolean);
		await recordAiMessage({
			conversationId: activity.conversation.id,
			activityId: posted.id,
			tenantId: tenantOf(activity),
			kind: 'agent_reply',
			agentId: agent.id,
			model: answer.model,
			citedDocs: [...new Set(cited)],
		});
	}
	const next = [...history, { role: 'user', content: text }, { role: 'assistant', content: said }].slice(-HISTORY_TURNS * 2);
	await cacheSet(historyKey(activity.conversation.id), next, HISTORY_TTL_S).catch(() => {});
	return { ...posted, labelled: true, citations: citations.length };
}

/** Run a reply in its own request (see forge-run), or here without a secret. */
export async function dispatchAgentReply(snapshot, base, { fetchImpl = fetch, env = process.env, run = runTeamsAgentReply } = {}) {
	const local = () => {
		run(snapshot).catch((err) => console.error(`[teams-agent-chat] reply failed: ${err?.message || err}`));
		return 'local';
	};
	const secret = String(env.CRON_SECRET || '').trim();
	if (!secret || !base) return local();
	const ac = new AbortController();
	const timer = setTimeout(() => ac.abort(), DISPATCH_HEADER_MS);
	try {
		const res = await fetchImpl(`${base}${RUN_PATH}`, {
			method: 'POST',
			headers: { authorization: `Bearer ${secret}`, 'content-type': 'application/json' },
			body: JSON.stringify(snapshot),
			signal: ac.signal,
		});
		clearTimeout(timer);
		if (res.status !== 202) {
			await res.text().catch(() => '');
			console.warn(`[teams-agent-chat] reply endpoint answered ${res.status}; replying in process`);
			return local();
		}
		res.text().catch(() => {});
		return 'remote';
	} catch (err) {
		clearTimeout(timer);
		console.warn(`[teams-agent-chat] reply endpoint unreachable (${err?.message || err}); replying in process`);
		return local();
	}
}

/**
 * Route a message for agent chat. Resolves true when it was handled here
 * (a chat command, or a turn in a bound conversation).
 */
export async function handleAgentChatMessage(activity, text, ctx = {}) {
	const connector = ctx.deps?.connector || defaultConnector;
	const cmd = chatCommand(text);
	if (cmd) {
		const bound = cmd.off ? await boundAgent(activity.conversation.id) : null;
		if (cmd.off && !bound && /^\/?stop$/i.test(text.trim())) return false;
		const reply = await handleChatCommand(activity, cmd);
		if (connector.connectorConfigured()) {
			await connector.replyToActivity({ ...replyTarget(activity), activity: { type: 'message', textFormat: 'markdown', text: reply } });
		}
		return true;
	}
	if (!isAgentTurn(text)) return false;
	const bound = await boundAgent(activity.conversation.id);
	if (!bound) return false;
	if (!connector.connectorConfigured()) {
		console.warn('[teams-agent-chat] a chat message arrived but MS_TEAMS_BOT_APP_PASSWORD is not set, so the bot cannot reply');
		return true;
	}
	// Teams retries a message it thinks went unanswered; reply once.
	if (!(await cacheSetIfAbsent(`teams:chat:turn:${hashId(`${activity.conversation.id}|${activity.id}`)}`, 1, 3600))) return true;
	const limiter = ctx.deps?.chatLimit || ((key) => limits.chatUser(key));
	const limited = await limiter(`teams:${hashId(activity.from?.aadObjectId || activity.from?.id)}`);
	if (limited && limited.success === false) {
		await connector.replyToActivity({ ...replyTarget(activity), activity: { type: 'message', text: 'You are sending messages faster than the agent can answer. Wait a minute, then try again.' } });
		return true;
	}
	const snapshot = snapshotOf(activity, { agentId: bound.agentId, text, origin: ctx.origin });
	if (ctx.deps?.runReply) await ctx.deps.runReply(snapshot);
	else await dispatchAgentReply(snapshot, ctx.selfBase || ctx.origin);
	return true;
}
