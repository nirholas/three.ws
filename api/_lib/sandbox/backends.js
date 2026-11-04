// Sandbox backends: where a program actually runs.
//
//   cloudrun  the runner service (workers/sandbox-runner) on Cloud Run gen2,
//             one request per instance, the program in its own network, PID
//             and user namespace as nobody. The production backend.
//   docker    a throwaway container per execution on a host with a docker
//             daemon: no network, read-only root, every capability dropped,
//             memory, CPU and PID caps. For self-hosters.
//   local     a subprocess on this machine in its own network and PID
//             namespace (exec-core isolate). Development only: the program
//             has no network, but it can read what the API's user can read,
//             so SANDBOX_LOCAL=1 is never set in production.
//
// Every backend takes the same job and returns the same result:
//
//   run({ job, workspace, limits, bridge, signal, onOutput }) →
//     { exitCode, signal, timedOut, killed, outputFlood, wallMs, cpuMs, peakMemoryMb,
//       stdout: { text, truncated, bytes }, stderr: {...},
//       files: [{ path, data }], deleted: [path], skipped: [{ path, reason }], isolation }
//
//   job     { kind: 'code', language, code } or { kind: 'terminal', command }
//   workspace  { load() → [{ path, data }], gcs: { bucket, prefix } | null }: the
//           in-process backends load the files; the runner pulls a GCS
//           workspace itself (a Cloud Run request body is capped at 32 MB)
//   bridge  { handle(msg) → response } for the in-process backends, and
//           { url, token } for a runner that calls back over HTTP

import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import { fileURLToPath } from 'node:url';

import { sandboxConfig } from './config.js';
import {
	SOURCE_FILE,
	changed,
	collectFiles,
	detectIsolation,
	isolate,
	materialize,
	programEnv,
	programFor,
	runProcess,
	serveBridge,
	snapshot,
	terminalScript,
	withLimits,
} from './exec-core.js';
import { SandboxError } from './store.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLIENTS_DIR = path.join(HERE, 'clients');
const AVAILABILITY_TTL_MS = 30_000;
// The runner's own HTTP overhead on top of the program's wall cap: instance
// start, workspace upload, and the result upload.
const RUNNER_GRACE_MS = 60_000;

// ── shared host flow (local, docker) ─────────────────────────────────────────

function sourceFor(job) {
	if (job.kind === 'terminal') return { file: SOURCE_FILE.terminal, text: terminalScript(job.command) };
	const file = SOURCE_FILE[job.language];
	if (!file) throw new SandboxError(400, 'bad_language', `unsupported language: ${job.language}`);
	return { file, text: job.code };
}

/**
 * Lay out one job directory:
 *   workspace/   the program's cwd and $THREE_WS_WORKSPACE
 *   prog/        the program source (outside the workspace, so it is not a "changed file")
 *   tmp/         $TMPDIR
 *   sock/        the bridge socket
 *   node_modules/three_ws  → the node client, so `import 'three_ws'` resolves from prog/
 */
async function prepareJobDir({ job, workspace }) {
	const base = path.join(sandboxConfig.dataDir, 'jobs');
	await fs.mkdir(base, { recursive: true });
	const root = await fs.mkdtemp(path.join(base, 'job-'));
	const dirs = {
		root,
		workspace: path.join(root, 'workspace'),
		prog: path.join(root, 'prog'),
		tmp: path.join(root, 'tmp'),
		sock: path.join(root, 'sock'),
	};
	for (const d of [dirs.workspace, dirs.prog, dirs.tmp, dirs.sock, path.join(root, 'node_modules')]) await fs.mkdir(d, { recursive: true });
	await materialize(dirs.workspace, await workspace.load());
	const src = sourceFor(job);
	dirs.programFile = path.join(dirs.prog, src.file);
	await fs.writeFile(dirs.programFile, src.text);
	await fs.symlink(path.join(CLIENTS_DIR, 'node', 'three_ws'), path.join(root, 'node_modules', 'three_ws'));
	return dirs;
}

