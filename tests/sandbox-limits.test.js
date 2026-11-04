// Per-plan sandbox limits (api/_lib/sandbox/limits.js), the workspace quota
// (api/_lib/sandbox/workspace.js), and the enforcement of both on a real child
// process (api/_lib/sandbox/exec-core.js runProcess): an infinite loop dies at
// the wall-clock cap, a program that floods stdout is killed, output is capped
// to the plan's size keeping head and tail, and the kernel rlimits hold.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
	JOB_SIZES,
	PLAN_LIMITS,
	SANDBOX_PRICING,
	limitsFor,
	maxExecutionCost,
	priceExecution,
	truncateOutput,
} from '../api/_lib/sandbox/limits.js';
import { CappedBuffer, programEnv, runProcess, withLimits } from '../api/_lib/sandbox/exec-core.js';
import { WorkspaceQuotaError, assertWorkspaceQuota, workspaceBytes } from '../api/_lib/sandbox/workspace.js';

const hasPython = spawnSync('python3', ['--version'], { stdio: 'ignore' }).status === 0;

describe('limitsFor', () => {
	it.each(Object.keys(PLAN_LIMITS))('gives plan %s its machine size and caps', (plan) => {
		const l = limitsFor(plan);
		const base = PLAN_LIMITS[plan];
		expect(l.plan).toBe(plan);
		expect(l.cpu).toBe(JOB_SIZES[base.size].cpu);
		expect(l.memoryMb).toBe(JOB_SIZES[base.size].memoryMb);
		expect(l.wallSeconds).toBe(base.wallSeconds);
		expect(l.outputBytes).toBe(base.outputBytes);
		expect(l.workspaceBytes).toBe(base.workspaceBytes);
		expect(l.fileBytes).toBe(base.fileBytes);
	});

	it('orders plans so a higher plan never gets less', () => {
		const order = ['free', 'pro', 'team', 'enterprise'].map((p) => limitsFor(p));
		for (let i = 1; i < order.length; i++) {
			for (const k of ['cpu', 'memoryMb', 'wallSeconds', 'outputBytes', 'workspaceBytes', 'executionsPerRun']) {
				expect(order[i][k], `${order[i].plan}.${k}`).toBeGreaterThanOrEqual(order[i - 1][k]);
			}
		}
	});

	it('treats an unknown or missing plan as free', () => {
		for (const p of [null, undefined, '', 'platinum', '__proto__', 'constructor']) {
			const l = limitsFor(p);
			expect(l.plan).toBe('free');
			expect(l.wallSeconds).toBe(PLAN_LIMITS.free.wallSeconds);
		}
	});

	it('lets a request ask for less wall time, never more', () => {
		expect(limitsFor('free', { timeoutSeconds: 10 }).wallSeconds).toBe(10);
		expect(limitsFor('free', { timeoutSeconds: 10_000 }).wallSeconds).toBe(60);
		expect(limitsFor('pro', { timeoutSeconds: 10_000 }).wallSeconds).toBe(300);
		expect(limitsFor('free', { timeoutSeconds: 0.2 }).wallSeconds).toBe(1);
		expect(limitsFor('free', { timeoutSeconds: -5 }).wallSeconds).toBe(60);
		expect(limitsFor('free', { timeoutSeconds: 'abc' }).wallSeconds).toBe(60);
		expect(limitsFor('free', { timeoutSeconds: 10 }).maxWallSeconds).toBe(60);
	});
});

describe('pricing', () => {
	it('charges nothing on a backend the platform does not pay for', () => {
		const l = limitsFor('pro');
		for (const b of ['local', 'docker', 'ssh']) expect(priceExecution({ backend: b, wallMs: 60_000, limits: l })).toBe(0);
	});

	it('meters Cloud Run by vCPU-second and GiB-second with a floor', () => {
		const l = limitsFor('pro');
		expect(priceExecution({ backend: 'cloudrun', wallMs: 1, limits: l })).toBe(SANDBOX_PRICING.minExecutionUsd);
		const tenMin = priceExecution({ backend: 'cloudrun', wallMs: 600_000, limits: l });
		const expected = 600 * l.cpu * SANDBOX_PRICING.vcpuSecondUsd + 600 * (l.memoryMb / 1024) * SANDBOX_PRICING.gibSecondUsd;
		expect(tenMin).toBeCloseTo(expected, 6);
		expect(maxExecutionCost('cloudrun', l)).toBe(priceExecution({ backend: 'cloudrun', wallMs: l.wallSeconds * 1000, limits: l }));
	});
});

