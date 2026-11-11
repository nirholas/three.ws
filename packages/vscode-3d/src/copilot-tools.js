// The three.ws tools GitHub Copilot's agent mode can call on its own.
//
// Each spec is the contract package.json declares under
// contributes.languageModelTools (the test suite checks the two match), plus the
// code that runs it. Specs never import vscode: the extension hands each run a
// small `deps` object (the origin, workspace file access, a model saver), so the
// same code is invoked by the editor and by the tests against the live studio.
//
// Results are plain text written for a model to reason over: what happened, the
// URLs and paths it can use next, and the exact next tool call when there is one.

import { callToolOnce, describeStatus, readToolResult, rpc, toolCall } from './studio.js';
import { CATALOG_KINDS, searchCatalog } from './catalog.js';
import { reportFor } from './inspect.js';
import { PRESETS, describeSavings, optimizeGlb } from './optimize.js';

const TIERS = ['draft', 'standard', 'high'];

/**
 * @typedef {object} ToolDeps
 * @property {() => string} origin
 * @property {(glbUrl: string, prompt: string|null, signal?: AbortSignal) => Promise<{ path: string }>} saveModel
 *   download a hosted model into the workspace download folder; returns its workspace-relative path
 * @property {(path: string) => Promise<{ path: string, bytes: Uint8Array }>} readModel
 *   read a workspace model by relative or absolute path; throws when it is outside the workspace
 * @property {(nextToPath: string, stem: string, bytes: Uint8Array) => Promise<{ path: string }>} writeSibling
 *   write a new file next to an existing model under a free name
 * @property {boolean} hasWorkspace
 */

/** @typedef {{ name: string, displayName: string, toolReferenceName: string, icon: string, userDescription: string, modelDescription: string, tags: string[], inputSchema: object, confirm: (input: any, deps: ToolDeps) => ({ title: string, message: string }|null), progress: (input: any) => string, run: (input: any, deps: ToolDeps, signal?: AbortSignal) => Promise<string> }} ToolSpec */

