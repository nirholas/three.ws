// Studio wiring for run receipts (api/_lib/run-receipt.js): one receipt per
// generating tool call, stating what each stage was expected to do, what it
// actually did, and the verdict, then sealed, stored and linked from the result.
//
// A receipt never changes what a tool returns, only adds to it: a
// `structuredContent.receipt` block and one closing line of text. Every step
// here fails open. If sealing, storing or the rig read-back fails, the model
// still goes out exactly as before, just with a receipt that says so (or, with
// no database, an inline receipt and no link).
//
// Data minimization: the receipt id is a fresh random public handle, the same
// footing as the job handle a pending result already carries. The job handle
// itself is never stored, only its hash (jobRef), which is how check_job finds
// the pending receipt it should complete.

import {
	startReceipt,
	addStage,
	finishReceipt,
	jobRef,
	inputStage,
	subjectGateStage,
	briefStage,
	meshStage,
	geometryStage,
	visualQaStage,
	rigStage,
	deliveryStage,
} from '../_lib/run-receipt.js';
import {
	sealReceipt,
	saveReceipt,
	loadReceiptForJob,
	inspectRiggedGlb,
	engineLabel,
	receiptUrl,
} from '../_lib/run-receipt-store.js';

export { inputStage, subjectGateStage, briefStage, rigStage, deliveryStage, inspectRiggedGlb };

/** A request turned away at the input boundary for a reason other than safety. */
export function inputRejected({ expected, message }) {
	return { id: 'input', label: 'Input', expected, observed: 'The input was rejected before any work ran.', verdict: 'missed', cause: message };
}

/**
 * Open a receipt for one tool call. `plan` is what the caller asked for in
 * pipeline terms (the tier, whether a rig follows), kept on the receipt so a
 * job collected later by check_job is judged against the same contract.
 */
export function openRun(tool, { prompt, hasImage = false, tier = null, rig = false } = {}) {
	const receipt = startReceipt({ tool, prompt, hasImage });
	receipt.plan = { tier, rig: Boolean(rig) };
	return runFor(receipt);
}

function runFor(receipt) {
	return {
		receipt,
		add(stage) {
			try {
				addStage(receipt, stage);
			} catch (err) {
				console.warn('[run-receipt] stage dropped:', err?.message || err);
			}
		},
		/** Mesh, geometry score and vision verdict, all read off one terminal job frame. */
		mesh(frame, { error, timedOut, ms } = {}) {
			this.add(meshStage({ frame, expectedTier: receipt.plan.tier, error, timedOut, ms, labelFor: engineLabel }));
			if (frame?.glb_url && !error && !timedOut) {
				this.add(geometryStage({ quality: frame.quality, retried: frame.quality_retried === true }));
				this.add(visualQaStage({ gate: frame.quality_gate }));
			}
		},
	};
}

function compactIssues(issues) {
	return issues.map((i) => ({
		stage: i.stage,
		label: i.label,
		verdict: i.verdict,
		expected: i.expected,
		observed: i.observed,
		...(i.cause ? { cause: i.cause } : {}),
	}));
}

/** Add the receipt to a tool result without disturbing anything already in it. */
export function attachReceipt(result, receipt, url) {
	if (!result || !receipt) return result;
	const block = {
		id: receipt.id,
		outcome: receipt.outcome,
		summary: receipt.summary,
		issues: compactIssues(receipt.issues || []),
		...(url ? { url } : {}),
	};
	const line = url
		? `Run receipt (what each stage was expected to do and what it did): ${url}`
		: `Run receipt: ${receipt.summary}`;
	const content = Array.isArray(result.content) ? [...result.content] : [];
	const at = content.findIndex((c) => c?.type === 'text');
	if (at >= 0) content[at] = { ...content[at], text: `${content[at].text}\n${line}` };
	else content.push({ type: 'text', text: line });
	return { ...result, content, structuredContent: { ...(result.structuredContent || {}), receipt: block } };
}

/**
 * Finish, seal, store and attach. `jobId` marks a pending run so check_job can
 * complete it; `redactPrompt` drops the prompt from a refusal's record.
 */
