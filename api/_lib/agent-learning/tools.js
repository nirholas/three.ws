// The learning tools, defined once and served on every surface an agent runs:
//
//   memory_save          keep one idea (fact, preference, procedure, user-model)
//   memory_search        read memories back by meaning or words
//   memory_list          newest-first page of memories, optionally one kind
//   memory_forget        delete one memory; irreversible, needs confirm_delete
//   search_sessions      full-text search over past conversations and runs
//   propose_skill_edit   improve a custom skill in use; a new, reversible version
//
// Surfaces: the server agent loop (v1 runs, api/_lib/agent-loop.js), the owner
// chat (api/chat.js server tool round) and MCP (api/_mcp/tools/learning.js).
// Each hands `runLearningTool` the (agent, account) it is running for; a tool
// never takes the agent or account from the model's arguments, so a prompt
// cannot point a memory write at somebody else's agent.
//
// Every write checks the account's off switch (/settings/memory) inside the
// service layer; a refused write comes back as a designed result the model
// can read (`memory_disabled`), never as a thrown error.

import { LearningError } from './errors.js';
import { saveMemory, searchAgentMemory, listAgentMemory, forgetMemory, getMemory, MEMORY_KINDS, ROW_KINDS } from './memory.js';
import { SECTION_IDS } from './user-model.js';
import { searchSessions } from './session-search.js';
import { proposeSkillEdit } from './skill-drafts.js';

/** Every learning tool name, in the order they are offered. */
export const LEARNING_TOOL_NAMES = Object.freeze([
	'memory_save',
	'memory_search',
	'memory_list',
	'memory_forget',
	'search_sessions',
	'propose_skill_edit',
]);

/**
 * Tools an unattended run may call. memory_forget is irreversible and needs the
 * owner to see the memory and say yes first, so it is offered only where the
 * owner is in the conversation (chat and MCP), never to an autonomous run.
 */
export const AUTONOMOUS_TOOL_NAMES = Object.freeze(LEARNING_TOOL_NAMES.filter((n) => n !== 'memory_forget'));

export const LEARNING_TOOLS = Object.freeze({
	memory_save: {
		description:
			'Keep one durable idea so you never have to ask again. kind: preference (how the person wants things done), fact (true about the world or the work), procedure (steps of a task that worked), or user-model (about the person themself; also pass section). One idea per memory, written to make sense with no other context. Saving the same thing twice reinforces it. Never save secrets such as keys, passwords or seed phrases.',
		parameters: {
			type: 'object',
			properties: {
				kind: { type: 'string', enum: [...MEMORY_KINDS] },
				content: { type: 'string', maxLength: 1000, description: 'The memory, one idea, plain language.' },
				section: { type: 'string', enum: SECTION_IDS, description: 'Required for kind user-model: which part of the about-the-person document it belongs to.' },
				tags: { type: 'array', items: { type: 'string' }, maxItems: 8 },
				confidence: { type: 'number', minimum: 0, maximum: 1, description: 'How sure you are, 0 to 1. Default 0.7; use 0.9+ only when the person said it outright.' },
			},
			required: ['kind', 'content'],
			additionalProperties: false,
		},
	},
	memory_search: {
		description: 'Search your memories about this person and your work by meaning and words. Call it before asking something they may already have told you.',
		parameters: {
			type: 'object',
			properties: {
				query: { type: 'string', maxLength: 300 },
				kind: { type: 'string', enum: [...ROW_KINDS] },
				limit: { type: 'integer', minimum: 1, maximum: 25 },
			},
			required: ['query'],
			additionalProperties: false,
		},
	},
	memory_list: {
		description: 'List your newest memories, optionally one kind. Use memory_search when you have a topic in mind.',
		parameters: {
			type: 'object',
			properties: {
				kind: { type: 'string', enum: [...ROW_KINDS] },
				limit: { type: 'integer', minimum: 1, maximum: 50 },
			},
			additionalProperties: false,
		},
	},
	memory_forget: {
		description:
			'Permanently delete one memory. Irreversible: first show the person the memory (from memory_search or memory_list) and get a clear yes, then call with confirm_delete: true.',
		parameters: {
			type: 'object',
			properties: {
				memory_id: { type: 'string', format: 'uuid' },
				confirm_delete: { type: 'boolean', description: 'Must be true. Only after the person confirmed this exact memory.' },
			},
			required: ['memory_id', 'confirm_delete'],
			additionalProperties: false,
		},
	},
	search_sessions: {
		description:
			'Search your past conversations and runs with this person (full-text). Returns the best matching sessions with a short summary and the matching lines. Use it to recall what was decided or tried before.',
		parameters: {
			type: 'object',
			properties: {
				query: { type: 'string', maxLength: 300, description: 'Words or a phrase; quotes and OR work like a web search.' },
				limit: { type: 'integer', minimum: 1, maximum: 10 },
			},
			required: ['query'],
			additionalProperties: false,
		},
	},
	propose_skill_edit: {
		description:
			'Improve one of your custom skills while you use it: pass the full new text and a note on what it fixes. The edit becomes a new version at once and the owner can roll it back at any time.',
		parameters: {
			type: 'object',
			properties: {
				skill_id: { type: 'string', format: 'uuid' },
				content: { type: 'string', maxLength: 24000, description: 'The complete new skill text (markdown), not a diff.' },
				note: { type: 'string', maxLength: 300, description: 'What the edit fixes, one sentence.' },
			},
			required: ['skill_id', 'content', 'note'],
			additionalProperties: false,
		},
	},
});

