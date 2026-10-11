// Run receipts: for every generation, a written record of what each stage was
// expected to do, what it actually did, and the verdict, signed so it cannot be
// edited after the fact.
//
// The pipeline already defends itself at every stage: a fail-soft prompt
// director with a fixed full-body brief behind it, a tier that degrades instead
// of failing, lane failover, a deterministic geometry score, a vision QA pass, a
// rig the platform can drive. What it never did was write any of that down for
// the person who asked. A fallback that carried a run was invisible, a quiet
// tier downgrade looked identical to the tier that was requested, and a failure
// was one sentence of copy. A run receipt is that record, stage by stage:
//
//   expected  the plain-language contract for the stage ("a 52-bone humanoid
//             skeleton with torso, arms and legs mapped")
//   observed  what the stage measurably produced, read from the job frame or the
//             delivered file, never from the stage's own say-so
//   verdict   met | recovered | missed | skipped | pending
//   cause     for anything but `met`, the reason in plain words
//
// `issues` then restates every recovered or missed stage as "expected X,
// observed Y, because Z": exactly what went wrong and what was expected.
//
// Pure core: no fetch, no DB, no env. The I/O (rig inspection, persistence,
// signing key) lives in run-receipt-store.js; the wiring lives in the studio
// tool handlers. Signatures are ed25519 over domain-tagged canonical JSON, the
// same construction as inference receipts (inference-settlement.js) and 3D
// provenance credentials (provenance-3d.js), under a tag of its own so no other
// three.ws signature can be replayed as a run receipt.
//
// Docs: docs/run-receipts.md. Tests: tests/run-receipt.test.js.

import { randomBytes } from 'node:crypto';
import { ed25519 } from '@noble/curves/ed25519.js';
import bs58 from 'bs58';

import { sha256Hex } from './provenance-3d.js';

export const RUN_RECEIPT_TYPE = 'three-run-receipt/v1';
const TAG = Buffer.from(`${RUN_RECEIPT_TYPE}\n`, 'utf8');

export const VERDICTS = Object.freeze(['met', 'recovered', 'missed', 'skipped', 'pending']);
export const OUTCOMES = Object.freeze(['delivered', 'delivered_with_issues', 'partial', 'pending', 'refused', 'failed']);

// What each outcome means, in the words the receipt page and the tool text use.
export const OUTCOME_LABELS = Object.freeze({
	delivered: 'Delivered as expected',
	delivered_with_issues: 'Delivered, with issues noted',
	partial: 'Partly delivered',
	pending: 'Still running',
	refused: 'Refused before any work ran',
	failed: 'Not delivered',
});

// A prompt is stored so the receipt can be read on its own, but never a novel.
const MAX_PROMPT_CHARS = 500;
const MAX_TEXT_CHARS = 400;

const ID_RE = /^rr_[1-9A-HJ-NP-Za-km-z]{16,32}$/;

/** A fresh public receipt id. 16 random bytes: unguessable, so the id is the capability. */
export function newReceiptId() {
	return `rr_${bs58.encode(randomBytes(16))}`;
}

export function isReceiptId(id) {
	return typeof id === 'string' && ID_RE.test(id);
}

/**
 * Stable reference to a job handle. Handles are signed tokens that grant a poll;
 * the receipt keeps only their hash, which is enough to find the receipt again
 * when check_job collects the job and useless for anything else.
 */
export function jobRef(jobId) {
	return typeof jobId === 'string' && jobId ? sha256Hex(Buffer.from(jobId, 'utf8')).slice(0, 40) : null;
}

