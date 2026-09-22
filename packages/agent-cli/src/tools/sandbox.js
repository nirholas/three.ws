// The local execution backend: one shell command in a child process with
// resource limits. This is the `local` backend of the platform sandbox
// contract (docs/prompts/25): the same limits, enforced on this machine.
//
//   wall time     a hard deadline; the whole process group is killed
//   CPU time      `ulimit -t` on POSIX
//   file size     `ulimit -f` on POSIX, so a runaway write cannot fill the disk
//   output        stdout and stderr are each capped; the rest is counted, not kept
//   environment   scrubbed: credentials (keys, tokens, secrets, passwords) never
//                 reach the child unless named in sandbox.passEnv
//   cwd           confined to the workspace
//
// The child runs in its own process group (POSIX) so a kill takes every
// grandchild with it; on Windows `taskkill /T /F` does the same.

import { spawn, spawnSync } from 'node:child_process';

const SECRET_ENV = /(KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL|PRIVATE|MNEMONIC|SEED|COOKIE|SESSION)/i;

export function scrubEnv(env, passEnv = []) {
	const keep = new Set(passEnv);
	const out = {};
	for (const [k, v] of Object.entries(env)) {
		if (v === undefined) continue;
		if (SECRET_ENV.test(k) && !keep.has(k)) continue;
		out[k] = v;
	}
	return out;
}

function posixWrapped(command, { cpuSeconds, maxFileMb }) {
	// ulimit -f counts 512-byte blocks in POSIX sh.
	const blocks = Math.max(1, Math.floor((maxFileMb * 1024 * 1024) / 512));
	const limits = [];
	if (cpuSeconds > 0) limits.push(`ulimit -t ${Math.ceil(cpuSeconds)} 2>/dev/null`);
	if (maxFileMb > 0) limits.push(`ulimit -f ${blocks} 2>/dev/null`);
	return `${limits.join('; ')}${limits.length ? '; ' : ''}${command}`;
}

function killTree(child) {
	if (!child.pid || child.exitCode !== null) return;
	if (process.platform === 'win32') {
		spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
		return;
	}
	try {
		process.kill(-child.pid, 'SIGTERM');
	} catch {
		child.kill('SIGTERM');
	}
	setTimeout(() => {
		try {
			process.kill(-child.pid, 'SIGKILL');
		} catch {
			// already gone
		}
	}, 2000).unref();
}

function capture(limit) {
	const chunks = [];
	let kept = 0;
	let total = 0;
	return {
		push(buf) {
			total += buf.length;
			if (kept >= limit) return;
			const slice = buf.subarray(0, limit - kept);
			chunks.push(slice);
			kept += slice.length;
		},
		text() {
			return Buffer.concat(chunks).toString('utf8');
		},
		get truncated() {
			return total > kept;
		},
		get total() {
			return total;
		},
	};
}

/**
 * Run one command. Never rejects for a failing command: a non-zero exit,
 * a timeout or a kill is reported in the result for the model to read.
 *
 * @returns {Promise<{ exitCode: number|null, signal: string|null, stdout: string, stderr: string, timedOut: boolean, interrupted: boolean, truncated: boolean, durationMs: number }>}
 */
export function runCommand(command, { cwd, timeoutMs = 120_000, cpuSeconds = 60, maxFileMb = 256, maxOutputBytes = 200_000, passEnv = [], env = process.env, signal, onOutput } = {}) {
	const started = Date.now();
	const childEnv = scrubEnv(env, passEnv);
	childEnv.THREE_WS_SANDBOX = '1';
	const isWin = process.platform === 'win32';
	const child = isWin
		? spawn(command, { cwd, env: childEnv, shell: true, windowsHide: true })
		: spawn('/bin/sh', ['-c', posixWrapped(command, { cpuSeconds, maxFileMb })], { cwd, env: childEnv, detached: true });

	const out = capture(maxOutputBytes);
	const err = capture(maxOutputBytes);
	let timedOut = false;
	let interrupted = false;

	return new Promise((resolve) => {
		const timer = setTimeout(() => {
			timedOut = true;
			killTree(child);
		}, timeoutMs);
		const onAbort = () => {
			interrupted = true;
			killTree(child);
		};
		signal?.addEventListener('abort', onAbort, { once: true });
		child.stdout.on('data', (b) => {
			out.push(b);
			onOutput?.('stdout', b.toString('utf8'));
		});
		child.stderr.on('data', (b) => {
			err.push(b);
			onOutput?.('stderr', b.toString('utf8'));
		});
		const finish = (exitCode, sig, spawnError) => {
			clearTimeout(timer);
			signal?.removeEventListener('abort', onAbort);
			resolve({
				exitCode,
				signal: sig || null,
				stdout: out.text(),
				stderr: spawnError ? `${err.text()}${spawnError}` : err.text(),
				timedOut,
				interrupted,
				truncated: out.truncated || err.truncated,
				durationMs: Date.now() - started,
			});
		};
		child.on('error', (e) => finish(null, null, `failed to start: ${e.message}`));
		child.on('close', (code, sig) => finish(code, sig));
	});
}
