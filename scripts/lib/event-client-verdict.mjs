// Pure judging logic for `npm run audit:event-client` (scripts/audit-event-client.mjs).
//
// The browser harness (scripts/play-mobile-repro.mjs with SUMMARY_JSON set)
// writes one summary per engine. This module turns a summary plus the committed
// limits in scripts/audit-event-client.baseline.json into a verdict. It does no
// I/O, so the rules that decide whether an event client is fit to ship are unit
// tested (tests/audit-event-client-verdict.test.js) instead of only ever being
// exercised on a quiet machine.
//
// Three outcomes, never two:
//   pass        every limit held
//   fail        a real regression in /play (a page error, a dropped room socket,
//               a duplicate asset download, a number past its limit)
//   unmeasured  the run never got a fair reading (navigation timed out, or the
//               host's network interfaces changed and Chromium aborted every
//               in-flight request with ERR_NETWORK_CHANGED). That is the box, not
//               the page, and it must neither pass nor masquerade as a defect.

import { isIgnorableConsole } from './console-noise.mjs';

// Vite's HMR socket is ws://host:port/?token=…, path "/". Its lifecycle is dev
// infrastructure, so it never counts as a player disconnect.
export function isDevSocket(url) {
	try {
		const u = new URL(url);
		return u.pathname === '/' && u.searchParams.has('token');
	} catch {
		return false;
	}
}

// Bytes that crossed the network. A HEAD probe carries a content-length but no
// body, and blob:/data: URLs are textures decoded in memory, so neither counts.
export function countsAsTransfer({ url, method }) {
	if (String(method || 'GET').toUpperCase() === 'HEAD') return false;
	return /^https?:/i.test(String(url));
}

// The same asset URL downloaded more than once by page code: the loader failing
// to reuse what it already has. A HEAD size probe is not a download.
export function duplicateDownloads(loads) {
	const asked = new Map();
	for (const l of loads || []) {
		if (String(l.method || 'GET').toUpperCase() === 'HEAD') continue;
		asked.set(l.url, (asked.get(l.url) || 0) + 1);
	}
	return [...asked].filter(([, c]) => c > 1).map(([url, count]) => ({ url, count }));
}

// Console lines from our code: errors and warnings that survive the shared noise
// filter every browser audit uses.
export function ourConsoleFindings(summary) {
	const pick = (list) => (list || []).filter((t) => !isIgnorableConsole(t));
	return { errors: pick(summary.consoleErrors), warnings: pick(summary.consoleWarnings) };
}

export function disconnects(summary) {
	return (summary.wsCloses || []).filter((c) => !isDevSocket(c.url));
}

function unmeasuredReason(summary) {
	if (!summary.navigation?.ok) return `navigation failed: ${summary.navigation?.error || 'unknown error'}`;
	if ((summary.networkChanged || 0) > 0) {
		return `host network changed ${summary.networkChanged}x during the run (ERR_NETWORK_CHANGED aborts every in-flight request)`;
	}
	if (summary.worldVisibleMs == null && !summary.bootError && !(summary.pageErrors || []).length) {
		return 'the world never became visible inside the run window and nothing failed, which on a loaded box means it never got the CPU';
	}
	return null;
}

const fmt = (n, unit) => `${Math.round(n * 10) / 10}${unit}`;

/**
 * @param {object} summary  one engine's run summary (see play-mobile-repro.mjs)
 * @param {object} limits   that engine's block from the baseline file
 * @returns {{ status: 'pass'|'fail'|'unmeasured', reasons: string[], metrics: object }}
 */
