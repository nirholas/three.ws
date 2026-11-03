#!/usr/bin/env node
// scripts/x402-ring-coverage-sweep.js
//
// Proves that EVERY paid x402 endpoint in api/_lib/x402/ring-catalog.js actually
// settles when paid — not just that it 402s. For each catalog entry it:
//   1. probes the endpoint (no payment) and records the 402 challenge + that a
//      Solana USDC accept is advertised at the expected price;
//   2. pays it once via payX402 (real 402 → signed Solana USDC transfer → replay
//      with X-PAYMENT), recording the facilitator settle signature;
//   3. confirms the 200 business response carries a real (non-error) payload;
//   4. for the load-bearing tips/commerce endpoints, asserts the real business
//      effect landed (tip row written, cover charged, billboard placed, sale
//      recorded) — not just the payment log.
//
// It then writes data/reports/x402-ring/COVERAGE.md (the human table) and
// data/reports/x402-ring/coverage-report.json (the machine record).
//
// Real payments only — no mocks. Requires an env-complete, funded context:
//   X402_SEED_SOLANA_SECRET_BASE58 (or X402_AGENT_…) funded with USDC + SOL,
//   X402_SELF_FACILITATOR_ENABLED=true, the ring env from tasks 02–03, and (for
//   the business-effect assertions) DATABASE_URL / Redis. Without a payer it
//   exits cleanly with a "no payer configured" report rather than faking data.
//
// Usage:
//   node scripts/x402-ring-coverage-sweep.js                 # autobuy set only
//   node scripts/x402-ring-coverage-sweep.js --manual        # + autobuy:false
//   node scripts/x402-ring-coverage-sweep.js --only=dance-tip,club-cover
//   node scripts/x402-ring-coverage-sweep.js --max-usd=0.50  # total spend cap
//   node scripts/x402-ring-coverage-sweep.js --origin=http://localhost:3000
//
// The autobuy sweep at default prices costs ≈ $0.30. --manual entries mint real
// artifacts (pump-launch deploys a coin; cosmetic-purchase can pay a creator) —
// only run --manual on devnet or with explicit owner sign-off.

import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { RING_CATALOG } from '../api/_lib/x402/ring-catalog.js';
import { payX402, bootstrapSolanaContext, fetchWithTimeout, parseSolanaAccept } from '../api/_lib/x402/pay.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(HERE, '..', 'data', 'reports', 'x402-ring');

// ── args ──────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const opt = (name, dflt) => {
	const hit = argv.find((a) => a.startsWith(`--${name}=`));
	return hit ? hit.slice(name.length + 3) : dflt;
};
const INCLUDE_MANUAL = flag('manual');
const ONLY = (opt('only', '') || '').split(',').map((s) => s.trim()).filter(Boolean);
const MAX_USD = Number(opt('max-usd', INCLUDE_MANUAL ? '2' : '0.5'));
const ORIGIN = (opt('origin', process.env.APP_ORIGIN || 'https://three.ws')).replace(/\/$/, '');

// ── business-effect verifiers ───────────────────────────────────────────────
// Each returns { checked:boolean, ok:boolean, note:string }. They run a cheap
// before/after probe around the paid call so the sweep proves the real effect
// landed, not just the payment. Missing DB/Redis → { checked:false }.
async function loadSql() {
	try {
		const { sql } = await import('../api/_lib/db.js');
		// A trivial probe confirms the connection is live.
		await sql`SELECT 1`;
		return sql;
	} catch { return null; }
}
async function loadRedis() {
	try {
		const { getRedis } = await import('../api/_lib/redis.js');
		const r = getRedis();
		if (r) await r.ping();
		return r;
	} catch { return null; }
}

