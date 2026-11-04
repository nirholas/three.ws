// One sandboxed execution, end to end. Every caller (the agent loop's
// execute_code and terminal tools, the v1 run stepper, the MCP agent server)
// goes through executeInSandbox, so the plan limits, the kill switch, the
// anomaly guard, the workspace quota, metering and the record of what ran are
// enforced in exactly one place.
//
//   1. limits from the account's plan; the backend the run is pinned to, else
//      the account default, else the first one available
//   2. refuse when the run is killed, and kill it first when it looks like a
//      runaway: a long failure streak, a burst of executions, or repeated
//      refused bridge calls
//   3. refuse up front when the credit balance cannot cover the most this
//      execution can cost (a platform-paid backend only)
//   4. write any input files into the workspace, under the quota
//   5. run, streaming output, polling for the owner's kill switch
//   6. save what the program changed back to the workspace, under the quota
//   7. record the outcome, meter it, and fold it into the run totals

import { debitCredits, getCreditAccount } from '../credits.js';
import { chooseBackend } from './backends.js';
import { bridgeContext, handleBridge, signBridgeToken } from './bridge.js';
import { sandboxConfig } from './config.js';
import { LANGUAGE_IDS, limitsFor, maxExecutionCost, priceExecution } from './limits.js';
import { isStatePath, normalizeWorkspacePath } from './paths.js';
import {
	SandboxError,
	countRecentExecutions,
	createExecution,
	ensureSandboxRun,
	finishExecution,
	getSandboxRun,
	getSandboxSettings,
	getUserPlan,
	killSandboxRun,
	recordRunTotals,
	setExecutionCost,
} from './store.js';
import { WorkspaceQuotaError, assertWorkspaceQuota, workspaceStore } from './workspace.js';

export const MAX_CODE_BYTES = 200 * 1024;
export const MAX_COMMAND_BYTES = 20 * 1024;
export const MAX_INPUT_FILES = 50;

// The anomaly guard. A run that trips any of these is killed before it starts
// another execution; the owner can see why at /settings/sandbox.
export const ANOMALY = Object.freeze({
	failureStreak: 10,
	burstWindowSeconds: 60,
	burstExecutions: 30,
	refusals: 25,
});

const KILL_POLL_MS = 2000;

/** Validate and normalize what the model asked to run. Throws a 400 SandboxError. */
export function normalizeJob(input) {
	if (input?.kind === 'terminal') {
		const command = typeof input.command === 'string' ? input.command : '';
		if (!command.trim()) throw new SandboxError(400, 'bad_request', 'terminal needs a command');
		if (Buffer.byteLength(command) > MAX_COMMAND_BYTES) throw new SandboxError(400, 'bad_request', `command is larger than ${MAX_COMMAND_BYTES / 1024} KB`);
		return { kind: 'terminal', command };
	}
	const language = String(input?.language || '').toLowerCase();
	const lang = language === 'node' || language === 'js' ? 'javascript' : language === 'py' ? 'python' : language === 'sh' ? 'bash' : language;
	if (!LANGUAGE_IDS.includes(lang)) throw new SandboxError(400, 'bad_language', `language must be one of ${LANGUAGE_IDS.join(', ')}`);
	const code = typeof input.code === 'string' ? input.code : '';
	if (!code.trim()) throw new SandboxError(400, 'bad_request', 'code is empty');
	if (Buffer.byteLength(code) > MAX_CODE_BYTES) throw new SandboxError(400, 'bad_request', `code is larger than ${MAX_CODE_BYTES / 1024} KB`);
	return { kind: 'code', language: lang, code };
}

/** Decode `[{ path, content } | { path, content_base64 }]` input files. */
export function decodeInputFiles(list) {
	if (list == null) return [];
	if (!Array.isArray(list)) throw new SandboxError(400, 'bad_request', 'files must be an array');
	if (list.length > MAX_INPUT_FILES) throw new SandboxError(400, 'bad_request', `at most ${MAX_INPUT_FILES} input files per execution`);
	return list.map((f) => {
		const p = normalizeWorkspacePath(f?.path);
		if (isStatePath(p)) throw new SandboxError(400, 'bad_path', `${p} is reserved for the terminal session`);
		if (typeof f.content_base64 === 'string') return { path: p, data: Buffer.from(f.content_base64, 'base64') };
		if (typeof f.content === 'string') return { path: p, data: Buffer.from(f.content, 'utf8') };
		throw new SandboxError(400, 'bad_request', `file ${p} needs content or content_base64`);
	});
}

