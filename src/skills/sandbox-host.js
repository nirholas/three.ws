// Sandbox host — manages the shared Web Worker that executes skill handlers.
// One worker instance is shared across all skills in a session.

// ?worker&inline tells Vite to bundle and inline the worker, avoiding a
// separate chunk (required for the UMD lib build which can't code-split).
import SandboxWorkerCtor from './sandbox-worker.js?worker&inline';

/** @type {Worker | null} */
let _worker = null;

/** @type {Map<string, Promise<void>>} skillURI → install promise */
const _installPromises = new Map();

/** @type {Map<string, { resolve: Function, reject: Function }>} */
const _installCallbacks = new Map();

/** @type {Map<number, { resolve: Function, reject: Function, mainCtx: object }>} */
const _pending = new Map();

/** @type {Map<string, any>} handleId → non-serializable object (AnimationClip, GLTF, …) */
const _handles = new Map();

let _handleCounter = 0;
let _invocationCounter = 0;

// --- Handle registry ---

function _storeHandle(obj) {
	if (obj == null) return null;
	const id = `@h:${++_handleCounter}`;
	_handles.set(id, obj);
	return id;
}

function _resolveHandle(val) {
	if (typeof val === 'string' && val.startsWith('@h:')) return _handles.get(val) ?? val;
	return val;
}

function _resolveArgs(args) {
	if (!Array.isArray(args)) return args;
	return args.map(_resolveHandle);
}

// --- Worker lifecycle ---

function _getWorker() {
	if (!_worker) {
		_worker = new SandboxWorkerCtor();
		_worker.onmessage = _onMessage;
		_worker.onerror = _onError;
	}
	return _worker;
}

function _onError(err) {
	console.error('[sandbox] worker crashed:', err);
	_worker = null;
	_installPromises.clear();
	_installCallbacks.clear();
	_handles.clear();
	for (const [, p] of _pending) p.reject(new Error('Sandbox worker crashed'));
	_pending.clear();
}

function _onMessage({ data }) {
	switch (data.type) {
		case 'install-ack': {
			const cb = _installCallbacks.get(data.skillURI);
			_installCallbacks.delete(data.skillURI);
			if (data.ok) {
				cb?.resolve();
			} else {
				_installPromises.delete(data.skillURI);
				cb?.reject(new Error(data.error || 'Install failed'));
			}
			break;
		}

		case 'request': {
			// Worker is requesting a ctx method call from the main thread
			const { invocationId, requestId, method, args } = data;
			const inv = _pending.get(invocationId);
			if (!inv) {
				_worker?.postMessage({ type: 'response', requestId, error: 'No active invocation' });
				return;
			}
			_dispatchCtxRequest(method, args, inv.mainCtx).then(
				(result) => _worker?.postMessage({ type: 'response', requestId, result: result ?? null }),
				(err) =>
					_worker?.postMessage({
						type: 'response',
						requestId,
						error: err.message || String(err),
					}),
			);
			break;
		}

		case 'invoke-result': {
			const { invocationId, result, error } = data;
			const inv = _pending.get(invocationId);
			if (!inv) return;
			_pending.delete(invocationId);
			if (error !== undefined) inv.reject(new Error(error));
			else inv.resolve(result);
			break;
		}
	}
}

// --- ctx dispatch ---

async function _dispatchCtxRequest(method, rawArgs, mainCtx) {
	const args = _resolveArgs(rawArgs);

	switch (method) {
		// viewer
		case 'viewer.play':
			return mainCtx.viewer?.play?.(args[0], args[1]);
		case 'viewer.stop':
			return mainCtx.viewer?.stop?.(args[0]);
		case 'viewer.setExpression':
			return mainCtx.viewer?.setExpression?.(args[0], args[1]);
		case 'viewer.lookAt':
			return mainCtx.viewer?.lookAt?.(args[0]);
		case 'viewer.moveTo':
			return mainCtx.viewer?.moveTo?.(args[0], args[1]);
		case 'viewer.playAnimationByHint':
			return mainCtx.viewer?.playAnimationByHint?.(args[0], args[1]);
		case 'viewer.playClipByName':
			return mainCtx.viewer?.playClipByName?.(args[0], args[1]);

		// memory
		case 'memory.read':
			return mainCtx.memory?.read?.(args[0]);
		case 'memory.write':
			return mainCtx.memory?.write?.(args[0], args[1]);
		case 'memory.note':
			return mainCtx.memory?.note?.(args[0], args[1]);
		case 'memory.recall':
			return mainCtx.memory?.recall?.(args[0]);

		// llm
		case 'llm.complete':
			return mainCtx.llm?.complete?.(args[0], args[1]);
		case 'llm.embed':
			return mainCtx.llm?.embed?.(args[0]);

		// asset loading — results stored as handles because they're non-serializable
		case 'loadClip': {
			const clip = await mainCtx.loadClip?.(args[0]);
			return _storeHandle(clip);
		}
		case 'loadGLB': {
			const gltf = await mainCtx.loadGLB?.(args[0]);
			return _storeHandle(gltf);
		}

		// speech
		case 'speak':
			return mainCtx.speak?.(args[0]);
		case 'listen':
			return mainCtx.listen?.(args[0]);

		// cross-skill call
		case 'call':
			return mainCtx.call?.(args[0], args[1]);

		default:
			throw new Error(`Unknown ctx method: ${method}`);
	}
}

// --- Public API ---

async function _ensureInstalled(skillURI, handlersSrc) {
	if (_installPromises.has(skillURI)) return _installPromises.get(skillURI);

	const promise = new Promise((resolve, reject) => {
		_installCallbacks.set(skillURI, { resolve, reject });
	});
	_installPromises.set(skillURI, promise);
	_getWorker().postMessage({ type: 'install', skillURI, handlersSrc });
	return promise;
}

async function _invoke(skillURI, toolName, args, handlersSrc, mainCtx) {
	await _ensureInstalled(skillURI, handlersSrc);

	const id = ++_invocationCounter;
	const worker = _getWorker();

	return new Promise((resolve, reject) => {
		_pending.set(id, { resolve, reject, mainCtx });
		worker.postMessage({
			type: 'invoke',
			invocationId: id,
			skillURI,
			toolName,
			args,
			skillBaseURI: mainCtx.skillBaseURI || skillURI,
		});
	});
}

function _terminate() {
	if (!_worker) return;
	_worker.terminate();
	_worker = null;
	_installPromises.clear();
	_installCallbacks.clear();
	_handles.clear();
	for (const [, p] of _pending) p.reject(new Error('Sandbox terminated'));
	_pending.clear();
}

/**
 * Returns the singleton sandbox host.
 * All skills in a session share one worker for efficient resource use.
 */
export function getHost() {
	return { invoke: _invoke, terminate: _terminate };
}