/** Make a job directory usable by a program running as another uid (nobody). */
async function openForOtherUid(dirs) {
	const walk = async (p) => {
		await fs.chmod(p, 0o777);
		for (const ent of await fs.readdir(p, { withFileTypes: true })) {
			const a = path.join(p, ent.name);
			if (ent.isDirectory()) await walk(a);
			else if (ent.isFile()) await fs.chmod(a, 0o666);
		}
	};
	for (const d of [dirs.workspace, dirs.tmp, dirs.sock]) await walk(d);
	await fs.chmod(dirs.root, 0o755);
	await fs.chmod(dirs.prog, 0o755);
	await fs.chmod(dirs.programFile, 0o644);
}

async function finishOnHost(dirs, before, result, limits) {
	const after = await snapshot(dirs.workspace);
	const diff = changed(before, after);
	const wanted = diff.modified.map((m) => m.path);
	const { files, skipped } = await collectFiles(dirs.workspace, wanted, { maxFileBytes: limits.fileBytes });
	return { ...result, files, deleted: diff.deleted, skipped };
}

async function runOnHost({ job, workspace, limits, bridge, onOutput, launch }) {
	const dirs = await prepareJobDir({ job, workspace });
	let server = null;
	try {
		const before = await snapshot(dirs.workspace);
		server = await serveBridge(path.join(dirs.sock, 'bridge.sock'), bridge.handle);
		const result = await launch(dirs, onOutput);
		return await finishOnHost(dirs, before, result, limits);
	} finally {
		await server?.close();
		await fs.rm(dirs.root, { recursive: true, force: true }).catch(() => {});
	}
}

// ── local ────────────────────────────────────────────────────────────────────

let _localIso = null;
function localIsolation() {
	if (!_localIso || Date.now() - _localIso.at > 10 * 60_000) _localIso = { at: Date.now(), ...detectIsolation() };
	return _localIso;
}

const local = {
	id: 'local',
	label: 'This machine',
	available() {
		if (!sandboxConfig.localEnabled || process.platform !== 'linux') return false;
		return Boolean(localIsolation().mode);
	},
	unavailableReason() {
		if (!sandboxConfig.localEnabled) return 'SANDBOX_LOCAL is not 1';
		if (process.platform !== 'linux') return 'namespace isolation needs Linux';
		const iso = localIsolation();
		return iso.mode ? null : `no isolation available: ${iso.tried.map((t) => `${t.mode}: ${t.reason}`).join('; ')}`;
	},
	async run({ job, workspace, limits, bridge, signal, onOutput }) {
		const mode = localIsolation().mode;
		if (!mode) throw new SandboxError(503, 'no_isolation', `the local backend cannot isolate a program here (${this.unavailableReason()})`);
		return runOnHost({
			job,
			workspace,
			limits,
			bridge,
			onOutput,
			launch: async (dirs) => {
				if (mode === 'root') await openForOtherUid(dirs);
				const language = job.kind === 'terminal' ? 'bash' : job.language;
				const argv = isolate(withLimits(programFor(job, { programPath: dirs.programFile, memoryMb: limits.memoryMb }), { limits, language }), mode);
				const r = await runProcess({
					argv,
					cwd: dirs.workspace,
					env: programEnv({
						workspace: dirs.workspace,
						socketPath: path.join(dirs.sock, 'bridge.sock'),
						clientsDir: CLIENTS_DIR,
						tmpDir: dirs.tmp,
						cpu: limits.cpu,
					}),
					limits,
					language,
					signal,
					hostLimits: false,
					onOutput,
				});
				return { ...r, isolation: mode };
			},
		});
	},
};

// ── docker ───────────────────────────────────────────────────────────────────

