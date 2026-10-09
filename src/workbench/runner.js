// Executes a validated Workbench workflow, node by node, against the real
// platform endpoints and the live viewport.
//
// The value flowing down the chain is either an image ({ url } or { prompt })
// or a mesh. A mesh is tracked as { url, loaded, dirty }: remote steps need a
// URL, in-browser steps need it in the viewport, and an in-browser edit marks
// it dirty so the next remote step checkpoints the edited bytes first.

import { NODE_TYPES, validate } from './workflows.js';
import { decimateScene, smoothScene } from './mesh-tools.js';
import { WorkbenchError, generateMesh, removeBackground, remesh, restyle, rig, uploadGlb } from './api.js';

const STATUS_TEXT = {
	queued: 'In line for a GPU',
	running: 'Running',
	processing: 'Running',
};

function generateBody(params, source) {
	const body = { path: 'image', tier: params.tier || 'standard' };
	if (params.backend && params.backend !== 'auto') body.backend = params.backend;
	if (source.url) body.image_urls = [source.url];
	else {
		body.prompt = source.prompt;
		body.aspect_ratio = '1:1';
	}
	if (params.resolution) body.resolution = Number(params.resolution);
	if (params.texture_size) body.texture_size = Number(params.texture_size);
	if (params.target_polycount !== '' && params.target_polycount != null) body.target_polycount = Number(params.target_polycount);
	if (params.output_format && params.output_format !== 'glb') body.output_format = params.output_format;
	if (params.seed !== '' && params.seed != null) body.seed = Number(params.seed);
	return body;
}

/**
 * @param {object} flow       workflow to run
 * @param {object} ctx
 * @param {object} ctx.viewport   mountViewport() handle
 * @param {{url?:string, prompt?:string}} ctx.source
 * @param {AbortSignal} ctx.signal
 * @param {(e:{nodeId:string,state:'active'|'done'|'error'|'skipped',text:string})=>void} ctx.onStep
 * @returns {Promise<{ glbUrl: string|null, backend: string|null, tier: string|null }>}
 */
export async function runWorkflow(flow, { viewport, source, signal, onStep }) {
	const { ok, order, errors } = validate(flow);
	if (!ok) throw new WorkbenchError(errors[0].message, { kind: 'invalid' });
	if (!source?.url && !source?.prompt) {
		throw new WorkbenchError('Drop an image into the Image node, or describe the object in its prompt box.', { kind: 'invalid' });
	}

	let image = { ...source };
	let mesh = null;
	let meta = { backend: null, tier: null };

	const step = (node, state, text) => onStep?.({ nodeId: node.id, state, text: text || NODE_TYPES[node.type].label });
	const progress = (node) => (s) => step(node, 'active', `${NODE_TYPES[node.type].label}: ${STATUS_TEXT[s.status] || s.status}`);

	async function ensureLoaded() {
		if (!mesh.loaded) {
			await viewport.loadGLB(mesh.url);
			mesh.loaded = true;
		}
	}

	async function ensureRemote(node) {
		if (mesh.url && !mesh.dirty) return mesh.url;
		step(node, 'active', `${NODE_TYPES[node.type].label}: saving the edited mesh`);
		mesh.url = await uploadGlb(await viewport.exportAs('glb'), { signal });
		mesh.dirty = false;
		return mesh.url;
	}

	for (const node of order) {
		if (signal?.aborted) throw new WorkbenchError('Cancelled.', { kind: 'cancelled' });
		const t = NODE_TYPES[node.type];
		if (!t.locked && node.enabled === false) {
			step(node, 'skipped', `${t.label}: off`);
			continue;
		}
		step(node, 'active');
		const p = node.params || {};
		switch (node.type) {
			case 'image':
				step(node, 'done', image.url ? 'Image ready' : 'Prompt ready');
				continue;
			case 'rembg': {
				if (!image.url) {
					step(node, 'skipped', 'Remove Background: skipped for a text prompt');
					continue;
				}
				const out = await removeBackground(image.url, p.model, { signal, onStatus: progress(node) });
				image = { url: out.result_url };
				break;
			}
			case 'generate': {
				const body = generateBody(p, image);
				let out;
				try {
					out = await generateMesh(body, { signal, onStatus: progress(node) });
				} catch (err) {
					// A pinned lane that failed retryably names the lanes that can still
					// serve this request; hop once instead of dead-ending.
					const next = err.retryBackends?.find((b) => b !== body.backend);
					if (!next) throw err;
					step(node, 'active', `Generate Mesh: ${body.backend || 'engine'} failed, retrying on ${next}`);
					out = await generateMesh({ ...body, backend: next }, { signal, onStatus: progress(node) });
				}
				mesh = { url: out.glb_url, loaded: false, dirty: false };
				meta = { backend: out.backend || body.backend || null, tier: out.tier || body.tier };
				break;
			}
			case 'restyle': {
				const url = await ensureRemote(node);
				const out = await restyle(url, String(p.instruction || '').trim() || 'brushed steel', { signal });
				mesh = { url: out.glbUrl, loaded: false, dirty: false };
				break;
			}
			case 'remesh': {
				const url = await ensureRemote(node);
				const faces = Math.min(500000, Math.max(1000, Math.round(Number(p.target_faces) || 20000)));
				const out = await remesh(url, { mode: p.mode, targetFaces: faces }, { signal, onStatus: progress(node) });
				mesh = { url: out.result_url, loaded: false, dirty: false };
				break;
			}
			case 'rig': {
				const url = await ensureRemote(node);
				const out = await rig(url, { signal, onStatus: progress(node) });
				mesh = { url: out.glb_url, loaded: false, dirty: false };
				break;
			}
			case 'decimate': {
				await ensureLoaded();
				const { before, after } = await viewport.mutate((m) => decimateScene(m, Number(p.ratio) || 0.5));
				mesh.dirty = true;
				step(node, 'done', `Decimate: ${before.tris.toLocaleString()} to ${after.tris.toLocaleString()} tris`);
				continue;
			}
			case 'smooth': {
				await ensureLoaded();
				await viewport.mutate((m) => smoothScene(m, Math.round(Number(p.iterations) || 4)));
				mesh.dirty = true;
				break;
			}
			case 'output':
				await ensureLoaded();
				// Checkpoint in-browser edits so the history entry and the share link
				// reopen exactly what is on screen. The model is already in the scene,
				// so a failed save costs only the link.
				if (mesh.dirty) {
					try {
						await ensureRemote(node);
					} catch (err) {
						if (err.kind === 'cancelled') throw err;
						step(node, 'done', 'Added to scene (not saved: the edited mesh could not be uploaded)');
						continue;
					}
				}
				break;
			default:
				throw new WorkbenchError(`Unknown node type ${node.type}.`);
		}
		step(node, 'done');
	}

	return { glbUrl: mesh && !mesh.dirty ? mesh.url : null, ...meta };
}
