// Main-thread handle on the mesh-ops worker.
//
// One worker per page, started on first use. If a browser refuses module
// workers (old WebViews, a blocked worker-src), the same runner is imported and
// run inline instead: slower to paint during the operation, never broken.

let worker = null;
let workerFailed = false;
let seq = 0;
const pending = new Map();

function startWorker() {
	if (worker || workerFailed) return worker;
	try {
		worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
		worker.addEventListener('message', (event) => {
			const msg = event.data || {};
			const job = pending.get(msg.id);
			if (!job) return;
			if (msg.phase) {
				job.onPhase?.(msg.phase);
				return;
			}
			pending.delete(msg.id);
			if (msg.ok) job.resolve(msg);
			else job.reject(new Error(msg.error || 'The mesh operation failed.'));
		});
		worker.addEventListener('error', (event) => {
			event.preventDefault?.();
			workerFailed = true;
			worker?.terminate();
			worker = null;
			for (const [id, job] of pending) {
				pending.delete(id);
				job.retryInline();
			}
		});
	} catch {
		workerFailed = true;
		worker = null;
	}
	return worker;
}

async function runInline(kind, bytes, op, params, onPhase) {
	const runner = await import('./runner.js');
	const input = new Uint8Array(bytes);
	if (kind === 'inspect') return runner.inspectGlb(input);
	const result = await runner.runMeshOp(input, op, params, onPhase);
	return { bytes: result.bytes, stats: result.stats, triangles: result.triangles };
}

function call(kind, bytes, op, params, onPhase) {
	const copy = bytes.slice(0);
	const w = startWorker();
	if (!w) return runInline(kind, copy, op, params, onPhase);
	return new Promise((resolve, reject) => {
		const id = ++seq;
		const retryInline = () => runInline(kind, bytes.slice(0), op, params, onPhase).then(resolve, reject);
		pending.set(id, { resolve, reject, onPhase, retryInline });
		w.postMessage({ id, kind, bytes: copy, op, params }, [copy]);
	});
}

/** Triangle count of a GLB ArrayBuffer. */
export async function inspect(bytes) {
	const result = await call('inspect', bytes);
	return { triangles: result.triangles };
}

/**
 * Run 'repair' | 'smooth' | 'decimate' on a GLB ArrayBuffer. Resolves to
 * `{ bytes: ArrayBuffer, stats, triangles }`; the input buffer is not consumed.
 */
export async function run(bytes, op, params, onPhase) {
	const result = await call('run', bytes, op, params, onPhase);
	const out = result.bytes instanceof ArrayBuffer ? result.bytes : result.bytes.buffer.slice(result.bytes.byteOffset, result.bytes.byteOffset + result.bytes.byteLength);
	return { bytes: out, stats: result.stats, triangles: result.triangles };
}
