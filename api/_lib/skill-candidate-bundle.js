// Pure core of the skills-from-experience pipeline (api/_lib/skill-candidates.js
// owns the database and the model call). Everything here is deterministic and
// side-effect free so the three guarantees the feature rests on can be tested
// without a database:
//
//   1. Evidence is verified. assessEvidence() decides whether a finished run
//      counts as a success worth distilling; only a verified signal qualifies.
//   2. Values never leave the run. redactShape()/scrubGoal() reduce a run to
//      argument SHAPES and a goal sentence with every literal removed, so the
//      model that writes the skill never sees a value, and neither does the
//      table. findLeaks()/findPatternLeaks() are the second line: a drafted
//      bundle that still contains a literal from the evidence is rejected.
//   3. The code in a draft is templated, not free-form. The model writes prose
//      (name, description, per-step notes, input descriptions); buildBundle()
//      derives tools.json and handlers.js from the recorded steps, so a draft
//      can only ever call the tools the run actually called.

import { createTwoFilesPatch } from 'diff';

export const SIGNALS = Object.freeze(['multi_tool_turn', 'labor_escrow_passed', 'profitable_trade']);

/** A procedure shorter than this is a single lookup, not a skill. */
export const MIN_STEPS = 3;
export const MIN_DISTINCT_TOOLS = 2;
export const MAX_STEPS = 12;

const TOOL_RE = /^[A-Za-z][A-Za-z0-9_.:-]{0,63}$/;
const ARG_KEY_RE = /^[A-Za-z_][A-Za-z0-9_]{0,39}$/;
const BASE58_RE = /[1-9A-HJ-NP-Za-km-z]{32,44}/g;

// ── Evidence ────────────────────────────────────────────────────────────────

/**
 * Whether a finished run is a verified success worth distilling. Pure.
 *
 * @param {object} o
 * @param {string} o.signal   one of SIGNALS
 * @param {Array<{tool:string, args?:any, error?:string, blocked?:boolean}>} o.calls ordered tool calls
 * @param {string} [o.finalAnswer]   multi_tool_turn: the answer the run ended on
 * @param {{pass?:boolean}} [o.verdict]  labor_escrow_passed: the verifier's verdict
 * @param {number|string|null} [o.pnlLamports] profitable_trade: realized PnL
 * @returns {{ok:true}|{ok:false, reason:string}}
 */
export function assessEvidence({ signal, calls, finalAnswer = '', verdict = null, pnlLamports = null }) {
	if (!SIGNALS.includes(signal)) return { ok: false, reason: 'unknown_signal' };
	const list = Array.isArray(calls) ? calls : [];
	if (list.some((c) => !c || !TOOL_RE.test(String(c.tool || '')))) return { ok: false, reason: 'unusable_tool_name' };
	if (list.some((c) => c.error || c.blocked)) return { ok: false, reason: 'tool_error_in_run' };
	if (list.length < MIN_STEPS) return { ok: false, reason: 'too_few_steps' };
	if (new Set(list.map((c) => c.tool)).size < MIN_DISTINCT_TOOLS) return { ok: false, reason: 'not_enough_distinct_tools' };

	if (signal === 'multi_tool_turn' && !String(finalAnswer || '').trim()) return { ok: false, reason: 'no_answer' };
	if (signal === 'labor_escrow_passed' && verdict?.pass !== true) return { ok: false, reason: 'verdict_not_pass' };
	if (signal === 'profitable_trade') {
		const pnl = Number(pnlLamports);
		if (!Number.isFinite(pnl) || pnl <= 0) return { ok: false, reason: 'trade_not_profitable' };
	}
	return { ok: true };
}

// ── Redaction ───────────────────────────────────────────────────────────────

function safeKey(key) {
	return ARG_KEY_RE.test(key) && !/\d{4,}/.test(key) && !BASE58_RE.test(key) ? key : null;
}

/**
 * Reduce a value to its shape: every leaf becomes its type name. Object keys
 * that look like data (an address used as a map key, an id) become "<key>".
 */
