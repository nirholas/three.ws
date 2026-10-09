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
import { TOOL_CATALOG, TOOLS, jobProgress } from './tools.js';
import { PERSONA_TOOL_CATALOG, PERSONA_TOOLS } from './persona-tools.js';
import { CATALOG_TOOL_CATALOG, CATALOG_TOOLS } from './catalog-tools.js';
import { finishCall, gateCall, listForRequest } from '../_mcp/policy.js';
import { accountToolCatalog, callAccountTool, isAccountTool } from './account-tools.js';
import { env } from '../_lib/env.js';

// The @three-ws/mcp-policy server id for the free studio.
const POLICY_SERVER = 'threews-3d-studio-free';
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
	'Every model result also carries four plain links, stated in its first text lines:',
	'viewer_url (opens in any browser), glb_url (the file), poster_png_url (a rendered PNG) and embed_html (paste-ready).',
	'refine_model(glb_url, instruction) iterates on a generated model in plain language ("make it metallic") and keeps',
	'a version lineage you can branch or revert. If a result comes back with status "pending", the model is still',
	'rendering: call check_job(job_id) after the suggested wait to collect it, or get_job(job_id) for its status,',
	'progress, eta_seconds and, once done, the asset links. Every generation tool takes an optional idempotency_key:',
	'retry with the same key after a timeout and you get the original job back instead of a second generation.',
];

// /api/mcp-grok also serves the account's agent tools (./account-tools.js) to a
// caller that signs in. Which half of the sentence the model reads depends on
// whether this request carried a valid credential.
const GROK_SIGNED_IN_INSTRUCTIONS = [
	'This connector is signed in to a three.ws account, so it can also manage the account\'s agents:',
	'list_my_agents, create_agent, attach_avatar_to_agent (give an agent a generated body), remember and recall (agent memory), the',
	'custom skill tools, list_my_avatars and get_embed_code. It can never move funds: wallet, payment and launch',
	'actions happen only in a browser at https://three.ws/dashboard, so tell the user that when they ask for one.',
	'The guided prompt agent-report writes a status report on those agents.',
];
const GROK_ANONYMOUS_INSTRUCTIONS = [
	'To also manage a three.ws account\'s agents, reconnect with a three.ws connector API key as the bearer token, or',
	'sign in with OAuth 2.1 at https://three.ws/api/mcp-grok?auth=oauth.',
];

// ChatGPT drops a tool call still open at 60 s, and a generation takes one to
// four minutes, so on that surface every call answers inside CHATGPT_CALL_BUDGET_MS
// with either the model or a pending job the viewer widget keeps polling.
const CHATGPT_INSTRUCTIONS = [
	'In ChatGPT the inline viewer collects a pending job by itself and shows the model when it lands, so tell the',
	'user it is rendering and do not loop on check_job; call check_job only when the user asks about the job.',
];

// 40 s of work, leaving headroom under the host's 60 s limit for a submit that
// needs its guaranteed floor (gpt-forge-client.js SUBMIT_FLOOR_MS) and the
// response's own trip back through ChatGPT.
export const CHATGPT_CALL_BUDGET_MS = 40_000;

// Grok Bot and the xAI Responses API call MCP tools from xAI's cloud, render no
// widget, and give no published tool-call timeout. Grok Bot runs tasks
// unattended for as long as they take, so on that surface a slow render comes
// back as a pending job inside GROK_CALL_BUDGET_MS and the model is told to keep
// collecting it, then hand the user links, since nothing renders inline.
const GROK_INSTRUCTIONS = [
	'Nothing renders inline in Grok, so always give the user the viewerUrl (an interactive 3D viewer that opens in any',
	'browser) and the glbUrl (the downloadable model); poster_png_url is a picture of it to attach or show, and',
	'embed_html puts it on a web page. A pending result is normal: wait the suggested seconds, then call',
	'check_job(job_id) again until it is done, and keep going without asking the user; a Grok Bot task should finish',
	'with the finished model, not the pending handle. To give yourself a body, forge_avatar a character, then',
	'create_agent_persona(glb_url, name) and share its embed_url; persona_say makes that body speak your reply and',
	'returns an embed_url that plays it. For scheduled tasks use the guided prompts (prompts/list): agent-get-started,',
	'daily-3d-brief, asset-pack and avatar-from-photo.',
];

