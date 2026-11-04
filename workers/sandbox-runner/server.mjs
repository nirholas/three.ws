// three.ws sandbox runner: runs one untrusted program per request.
//
// The API (api/_lib/sandbox/backends.js, backend `cloudrun`) POSTs a job here:
//
//   { job, workspace: { files: [{ path, data_base64 }] } | { gcs: { bucket, prefix } },
//     limits, bridge: { url, token } }
//
// and reads back newline-delimited JSON events: `started`, `stdout` and
// `stderr` while the program runs, then one `result` (or `error`). The runner
// is deliberately thin. Isolation, limits, process supervision and the
// changed-file diff are exec-core.js, the same module the API's local and
// docker backends use, so a program behaves identically on every backend.
//
// Trust model. The program runs in its own network, PID and IPC namespace as
// uid 65534 with no capabilities, no-new-privs, and kernel rlimits. It sees only
// its workspace, its temp directory and a unix socket. That socket is the
// bridge: the runner forwards each message to the API with the per-execution
// bearer token, and the API decides (tool tier, host allowlist, fund-moving
// tools refused). The runner holds no credentials the program can reach: its
// own environment is never passed down (programEnv builds a clean one).
//
// Cloud Run runs this with concurrency 1, and the runner refuses a second
// request while one is active, so two customers never share an instance.

import { randomUUID, timingSafeEqual } from 'node:crypto';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { StringDecoder } from 'node:string_decoder';

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
} from '../../api/_lib/sandbox/exec-core.js';
import { normalizeWorkspacePath } from '../../api/_lib/sandbox/paths.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLIENTS_DIR = path.join(HERE, '..', '..', 'api', '_lib', 'sandbox', 'clients');
const JOBS_DIR = process.env.SANDBOX_JOBS_DIR || '/tmp/sandbox-jobs';
const MAX_BODY_BYTES = 40 * 1024 * 1024;
const BRIDGE_TIMEOUT_MS = 60_000;
const GCS_API = 'https://storage.googleapis.com/storage/v1';

const TOKEN = process.env.SANDBOX_RUNNER_TOKEN || '';
if (!TOKEN) {
	console.error('SANDBOX_RUNNER_TOKEN is not set; refusing to start without a shared secret');
	process.exit(1);
}

const isolation = detectIsolation();
if (!isolation.mode) {
	console.error(`no usable isolation on this host, the runner will refuse every job: ${JSON.stringify(isolation.tried)}`);
}

let busy = false;

// ── helpers ──────────────────────────────────────────────────────────────────

function tokenOk(header) {
	const got = Buffer.from(String(header || ''));
	const want = Buffer.from(TOKEN);
	return got.length === want.length && timingSafeEqual(got, want);
}

async function readBody(req) {
	const chunks = [];
	let size = 0;
	for await (const c of req) {
		size += c.length;
		if (size > MAX_BODY_BYTES) throw Object.assign(new Error('request body too large'), { status: 413, code: 'too_large' });
		chunks.push(c);
	}
	try {
		return JSON.parse(Buffer.concat(chunks).toString('utf8'));
	} catch {
		throw Object.assign(new Error('request body is not JSON'), { status: 400, code: 'bad_request' });
	}
}

async function metadataToken() {
	const res = await fetch('http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token', {
		headers: { 'Metadata-Flavor': 'Google' },
		signal: AbortSignal.timeout(5000),
	});
	if (!res.ok) throw Object.assign(new Error(`metadata server answered ${res.status}`), { status: 502, code: 'workspace_unavailable' });
	return (await res.json()).access_token;
}