/** @type {ToolSpec[]} */
export const TOOL_SPECS = [
	{
		name: 'threews_generate_model',
		displayName: 'three.ws: Generate 3D Model',
		toolReferenceName: 'threewsGenerate',
		icon: '$(sparkle)',
		tags: ['3d', 'glb', 'threews'],
		userDescription: 'Generate a textured 3D model (GLB) from a description on the free three.ws lane.',
		modelDescription:
			'Generate a textured, downloadable 3D model (GLB) from a text description using the free three.ws text to 3D lane (no key, no account). ' +
			'Describe ONE object, character or creature: lead with the subject, then materials and colours. ' +
			'Search for a ready-made asset with threews_find_asset first when a common object would do. ' +
			'Returns the GLB URL, a browser viewer URL and, when saveToWorkspace is true, the workspace path it was saved to. ' +
			'A render that takes longer than about 40 seconds returns status "pending" with a jobId: call threews_check_job with it to collect the model.',
		inputSchema: {
			type: 'object',
			properties: {
				prompt: { type: 'string', minLength: 3, maxLength: 1000, description: 'The single subject to model, e.g. "a low-poly brass lantern with amber glass".' },
				tier: { type: 'string', enum: TIERS, description: 'Detail level: draft (fastest, default), standard, or high (slowest).' },
				saveToWorkspace: { type: 'boolean', description: 'Download the finished GLB into the workspace models folder. Default true when a folder is open.' },
			},
			required: ['prompt'],
		},
		confirm: (input, deps) => ({
			title: 'Generate a 3D model on three.ws?',
			message:
				`Sends "${clip(input?.prompt, 120)}" to the free three.ws text to 3D lane (${input?.tier || 'draft'} tier). ` +
				'This uses your share of the free generation quota' +
				(wantsSave(input, deps) ? ' and saves the GLB into the workspace models folder.' : '.'),
		}),
		progress: (input) => `Generating "${clip(input?.prompt, 60)}" on three.ws`,
		async run(input, deps, signal) {
			const prompt = String(input?.prompt || '').trim();
			if (prompt.length < 3) throw new Error('prompt must describe the subject in at least 3 characters');
			const tier = TIERS.includes(input?.tier) ? input.tier : 'draft';
			const result = await callToolOnce(deps.origin(), 'forge_free', { prompt, tier }, { signal });
			return finishModel(result, { prompt, save: wantsSave(input, deps), deps, signal });
		},
	},
	{
		name: 'threews_check_job',
		displayName: 'three.ws: Check Generation Job',
		toolReferenceName: 'threewsCheckJob',
		icon: '$(sync)',
		tags: ['3d', 'threews'],
		userDescription: 'Collect a three.ws generation that was still rendering.',
		modelDescription:
			'Check on a three.ws 3D generation that returned status "pending" and collect the finished model. Pass the jobId the generation returned. ' +
			'While it is still rendering this returns the stage and the live ETA: wait about that long, then call again. Checking does not use generation quota.',
		inputSchema: {
			type: 'object',
			properties: {
				jobId: { type: 'string', minLength: 8, maxLength: 4096, description: 'The jobId a pending threews_generate_model result returned.' },
				prompt: { type: 'string', maxLength: 1000, description: 'The prompt the job was started with, used to name the saved file.' },
				saveToWorkspace: { type: 'boolean', description: 'Download the finished GLB into the workspace models folder. Default true when a folder is open.' },
			},
			required: ['jobId'],
		},
		confirm: (input, deps) =>
			wantsSave(input, deps)
				? { title: 'Save the finished model into the workspace?', message: 'When the three.ws job has finished, its GLB is downloaded into the workspace models folder.' }
				: null,
		progress: () => 'Checking the three.ws job',
		async run(input, deps, signal) {
			const jobId = String(input?.jobId || '').trim();
			if (jobId.length < 8) throw new Error('jobId is required: pass the jobId a pending generation returned');
			const payload = await rpc(deps.origin(), toolCall('check_job', { job_id: jobId }), { signal, timeoutMs: 90_000 });
			const structured = payload.result?.structuredContent;
			if (payload.result?.isError && structured?.retryable) {
				const wait = Number(structured.retry_after) || 10;
				return `status: pending\njobId: ${jobId}\nThe job is still running; only this check failed. Call threews_check_job again in about ${wait}s.`;
			}
			const result = readToolResult(payload.result);
			const prompt = typeof input?.prompt === 'string' ? input.prompt.trim() : null;
			return finishModel(result, { prompt, save: wantsSave(input, deps), deps, signal });
		},
	},
	{
		name: 'threews_find_asset',
		displayName: 'three.ws: Find 3D Asset',
		toolReferenceName: 'threewsFind',
		icon: '$(search)',
		tags: ['3d', 'glb', 'threews', 'search'],
		userDescription: 'Search the free three.ws catalog of ready-made 3D models, characters and motions.',
		modelDescription:
			'Search every ready-made asset three.ws publishes: CC0 3D props and objects, rigged humanoid characters and retargetable motion clips. Free, read only. ' +
			'Use this before generating a common object. Every word of the query must match, so start broad ("chair", not "comfortable red velvet chair"). ' +
			'Returns each item with its id, title, license, GLB URL and viewer URL.',
		inputSchema: {
			type: 'object',
			properties: {
				query: { type: 'string', minLength: 1, maxLength: 200, description: 'Words to match against titles, tags and categories, e.g. "lantern" or "wooden chair".' },
				kind: { type: 'string', enum: CATALOG_KINDS, description: 'Narrow to object (props), character (rigged humanoids) or animation (motion clips).' },
				limit: { type: 'integer', minimum: 1, maximum: 20, description: 'How many items to return (default 8).' },
			},
			required: ['query'],
		},
		confirm: () => null,
		progress: (input) => `Searching the three.ws catalog for "${clip(input?.query, 40)}"`,
		async run(input, deps, signal) {
			const query = String(input?.query || '').trim();
			if (!query) throw new Error('query is required');
			const found = await searchCatalog(deps.origin(), { query, kind: input?.kind, limit: input?.limit ?? 8 }, { signal });
			if (!found.items.length) {
				return `No catalog items match "${query}"${found.total ? ` (the catalog holds ${found.total} items)` : ''}. Try a broader word, or generate it with threews_generate_model.`;
			}
			const lines = found.items.map(
				(item) =>
					`- ${item.title} (id ${item.id}, ${item.kind}, ${item.license || 'license unknown'})` +
					(item.glbUrl ? `\n  glb_url: ${item.glbUrl}` : '') +
					(item.viewerUrl ? `\n  viewer_url: ${item.viewerUrl}` : ''),
			);
			return `${found.matched} match${found.matched === 1 ? '' : 'es'} for "${query}"${found.relaxed ? ' (relaxed: not every word matched)' : ''}, showing ${found.items.length}:\n${lines.join('\n')}`;
		},
	},
	{
		name: 'threews_inspect_glb',
		displayName: 'three.ws: Inspect GLB',
		toolReferenceName: 'threewsInspect',
		icon: '$(info)',
		tags: ['3d', 'glb', 'threews'],
		userDescription: 'Report triangles, materials, textures, animations and web-readiness of a GLB in the workspace.',
		modelDescription:
			'Inspect a .glb or .gltf file in the workspace, entirely locally (the file is never uploaded): file size, triangles, vertices, meshes, materials, textures, animations, skeleton and extensions, plus concrete optimization suggestions. Read only.',
		inputSchema: {
			type: 'object',
			properties: {
				path: { type: 'string', minLength: 1, description: 'Workspace-relative (or absolute) path of the .glb or .gltf file, e.g. "models/lantern.glb".' },
			},
			required: ['path'],
		},
		confirm: () => null,
		progress: (input) => `Inspecting ${clip(input?.path, 60)}`,
		async run(input, deps) {
			const { path, bytes } = await deps.readModel(String(input?.path || ''));
			const { rows, suggestions } = await reportFor(bytes);
			const table = rows.map(([label, value]) => `${label}: ${value}`).join('\n');
			const real = suggestions.filter((s) => s.id !== 'ok');
			const tips = real.length
				? `\nSuggestions:\n${real.map((s) => `- [${s.severity}] ${s.message}${s.estimate ? ` (${s.estimate})` : ''}`).join('\n')}`
				: '\nNo optimization suggestions: the model is already in good shape for the web.';
			return `${path}\n${table}${tips}`;
		},
	},
	{
		name: 'threews_optimize_glb',
		displayName: 'three.ws: Optimize GLB for the Web',
		toolReferenceName: 'threewsOptimize',
		icon: '$(zap)',
		tags: ['3d', 'glb', 'threews'],
		userDescription: 'Write a web-optimized copy of a GLB next to the original.',
		modelDescription:
			'Optimize a .glb or .gltf in the workspace for the web, locally: dedup, prune, weld, resample animations and meshopt compression ("balanced"), plus vertex quantization ("compact"). ' +
			'Writes a NEW file next to the original (<name>.web.glb); the original is never modified. Returns the new path and the size and vertex savings.',
		inputSchema: {
			type: 'object',
			properties: {
				path: { type: 'string', minLength: 1, description: 'Workspace-relative (or absolute) path of the .glb or .gltf file to optimize.' },
				preset: { type: 'string', enum: Object.keys(PRESETS), description: 'balanced (default, full precision) or compact (smallest, tiny precision loss).' },
			},
			required: ['path'],
		},
		confirm: (input) => ({
			title: 'Write an optimized copy of this model?',
			message: `Optimizes ${clip(input?.path, 80)} with the ${presetOf(input)} preset and writes the result as a new .web.glb file next to it. The original is not changed.`,
		}),
		progress: (input) => `Optimizing ${clip(input?.path, 60)}`,
		async run(input, deps) {
			const { path, bytes } = await deps.readModel(String(input?.path || ''));
			const result = await optimizeGlb(bytes, { preset: presetOf(input) });
			const stem = (path.split('/').pop() || 'model').replace(/\.(glb|gltf)$/i, '');
			const written = await deps.writeSibling(path, `${stem}.web`, result.bytes);
			return `Wrote ${written.path} (${presetOf(input)} preset): ${describeSavings(result.before, result.after)}. The original ${path} is unchanged.`;
		},
	},
];