const EFFECT = {
	async 'dance-tip'({ sql }) {
		if (!sql) return { checked: false };
		const before = Number((await sql`SELECT count(*)::int AS n FROM club_tips`)[0]?.n || 0);
		return {
			async after() {
				const now = Number((await sql`SELECT count(*)::int AS n FROM club_tips`)[0]?.n || 0);
				return { checked: true, ok: now > before, note: `club_tips ${before}→${now} (tip recorded)` };
			},
		};
	},
	async 'club-cover'({ sql }) {
		if (!sql) return { checked: false };
		const q = () => sql`
			SELECT count(*)::int AS n FROM x402_audit_log
			WHERE route = '/api/x402/club-cover' AND settlement_status = 'success'`;
		const before = Number((await q())[0]?.n || 0);
		return {
			async after() {
				const now = Number((await q())[0]?.n || 0);
				return { checked: true, ok: now > before, note: `settled cover charges ${before}→${now}` };
			},
		};
	},
	async billboard({ redis }) {
		if (!redis) return { checked: false };
		const { RING_CANARY_MINT } = await import('../api/_lib/x402/ring-catalog.js');
		return {
			async after() {
				const placement = await redis.get(`billboard:${RING_CANARY_MINT}`);
				return { checked: true, ok: !!placement, note: placement ? 'billboard placement written to Redis' : 'no placement key found' };
			},
		};
	},
	async 'cosmetic-purchase'({ sql }) {
		if (!sql) return { checked: false };
		const before = Number((await sql`SELECT count(*)::int AS n FROM cosmetic_sales`.catch(() => [{ n: 0 }]))[0]?.n || 0);
		return {
			async after() {
				const now = Number((await sql`SELECT count(*)::int AS n FROM cosmetic_sales`.catch(() => [{ n: before }]))[0]?.n || 0);
				return { checked: true, ok: now > before, note: `cosmetic_sales ${before}→${now} (sale recorded)` };
			},
		};
	},
};

// ── sweep ─────────────────────────────────────────────────────────────────────
async function main() {
	let entries = RING_CATALOG.filter((e) => (INCLUDE_MANUAL ? true : e.autobuy));
	if (ONLY.length) entries = entries.filter((e) => ONLY.includes(e.slug));

	let ctx;
	try {
		ctx = await bootstrapSolanaContext();
	} catch (err) {
		const report = { generatedAt: new Date().toISOString(), origin: ORIGIN, error: `no_payer: ${err.message}`, rows: [] };
		writeReport(report);
		console.error(`[sweep] no payer configured — wrote a stub report. ${err.message}`);
		process.exit(1);
	}

	const sql = await loadSql();
	const redis = await loadRedis();
	const rows = [];
	let spentAtomic = 0;

	for (const e of entries) {
		const qs = e.query ? `?${new URLSearchParams(e.query).toString()}` : '';
		const url = `${ORIGIN}${e.path}${qs}`;
		const body = e.method === 'POST' ? e.body() : null;
		const capRemaining = Math.max(0, Math.round(MAX_USD * 1e6) - spentAtomic);

		// 1. Probe the 402 challenge (no payment).
		let challenge402 = false;
		let advertisedAtomic = null;
		let solanaAccept = false;
		try {
			const probe = await fetchWithTimeout(url, {
				method: e.method,
				headers: { 'content-type': 'application/json' },
				...(body != null ? { body: JSON.stringify(body) } : {}),
			});
			challenge402 = probe.status === 402;
			if (challenge402) {
				const acc = parseSolanaAccept(probe.body);
				solanaAccept = !!acc;
				advertisedAtomic = acc ? Number(acc.amount) : null;
			}
		} catch { /* recorded as challenge402=false below */ }

		// 2. Prep the business-effect before-probe.
		let effect = { checked: false };
		try {
			const mk = EFFECT[e.slug];
			if (mk) effect = await mk({ sql, redis });
		} catch { /* effect stays unchecked */ }

		// 3. Pay it (unless it would exceed the spend cap).
		let result;
		if (advertisedAtomic != null && advertisedAtomic > capRemaining) {
			result = { success: false, paid: false, skipped: true, amountAtomic: advertisedAtomic, txSig: null, status: 402, responseBody: null, errorMsg: 'spend_cap_reached' };
		} else {
			try {
				result = await payX402({ url, method: e.method, body, ...ctx, remainingCap: capRemaining });
			} catch (err) {
				result = { success: false, paid: false, amountAtomic: 0, txSig: null, status: 0, responseBody: null, errorMsg: err.message };
			}
		}
		if (result.paid) spentAtomic += result.amountAtomic || 0;

		// 4. Business-effect after-probe.
		let effectResult = { checked: false, ok: null, note: '' };
		if (effect.after && result.paid) {
			try { effectResult = await effect.after(); } catch (err) { effectResult = { checked: true, ok: false, note: `effect check failed: ${err.message}` }; }
		}

		const liveness = summarize(result.responseBody);
		rows.push({
			slug: e.slug,
			path: e.path,
			method: e.method,
			autobuy: e.autobuy,
			priceAtomic: advertisedAtomic ?? e.priceAtomicDefault,
			challenge402,
			solanaAccept,
			settleSignature: result.txSig || null,
			responseOk: result.success && liveness.ok,
			status: result.status,
			error: result.errorMsg || null,
			effect: effectResult,
			businessEffect: e.businessEffect,
			note: e.note || '',
		});
		const mark = result.paid ? '✓' : (result.skipped ? '·' : '✗');
		console.log(`${mark} ${e.slug.padEnd(28)} settle=${result.txSig ? result.txSig.slice(0, 12) + '…' : '—'} ${result.errorMsg || ''}`);
	}

	const report = { generatedAt: new Date().toISOString(), origin: ORIGIN, includeManual: INCLUDE_MANUAL, spentUsd: (spentAtomic / 1e6).toFixed(4), rows };
	writeReport(report);
	const settled = rows.filter((r) => r.settleSignature).length;
	console.log(`\n[sweep] ${settled}/${rows.length} settled, spent $${report.spentUsd}. Wrote COVERAGE.md + coverage-report.json`);
}