/** Pull a workspace prefix from GCS with the runner's own service account. */
async function pullGcs({ bucket, prefix }) {
	if (!/^[a-z0-9][a-z0-9._-]{2,221}$/.test(String(bucket)) || !/^runs\/[A-Za-z0-9_-]{6,80}\/$/.test(String(prefix))) {
		throw Object.assign(new Error('bad workspace location'), { status: 400, code: 'bad_request' });
	}
	const auth = { authorization: `Bearer ${await metadataToken()}` };
	const files = [];
	let pageToken = '';
	do {
		const q = new URLSearchParams({ prefix, fields: 'items(name),nextPageToken', maxResults: '1000' });
		if (pageToken) q.set('pageToken', pageToken);
		const res = await fetch(`${GCS_API}/b/${encodeURIComponent(bucket)}/o?${q}`, { headers: auth, signal: AbortSignal.timeout(30_000) });
		if (!res.ok) throw Object.assign(new Error(`GCS list answered ${res.status}`), { status: 502, code: 'workspace_unavailable' });
		const body = await res.json();
		for (const item of body.items || []) {
			const rel = item.name.slice(prefix.length);
			if (!rel || rel.endsWith('/')) continue;
			const obj = await fetch(`${GCS_API}/b/${encodeURIComponent(bucket)}/o/${encodeURIComponent(item.name)}?alt=media`, {
				headers: auth,
				signal: AbortSignal.timeout(60_000),
			});
			if (!obj.ok) throw Object.assign(new Error(`GCS read answered ${obj.status}`), { status: 502, code: 'workspace_unavailable' });
			files.push({ path: rel, data: Buffer.from(await obj.arrayBuffer()) });
		}
		pageToken = body.nextPageToken || '';
	} while (pageToken);
	return files;
}

async function workspaceFiles(workspace) {
	if (workspace?.gcs) return pullGcs(workspace.gcs);
	return (workspace?.files || []).map((f) => ({ path: f.path, data: Buffer.from(String(f.data_base64 || ''), 'base64') }));
}

function sourceFor(job) {
	if (job?.kind === 'terminal') return { file: SOURCE_FILE.terminal, text: terminalScript(String(job.command ?? '')) };
	const file = SOURCE_FILE[job?.language];
	if (job?.kind !== 'code' || !file) throw Object.assign(new Error(`unsupported job: ${job?.kind}/${job?.language}`), { status: 400, code: 'bad_language' });
	return { file, text: String(job.code ?? '') };
}

/** Forward one bridge message to the API and return the wire response. */
function forwardBridge(bridge) {
	return async (msg) => {
		try {
			const res = await fetch(bridge.url, {
				method: 'POST',
				headers: { 'content-type': 'application/json', authorization: `Bearer ${bridge.token}` },
				body: JSON.stringify(msg),
				signal: AbortSignal.timeout(BRIDGE_TIMEOUT_MS),
			});
			const body = await res.json().catch(() => null);
			if (body && typeof body === 'object' && typeof body.ok === 'boolean') return body;
			return { ok: false, error: { code: 'bridge_unavailable', message: `the platform answered ${res.status} to a bridge call` } };
		} catch (err) {
			return { ok: false, error: { code: 'bridge_unavailable', message: `the platform bridge did not answer: ${err.message}` } };
		}
	};
}

// ── one execution ────────────────────────────────────────────────────────────

async function execute(body, emit, signal) {
	const { job, workspace, limits, bridge } = body;
	if (!limits || typeof limits.wallSeconds !== 'number' || typeof limits.memoryMb !== 'number') {
		throw Object.assign(new Error('limits are required'), { status: 400, code: 'bad_request' });
	}
	if (!bridge?.url || !bridge?.token) throw Object.assign(new Error('bridge is required'), { status: 400, code: 'bad_request' });
	const src = sourceFor(job);
	const files = await workspaceFiles(workspace);

	await fs.mkdir(JOBS_DIR, { recursive: true });
	const root = await fs.mkdtemp(path.join(JOBS_DIR, `job-${randomUUID().slice(0, 8)}-`));
	const dirs = {
		workspace: path.join(root, 'workspace'),
		prog: path.join(root, 'prog'),
		tmp: path.join(root, 'tmp'),
		sock: path.join(root, 'sock'),
	};
	let server = null;
	try {
		for (const d of [...Object.values(dirs), path.join(root, 'node_modules')]) await fs.mkdir(d, { recursive: true });
		for (const f of files) normalizeWorkspacePath(f.path);
		await materialize(dirs.workspace, files);
		const programFile = path.join(dirs.prog, src.file);
		await fs.writeFile(programFile, src.text);
		await fs.symlink(path.join(CLIENTS_DIR, 'node', 'three_ws'), path.join(root, 'node_modules', 'three_ws'));
		await openForNobody(root, dirs, programFile);

		const before = await snapshot(dirs.workspace);
		const socketPath = path.join(dirs.sock, 'bridge.sock');
		server = await serveBridge(socketPath, forwardBridge(bridge));

		const language = job.kind === 'terminal' ? 'bash' : job.language;
		const argv = isolate(withLimits(programFor(job, { programPath: programFile, memoryMb: limits.memoryMb }), { limits, language }), isolation.mode);
		emit({ type: 'started', isolation: isolation.mode });
		const decoders = { stdout: new StringDecoder('utf8'), stderr: new StringDecoder('utf8') };
		const r = await runProcess({
			argv,
			cwd: dirs.workspace,
			env: programEnv({ workspace: dirs.workspace, socketPath, clientsDir: CLIENTS_DIR, tmpDir: dirs.tmp, cpu: limits.cpu }),
			limits,
			language,
			signal,
			hostLimits: false,
			onOutput: (stream, chunk) => {
				const text = decoders[stream].write(chunk);
				if (text) emit({ type: stream, data: text });
			},
		});

		const after = await snapshot(dirs.workspace);
		const diff = changed(before, after);
		const collected = await collectFiles(dirs.workspace, diff.modified.map((m) => m.path), { maxFileBytes: limits.fileBytes });
		emit({
			type: 'result',
			exitCode: r.exitCode,
			signal: r.signal,
			timedOut: r.timedOut,
			killed: r.killed,
			outputFlood: r.outputFlood,
			wallMs: r.wallMs,
			cpuMs: r.cpuMs,
			peakMemoryMb: r.peakMemoryMb,
			stdout: r.stdout,
			stderr: r.stderr,
			files: collected.files.map((f) => ({ path: f.path, data_base64: f.data.toString('base64') })),
			deleted: diff.deleted,
			skipped: collected.skipped,
			isolation: isolation.mode,
		});
	} finally {
		await server?.close();
		await fs.rm(root, { recursive: true, force: true }).catch(() => {});
	}
}

