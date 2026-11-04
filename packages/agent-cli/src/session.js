// The pieces every surface shares: an agent context (config, credential,
// model, tools, store, platform client) and a session over it (a transcript in
// the store that `send` extends one turn at a time).
//
// The TUI, the cron scheduler, subagents and the Telegram gateway all run
// turns through `session.send`, so they persist, index and bill the same way.

import os from 'node:os';
import path from 'node:path';
import { loadConfig } from './config.js';
import { resolveCredential } from './credentials.js';
import { createModel } from './model.js';
import { connectMcp } from './mcp.js';
import { databasePath, systemEnv } from './paths.js';
import { openStore } from './store.js';
import { localTools } from './tools/local.js';
import { createToolset } from './tools/registry.js';
import { InterruptedError, runTurn } from './loop.js';
import { createPlatform } from './platform.js';

/** The system prompt for a session on this machine. */
export function systemPrompt({ cwd, persona = null, kind = 'chat', now = new Date() }) {
	const lines = [
		persona ? `${persona.trim()}\n` : 'You are a three.ws agent running on the owner\'s own machine.',
		`Workspace root: ${cwd}. File paths are relative to it. Operating system: ${os.platform()} ${os.release()}. Today is ${now.toISOString().slice(0, 10)}.`,
		'You have local tools (files, a sandboxed shell, web fetch) and the three.ws platform tools (the agent wallet, marketplace, 3D generation, memory). Solana is the home chain.',
		'Writes, shell commands and anything that moves funds need the owner\'s approval. If a call is refused, do not retry it; say what you would have done.',
		'Be concise. Report what you did and what you found.',
	];
	if (kind === 'subagent') lines.push('You are a subagent: complete the one goal you were given, then reply with a short summary of the result for the parent session.');
	if (kind === 'cron') lines.push('This is a scheduled run with nobody at the keyboard: approval-gated tools will be refused, so work with read-only tools and report the result.');
	if (kind === 'gateway') lines.push('The owner is talking to you from a chat app: keep replies short and plain text.');
	return lines.join('\n');
}

/**
 * Build the agent context. MCP is connected on demand (`ensureTools`), so a
 * command that only lists sessions never opens a network connection.
 *
 * @param {object} [o]
 * @param {object} [o.env]        systemEnv() overrides (tests use a temp home)
 * @param {string} [o.cwd]        workspace root
 * @param {object} [o.store]      an open store (else the default database file)
 * @param {boolean} [o.mcp]       mount the three.ws MCP servers (default true)
 * @param {Function} [o.fetchImpl]
 */
export function createAgentContext({ env = systemEnv(), cwd = env.cwd, store = null, mcp = true, fetchImpl, overrides = {} } = {}) {
	let config = applyOverrides(loadConfig(env), overrides);
	let credential = resolveCredential(env);
	const db = store || openStore(databasePath(env));
	let model = null;
	let modelError = null;
	let remote = null;
	let toolsetPromise = null;

	function applyOverrides(cfg, o) {
		const next = { ...cfg };
		if (o.model) next.model = { ...next.model, model: o.model };
		if (o.agentId !== undefined) next.agentId = o.agentId;
		return next;
	}

	function buildModel() {
		try {
			model = createModel(config, credential, { fetchImpl, vars: env.vars });
			modelError = null;
		} catch (err) {
			model = null;
			modelError = err;
		}
	}
	buildModel();

	async function ensureTools() {
		if (!toolsetPromise) {
			toolsetPromise = (async () => {
				if (mcp && credential?.token) {
					remote = await connectMcp({ origin: config.origin, servers: config.mcp.servers, token: credential.token });
				}
				return createToolset({ local: localTools({ root: cwd, config }), remote, maxTools: config.mcp.maxTools });
			})();
		}
		return toolsetPromise;
	}

	return {
		env,
		cwd: path.resolve(cwd),
		store: db,
		get config() {
			return config;
		},
		get credential() {
			return credential;
		},
		get model() {
			if (!model) throw modelError;
			return model;
		},
		get modelError() {
			return modelError;
		},
		get modelLabel() {
			return model ? model.label : 'no model';
		},
		get remote() {
			return remote;
		},
		get platform() {
			return credential?.token ? createPlatform({ origin: config.origin, credential }) : null;
		},
		ensureTools,
		/** Reload config and credential from disk (after /model, /agent, login) and rebuild the model. */
		reload(nextOverrides = overrides) {
			config = applyOverrides(loadConfig(env), nextOverrides);
			credential = resolveCredential(env);
			buildModel();
		},
		async close() {
			await remote?.close();
			if (!store) db.close();
		},
	};
}

/**
 * A session: create one, or resume one by id or unique prefix.
 *
 * @param {ReturnType<typeof createAgentContext>} ctx
 * @param {{ resume?: string, title?: string, kind?: string, parentId?: string, channel?: string, persona?: string, budget?: object }} [o]
 */