let _docker = null;
function dockerState() {
	if (_docker && Date.now() - _docker.at < AVAILABILITY_TTL_MS) return _docker;
	const image = sandboxConfig.dockerImage;
	let reason = null;
	const v = spawnSync('docker', ['version', '--format', '{{.Server.Version}}'], { encoding: 'utf8', timeout: 5000 });
	if (v.status !== 0) reason = `docker daemon unreachable: ${(v.stderr || v.error?.message || '').trim().slice(0, 200)}`;
	else {
		const i = spawnSync('docker', ['image', 'inspect', '--format', '{{.Id}}', image], { encoding: 'utf8', timeout: 5000 });
		if (i.status !== 0) reason = `image ${image} not found: build it with docker build -t ${image} -f workers/sandbox-runner/Dockerfile .`;
	}
	_docker = { at: Date.now(), reason };
	return _docker;
}

/** The `docker run` argv for one execution (exported for tests). */
export function dockerArgv({ name, dirs, limits, job, image, user }) {
	const language = job.kind === 'terminal' ? 'bash' : job.language;
	const programPath = `/sandbox/prog/${path.basename(dirs.programFile)}`;
	const env = programEnv({ workspace: '/workspace', socketPath: '/run/three_ws/bridge.sock', clientsDir: '/opt/three_ws/clients', tmpDir: '/tmp', cpu: limits.cpu });
	const argv = [
		'docker',
		'run',
		'--rm',
		'--name',
		name,
		'--network',
		'none',
		'--read-only',
		'--cap-drop',
		'ALL',
		'--security-opt',
		'no-new-privileges',
		'--pids-limit',
		'256',
		'--memory',
		`${limits.memoryMb}m`,
		'--memory-swap',
		`${limits.memoryMb}m`,
		'--cpus',
		String(limits.cpu),
		'--user',
		user,
		'--tmpfs',
		'/tmp:rw,nosuid,nodev,size=512m,mode=1777',
		'--mount',
		`type=bind,source=${dirs.workspace},target=/workspace`,
		'--mount',
		`type=bind,source=${dirs.prog},target=/sandbox/prog,readonly`,
		'--mount',
		`type=bind,source=${dirs.sock},target=/run/three_ws`,
		'-w',
		'/workspace',
	];
	for (const [k, v] of Object.entries(env)) argv.push('-e', `${k}=${v}`);
	argv.push('--entrypoint', '', image, ...withLimits(programFor(job, { programPath, memoryMb: limits.memoryMb }), { limits, language }));
	return argv;
}

const docker = {
	id: 'docker',
	label: 'Docker',
	available() {
		return sandboxConfig.dockerEnabled && !dockerState().reason;
	},
	unavailableReason() {
		if (!sandboxConfig.dockerEnabled) return 'SANDBOX_DOCKER is not 1';
		return dockerState().reason;
	},
	async run({ job, workspace, limits, bridge, signal, onOutput }) {
		const name = `sbx-${randomUUID().slice(0, 12)}`;
		return runOnHost({
			job,
			workspace,
			limits,
			bridge,
			onOutput,
			launch: async (dirs) => {
				const uid = process.getuid?.() ?? 65534;
				const root = uid === 0;
				if (root) await openForOtherUid(dirs);
				const user = root ? '65534:65534' : `${uid}:${process.getgid?.() ?? uid}`;
				const argv = dockerArgv({ name, dirs, limits, job, image: sandboxConfig.dockerImage, user });
				// The wall timer kills the docker CLI; the container must die with it.
				const r = await runProcess({
					argv,
					cwd: dirs.root,
					env: { PATH: process.env.PATH, HOME: process.env.HOME || os.homedir(), DOCKER_HOST: process.env.DOCKER_HOST || '' },
					limits,
					language: job.language,
					signal,
					hostLimits: false,
					onOutput,
					onKill: () => spawnSync('docker', ['kill', name], { stdio: 'ignore', timeout: 10_000 }),
				});
				if (r.exitCode === 125) {
					throw new SandboxError(503, 'docker_failed', `docker could not start the sandbox: ${r.stderr.text.trim().slice(0, 300)}`);
				}
				return { ...r, cpuMs: null, peakMemoryMb: null, isolation: 'docker' };
			},
		});
	},
};

// ── cloudrun (the runner service) ────────────────────────────────────────────

const _idTokens = new Map();

