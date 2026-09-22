// Eval task suites: the JSON files under evals/suites/, loaded and validated.
//
// A suite is a fixed set of tasks an agent configuration is scored against.
// Each task names the prompt, the tools the agent may call, the outcome checks
// that score it (api/_lib/evals/checks.js), and optional sandbox tools: tools
// with side effects that the agent can see and call but that only ever return
// the preview declared in the suite, never execute.
//
// The files are read from disk so the CLI, the server and the tests all score
// against the same bytes, and a malformed suite fails its own load with every
// problem named instead of failing a task halfway through a run.

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { AGENT_TOOLS } from '../agent-tools.js';
import { validateCheck } from './checks.js';

export const SUITES_DIR = fileURLToPath(new URL('../../../evals/suites/', import.meta.url));

const SLUG_RE = /^[a-z][a-z0-9-]{1,47}$/;
const TOOL_NAME_RE = /^[a-z][a-z0-9_]{1,63}$/;
const MAX_TASKS = 50;

export class SuiteError extends Error {
	constructor(message, problems = []) {
		super(problems.length ? `${message}:\n  - ${problems.join('\n  - ')}` : message);
		this.name = 'SuiteError';
		this.problems = problems;
	}
}

function validateSandboxTool(tool, at, problems) {
	if (!tool || typeof tool !== 'object') {
		problems.push(`${at}: must be an object`);
		return;
	}
	if (typeof tool.name !== 'string' || !TOOL_NAME_RE.test(tool.name)) problems.push(`${at}: name must be a snake_case tool name`);
	else if (AGENT_TOOLS[tool.name]) problems.push(`${at}: "${tool.name}" is a real registry tool; a sandbox tool must not shadow one`);
	if (typeof tool.description !== 'string' || !tool.description.trim()) problems.push(`${at}: description is required`);
	if (!tool.parameters || tool.parameters.type !== 'object') problems.push(`${at}: parameters must be a JSON schema object`);
	if (!tool.preview || typeof tool.preview !== 'object' || Array.isArray(tool.preview)) {
		problems.push(`${at}: preview must be the object the sandbox returns instead of executing`);
	}
}

/**
 * Validate a parsed suite. Returns the list of problems; empty means valid.
 * @param {any} suite
 * @returns {string[]}
 */
export function validateSuite(suite) {
	const problems = [];
	if (!suite || typeof suite !== 'object' || Array.isArray(suite)) return ['suite must be a JSON object'];
	if (typeof suite.name !== 'string' || !SLUG_RE.test(suite.name)) problems.push('name must be a lowercase slug');
	if (!Number.isInteger(suite.version) || suite.version < 1) problems.push('version must be a positive integer');
	if (typeof suite.description !== 'string' || !suite.description.trim()) problems.push('description is required');
	if (!Array.isArray(suite.tasks) || !suite.tasks.length) problems.push('tasks must be a non-empty array');
	else if (suite.tasks.length > MAX_TASKS) problems.push(`at most ${MAX_TASKS} tasks per suite`);

	const d = suite.defaults || {};
	if (d.temperature !== undefined && !(typeof d.temperature === 'number' && d.temperature >= 0 && d.temperature <= 2)) {
		problems.push('defaults.temperature must be a number from 0 to 2');
	}
	if (d.maxToolRounds !== undefined && !(Number.isInteger(d.maxToolRounds) && d.maxToolRounds >= 0 && d.maxToolRounds <= 8)) {
		problems.push('defaults.maxToolRounds must be an integer from 0 to 8');
	}

	if (suite.gate !== undefined) {
		const g = suite.gate;
		if (typeof g?.agent !== 'string' || !g.agent) problems.push('gate.agent must name a preset');
		if (!Array.isArray(g?.models) || !g.models.length || g.models.some((m) => typeof m !== 'string')) {
			problems.push('gate.models must list at least one model id');
		}
		if (!(typeof g?.minScore === 'number' && g.minScore > 0 && g.minScore <= 1)) problems.push('gate.minScore must be in (0, 1]');
	}

	const ids = new Set();
	for (const [i, task] of (Array.isArray(suite.tasks) ? suite.tasks : []).entries()) {
		const at = `tasks[${i}]${task?.id ? ` (${task.id})` : ''}`;
		if (typeof task?.id !== 'string' || !SLUG_RE.test(task.id)) problems.push(`${at}: id must be a lowercase slug`);
		else if (ids.has(task.id)) problems.push(`${at}: duplicate id`);
		else ids.add(task.id);
		if (typeof task?.title !== 'string' || !task.title.trim()) problems.push(`${at}: title is required`);
		if (typeof task?.prompt !== 'string' || !task.prompt.trim()) problems.push(`${at}: prompt is required`);

		const sandboxNames = new Set();
		if (task?.sandbox !== undefined) {
			if (!Array.isArray(task.sandbox)) problems.push(`${at}: sandbox must be an array of tools`);
			else task.sandbox.forEach((t, j) => {
				validateSandboxTool(t, `${at}.sandbox[${j}]`, problems);
				if (t?.name) sandboxNames.add(t.name);
			});
		}
		if (task?.tools !== undefined) {
			if (!Array.isArray(task.tools)) problems.push(`${at}: tools must be an array of tool names`);
			else for (const name of task.tools) {
				if (!AGENT_TOOLS[name] && !sandboxNames.has(name)) problems.push(`${at}: unknown tool "${name}"`);
			}
		}
		if (!Array.isArray(task?.checks) || !task.checks.length) problems.push(`${at}: checks must be a non-empty array`);
		else task.checks.forEach((c, j) => {
			for (const p of validateCheck(c)) problems.push(`${at}.checks[${j}]: ${p}`);
		});
	}
	return problems;
}

/** The suite names available on disk, sorted. */
export function listSuiteNames(dir = SUITES_DIR) {
	return readdirSync(dir)
		.filter((f) => f.endsWith('.json'))
		.map((f) => f.slice(0, -5))
		.sort();
}

/**
 * Load and validate one suite by name, or by a path to a JSON file.
 * @param {string} nameOrPath
 * @returns {object} the suite
 */
export function loadSuite(nameOrPath, dir = SUITES_DIR) {
	const isPath = nameOrPath.endsWith('.json') || nameOrPath.includes('/');
	if (!isPath && !SLUG_RE.test(nameOrPath)) throw new SuiteError(`"${nameOrPath}" is not a suite name`);
	const file = isPath ? path.resolve(nameOrPath) : path.join(dir, `${nameOrPath}.json`);
	let raw;
	try {
		raw = readFileSync(file, 'utf8');
	} catch (err) {
		if (err?.code === 'ENOENT') {
			throw new SuiteError(`No suite named "${nameOrPath}". Available: ${listSuiteNames(dir).join(', ')}`);
		}
		throw err;
	}
	let suite;
	try {
		suite = JSON.parse(raw);
	} catch (err) {
		throw new SuiteError(`${file} is not valid JSON: ${err.message}`);
	}
	const problems = validateSuite(suite);
	if (problems.length) throw new SuiteError(`${file} is not a valid suite`, problems);
	return suite;
}

/** A public summary of a suite: what the Evaluate tab and GET /evals/suites list. */
export function describeSuite(suite) {
	return {
		name: suite.name,
		version: suite.version,
		title: suite.title || suite.name,
		description: suite.description,
		tasks: suite.tasks.map((t) => ({ id: t.id, title: t.title, checks: t.checks.length, sandboxed: Boolean(t.sandbox?.length) })),
		gate: suite.gate ? { agent: suite.gate.agent, minScore: suite.gate.minScore } : null,
	};
}
