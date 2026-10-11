// Anatomy service: the operations every transport shares.
//
// api/anatomy.js (the /anatomy page) and the anatomy_* MCP tools both call
// these, so a machine written on the page and one published by an agent are
// the same record with the same permalink.

import { AnatomySpecError, extractSpecJson, normalizeSpec, specStats } from '../../../src/anatomy/spec.js';
import { scanPartialSpec } from '../../../src/anatomy/stream.js';
import { OUTPUT_RULES, SPEC_GUIDE } from './guide.js';
import { streamSpec } from './writer.js';
import { anatomyStoreEnabled, getDesign, newDesignId, saveDesign } from './store.js';

const SITE = process.env.PUBLIC_BASE_URL || 'https://three.ws';
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const MAX_PROMPT_LEN = 600;
export const MAX_SPEC_BYTES = 400_000;
// A spec cut off by the token limit still carries every part that finished.
// Past this many, the salvaged machine is worth showing rather than retrying.
const SALVAGE_MIN_PARTS = 12;

export class AnatomyError extends Error {
	constructor(code, message, status = 400, detail = null) {
		super(message);
		this.code = code;
		this.status = status;
		this.detail = detail;
	}
}

export function designUrl(id) {
	return `${SITE}/anatomy/${id}`;
}

export function publicDesign(design) {
	return { ...design, url: design.id ? designUrl(design.id) : null };
}

export function cleanPrompt(raw) {
	const prompt = String(raw ?? '')
		.replace(/^\s*\/anatomy\s+/i, '')
		.replace(/\s+/g, ' ')
		.trim()
		.slice(0, MAX_PROMPT_LEN);
	if (prompt.length < 3) throw new AnatomyError('prompt_required', 'Describe the machine you want to see.', 400);
	return prompt;
}

export function systemPrompt() {
	return [
		'You are Anatomy, an engineer and illustrator who explains how machines work by building them as interactive 3D cutaways.',
		'Given a request, design the machine as an Anatomy spec: accurate geometry, the real moving parts in motion, the physics made visible with effects and flows, and a guided tour that teaches it step by step.',
		'Write for a curious, smart reader who is not an engineer: plain words, concrete numbers, no filler. Never use the em dash or en dash characters.',
		SPEC_GUIDE,
		OUTPUT_RULES,
	].join('\n\n');
}

function userMessage(prompt) {
	return `Build this machine: ${prompt}\n\nIf the request names a specific real machine, model it on that machine. If it is vague, choose the most iconic real example and say which in the subtitle.`;
}

/**
 * Turn model text into a normalized spec. Tries the whole document first,
 * then salvages every complete element when the text was cut short.
 * Returns { spec, warnings, salvaged } or throws AnatomySpecError.
 */
export function parseSpecText(text) {
	const raw = extractSpecJson(text);
	if (raw) return { ...normalizeSpec(raw), salvaged: false };
	const partial = scanPartialSpec(text);
	if (partial.parts.length >= SALVAGE_MIN_PARTS) {
		const { spec, warnings } = normalizeSpec(partial);
		return { spec, warnings: ['The model ran out of room; the machine shows every part it finished.', ...warnings], salvaged: true };
	}
	throw new AnatomySpecError(partial.parts.length ? `The spec was cut off after ${partial.parts.length} parts.` : 'The model did not return a JSON spec.');
}

function specSize(spec) {
	return Buffer.byteLength(JSON.stringify(spec), 'utf8');
}

async function persist({ spec, prompt, source, model, user }) {
	const design = {
		id: newDesignId(),
		title: spec.title,
		subtitle: spec.subtitle,
		prompt,
		spec,
		stats: specStats(spec),
		source,
		model,
		userId: user?.id ?? null,
	};
	const saved = await saveDesign(design);
	if (saved) return publicDesign(saved);
	// Storage off or a failed write: the visitor still gets their machine, it
	// just has no permalink. The page says so instead of showing a dead link.
	const { userId: _omit, ...rest } = design;
	return publicDesign({ ...rest, id: null, views: 0, creatorUsername: null, createdAt: new Date().toISOString() });
}