/** OpenAI function-calling schemas for the named learning tools. */
export function learningToolSchemas(names = LEARNING_TOOL_NAMES) {
	return names.map((name) => ({
		type: 'function',
		function: { name, description: LEARNING_TOOLS[name].description, parameters: LEARNING_TOOLS[name].parameters },
	}));
}

export function isLearningTool(name) {
	return Object.prototype.hasOwnProperty.call(LEARNING_TOOLS, name);
}

/**
 * Run one learning tool for (agent, account). Returns a JSON-serializable
 * result; a refusal the model should read (memory switched off, a missing
 * confirmation, a validation problem) comes back as `{ ok: false, error, message }`.
 *
 * @param {string} name
 * @param {object} args
 * @param {{ agentId: string, userId: string, source?: string, runRef?: string|null, messageId?: string|null, complete?: Function }} ctx
 */
export async function runLearningTool(name, args, ctx) {
	const a = args && typeof args === 'object' ? args : {};
	const { agentId, userId } = ctx;
	try {
		switch (name) {
			case 'memory_save': {
				const out = await saveMemory({
					agentId,
					userId,
					kind: a.kind,
					content: a.content,
					section: a.section ?? null,
					tags: a.tags,
					confidence: a.confidence ?? 0.7,
					source: ctx.source || 'tool',
					sourceRunId: ctx.runRef || null,
					sourceMessageId: ctx.messageId || null,
				});
				return { ok: true, status: out.status, kind: out.kind, memory: out.memory || out.entry };
			}
			case 'memory_search': {
				const out = await searchAgentMemory({ agentId, userId, query: a.query, kind: a.kind || null, limit: a.limit });
				return { ok: true, query: out.query, count: out.results.length, memories: out.results.map(slim) };
			}
			case 'memory_list': {
				const out = await listAgentMemory({ agentId, userId, kind: a.kind || null, limit: a.limit || 20 });
				return { ok: true, count: out.memories.length, has_more: out.has_more, memories: out.memories.map(slim) };
			}
			case 'memory_forget': {
				if (a.confirm_delete !== true) {
					const preview = a.memory_id ? await getMemory(userId, a.memory_id).catch(() => null) : null;
					return {
						ok: false,
						error: 'confirmation_required',
						message: 'Deleting a memory is permanent. Show the person this memory, get a clear yes, then call memory_forget again with confirm_delete: true.',
						preview: preview ? slim(preview) : null,
					};
				}
				const memory = await getMemory(userId, a.memory_id);
				if (memory.agent_id !== agentId) {
					return { ok: false, error: 'not_found', message: 'That memory does not belong to this agent.' };
				}
				await forgetMemory(userId, a.memory_id);
				return { ok: true, status: 'deleted', memory: slim(memory) };
			}
			case 'search_sessions': {
				const out = await searchSessions({ userId, agentId, query: a.query, limit: a.limit || 5, complete: ctx.complete });
				return { ok: true, query: out.query, count: out.sessions.length, sessions: out.sessions };
			}
			case 'propose_skill_edit': {
				const out = await proposeSkillEdit({ agentId, userId, skillId: a.skill_id, content: a.content, note: a.note });
				return {
					ok: true,
					status: 'edited',
					skill: { id: out.skill.id, name: out.skill.name, version: out.skill.version },
					version_no: out.version?.version_no ?? null,
					note: 'The owner can review and roll this back on the agent skills page.',
				};
			}
			default:
				return { ok: false, error: 'unknown_tool', message: `Unknown learning tool: ${name}` };
		}
	} catch (err) {
		if (err instanceof LearningError) return { ok: false, error: err.code, message: err.message, ...err.extra };
		throw err;
	}
}

function slim(m) {
	return {
		id: m.id,
		kind: m.kind,
		content: m.content,
		confidence: m.confidence,
		use_count: m.use_count,
		created_at: m.created_at,
		...(m.score != null ? { score: m.score } : {}),
	};
}

/** Handler map for the agent loop, bound to one (agent, account). */
export function learningToolHandlers(ctx, names = LEARNING_TOOL_NAMES) {
	return Object.fromEntries(names.map((name) => [name, (args) => runLearningTool(name, args, ctx)]));
}