// The same headroom as ChatGPT: a call that outlives an unpublished host
// timeout is lost work, while a pending handle costs one check_job round trip.
export const GROK_CALL_BUDGET_MS = 40_000;

const CATALOG_INSTRUCTIONS = [
	'Before generating a prop, character or animation, search_catalog(q) checks the thousands of ready-made CC0 props,',
	'rigged characters and motion clips three.ws already publishes; get_item_source(id) returns paste-ready code for a',
	'match. Say whether you used an existing asset or generated a new one.',
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
//            examples, and any MCP host that renders the inline living body,
//            plus the free asset catalog tools (./catalog-tools.js), the only
//            place a keyless MCP client can reach them.
//   chatgpt  /api/mcp-chatgpt: the nine tools in ./tools.js and the
//            model-viewer widget only. The persona widget frames the hosted
//            embodiment page, which requires frameDomains, and OpenAI's app
//            guidelines reserve frame domains for embedding an essential
//            third-party experience, saying those apps "are often not approved
//            for broad distribution". Framing our own page is not that case, so
//            the plugin listing leaves the persona tools out rather than ask
//            review for an exception.
//   grok     /api/mcp-grok: every tool of the full surface for Grok Bot and the
//            xAI Responses API, with a per-call budget and instructions that
//            hand out links in place of the widgets Grok does not render, so
//            it lists no widget templates and no ui:// resources. A caller
//            that signs in (OAuth 2.1 or a connector key, ./handler.js) also
//            gets the account's agent tools (./account-tools.js), never a
//            value-moving one. ./handler.js keys its generation caps on the
//            MCP session, because every Grok user reaches us from xAI's
//            shared egress.
// check_job and the persona tools stay out of the generation quota on both; see
// ./handler.js callsGenerationTool. look_at_model renders frames server-side, so
// it rides that quota.
// A tool descriptor without the Apps SDK keys that bind it to a widget
// template, for a surface whose host renders none.
function withoutWidgetMeta(catalog) {
	return catalog.map((tool) => {
		if (!tool._meta) return tool;
		const meta = Object.fromEntries(Object.entries(tool._meta).filter(([key]) => !key.startsWith('openai/')));
		const { _meta: _dropped, ...rest } = tool;
		return Object.keys(meta).length ? { ...rest, _meta: meta } : rest;
	});
}

const SURFACES = {
	full: {
		server: 'mcp-studio',
		catalog: [...TOOL_CATALOG, ...CATALOG_TOOL_CATALOG, ...PERSONA_TOOL_CATALOG],
		tools: { ...TOOLS, ...CATALOG_TOOLS, ...PERSONA_TOOLS },
		widgets: true,
		personas: true,
		prompts: true,
		instructions: [...BASE_INSTRUCTIONS, ...CATALOG_INSTRUCTIONS, ...PERSONA_INSTRUCTIONS].join(' '),
	},
	chatgpt: {
		server: 'mcp-chatgpt',
		catalog: [...TOOL_CATALOG],
		tools: { ...TOOLS },
		widgets: true,
		personas: false,
		instructions: [...BASE_INSTRUCTIONS, ...CHATGPT_INSTRUCTIONS].join(' '),
		callBudgetMs: CHATGPT_CALL_BUDGET_MS,
	},
	grok: {
		server: 'mcp-grok',
		catalog: withoutWidgetMeta([...TOOL_CATALOG, ...CATALOG_TOOL_CATALOG, ...PERSONA_TOOL_CATALOG]),
		tools: { ...TOOLS, ...CATALOG_TOOLS, ...PERSONA_TOOLS },
		widgets: false,
		personas: true,
		prompts: true,
		accounts: true,
		instructions: [...BASE_INSTRUCTIONS, ...CATALOG_INSTRUCTIONS, ...PERSONA_INSTRUCTIONS, ...GROK_INSTRUCTIONS].join(' '),
		signedInInstructions: GROK_SIGNED_IN_INSTRUCTIONS.join(' '),
		anonymousInstructions: GROK_ANONYMOUS_INSTRUCTIONS.join(' '),
		callBudgetMs: GROK_CALL_BUDGET_MS,
	},
};

export const SURFACE_NAMES = Object.keys(SURFACES);

/** Does this surface serve the account's agent tools to a signed-in caller? */
export function surfaceServesAccounts(name) {
	return Boolean(Object.hasOwn(SURFACES, name) && SURFACES[name].accounts);
}

function surfaceOf(name) {
	return Object.hasOwn(SURFACES, name) ? SURFACES[name] : SURFACES.full;
}

/** The tool descriptors a surface advertises on tools/list. */
export function toolCatalogFor(name = 'full') {
	return surfaceOf(name).catalog;
}

/** The handler map ({ name: { handler, validate } }) behind a surface's tools. */
export function toolsFor(name = 'full') {
	return surfaceOf(name).tools;
}

// The Apps SDK widget resources: the model viewer every generation tool renders,
// and the living-body persona widget the embodiment tools render. _meta (incl.
// the CSP) is built per call so the storage origin always tracks env.
function widgetResources({ widgets = true, personas = true } = {}) {
	if (!widgets) return [];
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

// Turns the progress a job reports on each poll into MCP notifications/progress
// for the client's progressToken. progress is a whole percent out of 100 and only
// ever rises (the spec requires it to), so a poll that reports no movement sends
// nothing. The message is the job's own status line, never an invented one.
function progressReporter(token, notify, jobProgress) {
	let last = -1;
	return (poll) => {
		const queued = poll?.status === 'queued';
		const fraction = jobProgress({
			status: queued ? 'queued' : 'running',
			elapsedSeconds: poll?.elapsed_seconds,
			etaRemainingSeconds: poll?.eta_remaining_seconds,
		});
		if (fraction === null) return;
		const percent = Math.round(fraction * 100);
		if (percent <= last) return;
		last = percent;
		const eta = Number(poll?.eta_remaining_seconds);
		notify({
			jsonrpc: '2.0',
			method: 'notifications/progress',
			params: {
				progressToken: token,
				progress: percent,
				total: 100,
				message: `${queued ? 'Queued' : 'Rendering'}${Number.isFinite(eta) && eta > 0 ? `, about ${Math.round(eta)}s left` : ''}`,
			},
		});
	};
}

async function onToolCall(params, auth, started, req, surface, notify, token) {
	const { name, arguments: args = {} } = params || {};
	const tool = typeof name === 'string' && Object.hasOwn(surface.tools, name) ? surface.tools[name] : null;
	if (!tool) throw rpcError(-32602, `unknown tool: ${name}`);
	const sentArgs = { ...args };
	const gate = await gateCall(POLICY_SERVER, name, sentArgs, auth, req);
	if (!gate.ok) return gate.result;
	if (tool.validate && !tool.validate(args)) {
		const first = tool.validate.errors?.[0];
		const detail = first ? `${first.instancePath || '(root)'} ${first.message || 'invalid'}` : 'invalid arguments';
		throw rpcError(-32602, `invalid params for ${name}: ${detail}`);
	}
	try {
		const ctx = surface.callBudgetMs ? { deadline: started + surface.callBudgetMs } : {};
		if (notify && token !== null && token !== undefined) ctx.onPoll = progressReporter(token, notify, jobProgress);
		const result = await tool.handler(args, auth, req, ctx);
		recordEvent({ kind: 'tool_call', tool: name, latencyMs: Date.now() - started, meta: { args_summary: summarize(args), server: surface.server } });
		return await finishCall(POLICY_SERVER, name, sentArgs, auth, result, gate.preview);
	} catch (err) {
		recordEvent({ kind: 'tool_call', tool: name, status: 'error', latencyMs: Date.now() - started, meta: { error: err.message, server: surface.server } });
		if (err.code && typeof err.code === 'number') throw err;
		const { message } = sanitizeToolError(err, { tool: name, server: surface.server, log });
		return { content: [{ type: 'text', text: `Error: ${message}` }], isError: true };
	}
}

// `account` is the signed-in principal on a surface that serves accounts
// (./handler.js), or null. Studio tools always run as the anonymous `auth`, so
// signing in never changes what a free tool does; only the account tools see
// the account.
export async function dispatch(msg, auth, req, { surface: surfaceName = 'full', account = null, notify = null } = {}) {
	const surface = surfaceOf(surfaceName);
	const signedIn = Boolean(surface.accounts && account?.userId);
	const origin = env.APP_ORIGIN || 'https://three.ws';
	const started = Date.now();
	const id = msg.id;
	const isNotification = id === undefined;
	try {
		if (msg.jsonrpc != null && msg.jsonrpc !== '2.0') throw rpcError(-32600, 'invalid Request');
		const method = msg.method;

		if (method === 'initialize') {
			const accountNote = surface.accounts ? [signedIn ? surface.signedInInstructions : surface.anonymousInstructions] : [];
			return ok(id, {
				protocolVersion: PROTOCOL_VERSION,
				serverInfo: SERVER_INFO,
				capabilities: {
					tools: { listChanged: false },
					...(surface.prompts ? { prompts: { listChanged: false } } : {}),
					...(surface.widgets ? { resources: { listChanged: false, subscribe: false } } : {}),
					logging: {},
				},
				instructions: [surface.instructions, ...accountNote].join(' '),
			});
		}
		if (method === 'ping') return ok(id, {});
		if (method === 'notifications/initialized') return null;
		if (method === 'tools/list') {
			const studio = await listForRequest(POLICY_SERVER, surface.catalog, auth, req);
			if (!signedIn) return ok(id, { tools: studio });
			return ok(id, { tools: [...studio, ...(await accountToolCatalog(account, req))] });
		}
		if (method === 'tools/call') {
			const name = msg.params?.name;
			if (surface.accounts && !Object.hasOwn(surface.tools, name) && isAccountTool(name)) {
				if (!signedIn) {
					throw rpcError(-32002, `${name} manages a three.ws account and needs a signed-in connector`, {
						reason: 'sign_in_required',
						tool: name,
						oauth_url: `${origin}/api/mcp-grok?auth=oauth`,
						docs: `${origin}/docs/grok`,
					});
				}
				const response = await callAccountTool(msg, account, req);
				if (response) return response;
				throw rpcError(-32002, `${name} is not available to this connector: its scopes or your MCP tool settings leave it off`, {
					reason: 'tool_not_granted',
					tool: name,
					settings: `${origin}/mcp-tools`,
					docs: `${origin}/docs/mcp`,
				});
			}
			return ok(id, await onToolCall(msg.params, auth, started, req, surface, notify, msg.params?._meta?.progressToken));
		}
		if (method === 'resources/list') {
			return ok(id, { resources: widgetResources(surface).map(({ text: _t, ...r }) => r) });
		}
		if (method === 'resources/read') {
			const uri = msg.params?.uri;
			const res = widgetResources(surface).find((r) => r.uri === uri);
			if (!res) throw rpcError(-32602, `unknown resource: ${uri}`);
			return ok(id, { contents: [{ uri: res.uri, mimeType: res.mimeType, text: res.text, _meta: res._meta }] });
		}
		if (method === 'resources/templates/list') return ok(id, { resourceTemplates: [] });
		if (method === 'prompts/list' || method === 'prompts/get') {
			if (!surface.prompts) {
				if (method === 'prompts/list') return ok(id, { prompts: [] });
				throw rpcError(-32602, `unknown prompt: ${msg.params?.name}`);
			}
			// Rendered against the tools this caller's tools/list shows, so a prompt
			// never names a tool the caller cannot call (the account prompts appear
			// only once the connector is signed in).
			const studio = await listForRequest(POLICY_SERVER, surface.catalog, auth, req);
			const visible = signedIn ? [...studio, ...(await accountToolCatalog(account, req))] : studio;
			const { handlePromptMethod } = await import('../_mcp/prompts.js');
			return ok(id, handlePromptMethod(surface.server, visible, method, msg.params));
		}
		if (method === 'logging/setLevel') return ok(id, {});

		throw rpcError(-32601, `method not found: ${method}`);
	} catch (err) {
		log.warn('rpc_error', { method: msg.method, code: err.code, message: err.message });
		if (isNotification) return null;
		return { jsonrpc: '2.0', id, error: { code: err.code || -32603, message: err.message || 'internal error', data: err.data } };
	}
}