describe('output caps', () => {
	it('truncateOutput keeps the head and the tail within the cap', () => {
		const text = `START${'x'.repeat(10_000)}END`;
		const r = truncateOutput(text, 1000);
		expect(r.truncated).toBe(true);
		expect(r.bytes).toBe(text.length);
		expect(r.text.startsWith('START')).toBe(true);
		expect(r.text.endsWith('END')).toBe(true);
		expect(r.text).toMatch(/bytes omitted/);
		expect(truncateOutput('short', 1000)).toEqual({ text: 'short', truncated: false, bytes: 5 });
	});

	it('CappedBuffer never holds more than its cap however the stream is chunked', () => {
		const b = new CappedBuffer(100);
		b.push(Buffer.from('HEAD'));
		for (let i = 0; i < 500; i++) b.push(Buffer.from('0123456789'));
		b.push(Buffer.from('TAIL'));
		const r = b.result();
		expect(r.truncated).toBe(true);
		expect(r.bytes).toBe(5008);
		expect(r.text.startsWith('HEAD')).toBe(true);
		expect(r.text.endsWith('TAIL')).toBe(true);
		const kept = Buffer.byteLength(r.text.replace(/\n\[\.\.\. \d+ bytes omitted \.\.\.\]\n/, ''));
		expect(kept).toBe(100);
	});
});

describe('workspace quota', () => {
	const listing = [
		{ path: 'a.csv', size: 400 },
		{ path: 'b.png', size: 500 },
	];

	it('sums a listing', () => {
		expect(workspaceBytes(listing)).toBe(900);
		expect(workspaceBytes([])).toBe(0);
	});

	it('allows writes that fit, counting a replaced file once', () => {
		const r = assertWorkspaceQuota({ listing, writes: [{ path: 'a.csv', size: 450 }, { path: 'c.txt', size: 50 }], limits: { workspaceBytes: 1000, fileBytes: 1000 } });
		expect(r).toEqual({ usedBytes: 900, afterBytes: 1000, limitBytes: 1000 });
	});

	it('credits deletes before counting writes', () => {
		const r = assertWorkspaceQuota({ listing, writes: [{ path: 'c.bin', size: 550 }], deletes: ['b.png'], limits: { workspaceBytes: 1000, fileBytes: 1000 } });
		expect(r.afterBytes).toBe(950);
	});

	it('refuses writes that would exceed the plan workspace size', () => {
		expect(() =>
			assertWorkspaceQuota({ listing, writes: [{ path: 'c.bin', size: 200 }], limits: { workspaceBytes: 1000, fileBytes: 1000 } }),
		).toThrow(WorkspaceQuotaError);
		try {
			assertWorkspaceQuota({ listing, writes: [{ path: 'c.bin', size: 200 }], limits: { workspaceBytes: 1000, fileBytes: 1000 } });
		} catch (err) {
			expect(err.status).toBe(413);
			expect(err.code).toBe('workspace_full');
			expect(err.detail).toMatchObject({ usedBytes: 900, afterBytes: 1100, limitBytes: 1000 });
		}
	});

	it('refuses a single file larger than the plan file cap', () => {
		expect(() => assertWorkspaceQuota({ listing: [], writes: [{ path: 'big', size: 11 }], limits: { workspaceBytes: 1000, fileBytes: 10 } })).toThrow(
			/larger than/,
		);
	});

	it('uses the real plan numbers', () => {
		const l = limitsFor('free');
		expect(() => assertWorkspaceQuota({ listing: [{ path: 'x', size: l.workspaceBytes }], writes: [{ path: 'y', size: 1 }], limits: l })).toThrow(
			WorkspaceQuotaError,
		);
	});
});

