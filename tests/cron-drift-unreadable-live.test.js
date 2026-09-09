// A live drift run whose Cloud Scheduler read fails must NOT exit 0.
//
// `npm run check:cron-drift` is the verification step for "is Cloud Scheduler
// running every cron vercel.json declares?". Until this was fixed, a dead
// gcloud session made it print a note and exit 0, so the command an operator
// runs to prove there is no drift passed while comparing nothing at all. That
// is the same silent failure the check exists to catch: on 2026-09-09 two
// declared crons (/api/cron/globe-ingest, /api/cron/hood-portfolio-snapshot)
// had never fired, and an unauthenticated run of the check reported success.
//
// `--offline` (npm run check:cron-syntax, which `npm run gate` uses) is a
// deliberate expression-only run and must still pass without gcloud.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const execFileP = promisify(execFile);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = path.join(ROOT, 'scripts', 'check-cron-drift.mjs');

let stubDir;

/** Run the check with a `gcloud` that always fails, so the live read cannot succeed. */
async function runWithBrokenGcloud(args) {
	try {
		const { stdout } = await execFileP(process.execPath, [SCRIPT, ...args], {
			cwd: ROOT,
			env: { ...process.env, PATH: `${stubDir}:${process.env.PATH}` },
			maxBuffer: 16 * 1024 * 1024,
		});
		return { code: 0, stdout };
	} catch (err) {
		return { code: err.code ?? 1, stdout: err.stdout ?? '' };
	}
}

beforeAll(() => {
	stubDir = mkdtempSync(path.join(tmpdir(), 'cron-drift-stub-'));
	// Stands in for an expired session: gcloud exists but every call fails.
	writeFileSync(
		path.join(stubDir, 'gcloud'),
		'#!/bin/sh\necho "ERROR: Reauthentication failed." >&2\nexit 1\n',
		{ mode: 0o755 },
	);
});

afterAll(() => {
	if (stubDir) rmSync(stubDir, { recursive: true, force: true });
});

describe('check-cron-drift with an unreadable Cloud Scheduler', () => {
	it('fails the live run instead of passing on a comparison it never made', async () => {
		const { code, stdout } = await runWithBrokenGcloud([]);
		expect(code).toBe(1);
		expect(stdout).toContain('FAILED: could not read Cloud Scheduler');
		expect(stdout).toContain('proves nothing about drift');
	});

	it('reports the failure in --json so a machine reader sees it too', async () => {
		const { code, stdout } = await runWithBrokenGcloud(['--json']);
		expect(code).toBe(1);
		const report = JSON.parse(stdout);
		expect(report.checkedLive).toBe(false);
		expect(report.liveError).toBeTruthy();
	});

	it('still passes --offline, which never asks gcloud anything', async () => {
		const { code, stdout } = await runWithBrokenGcloud(['--offline']);
		expect(code).toBe(0);
		expect(stdout).toContain('All cron expressions are valid');
	});
});
