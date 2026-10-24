// Persistence and policy around the supply-chain scanner (skill-supply-scan.js).
//
// One place decides what a verdict means for a catalog row, so publish, edit,
// candidate publish, moderation and the catalog rescan cannot drift:
//
//   clean    review_status none, may be public
//   review   review_status pending, forced private until a moderator approves
//   blocked  review_status rejected, forced private, cannot be published
//
// A moderator approval survives a rescan of unchanged content. It does not
// survive an edit: an edited skill is a new version and is scanned again.

import { sql } from './db.js';
import { scanSkillRow, SUPPLY_SCANNER_VERSION } from './skill-supply-scan.js';

/** The review state and visibility a scan result allows. */
export function stateFor(report, { previousStatus = 'none', contentChanged = true } = {}) {
	if (report.verdict === 'blocked') return { review_status: 'rejected', may_be_public: false };
	if (report.verdict === 'review') {
		if (previousStatus === 'approved' && !contentChanged) return { review_status: 'approved', may_be_public: true };
		return { review_status: 'pending', may_be_public: false };
	}
	return { review_status: 'none', may_be_public: true };
}

/** Columns every insert or update of a scanned row writes. */
export function scanColumns(report) {
	return {
		scan_verdict: report.verdict,
		scan_findings: JSON.stringify(report.findings),
		scan_version: report.scanner_version,
	};
}

/** What the API tells an author about their scan. */
export function authorFacing(report, state) {
	return {
		verdict: report.verdict,
		counts: report.counts,
		scanner_version: report.scanner_version,
		held: state ? state.review_status === 'pending' : report.verdict === 'review',
		findings: report.findings,
	};
}

export function rowPartsChanged(prev, next) {
	return (
		(next.content ?? prev.content ?? null) !== (prev.content ?? null) ||
		JSON.stringify(next.schema_json ?? prev.schema_json ?? null) !== JSON.stringify(prev.schema_json ?? null) ||
		JSON.stringify(next.manifest ?? prev.manifest ?? null) !== JSON.stringify(prev.manifest ?? null) ||
		(next.handlers_src ?? prev.handlers_src ?? null) !== (prev.handlers_src ?? null)
	);
}

// ── Moderation ──────────────────────────────────────────────────────────────

export async function reviewQueue({ limit = 50 } = {}) {
	const rows = await sql`
		SELECT ms.id, ms.slug, ms.name, ms.description, ms.category, ms.tags, ms.content, ms.manifest, ms.handlers_src,
		       ms.scan_verdict, ms.scan_findings, ms.scan_version, ms.scanned_at, ms.review_status,
		       ms.author_id, u.display_name AS author_display_name
		  FROM marketplace_skills ms
		  LEFT JOIN users u ON u.id = ms.author_id
		 WHERE ms.review_status = 'pending'
		 ORDER BY ms.scanned_at DESC NULLS LAST
		 LIMIT ${Math.min(Math.max(limit, 1), 200)}
	`;
	return rows;
}

/**
 * A moderator's decision on a held skill. `blocked` skills cannot be approved:
 * the only way out of a block is an edit that scans clean or review.
 */
export async function moderate({ id, moderatorId, decision, note = null }) {
	const [row] = await sql`SELECT id, scan_verdict, review_status FROM marketplace_skills WHERE id = ${id}`;
	if (!row) return { status: 404, code: 'not_found', message: 'skill not found' };
	if (decision === 'approve') {
		if (row.scan_verdict === 'blocked') return { status: 409, code: 'blocked', message: 'a blocked skill cannot be approved; the author must fix the findings' };
		if (row.scan_verdict !== 'review' || row.review_status !== 'pending') return { status: 409, code: 'not_pending', message: 'only a skill held for review can be approved' };
		const [updated] = await sql`
			UPDATE marketplace_skills
			   SET review_status = 'approved', is_public = true, reviewed_by = ${moderatorId}, reviewed_at = now(), review_note = ${note}
			 WHERE id = ${id}
			RETURNING id, slug, name, review_status, is_public, reviewed_at
		`;
		return { status: 200, skill: updated };
	}
	if (row.review_status !== 'pending' && row.review_status !== 'approved') return { status: 409, code: 'not_reviewable', message: 'this skill is not awaiting review' };
	const [updated] = await sql`
		UPDATE marketplace_skills
		   SET review_status = 'rejected', is_public = false, reviewed_by = ${moderatorId}, reviewed_at = now(), review_note = ${note}
		 WHERE id = ${id}
		RETURNING id, slug, name, review_status, is_public, reviewed_at
	`;
	return { status: 200, skill: updated };
}

// ── Catalog rescan ──────────────────────────────────────────────────────────

/**
 * Scan every row in the catalog. With `apply` false nothing is written and the
 * summary says what would change, so the effect on live skills can be read
 * before it happens.
 */
export async function rescanCatalog({ apply = false, onlyStale = false } = {}) {
	const rows = await sql`
		SELECT id, slug, name, description, content, schema_json, manifest, handlers_src, is_public,
		       scan_verdict, scan_version, review_status
		  FROM marketplace_skills
		 ORDER BY created_at
	`;
	const summary = {
		scanner_version: SUPPLY_SCANNER_VERSION,
		applied: apply,
		total: 0,
		skipped_current: 0,
		verdicts: { clean: 0, review: 0, blocked: 0 },
		made_private: 0,
		already_private: 0,
		approvals_kept: 0,
		by_rule: {},
		flagged: [],
	};
	for (const row of rows) {
		if (onlyStale && row.scan_version === SUPPLY_SCANNER_VERSION && row.scan_verdict) {
			summary.skipped_current += 1;
			continue;
		}
		summary.total += 1;
		const report = scanSkillRow(row);
		const state = stateFor(report, { previousStatus: row.review_status, contentChanged: false });
		summary.verdicts[report.verdict] += 1;
		if (state.review_status === 'approved') summary.approvals_kept += 1;
		const hide = row.is_public && !state.may_be_public;
		if (hide) summary.made_private += 1;
		else if (!row.is_public && !state.may_be_public) summary.already_private += 1;
		for (const f of report.findings) if (f.severity !== 'info') summary.by_rule[f.rule] = (summary.by_rule[f.rule] || 0) + 1;
		if (report.verdict !== 'clean') {
			summary.flagged.push({
				slug: row.slug,
				verdict: report.verdict,
				was_public: row.is_public,
				rules: [...new Set(report.findings.filter((f) => f.severity !== 'info').map((f) => `${f.rule}@${f.file}${f.line ? `:${f.line}` : ''}`))].slice(0, 6),
			});
		}
		if (apply) {
			const cols = scanColumns(report);
			await sql`
				UPDATE marketplace_skills
				   SET scan_verdict = ${cols.scan_verdict},
				       scan_findings = ${cols.scan_findings}::jsonb,
				       scan_version = ${cols.scan_version},
				       scanned_at = now(),
				       review_status = ${state.review_status},
				       is_public = is_public AND ${state.may_be_public}
				 WHERE id = ${row.id}
			`;
		}
	}
	return summary;
}