async function guardRun(run, limits) {
	let reason = null;
	if (run.failures_streak >= ANOMALY.failureStreak) reason = `${run.failures_streak} executions in a row failed`;
	else if (run.refusals >= ANOMALY.refusals) reason = `${run.refusals} bridge calls were refused (fund-moving tools or hosts off the allowlist)`;
	else if ((await countRecentExecutions(run.run_id, ANOMALY.burstWindowSeconds)) >= ANOMALY.burstExecutions) {
		reason = `more than ${ANOMALY.burstExecutions} executions in ${ANOMALY.burstWindowSeconds} seconds`;
	}
	if (reason) {
		await killSandboxRun(run.run_id, `anomaly guard: ${reason}`);
		throw new SandboxError(409, 'run_killed', `This run's sandbox was stopped by the anomaly guard: ${reason}. The owner can review it at ${sandboxConfig.publicOrigin}/settings/sandbox.`, {
			reason,
			plan: limits.plan,
		});
	}
}

function statusOf(r) {
	if (r.killed) return 'killed';
	if (r.timedOut) return 'timeout';
	if (r.outputFlood) return 'failed';
	return r.exitCode === 0 ? 'succeeded' : 'failed';
}

export function fileUrl(runId, p) {
	return `${sandboxConfig.publicOrigin}/api/sandbox/file?run=${encodeURIComponent(runId)}&path=${encodeURIComponent(p)}`;
}

/**
 * Run one job in the run's sandbox.
 * @param {object} o
 * @param {string} o.userId
 * @param {string|null} [o.agentId]
 * @param {string} o.runId              agent_runs id or chat completion id
 * @param {string|null} [o.title]
 * @param {object} o.job                { kind:'code', language, code } | { kind:'terminal', command }
 * @param {Array} [o.files]             input files to write into the workspace first
 * @param {number} [o.timeoutSeconds]
 * @param {string[]|null} [o.toolsAllowed]  tools the bridge may call; null = the whole read registry
 * @param {(stream: string, chunk: Buffer) => void} [o.onOutput]
 * @param {AbortSignal} [o.signal]
 */
