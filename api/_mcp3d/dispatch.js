// JSON-RPC dispatch for the 3D Studio MCP server — thin binding of the shared
// payment-free dispatcher (api/_lib/mcp-dispatch.js) to this server's catalog.
import { makeDispatcher, PROTOCOL_VERSION } from '../_lib/mcp-dispatch.js';
import { TOOL_CATALOG, TOOLS } from './catalog.js';

export { PROTOCOL_VERSION };
export { isPublicTool } from '../_lib/mcp-getting-started.js';

const INSTRUCTIONS = [
	'three.ws 3D Studio turns text or images into interactive, animation-ready 3D models.',
	'Pipeline: optionally direct_prompt(idea) to sharpen a vague prompt, then text_to_3d(prompt) or',
	'image_to_3d(image_url) to generate (tier=draft|standard|high, path=image|geometry); poll',
	'generation_status(job_id) until it returns a GLB and an inline <model-viewer> artifact.',
	'capture_scene(video_url) reconstructs a REAL space from a video into an explorable 3D point cloud',
	'(poll generation_status for the .ply + an inline point-cloud viewer artifact).',
	'auto_rig_model(glb_url) adds a skeleton; apply_animation(model_url, animation) and pose_model(prompt)',
	'drive the rigged result; list_animations enumerates clips. Mesh ops: remesh_model, stylize_model,',
	'segment_model, retexture_model, retexture_region, generate_material. preview_3d(glb_url) renders any',
	'GLB; inspect_model / optimize_model analyze one. save_avatar(glb_url, name) persists a generated GLB as a',
	'durable, named avatar you own (then render_avatar_image / get_avatar on the main server work on it).',
	'Always display returned text/html resources as inline 3D artifacts.',
].join(' ');

export const dispatch = makeDispatcher({
	serverInfo: { name: 'three-ws-3d-studio', version: '1.0.0' },
	instructions: INSTRUCTIONS,
	catalog: TOOL_CATALOG,
	tools: TOOLS,
	logName: 'mcp3d',
	resourceServer: 'mcp-3d',
});
