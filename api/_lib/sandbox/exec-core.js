// The execution core: everything that happens around one program run, shared
// by the backends that run on a machine we control (local, docker) and by the
// runner inside the Cloud Run job (workers/sandbox-runner), so a script behaves
// the same everywhere.
//
//   materialize(dir, files)     write the workspace to disk
//   snapshot(dir) / changed()   find what the program created or modified
//   programFor(job, paths)      the argv for code in a language, or a terminal command
//   runProcess(opts)            spawn under resource limits, capture capped
//                               output, enforce wall time, sample CPU and memory
//   serveBridge(path, handle)   the local socket `three_ws.tool(...)` talks to
//
// Node builtins and ./paths.js only: the runner image copies this file as is.

import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';

import { STATE_DIR } from './paths.js';

const CLOCK_TICKS = 100;
const SAMPLE_MS = 200;
// Output beyond this multiple of the cap is a flood: the program is killed
// instead of being allowed to spin writing into a buffer nobody reads.
const FLOOD_FACTOR = 8;
const MAX_BRIDGE_LINE = 8 * 1024 * 1024;

/** Write `[{ path, data }]` under dir. */
export async function materialize(dir, files) {
	await fs.mkdir(dir, { recursive: true });
	for (const f of files) {
		const abs = path.join(dir, f.path);
		if (!abs.startsWith(dir + path.sep)) throw new Error(`refusing to write outside the workspace: ${f.path}`);
		await fs.mkdir(path.dirname(abs), { recursive: true });
		await fs.writeFile(abs, f.data);
	}
}

/** Map of relative path → { size, hash } for every regular file under dir. Symlinks are skipped. */
export async function snapshot(dir) {
	const out = new Map();
	async function walk(abs, rel) {
		let entries;
		try {
			entries = await fs.readdir(abs, { withFileTypes: true });
		} catch (err) {
			if (err.code === 'ENOENT' || err.code === 'EACCES') return;
			throw err;
		}
		for (const ent of entries) {
			const a = path.join(abs, ent.name);
			const r = rel ? `${rel}/${ent.name}` : ent.name;
			if (ent.isDirectory()) await walk(a, r);
			else if (ent.isFile()) {
				const data = await fs.readFile(a);
				out.set(r, { size: data.length, hash: createHash('sha1').update(data).digest('hex') });
			}
		}
	}
	await walk(dir, '');
	return out;
}

/** Paths that are new or whose content changed between two snapshots, plus the ones deleted. */
export function changed(before, after) {
	const modified = [];
	for (const [p, meta] of after) {
		const prev = before.get(p);
		if (!prev || prev.hash !== meta.hash) modified.push({ path: p, size: meta.size });
	}
	const deleted = [...before.keys()].filter((p) => !after.has(p));
	return { modified, deleted };
}

/**
 * The bash program behind the `terminal` tool. The session (working directory
 * and exported variables) is restored from the workspace before the command
 * and saved back after it, so it persists across calls, executions and
 * backends: it lives in the workspace like any other file.
 * @param {string} command
 */
export function terminalScript(command) {
	return [
		'WS="$THREE_WS_WORKSPACE"',
		`mkdir -p "$WS/${STATE_DIR}"`,
		`if [ -f "$WS/${STATE_DIR}/terminal.env" ]; then . "$WS/${STATE_DIR}/terminal.env" 2>/dev/null; fi`,
		`__cwd=$(cat "$WS/${STATE_DIR}/terminal.cwd" 2>/dev/null || true)`,
		'cd "$WS/${__cwd:-.}" 2>/dev/null || cd "$WS"',
		'__three_ws_save() {',
		'  __rc=$?',
		'  case "$PWD" in "$WS") __rel=. ;; "$WS"/*) __rel="${PWD#"$WS"/}" ;; *) __rel=. ;; esac',
		`  printf '%s' "$__rel" > "$WS/${STATE_DIR}/terminal.cwd"`,
		`  export -p | grep -v -E '^(declare -x|export) (THREE_WS_[A-Z_]*|PWD|OLDPWD|SHLVL|_|HOME|PATH|PYTHONPATH|NODE_PATH|TMPDIR|MPLBACKEND|MPLCONFIGDIR|PYTHONUNBUFFERED)(=|$)' > "$WS/${STATE_DIR}/terminal.env" || true`,
		'  exit $__rc',
		'}',
		'trap __three_ws_save EXIT',
		command,
		'',
	].join('\n');
}

/** The file the program source is written to, per language. */
export const SOURCE_FILE = { python: 'main.py', javascript: 'main.mjs', bash: 'main.sh', terminal: 'terminal.sh' };

/**
 * argv for a job. `programPath` is where the source was written.
 * @param {{ kind: 'code'|'terminal', language?: string }} job
 * @param {{ programPath: string, memoryMb: number }} o
 */
export function programFor(job, { programPath, memoryMb }) {
	if (job.kind === 'terminal') return ['bash', programPath];
	switch (job.language) {
		case 'python':
			return ['python3', '-u', programPath];
		case 'javascript':
			return ['node', `--max-old-space-size=${Math.max(64, Math.floor(memoryMb * 0.75))}`, programPath];
		case 'bash':
			return ['bash', programPath];
		default:
			throw new Error(`unsupported language: ${job.language}`);
	}
}