export function judgeRun(summary, limits) {
	const metrics = {
		worldVisibleMs: summary.worldVisibleMs ?? null,
		transferMB: summary.transferMB ?? null,
		peakHeapMB: summary.heap?.peakMB ?? null,
		heapGrowthMB: summary.heap?.growthMB ?? null,
		worstFrameMs: summary.frames?.worstMs ?? null,
		p95FrameMs: summary.frames?.p95Ms ?? null,
		duplicateFetches: (summary.duplicateFetches || []).length,
		disconnects: disconnects(summary).length,
		pageErrors: (summary.pageErrors || []).length,
	};

	// Hard failures are judged before "unmeasured": a page error or a boot error
	// card is a real defect even on a run the network later spoiled.
	const reasons = [];
	if (summary.crashed) reasons.push('the page crashed (renderer killed, the WebKit signature of an iOS memory kill)');
	for (const e of summary.pageErrors || []) reasons.push(`uncaught page error: ${String(e).slice(0, 200)}`);
	if (summary.bootError) reasons.push(`boot watchdog showed its error card: ${summary.bootError.slice(0, 200)}`);
	if (reasons.length) return { status: 'fail', reasons, metrics };

	const why = unmeasuredReason(summary);
	if (why) return { status: 'unmeasured', reasons: [why], metrics };

	for (const c of disconnects(summary)) {
		reasons.push(`room socket closed mid-session at +${fmt((c.atMs || 0) / 1000, 's')}: ${c.url.slice(0, 120)}`);
	}
	for (const d of summary.duplicateFetches || []) {
		reasons.push(`downloaded ${d.count}x by page code (cache it at the loader): ${d.url.slice(0, 140)}`);
	}
	const ours = ourConsoleFindings(summary);
	for (const e of ours.errors) reasons.push(`console.error from our code: ${e.slice(0, 200)}`);
	for (const w of ours.warnings) reasons.push(`console.warn from our code: ${w.slice(0, 200)}`);

	const ceiling = (value, max, label, unit) => {
		if (max == null || value == null) return;
		if (value > max) reasons.push(`${label} ${fmt(value, unit)} is over the limit of ${fmt(max, unit)}`);
	};
	ceiling(metrics.worldVisibleMs, limits.maxWorldVisibleMs, 'time to a visible world', 'ms');
	ceiling(metrics.transferMB, limits.maxTransferMB, 'transferred', ' MB');
	ceiling(metrics.peakHeapMB, limits.maxPeakHeapMB, 'peak JS heap', ' MB');
	ceiling(metrics.heapGrowthMB, limits.maxHeapGrowthMB, 'JS heap growth over the run', ' MB');
	ceiling(metrics.worstFrameMs, limits.maxWorstFrameMs, 'worst frame while walking', 'ms');

	return { status: reasons.length ? 'fail' : 'pass', reasons, metrics };
}

/**
 * Judge one page from scripts/mobile-touch-audit.mjs --json. That script is a
 * reporter (it exits 0 whenever the page loaded), so the gate lives here.
 * @param {object} r one entry of the report's `results`
 */
export function judgeTouch(r) {
	if (!r || r.error) return { status: 'unmeasured', reasons: [`touch audit could not load the page: ${r?.error || 'no result'}`] };
	const reasons = [];
	const name = (x, fallback) => x.sel || x.text || fallback;
	for (const t of r.smallTargets || []) {
		reasons.push(`touch target ${t.w}x${t.h} px is under 44 px: ${name(t, 'element')}${t.text ? ` ("${t.text}")` : ''}`);
	}
	for (const c of (r.canvases || []).filter((c) => c.visible && c.touchAction === 'auto')) {
		reasons.push(`canvas keeps touch-action:auto, so orbit gestures fight page scroll: ${name(c, 'canvas')}`);
	}
	for (const b of (r.bottomBars || []).filter((b) => !b.hasSafeAreaRule)) {
		reasons.push(`bottom-anchored bar has no safe-area-inset rule and sits under the home indicator: ${name(b, 'bar')}`);
	}
	if (r.overflowX > 0) reasons.push(`page scrolls sideways by ${r.overflowX} px at phone width`);
	for (const c of r.clipped || []) reasons.push(`content clipped past the right edge: ${name(c, 'element')}`);
	return { status: reasons.length ? 'fail' : 'pass', reasons };
}

// Overall exit code for the whole audit: any fail is 1, otherwise any step that
// never got a fair reading is 3 (rerun when the box is quiet), otherwise 0.
export function exitCodeFor(statuses) {
	if (statuses.includes('fail')) return 1;
	if (statuses.includes('unmeasured')) return 3;
	return 0;
}
