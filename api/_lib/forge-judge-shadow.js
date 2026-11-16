// Shadow log for the Forge physical-plausibility judge.
//
// Every model the quality gate judges with both the current vision judge and
// NVIDIA Cosmos Reason gets one forge_judge_shadow row: both verdicts (structured
// fields only, never a reasoning trace), the four judging views stored in R2,
// whether the two disagreed, and which one decided. The eval script writes the
// same rows with a human label attached; /admin/forge-judge reads them back.
//
// Best-effort by design: a failed upload or insert is logged and swallowed, so
// the shadow log can never fail a generation.

import { sql } from './db.js';
import { putObject } from './r2.js';

// The parts of the current judge's verdict worth comparing; the full verdict
// also carries retry hints and render bookkeeping the log does not need.
export function summarizeCurrentVerdict(v, latencyMs = null) {
	if (!v) return null;
	return {
		available: v.qa_available !== false,
		pass: v.pass,
		score: v.score ?? null,
		completeness: v.completeness ?? null,
		realism: v.realism ?? null,
		defects: Array.isArray(v.defects) ? v.defects : [],
		subject_detected: v.subject_detected ?? null,
		provider: v.provider ?? null,
		model: v.model ?? null,
		reason: typeof v.reason === 'string' ? v.reason.slice(0, 300) : null,
		latency_ms: latencyMs,
	};
}

// The Cosmos verdict as stored. Drops nothing the judge returned except the raw
// views, which are stored as R2 objects instead.
export function summarizeCosmosVerdict(c) {
	if (!c) return null;
	if (!c.available) return { available: false, error: c.error || 'unavailable', latency_ms: c.latency_ms ?? null };
	return {
		available: true,
		pass: c.pass,
		plausible: c.plausible,
		issues: c.issues,
		prompt_match: c.prompt_match,
		confidence: c.confidence,
		model: c.model,
		reasoning: Boolean(c.reasoning),
		latency_ms: c.latency_ms ?? null,
		tokens: c.tokens ?? null,
	};
}

// Upload the judging views. Returns the stored keys in view order; a view that
// fails to upload is left out rather than failing the row.
export async function storeJudgeViews(views, prefix) {
	const keys = [];
	for (const v of views || []) {
		if (!v?.png) continue;
		const key = `${prefix}/${v.name || `view-${keys.length}`}.png`;
		try {
			await putObject({ key, body: v.png, contentType: 'image/png' });
			keys.push(key);
		} catch (e) {
			console.warn('[forge-judge-shadow] view upload failed', key, e?.message || e);
		}
	}
	return keys;
}

export function shadowRenderPrefix(source, id) {
	const safe = String(id).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64) || 'anon';
	const day = new Date().toISOString().slice(0, 10);
	return `forge/judge-shadow/${source}/${day}/${safe}`;
}

/**
 * Write one shadow row from the two raw verdicts (a runQualityGate result and a
 * judgeWithCosmos result). Never throws; returns the row id, or null when the
 * insert failed or an eval row for the creation already exists.
 */
export async function recordJudgeShadow({
	source = 'forge',
	creationId = null,
	glbUrl,
	prompt = null,
	subject = null,
	current = null,
	currentLatencyMs = null,
	cosmos = null,
	views = null,
	mode,
	applied = 'current',
	humanLabel = null,
	labelledBy = null,
}) {
	try {
		const cur = summarizeCurrentVerdict(current, currentLatencyMs);
		const cos = summarizeCosmosVerdict(cosmos);
		const currentPass = cur?.available ? Boolean(cur.pass) : null;
		const cosmosPass = cos?.available ? Boolean(cos.pass) : null;
		const disagree = currentPass !== null && cosmosPass !== null && currentPass !== cosmosPass;
		const renderKeys = views?.length
			? await storeJudgeViews(views, shadowRenderPrefix(source, creationId || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`))
			: [];
		const rows = await sql`
			insert into forge_judge_shadow
				(source, creation_id, glb_url, prompt, subject, render_keys, current, cosmos,
				 current_pass, cosmos_pass, disagree, mode, applied, human_label, labelled_by, labelled_at)
			values
				(${source}, ${creationId}, ${glbUrl}, ${prompt ? String(prompt).slice(0, 1000) : null}, ${subject},
				 ${renderKeys}, ${cur ? JSON.stringify(cur) : null}::jsonb, ${cos ? JSON.stringify(cos) : null}::jsonb,
				 ${currentPass}, ${cosmosPass}, ${disagree}, ${mode}, ${applied},
				 ${humanLabel}, ${labelledBy}, ${humanLabel ? new Date().toISOString() : null})
			on conflict do nothing
			returning id`;
		return rows?.[0]?.id ?? null;
	} catch (e) {
		console.warn('[forge-judge-shadow] record failed', e?.message || e);
		return null;
	}
}