/**
 * Write a machine with Claude, streaming it as it is written. Events:
 *   { type: 'stage', stage: 'writing' | 'repairing' | 'saving' }
 *   { type: 'delta', text }      raw model text, to render progressively
 *   { type: 'reset' }            discard the text so far (a rung died mid-way)
 * Returns { design, warnings }.
 */
export async function generateDesign({ prompt, user = null, onEvent = () => {} }) {
	const system = systemPrompt();
	const messages = [{ role: 'user', content: userMessage(prompt) }];
	const track = { userId: user?.id ?? null };

	onEvent({ type: 'stage', stage: 'writing' });
	let written = await streamSpec({
		system,
		messages,
		track,
		onDelta: (text) => onEvent({ type: 'delta', text }),
		onReset: () => onEvent({ type: 'reset' }),
	});

	let parsed;
	try {
		parsed = parseSpecText(written.text);
	} catch (err) {
		// One repair round: show the model exactly what failed and ask for the
		// whole object again. The client discards the first attempt.
		onEvent({ type: 'stage', stage: 'repairing', reason: err.message });
		onEvent({ type: 'reset' });
		const truncated = written.stopReason === 'max_tokens' || written.stopReason === 'length';
		const fix = truncated
			? 'Your answer was cut off before the JSON closed. Write the complete spec again, more compactly: fewer, well-chosen parts (use repeat and parent hierarchies instead of listing copies) and shorter descriptions, so it fits.'
			: `Your answer could not be used: ${err.message} Write the complete spec again as one valid JSON object.`;
		written = await streamSpec({
			system,
			messages: [...messages, { role: 'assistant', content: written.text.slice(0, 60_000) || '{}' }, { role: 'user', content: `${fix}\n\n${OUTPUT_RULES}` }],
			track,
			onDelta: (text) => onEvent({ type: 'delta', text }),
			onReset: () => onEvent({ type: 'reset' }),
		});
		try {
			parsed = parseSpecText(written.text);
		} catch (again) {
			throw new AnatomyError('spec_failed', 'The model could not produce a working machine for that. Try rephrasing it, or name a specific machine.', 502, again.message);
		}
	}

	if (specSize(parsed.spec) > MAX_SPEC_BYTES) throw new AnatomyError('spec_too_large', 'That machine came out too large to save. Try a narrower request.', 422);
	onEvent({ type: 'stage', stage: 'saving' });
	const design = await persist({ spec: parsed.spec, prompt, source: 'generated', model: written.model ? `${written.provider}:${written.model}` : null, user });
	return { design, warnings: parsed.warnings };
}

/**
 * Save a spec an agent wrote itself (the anatomy skill, MCP). No model call.
 * Returns { design, warnings }.
 */
export async function publishDesign({ spec: raw, prompt = null, user = null }) {
	let input = raw;
	if (typeof input === 'string') {
		input = extractSpecJson(input);
		if (!input) throw new AnatomyError('invalid_spec', 'spec must be a JSON object (or a string holding one).', 400);
	}
	let normalized;
	try {
		normalized = normalizeSpec(input);
	} catch (err) {
		throw new AnatomyError('invalid_spec', err.message, 400, err.warnings || null);
	}
	if (specSize(normalized.spec) > MAX_SPEC_BYTES) throw new AnatomyError('spec_too_large', `The spec is over ${MAX_SPEC_BYTES / 1000} KB after normalizing.`, 413);
	if (!anatomyStoreEnabled()) throw new AnatomyError('storage_unavailable', 'Publishing needs the database, which is not configured on this deployment.', 503);
	const cleanedPrompt = prompt ? String(prompt).replace(/\s+/g, ' ').trim().slice(0, MAX_PROMPT_LEN) || null : null;
	const design = await persist({ spec: normalized.spec, prompt: cleanedPrompt, source: 'published', model: null, user });
	if (!design.id) throw new AnatomyError('storage_unavailable', 'The design could not be saved right now. Try again.', 503);
	return { design, warnings: normalized.warnings };
}

export async function loadDesign(id) {
	if (!UUID_RE.test(String(id || ''))) throw new AnatomyError('invalid_id', 'Malformed design id.', 400);
	const design = await getDesign(String(id));
	if (!design) throw new AnatomyError('not_found', 'No machine with that id.', 404);
	return publicDesign(design);
}
