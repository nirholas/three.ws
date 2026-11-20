// The five LLM eval tasks, built exactly as production builds them. Each
// builder turns one row of data/evals/llm-<task>.jsonl into the request the
// production call site sends: the same system prompt (imported from the module
// that writes it, never retyped), the same user turn, the same tool set and the
// same token budget. A lane then sends that request to its model.
//
//   buildRequest(task, row) -> { system, user, tools, maxTokens, timeoutMs }
//
// `tools` is the OpenAI-format tool list or null. Agent chat offers the viewer
// tools on every turn in production, so both agent tasks carry them.

import { meshDirectorFor, meshSubjectClass, avatarDirectorFor } from '../../../api/_lib/forge-director-prompts.js';
import { classifySubject } from '../../../api/forge-enhance.js';
import { DIRECTOR_MAX_TOKENS } from '../../../api/_mcp-studio/forge-client.js';
import { buildPublicSystemPrompt, buildPublicUserTurn, MODEL_MAX_TOKENS as X_REPLY_MAX_TOKENS } from '../../../api/_lib/x-mention-reply.js';
import { buildSystem as buildSpecSystem, suggestSpecUserMessage } from '../../../api/agents/suggest-spec.js';
import { buildSystemPrompt, OPENAI_TOOLS } from '../../../api/chat.js';

export const TASKS = Object.freeze(['forge_director', 'agent_tools', 'agent_chat', 'x_reply', 'agent_spec']);

// Where each task runs in production and the usage_events tag it is logged
// under, for the report's method table.
export const TASK_INFO = Object.freeze({
	forge_director: { label: 'Forge prompt director', path: 'api/_mcp-studio/forge-client.js directPrompt', tag: 'forge-director', route: 'LLM_ROUTE_FORGE_DIRECTOR' },
	agent_tools: { label: 'Agent chat: tool selection', path: 'api/chat.js', tag: '<provider>.chat', route: 'LLM_ROUTE_AGENT_CHAT' },
	agent_chat: { label: 'Agent chat: persona replies', path: 'api/chat.js', tag: '<provider>.chat', route: 'LLM_ROUTE_AGENT_CHAT' },
	x_reply: { label: 'Public X replies', path: 'api/_lib/x-mention-reply.js composePublicReply', tag: 'x_public_reply', route: 'LLM_ROUTE_X_REPLY' },
	agent_spec: { label: 'Agent spec from a brief', path: 'api/agents/suggest-spec.js', tag: 'agent_suggest_spec', route: 'LLM_ROUTE_AGENT_SPEC' },
});

// api/chat.js: DEFAULT_MAX_TOKENS for a turn that names no budget.
const CHAT_MAX_TOKENS = 1024;
// The company account the mention bot answers as (x-mention-poll.js passes the
// account handle; the persona comes from x-mention-reply.js itself).
const X_COMPANY = Object.freeze({ handle: 'trythreews' });

function forgeDirector(row) {
	const { prompt, director } = row.input;
	const system = director === 'avatar'
		? avatarDirectorFor(classifySubject(prompt) === 'animal' ? 'animal' : 'person')
		: meshDirectorFor(meshSubjectClass(prompt));
	return { system, user: `Idea: ${prompt}`, tools: null, maxTokens: DIRECTOR_MAX_TOKENS, timeoutMs: 20_000 };
}

// An anonymous visitor's first turn with nothing loaded in the viewer: the
// production default context (body.context is empty on a fresh page).
function agentTurn(personaPrompt, message) {
	return { system: buildSystemPrompt({}, personaPrompt).text, user: message, tools: OPENAI_TOOLS, maxTokens: CHAT_MAX_TOKENS, timeoutMs: 30_000 };
}

const BUILDERS = {
	forge_director: forgeDirector,
	agent_tools: (row) => agentTurn(null, row.input.message),
	agent_chat: (row) => agentTurn(row.input.persona_prompt, row.input.message),
	x_reply: (row) => ({
		system: buildPublicSystemPrompt({ company: X_COMPANY }),
		user: buildPublicUserTurn({ mention: { text: row.input.post, username: null } }),
		tools: null,
		maxTokens: X_REPLY_MAX_TOKENS,
		timeoutMs: 20_000,
	}),
	agent_spec: (row) => ({ system: buildSpecSystem(), user: suggestSpecUserMessage(row.input.brief), tools: null, maxTokens: 700, timeoutMs: 30_000 }),
};

export function buildRequest(task, row) {
	const b = BUILDERS[task];
	if (!b) throw new Error(`unknown task ${task}`);
	return b(row);
}

/** The input as the judge sees it: the user's own words, never the system prompt. */
export function judgeInput(task, row) {
	const i = row.input;
	if (task === 'forge_director') return i.prompt;
	if (task === 'agent_tools') return i.message;
	if (task === 'agent_chat') return `Persona: ${i.persona_prompt}\nMessage: ${i.message}`;
	if (task === 'x_reply') return i.post;
	return i.brief || '(no brief: invent an agent)';
}
