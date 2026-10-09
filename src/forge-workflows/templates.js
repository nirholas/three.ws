// Forge Workflows: starter templates.
//
// Each template is a complete, runnable graph in the same JSON shape the editor
// saves and exports. Instantiate one with instantiateTemplate(), which gives every
// node and link a fresh id so two copies never collide.

import { WORKFLOW_KIND, WORKFLOW_VERSION, cloneWithFreshIds, defaultParams } from './graph.js';
import { NODE_TYPES } from './node-types.js';

function node(id, type, x, y, params = {}) {
	return { id, type, x, y, params: { ...defaultParams(NODE_TYPES[type]), ...params } };
}

function edge(id, from, fromPort, to, toPort) {
	return { id, from: { node: from, port: fromPort }, to: { node: to, port: toPort } };
}

function workflow(name, nodes, edges) {
	return { kind: WORKFLOW_KIND, version: WORKFLOW_VERSION, name, nodes, edges };
}

export const TEMPLATES = [
	{
		id: 'text-rig-export',
		title: 'Text to rigged character',
		description: 'Write a prompt, generate a model on the free engine, auto-rig it, preview it and download the GLB.',
		needs: 'A prompt',
		build: () =>
			workflow(
				'Text to rigged character',
				[
					node('t_prompt', 'prompt', 40, 120, { text: 'a friendly cartoon robot standing upright, arms at its sides' }),
					node('t_gen', 'generate', 320, 120, { mode: 'text', engine: 'auto', tier: 'draft' }),
					node('t_rig', 'rig', 600, 120),
					node('t_prev', 'preview', 880, 220),
					node('t_exp', 'export', 880, 20, { format: 'glb', filename: 'rigged-character' }),
				],
				[
					edge('t_e1', 't_prompt', 'text', 't_gen', 'prompt'),
					edge('t_e2', 't_gen', 'mesh', 't_rig', 'mesh'),
					edge('t_e3', 't_rig', 'mesh', 't_prev', 'mesh'),
					edge('t_e4', 't_rig', 'mesh', 't_exp', 'mesh'),
				],
			),
	},
	{
		id: 'image-preview',
		title: 'Photo to 3D',
		description: 'Upload one photo, turn it into a textured model and inspect it in the viewer.',
		needs: 'A photo',
		build: () =>
			workflow(
				'Photo to 3D',
				[
					node('i_img', 'image', 40, 120),
					node('i_gen', 'generate', 320, 120, { mode: 'image', engine: 'auto', tier: 'draft' }),
					node('i_prev', 'preview', 600, 120),
				],
				[edge('i_e1', 'i_img', 'image', 'i_gen', 'image'), edge('i_e2', 'i_gen', 'mesh', 'i_prev', 'mesh')],
			),
	},
	{
		id: 'batch-save',
		title: 'Batch photos to library',
		description: 'Drop in several photos. For Each generates a model from every one and saves each to your library.',
		needs: 'Photos and a sign-in',
		build: () =>
			workflow(
				'Batch photos to library',
				[
					node('b_each', 'forEach', 40, 120, { mode: 'image' }),
					node('b_gen', 'generate', 320, 120, { mode: 'image', engine: 'auto', tier: 'draft' }),
					node('b_prev', 'preview', 600, 220),
					node('b_save', 'save', 600, 0, { destination: 'library', name: 'Batch model', visibility: 'unlisted' }),
				],
				[
					edge('b_e1', 'b_each', 'item', 'b_gen', 'image'),
					edge('b_e2', 'b_gen', 'mesh', 'b_prev', 'mesh'),
					edge('b_e3', 'b_gen', 'mesh', 'b_save', 'mesh'),
				],
			),
	},
	{
		id: 'image-gameready',
		title: 'Photo to game asset',
		description: 'Generate from a photo, clean the topology, retopologize and bake for a game engine, then download.',
		needs: 'A photo and $THREE',
		build: () =>
			workflow(
				'Photo to game asset',
				[
					node('g_img', 'image', 40, 120),
					node('g_gen', 'generate', 300, 120, { mode: 'image', engine: 'auto', tier: 'draft' }),
					node('g_rem', 'remesh', 560, 120, { mode: 'triangle', operation: 'full', targetFaces: 50000 }),
					node('g_game', 'gameready', 820, 120, { topology: 'quad', polyBudget: 15000 }),
					node('g_prev', 'preview', 1080, 220),
					node('g_exp', 'export', 1080, 20, { format: 'glb', filename: 'game-asset' }),
				],
				[
					edge('g_e1', 'g_img', 'image', 'g_gen', 'image'),
					edge('g_e2', 'g_gen', 'mesh', 'g_rem', 'mesh'),
					edge('g_e3', 'g_rem', 'mesh', 'g_game', 'mesh'),
					edge('g_e4', 'g_game', 'mesh', 'g_prev', 'mesh'),
					edge('g_e5', 'g_game', 'mesh', 'g_exp', 'mesh'),
				],
			),
	},
];

/** A fresh, independent copy of a template's graph. */
export function instantiateTemplate(id) {
	const t = TEMPLATES.find((x) => x.id === id);
	if (!t) throw new Error(`Unknown template "${id}"`);
	return cloneWithFreshIds(t.build());
}