/** The program runs as uid 65534; give it the directories it writes and read access to the rest. */
async function openForNobody(root, dirs, programFile) {
	const walk = async (p) => {
		await fs.chmod(p, 0o777);
		for (const ent of await fs.readdir(p, { withFileTypes: true })) {
			const a = path.join(p, ent.name);
			if (ent.isDirectory()) await walk(a);
			else if (ent.isFile()) await fs.chmod(a, 0o666);
		}
	};
	for (const d of [dirs.workspace, dirs.tmp, dirs.sock]) await walk(d);
	await fs.chmod(root, 0o755);
	await fs.chmod(dirs.prog, 0o755);
	await fs.chmod(programFile, 0o644);
}

// ── http ─────────────────────────────────────────────────────────────────────

function sendJson(res, status, body) {
	res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
	res.end(JSON.stringify(body));
}

const server = http.createServer(async (req, res) => {
	const url = new URL(req.url, 'http://runner');
	if (req.method === 'GET' && (url.pathname === '/healthz' || url.pathname === '/')) {
		return sendJson(res, isolation.mode ? 200 : 503, { ok: Boolean(isolation.mode), isolation: isolation.mode, busy, tried: isolation.tried });
	}
	if (req.method !== 'POST' || url.pathname !== '/exec') return sendJson(res, 404, { error: 'not_found' });
	if (!tokenOk(req.headers['x-sandbox-token'])) return sendJson(res, 401, { error: 'unauthorized' });
	if (!isolation.mode) return sendJson(res, 503, { error: 'no_isolation', message: 'this runner cannot isolate a program and refuses to run one' });
	if (busy) return sendJson(res, 429, { error: 'busy' });
	busy = true;

	const ac = new AbortController();
	let finished = false;
	res.on('close', () => {
		if (!finished) ac.abort(new Error('the API closed the connection'));
	});
	try {
		const body = await readBody(req);
		// The stream starts with the first event, so a bad request still gets a real status code.
		const emit = (ev) => {
			if (!res.headersSent) res.writeHead(200, { 'content-type': 'application/x-ndjson', 'cache-control': 'no-store', 'x-accel-buffering': 'no' });
			res.write(`${JSON.stringify(ev)}\n`);
		};
		await execute(body, emit, ac.signal);
	} catch (err) {
		const ev = { type: 'error', status: err.status || 500, code: err.code || 'runner_error', message: String(err.message || err).slice(0, 500) };
		if (res.headersSent) res.write(`${JSON.stringify(ev)}\n`);
		else {
			finished = true;
			busy = false;
			return sendJson(res, ev.status, ev);
		}
	} finally {
		finished = true;
		busy = false;
		if (!res.writableEnded) res.end();
	}
});

server.requestTimeout = 0;
server.listen(Number(process.env.PORT) || 8080, () => console.log(`sandbox-runner listening, isolation=${isolation.mode}`));
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => server.close(() => process.exit(0)));