export function redactShape(value, depth = 0) {
	if (value === null || value === undefined) return 'null';
	if (Array.isArray(value)) {
		if (!value.length) return [];
		return depth >= 3 ? 'array' : [redactShape(value[0], depth + 1)];
	}
	switch (typeof value) {
		case 'string':
			return 'string';
		case 'number':
			return Number.isInteger(value) ? 'integer' : 'number';
		case 'boolean':
			return 'boolean';
		case 'object': {
			if (depth >= 3) return 'object';
			const out = {};
			for (const [key, v] of Object.entries(value).slice(0, 24)) {
				const k = safeKey(key) ?? '<key>';
				if (!(k in out)) out[k] = redactShape(v, depth + 1);
			}
			return out;
		}
		default:
			return 'string';
	}
}

/** Every literal inside a value: string leaves, numbers, and data-like keys. */
export function collectLiterals(value, out = new Set(), depth = 0) {
	if (value === null || value === undefined || depth > 6) return out;
	if (Array.isArray(value)) {
		for (const v of value.slice(0, 200)) collectLiterals(v, out, depth + 1);
	} else if (typeof value === 'object') {
		for (const [key, v] of Object.entries(value).slice(0, 200)) {
			if (safeKey(key) === null) out.add(key);
			collectLiterals(v, out, depth + 1);
		}
	} else if (typeof value === 'string') {
		const s = value.trim();
		if (s) out.add(s.slice(0, 400));
	} else if (typeof value === 'number' || typeof value === 'bigint') {
		out.add(String(value));
	}
	return out;
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * The goal sentence with every literal removed: values the run used, URLs,
 * emails, addresses, quoted strings and numbers. What remains is the intent.
 */
export function scrubGoal(goal, literals = []) {
	let s = String(goal || '').replace(/\s+/g, ' ').trim().slice(0, 400);
	const known = [...literals].filter((l) => l.length >= 3).sort((a, b) => b.length - a.length);
	for (const literal of known) {
		s = s.replace(new RegExp(`(?<![A-Za-z0-9])${escapeRe(literal)}(?![A-Za-z0-9])`, 'gi'), '<value>');
	}
	s = s
		.replace(/\bhttps?:\/\/\S+/gi, '<url>')
		.replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '<email>')
		.replace(/\b0x[0-9a-fA-F]{8,}\b/g, '<address>')
		.replace(BASE58_RE, '<address>')
		.replace(/"[^"]{1,200}"/g, '<value>')
		.replace(/(?<![A-Za-z])'[^']{1,100}'(?![A-Za-z])/g, '<value>')
		.replace(/\$?\d[\d,._]*/g, '<number>');
	return s || 'a multi-step task';
}

/** Steps as stored: tool name plus the SHAPE of its arguments. */
export function redactSteps(calls) {
	return (calls || []).slice(0, MAX_STEPS).map((c) => ({
		tool: String(c.tool),
		args: c.args && typeof c.args === 'object' && !Array.isArray(c.args) ? redactShape(c.args) : {},
	}));
}

const stringsOf = (texts) => (Array.isArray(texts) ? texts : [texts]).map((t) => String(t ?? ''));

/**
 * Evidence literals found inside draft text. A literal counts when it is
 * specific enough to be data and not vocabulary: at least 8 characters, or any
 * digit, or any character outside plain letters. A short plain word (an
 * argument value of "price") cannot be told from ordinary prose; the model
 * never receives values at all, which is the structural guarantee for those.
 */
export function findLeaks(texts, literals) {
	const haystack = stringsOf(texts).join('\n').toLowerCase();
	const found = [];
	for (const literal of literals || []) {
		const l = String(literal).trim();
		if (l.length < 3) continue;
		const specific = l.length >= 8 || /[^A-Za-z]/.test(l);
		if (!specific) continue;
		const re = new RegExp(`(?<![A-Za-z0-9])${escapeRe(l.toLowerCase())}(?![A-Za-z0-9])`);
		if (re.test(haystack)) found.push(l.length > 24 ? `${l.slice(0, 24)}...` : l);
	}
	return found;
}

/** Value-shaped strings in draft text, whether or not the run's literals are known. */
export function findPatternLeaks(texts) {
	const haystack = stringsOf(texts).join('\n');
	const found = [];
	if (/\bhttps?:\/\//i.test(haystack)) found.push('a URL');
	if (/[\w.+-]+@[\w-]+\.[\w.-]+/.test(haystack)) found.push('an email address');
	if (/\b0x[0-9a-fA-F]{8,}\b/.test(haystack)) found.push('a hex address');
	if (new RegExp(BASE58_RE.source).test(haystack)) found.push('a base58 address');
	return found;
}

// ── Plan (model-written prose) ──────────────────────────────────────────────

const clean = (s, max) =>
	String(s ?? '')
		.replace(/[\u0000-\u001f\u007f]+/g, ' ')
		.replace(/\s+/g, ' ')
		.trim()
		.slice(0, max);

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** A kebab slug from free text, or null when nothing usable remains. */
export function toSlug(text) {
	const s = String(text ?? '')
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 40)
		.replace(/-+$/g, '');
	return s.length >= 3 && SLUG_RE.test(s) ? s : null;
}