let _prlimit;
function hasPrlimit() {
	if (_prlimit === undefined) {
		try {
			_prlimit = spawnSync('prlimit', ['--version'], { stdio: 'ignore' }).status === 0;
		} catch {
			_prlimit = false;
		}
	}
	return _prlimit;
}

/**
 * Wrap argv with kernel resource limits: CPU seconds, largest file, address
 * space (skipped for node, whose heap cap is --max-old-space-size and which
 * reserves far more address space than it uses), and optionally process count.
 */
export function withLimits(argv, { limits, nproc = null, language }) {
	const cpuSeconds = Math.ceil(limits.wallSeconds * limits.cpu) + 5;
	const asBytes = (limits.memoryMb * 2 + 512) * 1024 * 1024;
	const useAs = language !== 'javascript';
	if (hasPrlimit()) {
		const flags = [`--cpu=${cpuSeconds}`, `--fsize=${limits.fileBytes}`];
		if (useAs) flags.push(`--as=${asBytes}`);
		if (nproc) flags.push(`--nproc=${nproc}`);
		return ['prlimit', ...flags, '--', ...argv];
	}
	const lines = [`ulimit -t ${cpuSeconds} 2>/dev/null`, `ulimit -f ${Math.ceil(limits.fileBytes / 512)} 2>/dev/null`];
	if (useAs) lines.push(`ulimit -v ${Math.floor(asBytes / 1024)} 2>/dev/null`);
	if (nproc) lines.push(`ulimit -u ${nproc} 2>/dev/null`);
	return ['/bin/sh', '-c', `${lines.join('; ')}; exec "$@"`, 'sandbox', ...argv];
}

function sampleProc(pid) {
	try {
		const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
		const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
		const cpuMs = ((Number(fields[11]) + Number(fields[12])) * 1000) / CLOCK_TICKS;
		const status = readFileSync(`/proc/${pid}/status`, 'utf8');
		const hwm = /VmHWM:\s+(\d+)\s+kB/.exec(status);
		return { cpuMs, peakKb: hwm ? Number(hwm[1]) : 0 };
	} catch {
		return null;
	}
}

class CappedBuffer {
	constructor(cap) {
		this.cap = cap;
		this.head = [];
		this.headBytes = 0;
		this.tail = Buffer.alloc(0);
		this.total = 0;
	}
	push(chunk) {
		this.total += chunk.length;
		const headRoom = Math.floor(this.cap * 0.4) - this.headBytes;
		if (headRoom > 0) {
			const take = chunk.subarray(0, headRoom);
			this.head.push(take);
			this.headBytes += take.length;
			chunk = chunk.subarray(take.length);
		}
		if (chunk.length) {
			const tailCap = this.cap - Math.floor(this.cap * 0.4);
			const joined = Buffer.concat([this.tail, chunk]);
			this.tail = joined.length > tailCap ? joined.subarray(joined.length - tailCap) : joined;
		}
	}
	result() {
		const head = Buffer.concat(this.head);
		const kept = head.length + this.tail.length;
		const truncated = this.total > kept;
		const text = truncated
			? `${head.toString()}\n[... ${this.total - kept} bytes omitted ...]\n${this.tail.toString()}`
			: Buffer.concat([head, this.tail]).toString();
		return { text, truncated, bytes: this.total };
	}
}

/**
 * Spawn a program under limits and wait for it.
 *
 * @param {object} o
 * @param {string[]} o.argv
 * @param {string} o.cwd
 * @param {Record<string,string>} o.env         the complete environment (nothing is inherited)
 * @param {object} o.limits                      from limitsFor()
 * @param {string} [o.language]
 * @param {number} [o.uid]                       drop to this uid (runner only)
 * @param {number} [o.gid]
 * @param {number} [o.nproc]
 * @param {AbortSignal} [o.signal]               kill switch
 * @returns {Promise<{ exitCode: number|null, signal: string|null, stdout: object, stderr: object,
 *   timedOut: boolean, killed: boolean, outputFlood: boolean, wallMs: number, cpuMs: number|null, peakMemoryMb: number|null }>}
 */