describe('runProcess enforces the caps on a real process', () => {
	let dir;
	beforeAll(async () => {
		dir = await fs.mkdtemp(path.join(os.tmpdir(), 'sbx-limits-'));
	});
	afterAll(async () => {
		await fs.rm(dir, { recursive: true, force: true });
	});
	const env = () => programEnv({ workspace: dir, socketPath: path.join(dir, 'none.sock'), clientsDir: dir, tmpDir: dir, cpu: 1 });

	it('kills an infinite loop at the wall-clock cap', async () => {
		const limits = { ...limitsFor('free', { timeoutSeconds: 1 }) };
		const r = await runProcess({ argv: ['node', '-e', 'for(;;){}'], cwd: dir, env: env(), limits, language: 'javascript' });
		expect(r.timedOut).toBe(true);
		expect(r.exitCode).not.toBe(0);
		expect(r.wallMs).toBeGreaterThanOrEqual(900);
		expect(r.wallMs).toBeLessThan(5000);
	}, 15_000);

	it('kills a program that floods its output and keeps only the cap', async () => {
		const limits = { ...limitsFor('free'), outputBytes: 4096 };
		const r = await runProcess({
			argv: ['node', '-e', 'const s="y".repeat(65536);for(;;)process.stdout.write(s)'],
			cwd: dir,
			env: env(),
			limits,
			language: 'javascript',
		});
		expect(r.outputFlood).toBe(true);
		expect(r.stdout.truncated).toBe(true);
		expect(r.timedOut).toBe(false);
		expect(Buffer.byteLength(r.stdout.text)).toBeLessThan(4096 + 64);
	}, 30_000);

	it('passes the environment through as given and nothing from the host', async () => {
		process.env.SANDBOX_TEST_SECRET = 'host-only';
		try {
			const limits = limitsFor('free', { timeoutSeconds: 10 });
			const r = await runProcess({
				argv: ['node', '-e', 'console.log(JSON.stringify({s:process.env.SANDBOX_TEST_SECRET||null,w:process.env.THREE_WS_WORKSPACE}))'],
				cwd: dir,
				env: env(),
				limits,
				language: 'javascript',
			});
			expect(r.exitCode).toBe(0);
			expect(JSON.parse(r.stdout.text)).toEqual({ s: null, w: dir });
		} finally {
			delete process.env.SANDBOX_TEST_SECRET;
		}
	}, 15_000);

	it('stops the program on abort and reports it as killed', async () => {
		const limits = limitsFor('free', { timeoutSeconds: 30 });
		const ac = new AbortController();
		setTimeout(() => ac.abort(), 300);
		const r = await runProcess({ argv: ['sleep', '20'], cwd: dir, env: env(), limits, signal: ac.signal });
		expect(r.killed).toBe(true);
		expect(r.wallMs).toBeLessThan(5000);
	}, 15_000);

	it('streams output chunks to onOutput as they arrive', async () => {
		const limits = limitsFor('free', { timeoutSeconds: 10 });
		const seen = [];
		const r = await runProcess({
			argv: ['node', '-e', 'console.log("out1");console.error("err1")'],
			cwd: dir,
			env: env(),
			limits,
			language: 'javascript',
			onOutput: (stream, chunk) => seen.push([stream, chunk.toString()]),
		});
		expect(r.exitCode).toBe(0);
		expect(seen).toContainEqual(['stdout', 'out1\n']);
		expect(seen).toContainEqual(['stderr', 'err1\n']);
	}, 15_000);

	it.runIf(hasPython)('caps a python program address space at the plan memory', async () => {
		const limits = limitsFor('free', { timeoutSeconds: 20 });
		const r = await runProcess({
			argv: withLimits(['python3', '-c', `b = bytearray(${(limits.memoryMb * 3) * 1024 * 1024}); print("allocated")`], { limits, language: 'python' }),
			cwd: dir,
			env: env(),
			limits,
			language: 'python',
			hostLimits: false,
		});
		expect(r.exitCode).not.toBe(0);
		expect(r.stdout.text).not.toContain('allocated');
		expect(r.stderr.text).toMatch(/MemoryError/);
	}, 30_000);
});
