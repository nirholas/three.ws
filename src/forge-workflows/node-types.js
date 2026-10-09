// Forge Workflows: the node registry.
//
// Each entry describes one kind of node: its ports, its params (which drive the
// inspector form), which inputs a run needs, and node-specific preflight checks.
// The registry is pure data plus small pure functions, so graph.js and the tests
// can use it without a browser. The network side of each node lives in
// executors.js under the same key.
//
// Param fields:
//   id, label, kind ('text' | 'textarea' | 'select' | 'number' | 'images' | 'mesh-url'),
//   default, options ([{ value, label }] or a function of ctx for live catalogs),
//   min / max / step (number), hint (one line under the field),
//   showIf(params) (hide the field when false), transient (never exported),
//   signatureExclude (editing it does not invalidate a cached result).

/** Engines the workflow can drive, read from the live /api/forge catalog. */
export function engineOptions(ctx, mode) {
	const options = [{ value: 'auto', label: 'Auto (best free engine)' }];
	for (const b of ctx?.catalog?.backends || []) {
		if (!Array.isArray(b.paths) || !b.paths.includes('image')) continue;
		if (mode === 'image' && !b.user_images) continue;
		if (!b.configured || b.byok) continue;
		const health = ctx?.health?.[b.id]?.status;
		const suffix = health === 'down' ? ' (down right now)' : health === 'degraded' ? ' (degraded)' : b.free ? ' (free)' : '';
		options.push({ value: b.id, label: `${b.label.replace(/\s*\(free\)\s*$/i, '')}${suffix}` });
	}
	if (mode === 'image') options.push({ value: 'modly', label: 'Your GPU (Modly)' });
	return options;
}

const TIER_OPTIONS = [
	{ value: 'draft', label: 'Draft (fastest)' },
	{ value: 'standard', label: 'Standard' },
	{ value: 'high', label: 'High ($THREE holders)' },
];

const IMAGE_URL_RE = /^https:\/\/[^\s]+$/i;

export function promptLines(text) {
	return String(text || '')
		.split(/\r?\n/)
		.map((s) => s.trim())
		.filter(Boolean)
		.slice(0, 50);
}

function imageList(value) {
	return (Array.isArray(value) ? value : []).filter((i) => i && typeof i.url === 'string' && IMAGE_URL_RE.test(i.url));
}