function clip(value, max = MAX_TEXT_CHARS) {
	if (value == null) return null;
	const s = String(value).replace(/\s+/g, ' ').trim();
	return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

function finite(n) {
	const v = Number(n);
	return Number.isFinite(v) ? v : null;
}

// ── the receipt ─────────────────────────────────────────────────────────────

/**
 * Start a receipt for one tool call.
 *
 * @param {{ tool: string, prompt?: string, hasImage?: boolean, id?: string, now?: number }} args
 */
export function startReceipt({ tool, prompt, hasImage = false, id, now = Date.now() }) {
	if (!tool || typeof tool !== 'string') throw new Error('startReceipt: tool is required');
	return {
		type: RUN_RECEIPT_TYPE,
		id: id && isReceiptId(id) ? id : newReceiptId(),
		tool,
		started_at: new Date(now).toISOString(),
		input: {
			prompt: prompt ? clip(prompt, MAX_PROMPT_CHARS) : null,
			reference_image: Boolean(hasImage),
		},
		stages: [],
	};
}

/**
 * Record one stage. Replaces an earlier entry with the same id, so a pending
 * mesh stage completed later by check_job reads as one stage, not two.
 */
export function addStage(receipt, stage) {
	if (!stage || !stage.id) throw new Error('addStage: stage.id is required');
	if (!VERDICTS.includes(stage.verdict)) throw new Error(`addStage: unknown verdict "${stage.verdict}"`);
	const entry = {
		id: stage.id,
		label: stage.label || stage.id,
		expected: clip(stage.expected),
		observed: clip(stage.observed),
		verdict: stage.verdict,
		...(stage.cause ? { cause: clip(stage.cause) } : {}),
		...(stage.metrics && Object.keys(stage.metrics).length ? { metrics: stage.metrics } : {}),
		...(finite(stage.ms) != null ? { ms: Math.max(0, Math.round(stage.ms)) } : {}),
	};
	const at = receipt.stages.findIndex((s) => s.id === entry.id);
	if (at >= 0) receipt.stages[at] = entry;
	else receipt.stages.push(entry);
	return entry;
}

/** Every stage that did not simply meet its contract, restated as one line of fact each. */
export function receiptIssues(receipt) {
	return receipt.stages
		.filter((s) => s.verdict === 'missed' || s.verdict === 'recovered')
		.map((s) => ({
			stage: s.id,
			label: s.label,
			verdict: s.verdict,
			expected: s.expected,
			observed: s.observed,
			...(s.cause ? { cause: s.cause } : {}),
		}));
}

/**
 * Close the receipt. The outcome is derived from the stages unless the caller
 * states it (a refusal, a partial delivery): a derived outcome can never claim
 * more than the stages show.
 */
export function finishReceipt(receipt, { outcome, glbUrl, viewerUrl, now = Date.now() } = {}) {
	const issues = receiptIssues(receipt);
	let derived;
	if (receipt.stages.some((s) => s.verdict === 'pending')) derived = 'pending';
	else if (!glbUrl) derived = 'failed';
	else if (issues.some((i) => i.verdict === 'missed')) derived = 'delivered_with_issues';
	else derived = 'delivered';
	// A caller may state a WORSE outcome than the stages imply (partial, refused),
	// never a better one.
	const rank = { delivered: 0, delivered_with_issues: 1, partial: 2, pending: 2, refused: 3, failed: 3 };
	const final = outcome && OUTCOMES.includes(outcome) && rank[outcome] >= rank[derived] ? outcome : derived;
	const started = Date.parse(receipt.started_at);
	return {
		...receipt,
		finished_at: final === 'pending' ? null : new Date(now).toISOString(),
		duration_ms: final === 'pending' || !Number.isFinite(started) ? null : Math.max(0, now - started),
		outcome: final,
		summary: summarize(final, issues),
		issues,
		output: glbUrl ? { glb_url: glbUrl, ...(viewerUrl ? { viewer_url: viewerUrl } : {}) } : null,
	};
}

function summarize(outcome, issues) {
	const missed = issues.filter((i) => i.verdict === 'missed');
	const recovered = issues.filter((i) => i.verdict === 'recovered');
	const parts = [OUTCOME_LABELS[outcome] || outcome];
	if (missed.length) parts.push(`${missed.length} stage${missed.length === 1 ? '' : 's'} missed (${missed.map((i) => i.label).join(', ')})`);
	if (recovered.length) parts.push(`${recovered.length} carried by a fallback (${recovered.map((i) => i.label).join(', ')})`);
	if (!missed.length && !recovered.length && outcome === 'delivered') parts.push('every stage met its contract');
	return `${parts.join('. ')}.`;
}

// ── stage builders: observed facts in, one stage out ───────────────────────
// Each takes what the pipeline actually reported and nothing else. None of
// them can mark a stage met without the measurement that proves it.

export function inputStage({ allowed, message, hasPrompt, hasImage }) {
	const given = [hasPrompt ? 'a text prompt' : null, hasImage ? 'a reference image' : null].filter(Boolean).join(' and ');
	if (!hasPrompt && !hasImage) {
		return {
			id: 'input',
			label: 'Input',
			expected: 'A text prompt or a reference image to work from.',
			observed: 'Neither was provided.',
			verdict: 'missed',
			cause: 'Nothing to generate from.',
		};
	}
	return {
		id: 'input',
		label: 'Input',
		expected: 'A request that passes the content-safety check.',
		observed: allowed ? `Received ${given}; it passed the safety check.` : `Received ${given}; it was declined by the safety check.`,
		verdict: allowed ? 'met' : 'missed',
		...(allowed ? {} : { cause: message || 'Declined by the content-safety check.' }),
	};
}

export function subjectGateStage({ hasImage, givenMesh, nonHumanoid, override }) {
	const expected = 'A humanoid subject, because auto-rigging builds a two-legged skeleton.';
	if (givenMesh) {
		return {
			id: 'subject',
			label: 'Subject check',
			expected,
			observed: 'The mesh was rigged as given; whether it depicts a humanoid figure was not checked.',
			verdict: 'skipped',
			cause: 'The rig check verifies the skeleton structure, not that the body it is bound to is a character. A non-humanoid mesh still receives a humanoid skeleton.',
		};
	}
	if (hasImage) {
		return { id: 'subject', label: 'Subject check', expected, observed: 'A reference image was supplied, so the subject was taken as given.', verdict: 'skipped' };
	}
	if (nonHumanoid && override) {
		return {
			id: 'subject',
			label: 'Subject check',
			expected,
			observed: 'The prompt reads as an object or animal, and the caller chose to rig it anyway.',
			verdict: 'recovered',
			cause: 'Override requested (allow_non_humanoid), so the rig may not map cleanly.',
		};
	}
	if (nonHumanoid) {
		return {
			id: 'subject',
			label: 'Subject check',
			expected,
			observed: 'The prompt reads as an object or animal, not a character.',
			verdict: 'missed',
			cause: 'Turned away before any GPU time was spent. Use the mesh generator for objects, or set allow_non_humanoid.',
		};
	}
	return { id: 'subject', label: 'Subject check', expected, observed: 'The prompt reads as a character.', verdict: 'met' };
}

/**
 * The prompt rewrite. `kind` is 'avatar' (a full-body brief is required, with a
 * fixed one as the fallback) or 'mesh' (an optional enrichment; the raw prompt
 * is a valid brief on its own).
 */
export function briefStage({ kind, hasImage, directed, knownMark = false, ms }) {
	if (hasImage) {
		return { id: 'brief', label: 'Brief', expected: 'A brief for the reference picture.', observed: 'A reference image was supplied, so it was used directly.', verdict: 'skipped', ms };
	}
	if (knownMark) {
		return {
			id: 'brief',
			label: 'Brief',
			expected: 'A precise brief for a known mark.',
			observed: 'Matched a known mark; its fixed specification was used.',
			verdict: 'met',
			ms,
		};
	}
	if (kind === 'avatar') {
		const expected = 'A director-written brief that frames the whole figure head to toe in a neutral A-pose.';
		return directed
			? { id: 'brief', label: 'Brief', expected, observed: 'The director rewrote the prompt into a full-body brief.', verdict: 'met', ms }
			: {
					id: 'brief',
					label: 'Brief',
					expected,
					observed: 'The fixed full-body brief was appended to the prompt as written.',
					verdict: 'recovered',
					cause: 'The director model did not return a usable brief in time; the fixed brief keeps the framing.',
					ms,
				};
	}
	const expected = 'A director-written brief that turns the idea into a single-subject 3D specification.';
	return directed
		? { id: 'brief', label: 'Brief', expected, observed: 'The director rewrote the prompt into a 3D specification.', verdict: 'met', ms }
		: {
				id: 'brief',
				label: 'Brief',
				expected,
				observed: 'The prompt was used as written.',
				verdict: 'recovered',
				cause: 'The director model did not return a usable brief in time.',
				ms,
			};
}

/**
 * The mesh. `frame` is the terminal poll payload; `labelFor(backendId)` turns
 * an engine id into its public catalog label.
 */
export function meshStage({ frame, expectedTier, error, timedOut, ms, labelFor = (b) => b }) {
	const tierWord = (t) => (t === 'high' ? 'high-detail' : t === 'draft' ? 'draft' : 'standard');
	const expected = `A textured 3D mesh from the ${tierWord(expectedTier)} tier.`;
	if (timedOut) {
		return {
			id: 'mesh',
			label: 'Mesh',
			expected,
			observed: 'Still rendering when the inline wait ended; the job keeps running and can be collected.',
			verdict: 'pending',
			ms,
		};
	}
	if (error || !frame?.glb_url) {
		return {
			id: 'mesh',
			label: 'Mesh',
			expected,
			observed: 'No mesh was produced.',
			verdict: 'missed',
			cause: clip(error) || 'The generator returned no model.',
			ms,
		};
	}
	const engine = frame.backend ? labelFor(frame.backend) : null;
	const tier = frame.tier || null;
	const metrics = {
		...(tier ? { tier } : {}),
		...(engine ? { engine } : {}),
		...(frame.cached ? { cached: true } : {}),
	};
	const on = engine ? ` on ${engine}` : '';
	if (expectedTier && tier && tier !== expectedTier) {
		return {
			id: 'mesh',
			label: 'Mesh',
			expected,
			observed: `A mesh from the ${tierWord(tier)} tier${on}.`,
			verdict: 'recovered',
			cause: `The ${tierWord(expectedTier)} lane did not accept the job, so it ran on the ${tierWord(tier)} tier instead of failing.`,
			metrics,
			ms,
		};
	}
	return {
		id: 'mesh',
		label: 'Mesh',
		expected,
		observed: `A mesh${tier ? ` from the ${tierWord(tier)} tier` : ''}${on}.`,
		verdict: 'met',
		metrics,
		ms,
	};
}

/** The deterministic geometry score (glb-quality.js) the frame already carries. */
export function geometryStage({ quality, retried }) {
	const expected = 'A valid GLB with real, textured geometry (not an empty or degenerate shell).';
	if (!quality || typeof quality !== 'object') {
		return { id: 'geometry', label: 'Geometry check', expected, observed: 'No geometry score was reported for this file.', verdict: 'skipped' };
	}
	const m = quality.metrics || {};
	const metrics = {
		...(finite(m.triangleCount) != null ? { triangles: finite(m.triangleCount) } : {}),
		...(finite(m.vertexCount) != null ? { vertices: finite(m.vertexCount) } : {}),
		...(typeof m.hasTextures === 'boolean' ? { textured: m.hasTextures } : {}),
		...(finite(quality.score) != null ? { score: finite(quality.score) } : {}),
		...(finite(m.sizeBytes) != null ? { bytes: finite(m.sizeBytes) } : {}),
	};
	const facts = [
		metrics.triangles != null ? `${metrics.triangles.toLocaleString('en-US')} triangles` : null,
		metrics.vertices != null ? `${metrics.vertices.toLocaleString('en-US')} vertices` : null,
		metrics.textured === true ? 'textured' : metrics.textured === false ? 'untextured' : null,
		metrics.score != null ? `score ${metrics.score}` : null,
	].filter(Boolean);
	const reasons = Array.isArray(quality.reasons) ? quality.reasons.filter((r) => typeof r === 'string') : [];
	const bad = quality.valid === false || quality.flag === 'invalid' || quality.flag === 'degenerate' || quality.flag === 'low';
	if (bad) {
		return {
			id: 'geometry',
			label: 'Geometry check',
			expected,
			observed: `${facts.join(', ') || 'Scored below the floor'}.`,
			verdict: 'missed',
			cause: reasons.length ? `Flagged: ${reasons.join(', ').replace(/_/g, ' ')}.` : `Flagged ${quality.flag || 'invalid'}.`,
			metrics,
		};
	}
	if (retried) {
		return {
			id: 'geometry',
			label: 'Geometry check',
			expected,
			observed: `${facts.join(', ')}, after one automatic regeneration.`,
			verdict: 'recovered',
			cause: 'The first result scored below the floor, so it was regenerated once automatically.',
			metrics,
		};
	}
	return { id: 'geometry', label: 'Geometry check', expected, observed: `${facts.join(', ') || 'Passed'}.`, verdict: 'met', metrics };
}

/** The vision QA verdict (forge-quality-gate.js) the frame carries on gated tiers. */
export function visualQaStage({ gate }) {
	const expected = 'A render of the model that reads as a complete, clean subject matching the prompt.';
	if (!gate || typeof gate !== 'object') {
		return { id: 'visual', label: 'Visual check', expected, observed: 'This tier does not run the vision check.', verdict: 'skipped' };
	}
	if (gate.qa_available === false) {
		return {
			id: 'visual',
			label: 'Visual check',
			expected,
			observed: 'The vision check could not run, so the model shipped without it.',
			verdict: 'skipped',
			cause: 'The vision model was unavailable. A QA outage never withholds a finished model.',
		};
	}
	const score = finite(gate.score);
	const defects = Array.isArray(gate.defects) ? gate.defects.filter((d) => typeof d === 'string').slice(0, 6) : [];
	const metrics = {
		...(score != null ? { score } : {}),
		...(finite(gate.realism) != null ? { realism: finite(gate.realism) } : {}),
		...(finite(gate.completeness) != null ? { completeness: finite(gate.completeness) } : {}),
		...(defects.length ? { defects } : {}),
	};
	const scored = score != null ? `Scored ${score}` : 'Scored';
	const said = defects.map((d) => d.replace(/_/g, ' ')).join(', ');
	if (gate.pass) {
		return {
			id: 'visual',
			label: 'Visual check',
			expected,
			observed: `${scored} and passed${defects.length ? `; minor notes: ${said}` : ''}.`,
			verdict: 'met',
			metrics,
		};
	}
	return {
		id: 'visual',
		label: 'Visual check',
		expected,
		observed: `${scored} and did not pass${defects.length ? `: ${said}` : ''}.`,
		verdict: 'missed',
		cause: clip(gate.reason) || 'The render did not read as a clean, complete subject.',
		metrics,
	};
}

/**
 * The skeleton, verified from the rigged file itself with the same analysis
 * Rig Doctor runs (src/rig-report.js analyzeGlb), not from the rigger's report.
 * `report` is analyzeGlb's output, or null with `inspectError` when the file
 * could not be read.
 */
export function rigStage({ report, error, inspectError, timedOut, ms }) {
	const expected = 'A skinned humanoid skeleton the animation library can drive: torso, arms and legs mapped.';
	if (timedOut) {
		return { id: 'rig', label: 'Rig', expected, observed: 'Still rigging when the inline wait ended; the job keeps running and can be collected.', verdict: 'pending', ms };
	}
	if (error) {
		return { id: 'rig', label: 'Rig', expected, observed: 'No rigged file was produced.', verdict: 'missed', cause: clip(error), ms };
	}
	if (!report) {
		return {
			id: 'rig',
			label: 'Rig',
			expected,
			observed: 'A rigged file was delivered but could not be read back to verify the skeleton.',
			verdict: 'skipped',
			cause: clip(inspectError) || 'The file could not be read for inspection.',
			ms,
		};
	}
	const sk = report.skeleton || {};
	const groups = Array.isArray(sk.groups) ? sk.groups : [];
	const needed = groups.filter((g) => g.id === 'torso' || g.id === 'arms' || g.id === 'legs');
	const undriven = needed.filter((g) => !g.driven);
	const metrics = {
		skinned: Boolean(sk.skinned),
		joints: finite(sk.jointCount) ?? 0,
		mapped: finite(sk.mapped) ?? 0,
		...(sk.convention?.label ? { convention: sk.convention.label } : {}),
		groups: Object.fromEntries(groups.map((g) => [g.id, g.driven ? 'driven' : `${g.have}/${g.total}`])),
	};
	const conv = sk.convention?.label ? ` (${sk.convention.label})` : '';
	if (!sk.skinned) {
		return { id: 'rig', label: 'Rig', expected, observed: 'The file has no skinned mesh, so no clip can move it.', verdict: 'missed', cause: 'The rigger returned a file without skin weights.', metrics, ms };
	}
	if (undriven.length) {
		return {
			id: 'rig',
			label: 'Rig',
			expected,
			observed: `${metrics.joints} joints${conv}; ${undriven.map((g) => g.label.toLowerCase()).join(' and ')} not mapped.`,
			verdict: 'missed',
			cause: `Missing key bones: ${undriven.flatMap((g) => g.missingKey || []).join(', ') || 'unmapped limb group'}.`,
			metrics,
			ms,
		};
	}
	return {
		id: 'rig',
		label: 'Rig',
		expected,
		observed: `${metrics.joints} joints${conv}, ${metrics.mapped} mapped to the canonical skeleton; torso, arms and legs all driven.`,
		verdict: 'met',
		metrics,
		ms,
	};
}

/** Delivery: the file is on our storage, not a provider link that expires in an hour. */
export function deliveryStage({ frame }) {
	const expected = 'A permanent first-party link to the finished file.';
	if (!frame?.glb_url) return { id: 'delivery', label: 'Delivery', expected, observed: 'Nothing to deliver.', verdict: 'missed', cause: 'No file was produced.' };
	if (frame.durable === false) {
		return {
			id: 'delivery',
			label: 'Delivery',
			expected,
			observed: "The file was served from the engine's own temporary link.",
			verdict: 'recovered',
			cause: 'Copying the file to permanent storage did not complete, so the engine link was handed over instead. It can expire.',
		};
	}
	return { id: 'delivery', label: 'Delivery', expected, observed: 'Stored permanently and served first-party.', verdict: 'met' };
}

// ── canonical bytes, hash, signature ───────────────────────────────────────

// Deterministic JSON: keys sorted recursively so signer and verifier produce
// byte-identical messages. Same algorithm as inference-settlement.js.
function canonicalize(value) {
	if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
	if (value && typeof value === 'object') {
		const keys = Object.keys(value).sort();
		return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalize(value[k])}`).join(',')}}`;
	}
	return JSON.stringify(value === undefined ? null : value);
}

