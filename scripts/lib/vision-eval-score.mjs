// Scoring rules for the vision eval (scripts/nvidia-vision-eval.mjs).
//
// One function per consumer task. Each takes the expectation written in
// data/evals/vision/manifest.json and the model's reply (text plus the parsed
// JSON for JSON tasks) and returns:
//   schemaOk  the reply has the shape the production consumer reads
//   correct   the reply gives the expected answer (false whenever schemaOk is)
//   detail    a short reason, shown in the report for every miss
//
// The rules mirror how each consumer acts on a reply, not a looser reading of
// it: the quality gate passes at the production pass score, the X review bots
// branch on safe first and usable second, and so on. PURE.

export const QUALITY_GATE_PASS_SCORE = 60;
export const SEED_MATCH_MIN = 6;
export const SEED_MISMATCH_MAX = 3;
export const DETECT_MIN_RECALL = 0.6;
export const DIORAMA_MIN_RECALL = 0.5;
export const CAPTION_MAX_WORDS = 20;

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** True when `text` contains `term` starting at a word boundary, case-insensitive. */
export function mentions(text, term) {
	return new RegExp(`(^|[^a-z0-9])${escape(term.toLowerCase())}`, 'i').test(String(text || '').toLowerCase());
}

/** Groups of alternatives that `text` names. Each group is a list of synonyms. */
export function groupsHit(text, groups) {
	return groups.filter((alts) => alts.some((a) => mentions(text, a)));
}

function norm(s) {
	return String(s || '').replace(/\s+/g, ' ').trim().toLowerCase();
}

function verdictOf(json, { needSubject = false } = {}) {
	if (!json || typeof json !== 'object' || typeof json.safe !== 'boolean' || typeof json.usable !== 'boolean') return null;
	if (needSubject && json.subject != null && typeof json.subject !== 'string') return null;
	if (!json.safe) return 'unsafe';
	if (!json.usable) return 'unusable';
	return 'ok';
}

const result = (schemaOk, correct, detail = '') => ({ schemaOk, correct: schemaOk && correct, detail });

// `text` is the reply after the consumer's own cleanAltText (quotes and an
// "Image of" opener stripped, trimmed to 160 characters), i.e. the string that
// is stored. Production keeps a caption over the prompt's 20-word ask, so the
// overrun is reported in the detail but does not make the caption wrong.
function scoreCaption(exp, { text }) {
	const t = String(text || '').trim();
	if (!t) return result(false, false, 'empty reply');
	const words = t.split(/\s+/).length;
	const over = words > CAPTION_MAX_WORDS ? `${words} words` : '';
	const hit = groupsHit(t, exp.mention);
	const ok = hit.length === exp.mention.length;
	return result(true, ok, [ok ? '' : `missing ${missingGroups(exp.mention, hit)}`, over].filter(Boolean).join('; '));
}

function missingGroups(groups, hit) {
	return groups.filter((g) => !hit.includes(g)).map((g) => g[0]).join(', ');
}

function scoreDescribe(exp, { text }) {
	const t = String(text || '').trim();
	if (!t) return result(false, false, 'empty reply');
	const hit = groupsHit(t, exp.mention);
	const missingText = (exp.transcribe || []).filter((s) => !norm(t).includes(norm(s)));
	const ok = hit.length === exp.mention.length && !missingText.length;
	const why = [];
	if (hit.length !== exp.mention.length) why.push(`missing ${missingGroups(exp.mention, hit)}`);
	if (missingText.length) why.push(`did not transcribe ${missingText.map((s) => `"${s}"`).join(', ')}`);
	return result(true, ok, why.join('; '));
}

const PRECHECK_ISSUES = new Set(['none', 'text_screenshot', 'multiple_subjects', 'no_clear_subject', 'too_dark_or_blurry', 'abstract_or_diagram']);

function scorePrecheck(exp, { json }) {
	if (!json || typeof json.usable !== 'boolean') return result(false, false, 'no boolean usable');
	if (json.issue != null && !PRECHECK_ISSUES.has(json.issue)) return result(false, false, `unknown issue "${json.issue}"`);
	if (exp.usable) return result(true, json.usable === true, json.usable ? '' : `rejected as ${json.issue}`);
	if (json.usable) return result(true, false, 'accepted');
	const okIssue = exp.issue.includes(json.issue);
	return result(true, okIssue, okIssue ? '' : `rejected as ${json.issue}, expected ${exp.issue.join(' or ')}`);
}

function scoreReview(needSubject) {
	return (exp, { json }) => {
		const v = verdictOf(json, { needSubject });
		if (!v) return result(false, false, 'no boolean safe and usable');
		return result(true, v === exp.verdict, v === exp.verdict ? '' : `said ${v}`);
	};
}