export function createSession(ctx, { resume = null, title = null, kind = 'chat', parentId = null, channel = null, persona = null, budget = null } = {}) {
	const store = ctx.store;
	let row;
	if (resume) {
		row = store.resolveSession(resume);
		if (!row) throw new Error(`No session matches "${resume}". List them with \`three-ws-agent sessions\`.`);
	} else {
		row = store.createSession({ title, kind, parentId, agentId: ctx.config.agentId, model: ctx.modelLabel, cwd: ctx.cwd, channel });
	}
	let messages = store.messages(row.id);
	if (!messages.length || messages[0].role !== 'system') {
		const sys = { role: 'system', content: systemPrompt({ cwd: ctx.cwd, persona, kind: row.kind }) };
		store.appendMessages(row.id, [sys]);
		messages = [sys, ...messages];
	}
	const recentTools = new Set();
	for (const m of messages) for (const tc of m.tool_calls || []) recentTools.add(tc.function?.name);
	const totals = { prompt_tokens: 0, completion_tokens: 0, billedUsd: 0 };
	const pendingNotes = [];
	let busy = false;

	function persist(newMessages) {
		if (!newMessages.length) return;
		store.appendMessages(row.id, newMessages);
		messages = [...messages, ...newMessages];
		if (!row.title) {
			const first = newMessages.find((m) => m.role === 'user' && m.content);
			if (first) {
				row = { ...row, title: String(first.content).replace(/\s+/g, ' ').slice(0, 80) };
				store.setTitle(row.id, row.title);
			}
		}
	}

	function flushNotes() {
		if (busy || !pendingNotes.length) return;
		persist(pendingNotes.splice(0));
	}

	return {
		get id() {
			return row.id;
		},
		get title() {
			return row.title;
		},
		get kind() {
			return row.kind;
		},
		get messages() {
			return messages;
		},
		get totals() {
			return totals;
		},
		get busy() {
			return busy;
		},
		/**
		 * Add a message from outside a turn (a subagent report). While a turn is
		 * running it waits and lands right after that turn, so it never splits a
		 * tool call from its result.
		 */
		note(content) {
			pendingNotes.push({ role: 'user', content });
			flushNotes();
		},
		/**
		 * Run one turn. Resolves the runTurn result; on interrupt the user
		 * message and whatever was streamed are kept and InterruptedError is rethrown.
		 */
		async send(text, { approve = null, onContent, onEvent, signal } = {}) {
			if (busy) throw new Error('a turn is already running in this session');
			busy = true;
			const user = { role: 'user', content: String(text) };
			let streamed = '';
			try {
				const model = ctx.model;
				const toolset = await ctx.ensureTools();
				const result = await runTurn({
					model,
					toolset,
					messages: [...messages, user],
					query: user.content,
					recentTools: [...recentTools],
					approvals: ctx.config.approvals,
					approve,
					budget: budget || ctx.config.budget,
					signal,
					onContent: (d) => {
						streamed += d;
						onContent?.(d);
					},
					onEvent,
				});
				persist(result.messages.slice(messages.length));
				for (const t of result.toolsUsed) recentTools.add(t);
				totals.prompt_tokens += result.usage.prompt_tokens;
				totals.completion_tokens += result.usage.completion_tokens;
				totals.billedUsd += result.billedUsd;
				return result;
			} catch (err) {
				if (err instanceof InterruptedError) {
					persist([user, { role: 'assistant', content: `${streamed}${streamed ? '\n' : ''}[interrupted by the owner]` }]);
				}
				throw err;
			} finally {
				busy = false;
				flushNotes();
			}
		},
	};
}

/**
 * Run one prompt with nobody attached (cron, CLI one-shots): a fresh run row,
 * no approver (so every `ask` class is refused), usage recorded.
 */
export async function runHeadless(ctx, { prompt, kind = 'cron', channel = null, goal = prompt, signal, onEvent } = {}) {
	const existing = channel ? ctx.store.sessionForChannel(channel) : null;
	const session = existing ? createSession(ctx, { resume: existing.id }) : createSession(ctx, { kind, channel, title: String(goal).slice(0, 80) });
	const runId = ctx.store.startRun({ kind, sessionId: session.id, goal });
	try {
		const result = await session.send(prompt, { approve: null, signal, onEvent });
		ctx.store.finishRun(runId, { status: 'done', result: result.answer, usage: result.usage, billedUsd: result.billedUsd });
		return { runId, status: 'done', answer: result.answer, sessionId: session.id };
	} catch (err) {
		const status = err instanceof InterruptedError ? 'cancelled' : 'error';
		ctx.store.finishRun(runId, { status, error: String(err?.message || err) });
		return { runId, status, error: String(err?.message || err), sessionId: session.id };
	}
}
