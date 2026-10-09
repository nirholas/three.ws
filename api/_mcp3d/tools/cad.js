// cad_generate / cad_rebuild: parametric CAD for agents.
//
// The same pipeline as three.ws/cad (api/_lib/cad/service.js): a model writes
// a build123d program, the OpenCascade kernel builds it in the cad-forge
// sandbox, kernel errors go back for repair, and the part is saved with STEP,
// STL, GLB and drawing files plus a permalink. cad_rebuild re-runs a saved
// program at new dimension values with no model involved.
//
// Both answer synchronously. A design usually lands in 20-90 s; agents whose
// MCP client enforces a short per-call timeout should raise it for this tool.

import { CadForgeError } from '../../_lib/cad/forge.js';
import { cleanPrompt, createDesign, loadParent, rebuildVariant } from '../../_lib/cad/service.js';
import { buildSpatialArtifact } from '../../_lib/spatial-mcp.js';

function failure(err) {
	const known = err instanceof CadForgeError;
	const message = known ? err.message : 'CAD Forge could not finish this part. Try again.';
	const kernel = known && err.code === 'design_failed' ? err.detail?.lastError : known && err.code === 'rebuild_failed' ? err.detail : null;
	return {
		content: [{ type: 'text', text: kernel ? `${message}\nLast kernel error: ${kernel.message}${kernel.line ? ` (line ${kernel.line})` : ''}` : message }],
		structuredContent: { error: true, code: known ? err.code : 'internal_error', message, ...(kernel ? { kernelError: kernel } : {}) },
		isError: true,
	};
}

function summarizeParams(params) {
	return params.map((p) => `${p.name} = ${p.value} ${p.unit === 'count' ? '' : p.unit} (${p.label}, ${p.min}..${p.max})`.replace(/\s+\(/, ' (')).join('\n');
}

function sizeLine(metrics) {
	const [x, y, z] = metrics.size_mm;
	return `${x} x ${y} x ${z} mm, ${(metrics.volume_mm3 / 1000).toFixed(2)} cm3, ${metrics.solids} solid${metrics.solids === 1 ? '' : 's'}`;
}

export const toolDefs = [
	{
		name: 'cad_generate',
		title: 'Generate a parametric CAD part (STEP, STL, GLB)',
		annotations: {
			readOnlyHint: false,
			destructiveHint: false,
			idempotentHint: false,
			openWorldHint: true,
		},
		description:
			'Turn a description of a mechanical part into real parametric CAD: a build123d (OpenCascade) program that the ' +
			'geometry kernel has accepted, saved with STEP (for Fusion, SolidWorks, FreeCAD, Onshape), STL (for 3D printing), ' +
			'GLB (web and AR, true scale in metres) and an SVG drawing sheet, plus a public page with dimension sliders. ' +
			'Use it for brackets, enclosures, mounts, gears, knobs, clips, adapters and other functional parts with real ' +
			'dimensions; use text_to_3d instead for organic or decorative models. Name the key sizes in millimetres and how ' +
			'the part mounts. Pass parent_id (and optionally values) to refine an existing design. Takes 20-90 seconds.',
		inputSchema: {
			type: 'object',
			additionalProperties: false,
			required: ['prompt'],
			properties: {
				prompt: { type: 'string', minLength: 3, maxLength: 600, description: 'The part to make, or the change to make when refining. Include key dimensions in mm.' },
				parent_id: { type: 'string', format: 'uuid', description: 'Refine this existing CAD Forge design instead of starting fresh.' },
				values: {
					type: 'object',
					additionalProperties: { type: 'number' },
					description: 'With parent_id: the parent parameter values to start the refinement from, e.g. {"WIDTH": 90}.',
				},
			},
		},
		async handler(args, auth) {
			try {
				const prompt = cleanPrompt(args.prompt);
				const parent = await loadParent(args.parent_id);
				const { design, attempts } = await createDesign({
					prompt,
					parent,
					values: args.values,
					user: auth?.userId ? { id: auth.userId } : null,
				});
				const spatial = buildSpatialArtifact({ glbUrl: design.files.glb, kind: 'model', viewerUrl: design.url, title: design.title });
				return {
					content: [
						{
							type: 'text',
							text:
								`${design.title}: ${sizeLine(design.metrics)}. Built on the kernel in ${attempts} attempt${attempts === 1 ? '' : 's'}.\n` +
								`Page with sliders: ${design.url}\nSTEP: ${design.files.step}\nSTL: ${design.files.stl}\nGLB: ${design.files.glb}` +
								(design.files.drawing_svg ? `\nDrawing: ${design.files.drawing_svg}` : '') +
								(design.params.length ? `\nParameters (change with cad_rebuild):\n${summarizeParams(design.params)}` : '') +
								(design.adjustments.length ? `\nKernel adjustments: ${design.adjustments.join('; ')}` : ''),
						},
					],
					structuredContent: {
						id: design.id,
						title: design.title,
						summary: design.summary,
						url: design.url,
						files: design.files,
						metrics: design.metrics,
						params: design.params.map(({ line: _l, ...p }) => p),
						adjustments: design.adjustments,
						code: design.code,
						spatial,
					},
				};
			} catch (err) {
				return failure(err);
			}
		},
	},
	{
		name: 'cad_rebuild',
		title: 'Rebuild a CAD part with new dimensions',
		annotations: {
			readOnlyHint: false,
			destructiveHint: false,
			idempotentHint: true,
			openWorldHint: false,
		},
		description:
			'Rebuild a CAD Forge design (from cad_generate) at new parameter values, e.g. {"WIDTH": 120, "WALL": 3}. Runs the ' +
			"design's own program on the OpenCascade kernel with no model involved, so the result is exact and repeatable. " +
			'Values are clamped to each parameter\'s range. Returns fresh STEP, STL, GLB and drawing files and a link to this ' +
			'configuration. Identical values return the cached build instantly.',
		inputSchema: {
			type: 'object',
			additionalProperties: false,
			required: ['id', 'values'],
			properties: {
				id: { type: 'string', format: 'uuid', description: 'The design id returned by cad_generate.' },
				values: {
					type: 'object',
					additionalProperties: { type: 'number' },
					minProperties: 1,
					description: 'Parameter values by name, e.g. {"WIDTH": 120}.',
				},
			},
		},
		async handler(args) {
			try {
				const { variant, cached, design } = await rebuildVariant({ id: args.id, values: args.values });
				return {
					content: [
						{
							type: 'text',
							text:
								`${design.title} at ${Object.entries(variant.values).map(([k, v]) => `${k}=${v}`).join(', ')}: ${sizeLine(variant.metrics)}${cached ? ' (cached)' : ''}.\n` +
								`Page: ${variant.url}\nSTEP: ${variant.files.step}\nSTL: ${variant.files.stl}\nGLB: ${variant.files.glb}`,
						},
					],
					structuredContent: { id: design.id, key: variant.key, url: variant.url, values: variant.values, files: variant.files, metrics: variant.metrics, cached },
				};
			} catch (err) {
				return failure(err);
			}
		},
	},
];