export function canonicalReceiptBytes(receipt) {
	return Buffer.from(canonicalize(receipt), 'utf8');
}

/** sha256 (hex) of the canonical receipt: its content address. */
export function receiptHash(receipt) {
	return sha256Hex(canonicalReceiptBytes(receipt));
}

/**
 * Sign a finished receipt with an ed25519 key (64-byte secret key or 32-byte
 * seed). Returns the envelope { receipt, sha256, signature, signer }.
 */
export function signReceipt(receipt, secretKey) {
	if (!secretKey || secretKey.length < 32) throw new Error('signReceipt: a 32-byte seed or 64-byte secret key is required');
	const seed = secretKey.slice(0, 32);
	const msg = Buffer.concat([TAG, canonicalReceiptBytes(receipt)]);
	return {
		receipt,
		sha256: receiptHash(receipt),
		signature: bs58.encode(ed25519.sign(msg, seed)),
		signer: bs58.encode(ed25519.getPublicKey(seed)),
	};
}

/**
 * Verify an envelope offline. Pure. `trustedSigner` pins the issuer key; without
 * it the check proves only that the receipt is internally consistent and was
 * signed by the key it names.
 *
 * @returns {{ ok: boolean, checks: Array<{ name: string, ok: boolean, detail?: string }> }}
 */
export function verifyReceipt(envelope, { trustedSigner } = {}) {
	const checks = [];
	const check = (name, ok, detail) => {
		checks.push(detail ? { name, ok, detail } : { name, ok });
		return ok;
	};
	const r = envelope?.receipt;
	if (!check('shape', Boolean(r && typeof r === 'object' && r.type === RUN_RECEIPT_TYPE && isReceiptId(r.id) && Array.isArray(r.stages)), 'a three-run-receipt/v1 object')) {
		return { ok: false, checks };
	}
	check('hash', receiptHash(r) === envelope.sha256, 'sha256 of the canonical receipt matches');
	if (!envelope.signature || !envelope.signer) {
		check('signature', false, 'the receipt is unsigned');
		return { ok: false, checks };
	}
	let sigOk = false;
	try {
		sigOk = ed25519.verify(bs58.decode(envelope.signature), Buffer.concat([TAG, canonicalReceiptBytes(r)]), bs58.decode(envelope.signer));
	} catch {
		sigOk = false;
	}
	check('signature', sigOk, 'ed25519 signature over the tagged canonical bytes');
	if (trustedSigner) check('signer', envelope.signer === trustedSigner, 'signed by the pinned three.ws key');
	return { ok: checks.every((c) => c.ok), checks };
}
