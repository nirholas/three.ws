// src/lib/ledger.js backs spending_report (order 521). LEDGER_PATH is read from
// X402_MCP_LEDGER_PATH at module-load time, so this test sets that env var to a
// throwaway temp file BEFORE the first dynamic import of ledger.js, then cleans
// the file up afterward. Pure file I/O, no network, no key.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const dir = await mkdtemp(path.join(tmpdir(), 'x402-mcp-ledger-test-'));
process.env.X402_MCP_LEDGER_PATH = path.join(dir, 'ledger.jsonl');

const { recordSpend, summarize, readEntries, LEDGER_PATH } = await import('../src/lib/ledger.js');
const { def: spendingReportDef } = await import('../src/tools/spending-report.js');

test.after(async () => {
	await rm(dir, { recursive: true, force: true });
});

test('LEDGER_PATH picked up the env override', () => {
	assert.equal(LEDGER_PATH, process.env.X402_MCP_LEDGER_PATH);
});

test('recordSpend appends, readEntries reads back in order', async () => {
	await recordSpend({ tool: 'weather_forecast', url: 'https://three.ws/api/x402/weather-guard-forecast', amountUsd: 0.001, token: 'usdc' });
	await recordSpend({ tool: 'domain_rdap_check', url: 'https://three.ws/api/x402/domains-check', amountUsd: 0.001, token: 'usdc' });
	const entries = await readEntries();
	assert.equal(entries.length, 2);
	assert.equal(entries[0].tool, 'weather_forecast');
	assert.equal(entries[0].merchant, 'three.ws');
	assert.equal(entries[1].tool, 'domain_rdap_check');
});

test('summarize totals by merchant and by day', async () => {
	await recordSpend({ tool: 'book_read', url: 'https://three.ws/api/x402/books-read', amountUsd: 0.01, token: 'usdc' });
	await recordSpend({ tool: 'weather_forecast', url: 'https://other.example/api/x', amountUsd: 0.002, token: 'usdc' });

	const report = await summarize();
	assert.equal(report.totalCalls, 4);
	assert.equal(report.unpricedCalls, 0);
	assert.ok(Math.abs(report.totalUsd - 0.014) < 1e-9, `expected ~0.014, got ${report.totalUsd}`);

	const threeWs = report.byMerchant.find((m) => m.merchant === 'three.ws');
	assert.ok(threeWs, 'three.ws should have an aggregated row');
	assert.equal(threeWs.calls, 3);
	assert.ok(Math.abs(threeWs.totalUsd - 0.012) < 1e-9);

	const other = report.byMerchant.find((m) => m.merchant === 'other.example');
	assert.ok(other, 'other.example should have its own aggregated row');
	assert.equal(other.calls, 1);

	assert.equal(report.byDay.length, 1, 'all four calls happened the same UTC day in this test run');
	assert.equal(report.byDay[0].calls, 4);
});

test('summarize filters by merchant', async () => {
	const report = await summarize({ merchant: 'other.example' });
	assert.equal(report.totalCalls, 1);
	assert.equal(report.byMerchant.length, 1);
	assert.equal(report.byMerchant[0].merchant, 'other.example');
});

test('summarize filters by since, excluding entries before the cutoff', async () => {
	const future = new Date(Date.now() + 60_000).toISOString();
	const report = await summarize({ since: future });
	assert.equal(report.totalCalls, 0);
	assert.equal(report.totalUsd, 0);
});

test('spending_report tool handler returns ok, the ledger path, and the same totals as summarize()', async () => {
	const result = await spendingReportDef.handler({});
	assert.equal(result.ok, true);
	assert.equal(result.ledger_path, LEDGER_PATH);
	assert.equal(result.totalCalls, 4);
});

test('spending_report tool handler respects its merchant filter argument', async () => {
	const result = await spendingReportDef.handler({ merchant: 'other.example' });
	assert.equal(result.ok, true);
	assert.equal(result.totalCalls, 1);
	assert.equal(result.byMerchant[0].merchant, 'other.example');
});

test('readEntries returns an empty array when the ledger file does not exist yet', async () => {
	const unusedPath = path.join(dir, 'never-written.jsonl');
	const original = process.env.X402_MCP_LEDGER_PATH;
	process.env.X402_MCP_LEDGER_PATH = unusedPath;
	try {
		// readEntries reads LEDGER_PATH captured at import time, not the live env
		// var, so this exercises the ENOENT branch directly against that path.
		const fresh = await import(`../src/lib/ledger.js?probe=${Date.now()}`);
		const entries = await fresh.readEntries();
		assert.deepEqual(entries, []);
	} finally {
		process.env.X402_MCP_LEDGER_PATH = original;
	}
});
