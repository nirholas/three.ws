// `blender_optimize`: make a model small enough to ship.
//
// This is the delivery pass three.ws runs constantly, and until now it took a
// hand-written bpy script every time: decimate to a triangle budget, pull
// oversized textures down, drop the datablocks importers leave behind, then
// compress the mesh streams on the way out. Doing it in one call also means the
// caller gets one honest before/after, rather than assembling it from four.
//
// Compression happens outside Blender because its exporter offers Draco only,
// and only on builds shipping the library, while meshopt is what the three.ws
// runtime and every major web viewer expect.

import { z } from 'zod';

import { runJob } from '../lib/blender.js';
import { compressGlb } from '../lib/gltf.js';
import { resolveInput, resolveOutput } from '../lib/paths.js';

export const def = {
	name: 'blender_optimize',
	title: 'Shrink a 3D model for delivery',
	annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
	description:
		'Make a model web-ready in one call: decimate every mesh proportionally to hit a triangle budget, scale ' +
		'oversized textures down, purge datablocks nothing references, and compress the mesh streams with meshopt ' +
		'(or Draco) on the way out. Returns before and after triangle counts, texture bytes and file size, plus what ' +
		'each step did, so the trade is visible rather than guessed. The input file is never modified. Decimation ' +
		'is collapse-based and preserves vertex groups, but a heavily decimated skinned mesh should be checked with ' +
		'blender_render before shipping.',
	inputSchema: {
		input: z.string().min(1).describe('Path to the model to optimize.'),
		output: z
			.string()
			.optional()
			.describe('Destination. The extension picks the format. Defaults to a .glb in the server workdir.'),
		max_triangles: z
			.number()
			.int()
			.min(4)
			.optional()
			.describe('Triangle budget for the whole scene. Omit to leave geometry untouched.'),
		max_texture_px: z
			.number()
			.int()
			.min(16)
			.max(8192)
			.optional()
			.describe('Longest edge any texture may keep, e.g. 1024. Omit to leave textures untouched.'),
		compress: z
			.enum(['meshopt', 'draco', 'none'])
			.optional()
			.describe(
				'Mesh compression for a .glb/.gltf output. "meshopt" (default) is what the three.ws runtime and every ' +
					'major web viewer decode. Ignored for other formats.',
			),
	},
	async handler(args) {
		const input = await resolveInput(args?.input);
		const output = await resolveOutput(args?.output, input, '.glb');
		const payload = await runJob({
			op: 'optimize',
			input,
			output,
			max_triangles: args?.max_triangles,
			max_texture_px: args?.max_texture_px,
		});

		const method = args?.compress ?? 'meshopt';
		const steps = [...payload.steps];
		let outputBytes = payload.output_bytes;
		if (method !== 'none' && /\.(glb|gltf)$/i.test(output)) {
			const compressed = await compressGlb(output, method);
			steps.push({ step: 'compress', ...compressed });
			outputBytes = compressed.after_bytes;
		}

		const saved = payload.input_bytes - outputBytes;
		return {
			...payload,
			ok: true,
			steps,
			output_bytes: outputBytes,
			saved_bytes: saved,
			saved_percent: payload.input_bytes ? Math.round((saved / payload.input_bytes) * 1000) / 10 : 0,
		};
	},
};