/** A Google-signed ID token for the runner's audience, from the metadata server. */
async function runnerIdToken(audience) {
	if (!process.env.K_SERVICE) return null;
	const hit = _idTokens.get(audience);
	if (hit && hit.exp > Date.now()) return hit.token;
	const res = await fetch(
		`http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/identity?audience=${encodeURIComponent(audience)}&format=full`,
		{ headers: { 'Metadata-Flavor': 'Google' }, signal: AbortSignal.timeout(3000) },
	).catch((err) => {
		throw new SandboxError(503, 'runner_auth', `could not mint an identity token for the runner: ${err.message}`);
	});
	if (!res.ok) throw new SandboxError(503, 'runner_auth', `metadata server answered ${res.status} for the runner identity token`);
	const token = (await res.text()).trim();
	_idTokens.set(audience, { token, exp: Date.now() + 50 * 60_000 });
	return token;
}

/** Parse an NDJSON stream into events. */
async function* ndjson(body) {
	const dec = new StringDecoder('utf8');
	let buf = '';
	for await (const chunk of body) {
		buf += dec.write(Buffer.from(chunk));
		let nl;
		while ((nl = buf.indexOf('\n')) >= 0) {
			const line = buf.slice(0, nl).trim();
			buf = buf.slice(nl + 1);
			if (line) yield JSON.parse(line);
		}
	}
	buf += dec.end();
	if (buf.trim()) yield JSON.parse(buf.trim());
}

// A Cloud Run request body is capped at 32 MB; base64 adds a third.
const INLINE_WORKSPACE_BYTES = 20 * 1024 * 1024;

/** What the runner needs to rebuild the workspace: a GCS prefix to pull, or the files inline. */
async function runnerWorkspace(workspace) {
	if (workspace.gcs) return { gcs: workspace.gcs };
	const files = await workspace.load();
	const total = files.reduce((n, f) => n + f.data.length, 0);
	if (total > INLINE_WORKSPACE_BYTES) {
		throw new SandboxError(413, 'workspace_too_large', `a workspace over ${INLINE_WORKSPACE_BYTES / 1024 / 1024} MB needs SANDBOX_STORE=gcs to reach the runner`);
	}
	return { files: files.map((f) => ({ path: f.path, data_base64: f.data.toString('base64') })) };
}