export async function executeInSandbox({ userId, agentId = null, runId, title = null, job: rawJob, files: rawFiles = [], timeoutSeconds, toolsAllowed = null, onOutput = null, signal = null }) {
	if (!userId) throw new SandboxError(401, 'unauthorized', 'code execution needs a signed-in account');
	const job = normalizeJob(rawJob);
	const inputFiles = decodeInputFiles(rawFiles);
	const [plan, settings, existing] = await Promise.all([getUserPlan(userId), getSandboxSettings(userId), getSandboxRun(runId)]);
	if (existing && String(existing.user_id) !== String(userId)) throw new SandboxError(403, 'forbidden', 'this run belongs to another account');
	const limits = limitsFor(plan, { timeoutSeconds });
	const backend = chooseBackend({ pinned: existing?.backend || null, preferred: settings?.default_backend || null });

	const run = await ensureSandboxRun({ runId, userId, agentId, backend: backend.id, title, toolsAllowed });
	if (run.status === 'killed') {
		throw new SandboxError(409, 'run_killed', `This run's sandbox was stopped: ${run.killed_reason || 'killed'}.`, { reason: run.killed_reason });
	}
	await guardRun(run, limits);

	const ceiling = maxExecutionCost(backend.id, limits);
	if (ceiling > 0) {
		const acct = await getCreditAccount(userId);
		if (acct.balanceUsd < ceiling) {
			throw new SandboxError(402, 'insufficient_credits', `Running code here can cost up to $${ceiling.toFixed(4)} and the credit balance is $${acct.balanceUsd.toFixed(4)}. Top up at ${sandboxConfig.publicOrigin}/settings/billing.`, {
				required_usd: ceiling,
				available_usd: acct.balanceUsd,
			});
		}
	}

	const store = workspaceStore();
	let listing = await store.list(runId);
	if (inputFiles.length) {
		assertWorkspaceQuota({ listing, writes: inputFiles.map((f) => ({ path: f.path, size: f.data.length })), limits });
		for (const f of inputFiles) await store.write(runId, f.path, f.data);
		listing = await store.list(runId);
	}

	const exec = await createExecution({
		runId,
		userId,
		kind: job.kind,
		backend: backend.id,
		language: job.kind === 'terminal' ? 'bash' : job.language,
		code: job.kind === 'terminal' ? job.command : job.code,
		limits,
	});

	const ac = new AbortController();
	const onCallerAbort = () => ac.abort(signal.reason);
	signal?.addEventListener('abort', onCallerAbort, { once: true });
	const killPoll = setInterval(() => {
		getSandboxRun(runId)
			.then((r) => {
				if (r?.status === 'killed') ac.abort(new Error('killed by the owner'));
			})
			.catch(() => {});
	}, KILL_POLL_MS);

	let result;
	let failure = null;
	try {
		const ctx = await bridgeContext(exec.id);
		const workspace = {
			listing,
			gcs: store.kind === 'gcs' ? { bucket: sandboxConfig.bucket, prefix: `runs/${runId}/` } : null,
			load: () => Promise.all(listing.map(async (f) => ({ path: f.path, data: (await store.read(runId, f.path)) || Buffer.alloc(0) }))),
		};
		result = await backend.run({
			job,
			workspace,
			limits,
			bridge: {
				handle: (msg) => handleBridge(ctx, msg),
				url: `${sandboxConfig.bridgeOrigin}/api/sandbox/bridge`,
				token: signBridgeToken(exec.id, limits.wallSeconds + 180),
			},
			signal: ac.signal,
			onOutput,
		});
	} catch (err) {
		failure = err;
	} finally {
		clearInterval(killPoll);
		signal?.removeEventListener('abort', onCallerAbort);
	}

	if (failure) {
		const finished = await finishExecution(exec.id, { status: 'error', error: failure.message || String(failure) });
		await recordRunTotals(runId, { costUsd: 0, wallMs: 0, failed: true });
		if (failure instanceof SandboxError) throw failure;
		throw new SandboxError(502, 'sandbox_error', `the sandbox failed: ${failure.message || failure}`, { execution_id: finished?.id || exec.id });
	}

	// Save what the program changed, unless it would overflow the workspace.
	let saveError = null;
	const written = [];
	try {
		const current = await store.list(runId);
		assertWorkspaceQuota({ listing: current, writes: result.files.map((f) => ({ path: f.path, size: f.data.length })), deletes: result.deleted, limits });
		for (const f of result.files) {
			await store.write(runId, f.path, f.data);
			written.push({ path: f.path, size: f.data.length });
		}
		for (const p of result.deleted) await store.remove(runId, p);
	} catch (err) {
		if (!(err instanceof WorkspaceQuotaError)) throw err;
		saveError = `${err.message} The files this execution wrote were not saved.`;
	}

	const status = statusOf(result);
	const errorText =
		saveError ||
		(result.outputFlood ? `the program wrote far more than the ${limits.outputBytes} byte output cap and was stopped` : null) ||
		(result.timedOut ? `stopped at the ${limits.wallSeconds}s wall-clock limit` : null) ||
		(result.killed ? 'stopped by the kill switch' : null);
	const filesOut = written.filter((f) => !isStatePath(f.path)).map((f) => ({ ...f, url: fileUrl(runId, f.path) }));
	const filesDeleted = saveError ? [] : result.deleted.filter((p) => !isStatePath(p));
	const finished = await finishExecution(exec.id, {
		status,
		exitCode: result.exitCode,
		stdout: result.stdout.text,
		stderr: result.stderr.text,
		stdoutTruncated: result.stdout.truncated,
		stderrTruncated: result.stderr.truncated,
		filesOut,
		filesDeleted,
		wallMs: result.wallMs,
		cpuMs: result.cpuMs,
		peakMemoryMb: result.peakMemoryMb,
		error: errorText,
	});

	const costUsd = priceExecution({ backend: backend.id, wallMs: result.wallMs, limits });
	let chargedUsd = 0;
	let chargeNote = null;
	if (costUsd > 0) {
		try {
			const d = await debitCredits({
				userId,
				amountUsd: costUsd,
				action: 'sandbox_execution',
				refType: 'sandbox_execution',
				refId: exec.id,
				idempotencyKey: `sandbox:${exec.id}`,
				meta: { run_id: runId, backend: backend.id, wall_ms: result.wallMs, plan: limits.plan },
			});
			chargedUsd = d.chargedUsd;
		} catch (err) {
			if (err?.status !== 402) throw err;
			chargeNote = 'The credit balance ran out; this run can start no more executions until it is topped up.';
			await killSandboxRun(runId, 'credit balance ran out');
		}
	}
	await setExecutionCost(exec.id, { costUsd, chargedUsd });
	const totals = await recordRunTotals(runId, { costUsd: chargedUsd, wallMs: result.wallMs, failed: status !== 'succeeded' });
	if (totals && totals.failures_streak >= ANOMALY.failureStreak) {
		await killSandboxRun(runId, `anomaly guard: ${totals.failures_streak} executions in a row failed`);
	}

	return {
		execution_id: exec.id,
		run_id: runId,
		seq: exec.seq,
		status: finished?.status || status,
		exit_code: result.exitCode,
		stdout: result.stdout.text,
		stderr: result.stderr.text,
		stdout_truncated: result.stdout.truncated,
		stderr_truncated: result.stderr.truncated,
		files_changed: filesOut,
		files_deleted: filesDeleted,
		files_skipped: result.skipped,
		wall_ms: result.wallMs,
		cpu_ms: result.cpuMs,
		peak_memory_mb: result.peakMemoryMb,
		cost_usd: costUsd,
		charged_usd: chargedUsd,
		backend: backend.id,
		isolation: result.isolation || null,
		limits: { plan: limits.plan, wall_seconds: limits.wallSeconds, memory_mb: limits.memoryMb, cpu: limits.cpu, egress: limits.egress },
		error: errorText,
		...(chargeNote ? { note: chargeNote } : {}),
	};
}