function scoreQualityGate(exp, { json }) {
	const score = Number(json?.score);
	if (!json || !Number.isFinite(score)) return result(false, false, 'no numeric score');
	const passed = score >= QUALITY_GATE_PASS_SCORE;
	const ok = exp.expect === 'pass' ? passed : !passed;
	return result(true, ok, ok ? '' : `score ${score}`);
}

const SEED_AXES = ['photorealism', 'geometryIntegrity', 'textureFidelity', 'promptAdherence'];

function scoreSeedJudge(exp, { json }) {
	if (!json || SEED_AXES.some((k) => !Number.isFinite(Number(json[k])))) return result(false, false, 'missing a numeric axis');
	const adherence = Number(json.promptAdherence);
	const ok = exp.expect === 'match' ? adherence >= SEED_MATCH_MIN : adherence <= SEED_MISMATCH_MAX;
	return result(true, ok, ok ? '' : `promptAdherence ${adherence}`);
}

function validBox(b) {
	if (!Array.isArray(b) || b.length !== 4 || b.some((n) => !Number.isFinite(Number(n)) || n < 0 || n > 1000)) return false;
	return b[0] < b[2] && b[1] < b[3];
}

function validEdgeBox(b) {
	if (!b || typeof b !== 'object') return false;
	const v = [b.left, b.top, b.right, b.bottom].map(Number);
	if (v.some((n) => !Number.isFinite(n) || n < 0 || n > 1000)) return false;
	return v[0] < v[2] && v[1] < v[3];
}

function recall(labels, groups) {
	const text = labels.join(' | ');
	return groupsHit(text, groups).length / groups.length;
}

function scoreDetect(exp, { json }) {
	const objs = json?.objects;
	if (!Array.isArray(objs) || !objs.length) return result(false, false, 'no objects array');
	if (objs.some((o) => typeof o?.label !== 'string' || !validBox(o.box_2d))) return result(false, false, 'a label or box_2d is malformed');
	const r = recall(objs.map((o) => o.label), exp.labels);
	return result(true, r >= DETECT_MIN_RECALL, `recall ${r.toFixed(2)}`);
}

export function scoreDiorama(exp, { json }, { moods, grounds }) {
	const objs = json?.objects;
	if (!Array.isArray(objs) || !objs.length) return result(false, false, 'no objects array');
	if (!moods.includes(json.mood)) return result(false, false, `mood "${json.mood}" not in schema`);
	if (!grounds.includes(json.ground)) return result(false, false, `ground "${json.ground}" not in schema`);
	if (objs.some((o) => typeof o?.label !== 'string' || !validEdgeBox(o.box))) return result(false, false, 'a label or box is malformed');
	const r = recall(objs.map((o) => `${o.label} ${o.prompt || ''}`), exp.labels);
	return result(true, r >= DIORAMA_MIN_RECALL, `recall ${r.toFixed(2)}`);
}

export const SCORERS = {
	caption: scoreCaption,
	describe: scoreDescribe,
	forge_precheck: scorePrecheck,
	image3d_review: scoreReview(true),
	avatar_review: scoreReview(false),
	quality_gate: scoreQualityGate,
	seed_judge: scoreSeedJudge,
	object_detect: scoreDetect,
	diorama: scoreDiorama,
};

/** Nearest-rank percentile of a list of numbers; null for an empty list. */
export function percentile(values, p) {
	const v = values.filter(Number.isFinite).sort((a, b) => a - b);
	if (!v.length) return null;
	return v[Math.min(v.length - 1, Math.max(0, Math.ceil((p / 100) * v.length) - 1))];
}

/**
 * Aggregate scored rows for one model and one task (or all tasks).
 * Rows: { ok, correct, schemaOk, latencyMs, budgetMs }.
 * Accuracy and schema adherence count every attempt, errors included, so a
 * model cannot score well by failing the hard items.
 */
export function summarize(rows) {
	const n = rows.length;
	const okRows = rows.filter((r) => r.ok);
	const lat = okRows.map((r) => r.latencyMs);
	return {
		n,
		accuracy: n ? rows.filter((r) => r.correct).length / n : null,
		schema: n ? rows.filter((r) => r.schemaOk).length / n : null,
		errorRate: n ? (n - okRows.length) / n : null,
		inBudget: n ? rows.filter((r) => r.correct && r.latencyMs <= r.budgetMs).length / n : null,
		p50: percentile(lat, 50),
		p95: percentile(lat, 95),
	};
}