/**
 * Validate and bound the model's plan. Returns null when it is unusable.
 * step_notes always has one entry per step and param_descriptions covers every
 * parameter, so the rendered SKILL.md never has a hole.
 */
export function sanitizePlan(raw, steps) {
	if (!raw || typeof raw !== 'object') return null;
	const name = toSlug(raw.name);
	const description = clean(raw.description, 200);
	if (!name || description.length < 12) return null;
	const notes = Array.isArray(raw.step_notes) ? raw.step_notes : [];
	const paramDescriptions = raw.param_descriptions && typeof raw.param_descriptions === 'object' ? raw.param_descriptions : {};
	return {
		name,
		description,
		when_to_use: clean(raw.when_to_use, 400) || description,
		step_notes: steps.map((s, i) => clean(notes[i], 160) || `Call ${s.tool}.`),
		param_descriptions: Object.fromEntries(
			Object.entries(paramDescriptions)
				.filter(([k]) => ARG_KEY_RE.test(k))
				.map(([k, v]) => [k, clean(v, 160)])
				.filter(([, v]) => v),
		),
		failure_handling:
			clean(raw.failure_handling, 300) || 'If a step fails, stop, report which step failed and why, and do not guess the missing result.',
	};
}

// ── Bundle ──────────────────────────────────────────────────────────────────

function jsonType(shape) {
	if (Array.isArray(shape)) return 'array';
	if (shape && typeof shape === 'object') return 'object';
	if (shape === 'integer' || shape === 'number' || shape === 'boolean') return shape;
	return 'string';
}

function propertySchema(shape) {
	const type = jsonType(shape);
	if (type === 'array') {
		const inner = Array.isArray(shape) && shape.length ? jsonType(shape[0]) : null;
		return { type, items: inner && inner !== 'array' ? { type: inner } : {} };
	}
	return { type };
}

/**
 * One tool parameter per distinct argument key across the recorded steps. The
 * same key used by two steps is one parameter (the value flows through); the
 * same key with a different type becomes `<key>_<step>`.
 */
export function deriveParams(steps) {
	const params = [];
	const byName = new Map();
	const stepMaps = steps.map((step, i) => {
		const map = {};
		for (const [key, shape] of Object.entries(step.args || {})) {
			if (!ARG_KEY_RE.test(key)) continue;
			const type = jsonType(shape);
			let name = key;
			if (byName.has(name) && byName.get(name).type !== type) name = `${key}_${i + 1}`;
			if (!byName.has(name)) {
				const param = { name, type, schema: propertySchema(shape) };
				byName.set(name, param);
				params.push(param);
			}
			map[key] = name;
		}
		return { tool: step.tool, map };
	});
	return { params, stepMaps };
}

const toolFnName = (slug) =>
	'run' + slug.split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join('');

function renderHandlers(fnName, params, stepMaps) {
	return `// Generated from a verified run (api/_lib/skill-candidates.js). It calls only the
// tools that run called, in the same order, and stops at the first failure.
const REQUIRED = ${JSON.stringify(params.map((p) => p.name))};
const STEPS = ${JSON.stringify(stepMaps, null, '\t')};

export async function ${fnName}(args, ctx) {
	const input = args && typeof args === 'object' ? args : {};
	const missing = REQUIRED.filter((name) => input[name] === undefined);
	if (missing.length) return { ok: false, error: \`missing required input: \${missing.join(', ')}\` };

	const results = [];
	for (const [index, step] of STEPS.entries()) {
		const stepArgs = Object.fromEntries(Object.entries(step.map).map(([key, name]) => [key, input[name]]));
		let out;
		try {
			out = await ctx.call(step.tool, stepArgs);
		} catch (err) {
			return { ok: false, error: \`step \${index + 1} (\${step.tool}) failed: \${err?.message || err}\`, data: { completed: results } };
		}
		if (out && out.ok === false) {
			return { ok: false, error: \`step \${index + 1} (\${step.tool}) failed: \${out.error || 'unknown error'}\`, data: { completed: results } };
		}
		results.push({ tool: step.tool, result: out });
	}
	return { ok: true, data: { steps: results } };
}
`;
}

