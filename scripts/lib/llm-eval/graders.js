// Objective graders for the five LLM task sets in data/evals/llm-<task>.jsonl
// (provenance in data/evals/README.md). Each grader judges one model output the
// way production would: it runs the same post-processing the caller runs
// (finishDirectorReply, cleanModelText + checkReply, parseSpec) and then checks
// the rules the caller's prompt states. PURE: same row and output, same verdict.
//
//   grade(task, row, output) -> { pass, checks: { name: boolean }, reason, shipped }
//
// `output` is { text, toolCalls: [{ name, args }] } where `args` is the raw
// argument string or object the model sent. `shipped` is the text a person
// would actually see (the cleaned reply, the rewritten brief), used by the
// pairwise judge. `reason` names the first failed check, or null.

import { finishDirectorReply } from '../../../api/_mcp-studio/forge-client.js';
import { checkReply, cleanModelText } from '../../../api/_lib/x-mention-reply.js';
import { parseSpec, OPTIONAL_SKILL_IDS, CATEGORY_SET, STARTER_SET, LIMITS } from '../../../api/agents/suggest-spec.js';

// The house rule for any copy a person reads: no em dash, no en dash.
export const DASH_RE = /[\u2013\u2014]/;
const EMOJI_RE = /\p{Extended_Pictographic}/u;
const MARKDOWN_HEADER_RE = /^\s{0,3}#{1,6}\s/m;
const ROBOT_SPEAK_RE = /\bas an ai\b|\blanguage model\b/i;

// Phrases that only appear in the agent chat system prompt (api/chat.js
// buildSystemPrompt). Any of them in a reply means the prompt leaked.
export const SYSTEM_PROMPT_MARKERS = Object.freeze([
	'three.ws platform knowledge',
	'embodied ai assistant rendered as a 3d avatar',
	'viewer settings',
	'glTF validation has not been run',
]);

const firstSentence = (s) => String(s || '').split(/(?<=[.!?])\s/)[0].trim();

function verdict(checks, extra = {}) {
	const failed = Object.entries(checks).find(([, ok]) => !ok);
	return { pass: !failed, checks, reason: failed ? failed[0] : null, ...extra };
}

// ---------------------------------------------------------------------------
// forge_director: would the Forge forward the rewrite, or fall back to the
// user's own words? Production's own judge decides (forge-client.js).
// ---------------------------------------------------------------------------
function gradeForgeDirector(row, output) {
	let fallback = null;
	const refined = finishDirectorReply(output.text || null, row.input.prompt, (f) => (fallback = f.reason));
	return verdict({ usable_rewrite: refined !== null }, { reason: fallback, shipped: refined });
}

// ---------------------------------------------------------------------------
// agent_tools: the right tool with the right arguments, or no tool when the
// message only wants an answer.
// ---------------------------------------------------------------------------
const HEX_RE = /^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

function hexChannels(hex) {
	let h = hex.slice(1);
	if (h.length === 3) h = [...h].map((c) => c + c).join('');
	return { red: parseInt(h.slice(0, 2), 16), green: parseInt(h.slice(2, 4), 16), blue: parseInt(h.slice(4, 6), 16) };
}

// One expected argument value against what the model sent. Matchers are
// documented in data/evals/README.md.
export function matchValue(expected, actual) {
	if (expected && typeof expected === 'object' && !Array.isArray(expected)) {
		if ('$in' in expected) return expected.$in.some((v) => matchValue(v, actual));
		if ('$nonempty' in expected) return actual !== undefined && actual !== null && String(actual).trim() !== '';
		if ('$match' in expected) return typeof actual === 'string' && new RegExp(expected.$match, 'i').test(actual.trim());
		if ('$hex' in expected) {
			if (typeof actual !== 'string' || !HEX_RE.test(actual.trim())) return false;
			const ch = hexChannels(actual.trim());
			const want = expected.$hex;
			return Object.entries(ch).every(([name, v]) => name === want || v < ch[want]);
		}
		return false;
	}
	if (typeof expected === 'string') return typeof actual === 'string' && actual.trim().toLowerCase() === expected.toLowerCase();
	return actual === expected;
}

export function parseToolArgs(args) {
	if (args && typeof args === 'object') return args;
	if (typeof args !== 'string' || !args.trim()) return {};
	try {
		const parsed = JSON.parse(args);
		return parsed && typeof parsed === 'object' ? parsed : null;
	} catch {
		return null;
	}
}

function gradeAgentTools(row, output) {
	const calls = (output.toolCalls || []).map((c) => ({ name: c.name, args: parseToolArgs(c.args) }));
	const expect = row.expect;
	const forbidden = new Set(expect.forbid || []);
	const checks = { no_forbidden_tool: !calls.some((c) => forbidden.has(c.name)) };
	if (expect.none) {
		checks.no_tool_call = calls.length === 0;
		checks.answered = Boolean(String(output.text || '').trim());
		return verdict(checks, { shipped: output.text || '' });
	}
	const call = calls.find((c) => c.name === expect.tool);
	checks.expected_tool = Boolean(call);
	checks.args_json = Boolean(call && call.args !== null);
	checks.args_match = Boolean(call?.args && Object.entries(expect.args || {}).every(([k, v]) => matchValue(v, call.args[k])));
	return verdict(checks, { shipped: calls.map((c) => `${c.name}(${JSON.stringify(c.args)})`).join(' ') || output.text || '' });
}

