// `blender_render`: render a still preview of a 3D file.
//
// The point is a preview an agent can look at without a viewport, so the tool
// fills in what a bare asset file lacks: if the scene has no camera one is
// created and framed to the geometry's bounding sphere, and if it has no light
// a key light and a lit world are added. A scene that already carries its own
// camera and lighting is rendered exactly as authored.
//
// CYCLES is the default engine because it renders on CPU; EEVEE needs a real
// GPU context, which a headless container usually does not have.

import { readFile, rm } from 'node:fs/promises';

import { z } from 'zod';

import { runJob } from '../lib/blender.js';
import { INLINE_IMAGE_MAX_PX, INLINE_IMAGE_MAX_BYTES } from '../config.js';
import { resolveInput, resolveOutput } from '../lib/paths.js';

export const def = {
	name: 'blender_render',
	title: 'Render a preview image of a 3D file',
	annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
	description:
		'Render a still PNG of any 3D file Blender can open (.blend, .glb, .fbx, .obj, .usd and the rest). If the ' +
		'scene has no camera, one is created and framed to the model; if it has no light, a key light and a lit ' +
		'world are added, so a bare asset file renders as a usable preview with no setup. A scene that already has ' +
		'its own camera and lighting is rendered as authored. The rendered image is returned INLINE alongside the ' +
		'JSON, so you can actually look at the model in this one call without needing filesystem access, while the ' +
		'full-resolution PNG is written to disk. Ask for several views and it orbits the model, rendering every angle ' +
		'in the same Blender launch. Use it to see a model, check a conversion, or produce a thumbnail.',
	inputSchema: {
		input: z.string().min(1).describe('Path to the 3D file to render.'),
		output: z.string().optional().describe('Destination PNG path. Defaults to a .png in the server workdir.'),
		engine: z
			.enum(['auto', 'CYCLES', 'BLENDER_EEVEE', 'BLENDER_WORKBENCH'])
			.optional()
			.describe(
				'Render engine. "auto" (default) picks CYCLES, which renders on CPU. EEVEE is far faster but needs a GPU ' +
					'context. Call blender_info to see what this build offers.',
			),
		samples: z.number().int().min(1).max(4096).optional().describe('Sample count. Default 32: enough for a preview.'),
		resolution: z
			.array(z.number().int().min(16).max(8192))
			.length(2)
			.optional()
			.describe('Output size as [width, height]. Default [960, 960].'),
		transparent: z.boolean().optional().describe('Render with a transparent background instead of the world. Default false.'),
		views: z
			.number()
			.int()
			.min(1)
			.max(6)
			.optional()
			.describe(
				'How many angles to render, orbiting the model, all in one Blender launch and all returned inline. ' +
					'Default 1. Use 4 to see whether the back of a model is modelled at all. A set always orbits its own ' +
					'camera, so an authored camera is only honoured when views is 1.',
			),
		inline_image: z
			.boolean()
			.optional()
			.describe('Return the image inline so you can see it, downscaled to fit the context. Default true.'),
	},
	async handler(args) {
		const input = await resolveInput(args?.input);
		const output = await resolveOutput(args?.output, input, '.png');
		const payload = await runJob({
			op: 'render',
			input,
			output,
			engine: args?.engine || 'auto',
			samples: args?.samples ?? 32,
			resolution: args?.resolution ?? [960, 960],
			transparent: args?.transparent === true,
			views: args?.views ?? 1,
			inline_max_px: args?.inline_image === false ? 0 : INLINE_IMAGE_MAX_PX,
		});
		return { ...payload, ok: true, inline_image: args?.inline_image !== false };
	},

	/**
	 * Hand every rendered view back as an MCP image block.
	 *
	 * Scaled copies exist only to travel in this response, so they are read and
	 * then deleted; leaving them beside the real outputs would be litter the
	 * caller has to reason about. Images too large to inline are reported in the
	 * JSON rather than silently dropped, so the caller knows to read the files.
	 */
	async attachments(result) {
		if (!result?.inline_image) return [];
		const outputs = result.outputs || (result.output ? [result.output] : []);
		const previews = result.previews || [];
		const blocks = [];
		let budget = INLINE_IMAGE_MAX_BYTES;

		for (let index = 0; index < outputs.length; index += 1) {
			const preview = previews[index];
			const source = preview || outputs[index];
			let data;
			try {
				data = await readFile(source);
			} catch {
				continue;
			}
			if (preview) await rm(preview, { force: true });
			if (data.length > budget) {
				result.inline_image_skipped =
					`${outputs.length - blocks.length} view(s) exceeded the ${INLINE_IMAGE_MAX_BYTES} byte inline budget; ` +
					`read them from ${outputs.slice(blocks.length).join(', ')}`;
				break;
			}
			budget -= data.length;
			blocks.push({ type: 'image', data: data.toString('base64'), mimeType: 'image/png' });
		}
		return blocks;
	},
};