/** Read one workspace file for a tool call; state files are hidden. */
export async function readWorkspaceFile({ userId, runId, path: p, maxBytes = 256 * 1024 }) {
	const run = await getSandboxRun(runId);
	if (!run) throw new SandboxError(404, 'not_found', 'this run has no workspace yet; write a file or run code first');
	if (String(run.user_id) !== String(userId)) throw new SandboxError(403, 'forbidden', 'this run belongs to another account');
	const rel = normalizeWorkspacePath(p);
	if (isStatePath(rel)) throw new SandboxError(400, 'bad_path', `${rel} is reserved for the terminal session`);
	const data = await workspaceStore().read(runId, rel);
	if (!data) throw new SandboxError(404, 'not_found', `no file ${rel} in the workspace`);
	const textual = !data.subarray(0, Math.min(data.length, 8192)).includes(0);
	const slice = data.subarray(0, maxBytes);
	return {
		path: rel,
		size: data.length,
		truncated: data.length > maxBytes,
		encoding: textual ? 'utf8' : 'base64',
		content: textual ? slice.toString('utf8') : slice.toString('base64'),
		url: fileUrl(runId, rel),
	};
}

/** Write one workspace file for a tool call, under the plan quota. */
export async function writeWorkspaceFile({ userId, agentId = null, runId, title = null, path: p, content, contentBase64 = null }) {
	const [file] = decodeInputFiles([{ path: p, ...(contentBase64 != null ? { content_base64: contentBase64 } : { content }) }]);
	const [plan, settings, existing] = await Promise.all([getUserPlan(userId), getSandboxSettings(userId), getSandboxRun(runId)]);
	if (existing && String(existing.user_id) !== String(userId)) throw new SandboxError(403, 'forbidden', 'this run belongs to another account');
	if (existing?.status === 'killed') throw new SandboxError(409, 'run_killed', `This run's sandbox was stopped: ${existing.killed_reason || 'killed'}.`);
	const limits = limitsFor(plan);
	if (!existing) {
		const backend = chooseBackend({ preferred: settings?.default_backend || null });
		await ensureSandboxRun({ runId, userId, agentId, backend: backend.id, title });
	}
	const store = workspaceStore();
	assertWorkspaceQuota({ listing: await store.list(runId), writes: [{ path: file.path, size: file.data.length }], limits });
	await store.write(runId, file.path, file.data);
	return { path: file.path, size: file.data.length, url: fileUrl(runId, file.path) };
}