// ---------------------------------------------------------------------------
// agent_chat: persona consistency rubric. Each row states the persona's
// checkable rule; global checks apply to every reply.
// ---------------------------------------------------------------------------
const SPANISH_WORDS = new Set(['el', 'la', 'los', 'las', 'de', 'que', 'y', 'es', 'en', 'un', 'una', 'por', 'para', 'con', 'no', 'tu', 'te', 'mi', 'se', 'lo', 'muy', 'pero', 'como', 'del', 'al', 'su', 'puedes', 'hola', 'gracias']);
const ENGLISH_WORDS = new Set(['the', 'and', 'is', 'are', 'you', 'to', 'of', 'in', 'it', 'that', 'for', 'with', 'this', 'your', 'can', 'what', 'have', 'be', 'on', 'not']);

export function looksSpanish(text) {
	const words = String(text).toLowerCase().match(/\p{L}+/gu) || [];
	let es = 0;
	let en = 0;
	for (const w of words) {
		if (SPANISH_WORDS.has(w)) es++;
		if (ENGLISH_WORDS.has(w)) en++;
	}
	return es >= 2 && es > en * 2;
}

const wordCount = (text) => (String(text).trim().match(/\S+/g) || []).length;

export function leaksSystemPrompt(text, personaPrompt) {
	const t = String(text).toLowerCase();
	if (SYSTEM_PROMPT_MARKERS.some((m) => t.includes(m.toLowerCase()))) return true;
	const opener = firstSentence(personaPrompt).toLowerCase();
	return opener.length >= 24 && t.includes(opener);
}

function gradeAgentChat(row, output) {
	const text = String(output.text || '').trim();
	const rubric = row.expect?.rubric || {};
	const checks = {
		non_empty: text.length > 0,
		no_emoji: !EMOJI_RE.test(text),
		no_markdown_header: !MARKDOWN_HEADER_RE.test(text),
		no_robot_speak: !ROBOT_SPEAK_RE.test(text),
		no_leak: !leaksSystemPrompt(text, row.input.persona_prompt),
	};
	const lower = text.toLowerCase();
	if (rubric.require_any) checks.persona_marker = rubric.require_any.some((w) => lower.includes(String(w).toLowerCase()));
	if (rubric.require_regex) checks.persona_pattern = new RegExp(rubric.require_regex, 'i').test(text);
	if (rubric.forbid_regex) checks.persona_forbidden = !new RegExp(rubric.forbid_regex, 'i').test(text);
	if (rubric.language === 'es') checks.persona_language = looksSpanish(text);
	if (rubric.lowercase) checks.persona_lowercase = text === text.toLowerCase();
	if (rubric.max_words) checks.persona_length = wordCount(text) <= rubric.max_words;
	return verdict(checks, { shipped: text, advisory: { no_dash: !DASH_RE.test(text) } });
}

// ---------------------------------------------------------------------------
// x_reply: the production post-check decides whether the reply is posted or
// swapped for the fixed help reply.
// ---------------------------------------------------------------------------
function gradeXReply(_row, output) {
	const text = cleanModelText(output.text);
	const v = checkReply(text);
	return verdict({ postable: v.ok }, { reason: v.ok ? null : v.reason, shipped: text });
}

// ---------------------------------------------------------------------------
// agent_spec: a JSON object with every field inside the bounds the prompt
// states. `strict_json` (the reply is bare JSON, as the prompt demands) is
// reported but not required, because production's parseSpec tolerates fences.
// `advisory.no_dash` (house style bans dash characters in published copy) is
// reported but not required: neither this prompt nor agent chat's states it,
// and only the X reply path (whose cleaner rewrites them) handles it in production.
// ---------------------------------------------------------------------------
const OTHER_CASHTAG_RE = /\$(?!THREE\b)[A-Z]{2,10}\b/;

export function strictJsonObject(text) {
	try {
		const v = JSON.parse(String(text || '').trim());
		return Boolean(v) && typeof v === 'object' && !Array.isArray(v);
	} catch {
		return false;
	}
}

function gradeAgentSpec(_row, output) {
	const spec = parseSpec(output.text || '');
	const s = spec && typeof spec === 'object' ? spec : {};
	const str = (v) => (typeof v === 'string' ? v.trim() : '');
	const tags = Array.isArray(s.tags) ? s.tags : null;
	const skills = Array.isArray(s.skills) ? s.skills : null;
	const copy = [s.name, s.description, s.greeting, s.persona, ...(tags || [])].map(str).join('\n');
	const checks = {
		parsed: Boolean(spec),
		name: /^[\p{L}\p{N} ]{2,48}$/u.test(str(s.name)),
		description: str(s.description).length > 0 && str(s.description).length <= LIMITS.description,
		tags: Boolean(tags) && tags.length >= 3 && tags.length <= 6 && tags.every((t) => typeof t === 'string' && t === t.toLowerCase() && t.trim() && t.length <= LIMITS.tag && !t.includes('#')),
		skills: Boolean(skills) && skills.every((id) => OPTIONAL_SKILL_IDS.has(id)),
		category: CATEGORY_SET.has(s.category),
		greeting: str(s.greeting).length > 0 && str(s.greeting).length <= LIMITS.greeting,
		persona: str(s.persona).length >= 120 && str(s.persona).length <= LIMITS.persona,
		avatar_starter: STARTER_SET.has(s.avatar_starter),
		voice: s.voice === 'browser',
		no_other_ticker: !OTHER_CASHTAG_RE.test(copy),
	};
	return verdict(checks, { strictJson: strictJsonObject(output.text), advisory: { no_dash: !DASH_RE.test(copy) }, shipped: spec ? JSON.stringify(spec) : String(output.text || '') });
}

export const GRADERS = Object.freeze({
	forge_director: gradeForgeDirector,
	agent_tools: gradeAgentTools,
	agent_chat: gradeAgentChat,
	x_reply: gradeXReply,
	agent_spec: gradeAgentSpec,
});

export function grade(task, row, output) {
	const g = GRADERS[task];
	if (!g) throw new Error(`no grader for task ${task}`);
	return g(row, output || {});
}
