// three.ws 3D Studio (free) — JSON-RPC dispatcher.
//
// A slim, payment-free MCP dispatcher for the free studio server. It mirrors the
// shared api/_lib/mcp-dispatch.js core (method routing, Ajv arg validation,
// usage accounting, error sanitizing) but ALSO serves the Apps SDK UI resource
// (resources/list + resources/read for the ui:// widget), which the shared core
// stubs out. There is no scope check and no payment path here — every tool is
// free and unauthenticated.

import { recordEvent, logger } from '../_lib/usage.js';
import { sanitizeToolError } from '../_lib/mcp-error-sanitize.js';
import { TOOL_CATALOG, TOOLS } from './tools.js';
import { PERSONA_TOOL_CATALOG, PERSONA_TOOLS } from './persona-tools.js';
import {
	COMPONENT_HTML,
	COMPONENT_URI,
	COMPONENT_MIME,
	componentCsp,
	PERSONA_COMPONENT_HTML,
	PERSONA_COMPONENT_URI,
	personaComponentCsp,
} from './component.js';

export const PROTOCOL_VERSION = '2025-06-18';

const SERVER_INFO = { name: 'three-ws-3d-studio-free', version: '1.0.0' };

const BASE_INSTRUCTIONS = [
	'three.ws 3D Studio turns a text prompt or an image into an interactive, downloadable 3D model (GLB), free.',
	'forge_free(prompt) generates a model from text; text_to_avatar and mesh_forge generate an avatar or art-directed',
	'mesh from text or a reference image; rig_mesh(glb_url) makes a static model animation-ready; forge_avatar does',
	'generate + rig in one step. Each result includes a glbUrl and a viewerUrl and renders inline in a 3D viewer widget.',
	'refine_model(glb_url, instruction) iterates on a generated model in plain language ("make it metallic") and keeps',
	'a version lineage you can branch or revert. If a result comes back with status "pending", the model is still',
	'rendering: call check_job(job_id) after the suggested wait to collect it.',
];

const PERSONA_INSTRUCTIONS = [
	'To give the assistant a LIVING body: create_agent_persona(glb_url, name) saves a rigged model as a named,',
	'persistent persona and returns a persona_id; persona_say(persona_id, text) makes that body lip-sync the reply and',
	'emote; get_agent_persona(persona_id) brings the same body back in a later session. The persona renders inline and',
	'idles between turns.',
];

// Two surfaces share this dispatcher, each advertising a consistent set of
// tools, widgets and model instructions.
//   full     /api/mcp-studio: every tool and both widgets, for Claude, the
//            examples, and any MCP host that renders the inline living body.
//   chatgpt  /api/mcp-chatgpt: the eight tools in ./tools.js and the
//            model-viewer widget only. The persona widget frames the hosted
//            embodiment page, which requires frameDomains, and OpenAI's app
//            guidelines reserve frame domains for embedding an essential
//            third-party experience, saying those apps "are often not approved
//            for broad distribution". Framing our own page is not that case, so
//            the plugin listing leaves the persona tools out rather than ask
//            review for an exception.
// check_job and the persona tools stay out of the generation quota on both; see
// ./handler.js callsGenerationTool. look_at_model renders frames server-side, so
// it rides that quota.
const SURFACES = {
	full: {
		server: 'mcp-studio',
		catalog: [...TOOL_CATALOG, ...PERSONA_TOOL_CATALOG],
		tools: { ...TOOLS, ...PERSONA_TOOLS },
		personas: true,
		instructions: [...BASE_INSTRUCTIONS, ...PERSONA_INSTRUCTIONS].join(' '),
	},
	chatgpt: {
		server: 'mcp-chatgpt',
		catalog: [...TOOL_CATALOG],
		tools: { ...TOOLS },
		personas: false,
		instructions: BASE_INSTRUCTIONS.join(' '),
	},
};

export const SURFACE_NAMES = Object.keys(SURFACES);

function surfaceOf(name) {
	return Object.hasOwn(SURFACES, name) ? SURFACES[name] : SURFACES.full;
}

/** The tool descriptors a surface advertises on tools/list. */
export function toolCatalogFor(name = 'full') {
	return surfaceOf(name).catalog;
}