export function runProcess({ argv, cwd, env, limits, language, uid, gid, nproc, signal }) {
	const wrapped = withLimits(argv, { limits, nproc, language });
	const started = Date.now();
	return new Promise((resolve) => {
		const child = spawn(wrapped[0], wrapped.slice(1), {
			cwd,
			env,
			detached: true,
			stdio: ['ignore', 'pipe', 'pipe'],
			...(Number.isInteger(uid) ? { uid } : {}),
			...(Number.isInteger(gid) ? { gid } : {}),
		});
		const out = new CappedBuffer(limits.outputBytes);
		const err = new CappedBuffer(limits.outputBytes);
		let timedOut = false;
		let killed = false;
		let outputFlood = false;
		let cpuMs = null;
		let peakKb = 0;
		let done = false;

		const killTree = () => {
			try {
				process.kill(-child.pid, 'SIGKILL');
			} catch {
				try {
					child.kill('SIGKILL');
				} catch {
					/* already gone */
				}
			}
		};
		const floodCheck = () => {
			if (!outputFlood && out.total + err.total > limits.outputBytes * FLOOD_FACTOR) {
				outputFlood = true;
				killTree();
			}
		};
		child.stdout.on('data', (c) => {
			out.push(c);
			floodCheck();
		});
		child.stderr.on('data', (c) => {
			err.push(c);
			floodCheck();
		});

		const wallTimer = setTimeout(() => {
			timedOut = true;
			killTree();
		}, limits.wallSeconds * 1000);
		const sampler = setInterval(() => {
			const s = child.pid ? sampleProc(child.pid) : null;
			if (s) {
				cpuMs = s.cpuMs;
				peakKb = Math.max(peakKb, s.peakKb);
			}
		}, SAMPLE_MS);
		const onAbort = () => {
			killed = true;
			killTree();
		};
		signal?.addEventListener('abort', onAbort, { once: true });

		const finish = (exitCode, sig, spawnError) => {
			if (done) return;
			done = true;
			clearTimeout(wallTimer);
			clearInterval(sampler);
			signal?.removeEventListener('abort', onAbort);
			if (spawnError) err.push(Buffer.from(`failed to start ${argv[0]}: ${spawnError.message}\n`));
			resolve({
				exitCode: spawnError ? 127 : exitCode,
				signal: sig,
				stdout: out.result(),
				stderr: err.result(),
				timedOut,
				killed,
				outputFlood,
				wallMs: Date.now() - started,
				cpuMs: cpuMs == null ? null : Math.round(cpuMs),
				peakMemoryMb: peakKb ? Math.round(peakKb / 1024) : null,
			});
		};
		child.on('error', (e) => finish(null, null, e));
		child.on('close', (code, sig) => finish(code, sig, null));
	});
}

/**
 * Serve the bridge on a unix socket. One JSON object per line in each
 * direction; requests carry an `id` the response echoes, so a client may keep
 * several calls in flight on one connection.
 * @param {string} socketPath
 * @param {(msg: object) => Promise<object>} handle  resolves to the response body
 */
export async function serveBridge(socketPath, handle) {
	await fs.rm(socketPath, { force: true });
	const server = net.createServer((conn) => {
		let buf = '';
		conn.setEncoding('utf8');
		conn.on('data', (chunk) => {
			buf += chunk;
			if (buf.length > MAX_BRIDGE_LINE) {
				conn.end(`${JSON.stringify({ ok: false, error: { code: 'too_large', message: 'bridge request larger than 8 MB' } })}\n`);
				return;
			}
			let nl;
			while ((nl = buf.indexOf('\n')) >= 0) {
				const line = buf.slice(0, nl);
				buf = buf.slice(nl + 1);
				if (!line.trim()) continue;
				let msg;
				try {
					msg = JSON.parse(line);
				} catch {
					conn.write(`${JSON.stringify({ ok: false, error: { code: 'bad_json', message: 'bridge request is not JSON' } })}\n`);
					continue;
				}
				Promise.resolve()
					.then(() => handle(msg))
					.catch((e) => ({ ok: false, error: { code: e?.code || 'bridge_error', message: String(e?.message || e).slice(0, 500) } }))
					.then((body) => {
						if (!conn.destroyed) conn.write(`${JSON.stringify({ id: msg.id ?? null, ...body })}\n`);
					});
			}
		});
		conn.on('error', () => {});
	});
	await new Promise((resolve, reject) => {
		server.once('error', reject);
		server.listen(socketPath, resolve);
	});
	await fs.chmod(socketPath, 0o666);
	return {
		close: () =>
			new Promise((resolve) => {
				server.close(() => resolve());
				fs.rm(socketPath, { force: true }).catch(() => {});
			}),
	};
}

/**
 * The environment a sandboxed program sees. Nothing leaks in from the host:
 * no credentials, no cloud metadata variables, no API keys.
 */
export function programEnv({ workspace, socketPath, clientsDir, tmpDir, cpu, extra = {} }) {
	const threads = String(Math.max(1, cpu || 1));
	return {
		PATH: '/usr/local/bin:/usr/bin:/bin',
		HOME: workspace,
		LANG: 'C.UTF-8',
		LC_ALL: 'C.UTF-8',
		TMPDIR: tmpDir,
		THREE_WS_WORKSPACE: workspace,
		THREE_WS_SOCKET: socketPath,
		PYTHONPATH: path.join(clientsDir, 'python'),
		NODE_PATH: path.join(clientsDir, 'node'),
		PYTHONUNBUFFERED: '1',
		PYTHONDONTWRITEBYTECODE: '1',
		MPLBACKEND: 'Agg',
		MPLCONFIGDIR: path.join(tmpDir, 'mpl'),
		OPENBLAS_NUM_THREADS: threads,
		OMP_NUM_THREADS: threads,
		MKL_NUM_THREADS: threads,
		...extra,
	};
}