export const NODE_TYPES = {
	image: {
		label: 'Image',
		category: 'input',
		blurb: 'A photo to turn into 3D. Uploaded once to three.ws storage, so the workflow file stays portable.',
		inputs: [],
		outputs: [{ id: 'image', type: 'image', label: 'Image' }],
		params: [{ id: 'images', label: 'Photo', kind: 'images', max: 1, default: [], hint: 'PNG, JPEG or WebP up to 8 MB.' }],
		validate(node) {
			return imageList(node.params.images).length ? [] : ['upload a photo.'];
		},
		summary(params) {
			return imageList(params.images)[0]?.name || 'No photo yet';
		},
	},

	prompt: {
		label: 'Text prompt',
		category: 'input',
		blurb: 'Describe the object. Generate turns it into a reference image, then a 3D model.',
		inputs: [],
		outputs: [{ id: 'text', type: 'text', label: 'Text' }],
		params: [{ id: 'text', label: 'Prompt', kind: 'textarea', default: '', maxLength: 1000, hint: 'One clear object works best, e.g. "a weathered brass lantern".' }],
		validate(node) {
			const t = String(node.params.text || '').trim();
			if (!t) return ['write a prompt.'];
			if (t.length > 1000) return ['keep the prompt under 1000 characters.'];
			return [];
		},
		summary(params) {
			return String(params.text || '').trim() || 'Empty prompt';
		},
	},

	loadMesh: {
		label: 'Load 3D',
		category: 'input',
		blurb: 'Start from an existing GLB: paste a public https link or upload a file.',
		inputs: [],
		outputs: [{ id: 'mesh', type: 'mesh', label: 'Model' }],
		params: [
			{ id: 'url', label: 'GLB', kind: 'mesh-url', default: '', hint: 'A public https link to a .glb, or upload one (up to 200 MB).' },
			{ id: 'name', label: 'Name', kind: 'text', default: '', signatureExclude: true },
		],
		validate(node) {
			const url = String(node.params.url || '').trim();
			if (!url) return ['add a GLB link or upload a file.'];
			if (!/^https:\/\//i.test(url)) return ['the GLB link must start with https://.'];
			return [];
		},
		summary(params) {
			return params.name || (params.url ? String(params.url).split('/').pop().slice(0, 40) : 'No model yet');
		},
	},

	forEach: {
		label: 'For Each',
		category: 'input',
		iterator: true,
		blurb: 'Runs everything connected after it once per item, in order. A failed item does not stop the rest.',
		inputs: [],
		outputs(params) {
			return params.mode === 'text' ? [{ id: 'item', type: 'text', label: 'Prompt' }] : [{ id: 'item', type: 'image', label: 'Image' }];
		},
		params: [
			{
				id: 'mode',
				label: 'Repeat over',
				kind: 'select',
				default: 'image',
				options: [
					{ value: 'image', label: 'A batch of photos' },
					{ value: 'text', label: 'A list of prompts' },
				],
			},
			{ id: 'images', label: 'Photos', kind: 'images', max: 12, default: [], showIf: (p) => p.mode !== 'text', hint: 'Up to 12 photos, each processed separately.' },
			{ id: 'prompts', label: 'Prompts', kind: 'textarea', default: '', showIf: (p) => p.mode === 'text', hint: 'One prompt per line, up to 50.' },
		],
		items(params) {
			return params.mode === 'text' ? promptLines(params.prompts) : imageList(params.images);
		},
		validate(node) {
			const count = NODE_TYPES.forEach.items(node.params).length;
			if (!count) return [node.params.mode === 'text' ? 'add at least one prompt (one per line).' : 'upload at least one photo.'];
			return [];
		},
		summary(params) {
			const n = NODE_TYPES.forEach.items(params).length;
			return params.mode === 'text' ? `${n} prompt${n === 1 ? '' : 's'}` : `${n} photo${n === 1 ? '' : 's'}`;
		},
	},

	generate: {
		label: 'Generate 3D',
		category: 'generate',
		blurb: 'Turns a prompt or a photo into a textured 3D model on three.ws engines, or on your own GPU through Modly.',
		inputs(params) {
			return params.mode === 'image'
				? [
						{ id: 'image', type: 'image', label: 'Image' },
						{ id: 'prompt', type: 'text', label: 'Hint', optional: true },
					]
				: [{ id: 'prompt', type: 'text', label: 'Prompt' }];
		},
		outputs: [{ id: 'mesh', type: 'mesh', label: 'Model' }],
		params: [
			{
				id: 'mode',
				label: 'From',
				kind: 'select',
				default: 'text',
				options: [
					{ value: 'text', label: 'Text prompt' },
					{ value: 'image', label: 'Photo' },
				],
			},
			{ id: 'engine', label: 'Engine', kind: 'select', default: 'auto', options: (ctx, params) => engineOptions(ctx, params.mode) },
			{ id: 'tier', label: 'Quality', kind: 'select', default: 'draft', options: TIER_OPTIONS, showIf: (p) => p.engine !== 'modly' },
			{
				id: 'modlyModel',
				label: 'Modly model',
				kind: 'select',
				default: '',
				options: (ctx) =>
					(ctx?.modly?.models || []).map((m) => ({ value: m.id, label: `${m.name}${m.downloaded ? '' : ' (not downloaded)'}` })),
				showIf: (p) => p.engine === 'modly',
				hint: 'Runs on your machine. Connect Modly in the inspector to list your models.',
			},
		],
		validate(node, ctx = {}) {
			const p = node.params;
			const out = [];
			if (p.engine === 'modly') {
				if (p.mode !== 'image') out.push('Your GPU (Modly) turns photos into 3D. Switch From to Photo, or pick a cloud engine.');
				if (!ctx.modly) out.push('connect Modly first (select this node, then Connect in the inspector).');
				else if (!p.modlyModel) out.push('pick a Modly model.');
				else {
					const model = ctx.modly.models?.find((m) => m.id === p.modlyModel);
					if (!model) out.push(`Modly does not have "${p.modlyModel}" installed.`);
					else if (!model.downloaded) out.push(`download ${model.name} in Modly first.`);
				}
				return out;
			}
			if (p.engine !== 'auto' && ctx.catalog) {
				const b = ctx.catalog.backends?.find((x) => x.id === p.engine);
				if (!b) out.push(`the engine "${p.engine}" is not available. Pick another engine.`);
				else if (b.byok) out.push(`${b.label} needs your own API key. Use /forge for key-based engines, or pick a free engine here.`);
				else if (!b.configured) out.push(`${b.label} is not enabled on three.ws right now. Pick another engine.`);
				else if (p.mode === 'image' && !b.user_images) out.push(`${b.label} only takes text prompts. Pick another engine for photos.`);
				else if (ctx.health?.[b.id]?.status === 'down') out.push({ level: 'warning', message: `${b.label} is reporting down; the run may fail. Auto picks a healthy engine.` });
			}
			if (p.tier === 'high') out.push({ level: 'warning', message: 'High quality is a $THREE holder perk. Non-holders get a clear prompt to hold or pay when it runs.' });
			return out;
		},
		summary(params, ctx) {
			const engine = engineOptions(ctx, params.mode).find((o) => o.value === params.engine)?.label || params.engine;
			return params.engine === 'modly' ? `Modly${params.modlyModel ? ` · ${params.modlyModel}` : ''}` : `${engine} · ${params.tier}`;
		},
	},

	remesh: {
		label: 'Remesh',
		category: 'process',
		blurb: 'Rebuilds the topology: clean triangles, quads, or a low-poly look, at a face budget.',
		inputs: [{ id: 'mesh', type: 'mesh', label: 'Model' }],
		outputs: [{ id: 'mesh', type: 'mesh', label: 'Model' }],
		params: [
			{
				id: 'mode',
				label: 'Topology',
				kind: 'select',
				default: 'triangle',
				options: [
					{ value: 'triangle', label: 'Triangles' },
					{ value: 'quad', label: 'Quads' },
					{ value: 'lowpoly', label: 'Low-poly' },
				],
			},
			{
				id: 'operation',
				label: 'Operation',
				kind: 'select',
				default: 'full',
				showIf: (p) => p.mode === 'triangle',
				options: [
					{ value: 'full', label: 'Repair and simplify' },
					{ value: 'simplify', label: 'Simplify only' },
					{ value: 'repair', label: 'Repair only' },
					{ value: 'convert', label: 'Convert only' },
				],
			},
			{ id: 'targetFaces', label: 'Target faces', kind: 'number', default: 50000, min: 1000, max: 500000, step: 1000 },
			{
				id: 'textureSize',
				label: 'Texture',
				kind: 'select',
				default: 1024,
				options: [
					{ value: 512, label: '512 px' },
					{ value: 1024, label: '1024 px' },
					{ value: 2048, label: '2048 px' },
				],
			},
		],
		summary(params) {
			return `${params.mode} · ${Number(params.targetFaces).toLocaleString('en-US')} faces`;
		},
	},

	rig: {
		label: 'Auto-rig',
		category: 'process',
		blurb: 'Adds a humanoid skeleton so the model can be animated. Works best on a character standing upright.',
		inputs: [{ id: 'mesh', type: 'mesh', label: 'Model' }],
		outputs: [{ id: 'mesh', type: 'mesh', label: 'Rigged model' }],
		params: [],
		summary() {
			return 'Humanoid skeleton';
		},
	},

	segment: {
		label: 'Segment',
		category: 'process',
		blurb: 'Splits the model into separate named parts you can recolor or animate one by one.',
		inputs: [{ id: 'mesh', type: 'mesh', label: 'Model' }],
		outputs: [{ id: 'mesh', type: 'mesh', label: 'Parts' }],
		params: [
			{
				id: 'method',
				label: 'Method',
				kind: 'select',
				default: 'auto',
				options: [
					{ value: 'auto', label: 'Auto' },
					{ value: 'connected', label: 'Connected pieces' },
					{ value: 'crease', label: 'Sharp creases' },
				],
			},
			{ id: 'maxParts', label: 'Max parts', kind: 'number', default: 24, min: 2, max: 64, step: 1 },
		],
		summary(params) {
			return `${params.method} · up to ${params.maxParts} parts`;
		},
	},

	stylize: {
		label: 'Stylize',
		category: 'process',
		blurb: 'Rebuilds the model in a new style: voxels, bricks, Voronoi cells or low-poly facets.',
		inputs: [{ id: 'mesh', type: 'mesh', label: 'Model' }],
		outputs: [{ id: 'mesh', type: 'mesh', label: 'Model' }],
		params: [
			{
				id: 'style',
				label: 'Style',
				kind: 'select',
				default: 'voxel',
				options: [
					{ value: 'voxel', label: 'Voxel' },
					{ value: 'brick', label: 'Brick' },
					{ value: 'voronoi', label: 'Voronoi' },
					{ value: 'lowpoly', label: 'Low-poly' },
				],
			},
		],
		summary(params) {
			return params.style;
		},
	},

	gameready: {
		label: 'Game-ready',
		category: 'process',
		blurb: 'Retopologizes to a poly budget and bakes PBR textures, with GLB and FBX ready for Unity or Unreal. A $THREE holder tool.',
		inputs: [{ id: 'mesh', type: 'mesh', label: 'Model' }],
		outputs: [{ id: 'mesh', type: 'mesh', label: 'Model' }],
		params: [
			{
				id: 'topology',
				label: 'Topology',
				kind: 'select',
				default: 'quad',
				options: [
					{ value: 'quad', label: 'Quads' },
					{ value: 'tri', label: 'Triangles' },
				],
			},
			{
				id: 'polyBudget',
				label: 'Poly budget',
				kind: 'select',
				default: 15000,
				options: [
					{ value: 5000, label: '5,000 (mobile)' },
					{ value: 15000, label: '15,000 (default)' },
					{ value: 50000, label: '50,000 (hero asset)' },
				],
			},
			{
				id: 'textureSize',
				label: 'Texture',
				kind: 'select',
				default: 1024,
				options: [
					{ value: 1024, label: '1024 px' },
					{ value: 2048, label: '2048 px' },
				],
			},
		],
		summary(params) {
			return `${params.topology} · ${Number(params.polyBudget).toLocaleString('en-US')} polys`;
		},
	},

	preview: {
		label: 'Preview',
		category: 'output',
		blurb: 'Shows the model in an interactive 3D viewer right on the node.',
		inputs: [{ id: 'mesh', type: 'mesh', label: 'Model' }],
		outputs: [],
		params: [],
		summary() {
			return 'Interactive viewer';
		},
	},

	export: {
		label: 'Export',
		category: 'output',
		blurb: 'Downloads the model as GLB, or converts it to STL, OBJ or PLY in your browser.',
		inputs: [{ id: 'mesh', type: 'mesh', label: 'Model' }],
		outputs: [],
		params: [
			{
				id: 'format',
				label: 'Format',
				kind: 'select',
				default: 'glb',
				options: [
					{ value: 'glb', label: 'GLB (textured)' },
					{ value: 'fbx', label: 'FBX (from Game-ready)' },
					{ value: 'stl', label: 'STL (3D printing)' },
					{ value: 'obj', label: 'OBJ' },
					{ value: 'ply', label: 'PLY' },
				],
			},
			{ id: 'filename', label: 'File name', kind: 'text', default: 'forge-model', signatureExclude: true },
			{ id: 'autoDownload', label: 'Download automatically when done', kind: 'checkbox', default: true, signatureExclude: true },
		],
		validate(node) {
			const name = String(node.params.filename || '').trim();
			if (!name) return ['give the file a name.'];
			if (/[\\/:*?"<>|]/.test(name)) return ['the file name cannot contain \\ / : * ? " < > |.'];
			return [];
		},
		summary(params) {
			return `${params.filename || 'model'}.${params.format}`;
		},
	},

	save: {
		label: 'Save',
		category: 'output',
		blurb: 'Keeps the model on three.ws: in your avatar library (signed in) or in the public creations gallery.',
		inputs: [{ id: 'mesh', type: 'mesh', label: 'Model' }],
		outputs: [],
		params: [
			{
				id: 'destination',
				label: 'Save to',
				kind: 'select',
				default: 'library',
				options: [
					{ value: 'library', label: 'My library (sign in)' },
					{ value: 'gallery', label: 'Public creations gallery' },
				],
			},
			{ id: 'name', label: 'Name', kind: 'text', default: 'Forge workflow model', maxLength: 80 },
			{
				id: 'visibility',
				label: 'Visibility',
				kind: 'select',
				default: 'unlisted',
				showIf: (p) => p.destination === 'library',
				options: [
					{ value: 'private', label: 'Private' },
					{ value: 'unlisted', label: 'Unlisted (link only)' },
					{ value: 'public', label: 'Public' },
				],
			},
		],
		validate(node, ctx = {}) {
			const name = String(node.params.name || '').trim();
			if (!name) return ['give the model a name.'];
			if (name.length > 80) return ['keep the name under 80 characters.'];
			if (node.params.destination === 'library' && ctx.signedIn === false) {
				return [{ level: 'warning', message: 'you are signed out, so saving to your library will ask you to sign in.' }];
			}
			return [];
		},
		summary(params) {
			return params.destination === 'gallery' ? 'Public gallery' : `Library · ${params.visibility}`;
		},
	},
};

/** Palette groups in display order. */
export const PALETTE = [
	{ id: 'input', label: 'Inputs', types: ['prompt', 'image', 'loadMesh', 'forEach'] },
	{ id: 'generate', label: 'Generate', types: ['generate'] },
	{ id: 'process', label: 'Process', types: ['remesh', 'rig', 'segment', 'stylize', 'gameready'] },
	{ id: 'output', label: 'Outputs', types: ['preview', 'export', 'save'] },
];

/** Resolve a param's options (static list or a function of the live context). */
export function paramOptions(param, ctx, params) {
	if (typeof param.options === 'function') return param.options(ctx, params) || [];
	return param.options || [];
}

/** Params that should currently show in the inspector. */
export function visibleParams(def, params) {
	return (def?.params || []).filter((p) => !p.showIf || p.showIf(params));
}