export async function closeRun(run, result, { base, outcome, jobId, redactPrompt = false } = {}) {
	try {
		if (redactPrompt) run.receipt.input.prompt = null;
		const sc = result?.structuredContent || {};
		const glbUrl = result?.isError ? null : sc.glbUrl || sc.glb_url || null;
		const finished = finishReceipt(run.receipt, { outcome, glbUrl, viewerUrl: glbUrl ? sc.viewer_url || sc.viewerUrl : undefined });
		const envelope = await sealReceipt(finished);
		const stored = await saveReceipt(envelope, { jobRef: jobRef(jobId) });
		return attachReceipt(result, envelope.receipt, stored ? receiptUrl(base, finished.id) : null);
	} catch (err) {
		console.warn('[run-receipt] not attached:', err?.message || err);
		return result;
	}
}

// The fields finishReceipt adds; stripped before a pending receipt is re-opened.
const FINISH_FIELDS = ['finished_at', 'duration_ms', 'outcome', 'summary', 'issues', 'output'];

/**
 * check_job collected a job some tool call left pending. Find that call's
 * receipt, record what the job actually produced against the same contract,
 * and re-seal it. `data` is the terminal poll payload; `failure` is the copy for
 * a failed job. Resolves to the result with the receipt attached, or the result
 * untouched when the job has no pending receipt.
 */
export async function completeRun(result, { base, jobId, data, failure }) {
	try {
		const ref = jobRef(jobId);
		const envelope = await loadReceiptForJob(ref);
		if (!envelope) return result;
		if (envelope.receipt.outcome !== 'pending') return attachReceipt(result, envelope.receipt, receiptUrl(base, envelope.receipt.id));
		const receipt = { ...envelope.receipt, stages: [...(envelope.receipt.stages || [])] };
		for (const f of FINISH_FIELDS) delete receipt[f];
		receipt.plan = receipt.plan || { tier: null, rig: false };
		const run = runFor(receipt);
		const pendingStage = receipt.stages.find((s) => s.verdict === 'pending');
		const elapsedMs = Number.isFinite(Number(data?.elapsed_seconds)) ? Number(data.elapsed_seconds) * 1000 : undefined;
		let outcome;
		if (failure) {
			const id = pendingStage?.id || 'mesh';
			run.add(id === 'rig' ? rigStage({ error: failure, ms: elapsedMs }) : meshStage({ error: failure, expectedTier: receipt.plan.tier, ms: elapsedMs }));
		} else if (pendingStage?.id === 'rig') {
			const inspected = await inspectRiggedGlb(data.glb_url);
			run.add(rigStage({ report: inspected.report, inspectError: inspected.error, ms: elapsedMs }));
			run.add(deliveryStage({ frame: data }));
		} else {
			run.mesh(data, { ms: elapsedMs });
			if (receipt.plan.rig) {
				run.add({
					id: 'rig',
					label: 'Rig',
					expected: 'A skinned humanoid skeleton the animation library can drive: torso, arms and legs mapped.',
					observed: 'The mesh outlived the inline wait, so rigging moved to a follow-up rig_mesh call (the viewer starts it automatically).',
					verdict: 'skipped',
					cause: 'Not rigged inside this run.',
				});
				outcome = 'partial';
			}
			run.add(deliveryStage({ frame: data }));
		}
		const sc = result?.structuredContent || {};
		const glbUrl = failure ? null : sc.glbUrl || sc.glb_url || data?.glb_url || null;
		const finished = finishReceipt(receipt, { outcome, glbUrl, viewerUrl: glbUrl ? sc.viewer_url || sc.viewerUrl : undefined });
		const sealed = await sealReceipt(finished);
		const stored = await saveReceipt(sealed, { jobRef: ref });
		return attachReceipt(result, sealed.receipt, stored ? receiptUrl(base, finished.id) : null);
	} catch (err) {
		console.warn('[run-receipt] completion not attached:', err?.message || err);
		return result;
	}
}