function summarize(body) {
	if (body == null) return { ok: false };
	if (typeof body === 'string') return { ok: body.length > 0 };
	if (Array.isArray(body)) return { ok: body.length > 0 };
	if (typeof body === 'object') return { ok: Object.keys(body).length > 0 && !body.error };
	return { ok: true };
}

function writeReport(report) {
	mkdirSync(OUT_DIR, { recursive: true });
	writeFileSync(join(OUT_DIR, 'coverage-report.json'), JSON.stringify(report, null, '\t') + '\n');
	writeFileSync(join(OUT_DIR, 'COVERAGE.md'), renderMarkdown(report));
}

function renderMarkdown(report) {
	const usd = (a) => (a == null ? '—' : `$${(a / 1e6).toFixed(a >= 1e6 ? 2 : 3)}`);
	const yn = (b) => (b === true ? '✅' : b === false ? '❌' : '—');
	const lines = [];
	lines.push('# x402 Ring — Endpoint Coverage');
	lines.push('');
	lines.push(`Generated ${report.generatedAt} against \`${report.origin}\`` + (report.includeManual ? ' (including --manual autobuy:false entries)' : '') + '.');
	lines.push('');
	if (report.error) {
		lines.push(`> **No live sweep run:** \`${report.error}\`. Run this script from an env-complete, funded context (see the header of \`scripts/x402-ring-coverage-sweep.js\`).`);
		lines.push('');
	} else {
		lines.push(`Total verification spend: **$${report.spentUsd}**. A ✓ settle signature is a real on-chain USDC payment settled by the self-hosted facilitator.`);
		lines.push('');
	}
	lines.push('| Slug | Price | 402 | Sol accept | Settle signature | Response OK | Business effect verified |');
	lines.push('|------|------:|:---:|:----------:|------------------|:-----------:|--------------------------|');
	for (const r of report.rows || []) {
		const effect = r.effect?.checked ? `${yn(r.effect.ok)} ${r.effect.note}` : (r.autobuy ? '—' : '(manual)');
		const sig = r.settleSignature ? `\`${r.settleSignature}\`` : (r.error ? `❌ ${r.error}` : '—');
		lines.push(`| \`${r.slug}\` | ${usd(r.priceAtomic)} | ${yn(r.challenge402)} | ${yn(r.solanaAccept)} | ${sig} | ${yn(r.responseOk)} | ${effect} |`);
	}
	lines.push('');
	lines.push('## autobuy:false — justifications');
	lines.push('');
	for (const r of (report.rows || []).filter((x) => !x.autobuy)) {
		lines.push(`- **\`${r.slug}\`** — ${r.note || r.businessEffect}`);
	}
	lines.push('');
	return lines.join('\n');
}

main().catch((err) => {
	console.error('[sweep] fatal', err);
	process.exit(1);
});