function renderSkillMd(plan, params, steps) {
	const title = plan.name.split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
	const inputs = params.length
		? params.map((p) => `- \`${p.name}\` (${p.type}): ${plan.param_descriptions[p.name] || 'Value to pass to the steps that use it.'}`).join('\n')
		: '- No inputs.';
	const procedure = steps.map((s, i) => `${i + 1}. \`${s.tool}\`: ${plan.step_notes[i]}`).join('\n');
	return `---
name: ${plan.name}
description: ${JSON.stringify(plan.description)}
---

# ${title}

## When to use

${plan.when_to_use}

## Procedure

Call the tool \`${toolFnName(plan.name)}\` once; it runs these steps in order and stops at the first failure.

${procedure}

## Inputs

${inputs}

## When a step fails

${plan.failure_handling}
`;
}

/**
 * Build the four-file bundle for a plan and its recorded steps.
 * @returns {{manifest:object, skillMd:string, tools:object, handlersSrc:string, toolName:string}}
 */
export function buildBundle({ plan, steps, version = '0.1.0' }) {
	const toolName = toolFnName(plan.name);
	const { params, stepMaps } = deriveParams(steps);
	const properties = Object.fromEntries(
		params.map((p) => [p.name, { ...p.schema, description: plan.param_descriptions[p.name] || `Value for ${p.name}.` }]),
	);
	const tools = {
		tools: [
			{
				name: toolName,
				description: plan.description,
				input_schema: { type: 'object', properties, required: params.map((p) => p.name), additionalProperties: false },
			},
		],
	};
	const manifest = {
		spec: 'skill/0.1',
		name: plan.name,
		version,
		description: plan.description,
		tags: ['learned', 'experience'],
		requires: { runtime: '>=0.1.0', tools: [...new Set(steps.map((s) => s.tool))] },
		provides: { tools: [toolName], triggers: [] },
		config: {},
	};
	return { manifest, skillMd: renderSkillMd(plan, params, steps), tools, handlersSrc: renderHandlers(toolName, params, stepMaps), toolName };
}

// ── Revisions ───────────────────────────────────────────────────────────────

const signature = (steps) => steps.map((s) => s.tool).join('>');

function dedupeConsecutive(steps) {
	return steps.filter((s, i) => i === 0 || s.tool !== steps[i - 1].tool);
}

/**
 * How a successful run that used an installed skill differs from the skill's
 * recorded steps. `observed` are the run's tool calls OTHER than the skill
 * itself, already redacted. Returns null when the run did not deviate.
 *   extend: the skill ran fine and the run needed more tools afterwards.
 *   repair: the skill's own call failed and the run succeeded another way.
 */
export function planRevisionSteps({ currentSteps, observed, skillCallOk }) {
	if (!observed?.length) return null;
	if (skillCallOk) {
		const known = new Set(currentSteps.map((s) => s.tool));
		const extra = dedupeConsecutive(observed.filter((s) => !known.has(s.tool)));
		if (!extra.length) return null;
		return { kind: 'extend', steps: [...currentSteps, ...extra].slice(0, MAX_STEPS) };
	}
	if (signature(observed) === signature(currentSteps)) return null;
	return { kind: 'repair', steps: dedupeConsecutive(observed).slice(0, MAX_STEPS) };
}

/** Next patch version of a semver string. */
export function bumpPatch(version) {
	const m = /^(\d+)\.(\d+)\.(\d+)/.exec(String(version || ''));
	return m ? `${m[1]}.${m[2]}.${Number(m[3]) + 1}` : '0.1.1';
}

/** Unified diff of the two files an owner reviews: SKILL.md and handlers.js. */
export function bundleDiff(before, after) {
	const part = (name, a, b) => (a === b ? '' : createTwoFilesPatch(name, name, a || '', b || '', 'current', 'proposed', { context: 2 }));
	return [part('SKILL.md', before.skillMd, after.skillMd), part('handlers.js', before.handlersSrc, after.handlersSrc)]
		.filter(Boolean)
		.join('\n');
}