// The Apps SDK widget resources: the model viewer every generation tool renders,
// and the living-body persona widget the embodiment tools render. _meta (incl.
// the CSP) is built per call so the storage origin always tracks env.
function widgetResources(personas = true) {
	const all = [
		{
			uri: COMPONENT_URI,
			name: 'three.ws 3D model viewer',
			description: 'Interactive 3D viewer that renders a generated GLB model inline.',
			mimeType: COMPONENT_MIME,
			text: COMPONENT_HTML,
			_meta: {
				'openai/widgetDescription': 'Interactive 3D viewer for a generated model: rotate, view, and download the GLB.',
				'openai/widgetCSP': componentCsp(),
				'openai/widgetDomain': 'https://three.ws',
				'openai/widgetPrefersBorder': true,
			},
		},
		{
			uri: PERSONA_COMPONENT_URI,
			name: 'three.ws living agent',
			description: 'Live agent body that idles between turns, lip-syncs replies, and emotes.',
			mimeType: COMPONENT_MIME,
			text: PERSONA_COMPONENT_HTML,
			_meta: {
				'openai/widgetDescription': 'A live 3D agent body: it idles between turns, lip-syncs each reply, and shows emotion.',
				'openai/widgetCSP': personaComponentCsp(),
				'openai/widgetDomain': 'https://three.ws',
				'openai/widgetPrefersBorder': true,
			},
		},
	];
	return personas ? all : all.filter((r) => r.uri !== PERSONA_COMPONENT_URI);
}

const log = logger('mcp-studio');

function ok(id, result) {
	return { jsonrpc: '2.0', id, result };
}

function rpcError(code, message, data) {
	const e = new Error(message);
	e.code = code;
	e.data = data;
	return e;
}

function summarize(args) {
	const o = {};
	for (const [k, v] of Object.entries(args || {})) {
		o[k] = typeof v === 'string' && v.length > 64 ? v.slice(0, 64) + '…' : v;
	}
	return o;
}

async function onToolCall(params, auth, started, req, surface) {
	const { name, arguments: args = {} } = params || {};
	const tool = typeof name === 'string' && Object.hasOwn(surface.tools, name) ? surface.tools[name] : null;
	if (!tool) throw rpcError(-32602, `unknown tool: ${name}`);
	if (tool.validate && !tool.validate(args)) {
		const first = tool.validate.errors?.[0];
		const detail = first ? `${first.instancePath || '(root)'} ${first.message || 'invalid'}` : 'invalid arguments';
		throw rpcError(-32602, `invalid params for ${name}: ${detail}`);
	}
	try {
		const result = await tool.handler(args, auth, req);
		recordEvent({ kind: 'tool_call', tool: name, latencyMs: Date.now() - started, meta: { args_summary: summarize(args), server: surface.server } });
		return result;
	} catch (err) {
		recordEvent({ kind: 'tool_call', tool: name, status: 'error', latencyMs: Date.now() - started, meta: { error: err.message, server: surface.server } });
		if (err.code && typeof err.code === 'number') throw err;
		const { message } = sanitizeToolError(err, { tool: name, server: surface.server, log });
		return { content: [{ type: 'text', text: `Error: ${message}` }], isError: true };
	}
}

export async function dispatch(msg, auth, req, { surface: surfaceName = 'full' } = {}) {
	const surface = surfaceOf(surfaceName);
	const started = Date.now();
	const id = msg.id;
	const isNotification = id === undefined;
	try {
		if (msg.jsonrpc != null && msg.jsonrpc !== '2.0') throw rpcError(-32600, 'invalid Request');
		const method = msg.method;

		if (method === 'initialize') {
			return ok(id, {
				protocolVersion: PROTOCOL_VERSION,
				serverInfo: SERVER_INFO,
				capabilities: { tools: { listChanged: false }, resources: { listChanged: false, subscribe: false }, logging: {} },
				instructions: surface.instructions,
			});
		}
		if (method === 'ping') return ok(id, {});
		if (method === 'notifications/initialized') return null;
		if (method === 'tools/list') return ok(id, { tools: surface.catalog });
		if (method === 'tools/call') return ok(id, await onToolCall(msg.params, auth, started, req, surface));
		if (method === 'resources/list') {
			return ok(id, { resources: widgetResources(surface.personas).map(({ text: _t, ...r }) => r) });
		}
		if (method === 'resources/read') {
			const uri = msg.params?.uri;
			const res = widgetResources(surface.personas).find((r) => r.uri === uri);
			if (!res) throw rpcError(-32602, `unknown resource: ${uri}`);
			return ok(id, { contents: [{ uri: res.uri, mimeType: res.mimeType, text: res.text, _meta: res._meta }] });
		}
		if (method === 'resources/templates/list') return ok(id, { resourceTemplates: [] });
		if (method === 'prompts/list') return ok(id, { prompts: [] });
		if (method === 'logging/setLevel') return ok(id, {});

		throw rpcError(-32601, `method not found: ${method}`);
	} catch (err) {
		log.warn('rpc_error', { method: msg.method, code: err.code, message: err.message });
		if (isNotification) return null;
		return { jsonrpc: '2.0', id, error: { code: err.code || -32603, message: err.message || 'internal error', data: err.data } };
	}
}