export function specByName(name) {
	return TOOL_SPECS.find((spec) => spec.name === name) || null;
}

/** The package.json contribution entry for a spec. */
export function contributionOf(spec) {
	return {
		name: spec.name,
		displayName: spec.displayName,
		toolReferenceName: spec.toolReferenceName,
		canBeReferencedInPrompt: true,
		icon: spec.icon,
		userDescription: spec.userDescription,
		modelDescription: spec.modelDescription,
		tags: spec.tags,
		inputSchema: spec.inputSchema,
	};
}

/** Turn a model or a pending handle into the text the model reads, saving when asked. */
async function finishModel(result, { prompt, save, deps, signal }) {
	if (result.pending) {
		return [
			'status: pending',
			`jobId: ${result.jobId}`,
			`The model is ${describeStatus(result)}.`,
			result.watchUrl ? `watch_url: ${result.watchUrl} (opens the model by itself when it lands)` : '',
			`Call threews_check_job with this jobId${result.etaSeconds ? ` in about ${result.etaSeconds}s` : ' shortly'} to collect it.`,
		]
			.filter(Boolean)
			.join('\n');
	}
	const lines = ['status: done', `glb_url: ${result.glbUrl}`];
	if (result.viewerUrl) lines.push(`viewer_url: ${result.viewerUrl}`);
	if (save) {
		const saved = await deps.saveModel(result.glbUrl, prompt || result.prompt || null, signal);
		lines.push(`saved_to: ${saved.path}`);
	}
	lines.push('Next: threews_inspect_glb on the saved path reports its geometry; the @threews chat participant can rig or embed it.');
	return lines.join('\n');
}

function wantsSave(input, deps) {
	if (!deps?.hasWorkspace) return false;
	return input?.saveToWorkspace !== false;
}

function presetOf(input) {
	return Object.hasOwn(PRESETS, input?.preset) ? input.preset : 'balanced';
}

function clip(value, n) {
	const s = String(value ?? '').trim();
	return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}