const cloudrun = {
	id: 'cloudrun',
	label: 'three.ws cloud',
	available() {
		return Boolean(sandboxConfig.runnerUrl && sandboxConfig.runnerToken);
	},
	unavailableReason() {
		if (!sandboxConfig.runnerUrl) return 'SANDBOX_RUNNER_URL is not set';
		if (!sandboxConfig.runnerToken) return 'SANDBOX_RUNNER_TOKEN is not set';
		return null;
	},
	async run({ job, workspace, limits, bridge, signal, onOutput }) {
		const base = sandboxConfig.runnerUrlFor(limits.size);
		if (!base || !sandboxConfig.runnerToken) throw new SandboxError(503, 'runner_unconfigured', this.unavailableReason());
		const idToken = await runnerIdToken(base);
		const ac = new AbortController();
		const onAbort = () => ac.abort(signal.reason);
		signal?.addEventListener('abort', onAbort, { once: true });
		const deadline = setTimeout(() => ac.abort(new Error('runner deadline')), limits.wallSeconds * 1000 + RUNNER_GRACE_MS);
		try {
			let res;
			try {
				res = await fetch(`${base}/exec`, {
					method: 'POST',
					signal: ac.signal,
					headers: {
						'content-type': 'application/json',
						'x-sandbox-token': sandboxConfig.runnerToken,
						...(idToken ? { authorization: `Bearer ${idToken}` } : {}),
					},
					body: JSON.stringify({
						job,
						workspace: await runnerWorkspace(workspace),
						limits,
						bridge: { url: bridge.url, token: bridge.token },
					}),
				});
			} catch (err) {
				if (signal?.aborted) return killedResult();
				throw new SandboxError(502, 'runner_unreachable', `the sandbox runner did not answer: ${err.message}`);
			}
			if (res.status === 429) throw new SandboxError(503, 'runner_busy', 'every sandbox runner is busy; try again in a moment');
			if (!res.ok) {
				const text = await res.text().catch(() => '');
				throw new SandboxError(502, 'runner_error', `the sandbox runner answered ${res.status}: ${text.slice(0, 300)}`);
			}
			let isolation = null;
			try {
				for await (const ev of ndjson(res.body)) {
					if (ev.type === 'started') isolation = ev.isolation;
					else if ((ev.type === 'stdout' || ev.type === 'stderr') && onOutput) onOutput(ev.type, Buffer.from(ev.data));
					else if (ev.type === 'error') throw new SandboxError(ev.status || 502, ev.code || 'runner_error', ev.message || 'the runner failed');
					else if (ev.type === 'result') {
						return {
							exitCode: ev.exitCode,
							signal: ev.signal,
							timedOut: ev.timedOut,
							killed: ev.killed,
							outputFlood: ev.outputFlood,
							wallMs: ev.wallMs,
							cpuMs: ev.cpuMs,
							peakMemoryMb: ev.peakMemoryMb,
							stdout: ev.stdout,
							stderr: ev.stderr,
							files: (ev.files || []).map((f) => ({ path: f.path, data: Buffer.from(f.data_base64, 'base64') })),
							deleted: ev.deleted || [],
							skipped: ev.skipped || [],
							isolation: ev.isolation || isolation,
						};
					}
				}
			} catch (err) {
				if (signal?.aborted) return killedResult();
				if (err instanceof SandboxError) throw err;
				throw new SandboxError(502, 'runner_stream', `the sandbox runner stream broke: ${err.message}`);
			}
			if (signal?.aborted) return killedResult();
			throw new SandboxError(502, 'runner_stream', 'the sandbox runner closed the stream without a result');
		} finally {
			clearTimeout(deadline);
			signal?.removeEventListener('abort', onAbort);
		}
	},
};

function killedResult() {
	const empty = { text: '', truncated: false, bytes: 0 };
	return {
		exitCode: null,
		signal: 'SIGKILL',
		timedOut: false,
		killed: true,
		outputFlood: false,
		wallMs: 0,
		cpuMs: null,
		peakMemoryMb: null,
		stdout: empty,
		stderr: empty,
		files: [],
		deleted: [],
		skipped: [],
		isolation: null,
	};
}

// ── registry ─────────────────────────────────────────────────────────────────

export const BACKENDS = Object.freeze({ cloudrun, docker, local });
export const BACKEND_ORDER = Object.freeze(['cloudrun', 'docker', 'local']);

export function backendById(id) {
	return Object.hasOwn(BACKENDS, id) ? BACKENDS[id] : null;
}

/** Every backend with whether it can run here and, when it cannot, why. */
export function backendStatus() {
	return BACKEND_ORDER.map((id) => {
		const b = BACKENDS[id];
		const available = b.available();
		return { id, label: b.label, available, reason: available ? null : b.unavailableReason() };
	});
}

export function anyBackendAvailable() {
	return BACKEND_ORDER.some((id) => BACKENDS[id].available());
}

/**
 * The backend an execution uses: the one the run is pinned to, else the
 * account default, else the first available. Never one that cannot run here.
 */
export function chooseBackend({ pinned = null, preferred = null } = {}) {
	if (pinned) {
		const b = backendById(pinned);
		if (!b) throw new SandboxError(500, 'bad_backend', `unknown backend ${pinned}`);
		if (!b.available()) throw new SandboxError(503, 'backend_unavailable', `this run is pinned to the ${b.label} backend, which is unavailable: ${b.unavailableReason()}`);
		return b;
	}
	if (preferred) {
		const b = backendById(preferred);
		if (b?.available()) return b;
	}
	for (const id of BACKEND_ORDER) if (BACKENDS[id].available()) return BACKENDS[id];
	throw new SandboxError(503, 'sandbox_unavailable', 'Code execution is not available right now: no sandbox backend is configured on this server.');
}
