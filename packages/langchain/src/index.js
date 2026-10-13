// LangChain JS `tool()` definitions for three.ws's generative 3D pipeline:
// forge a model from text, rig it for animation, render a turntable preview,
// animate it from a text prompt, and chat with a three.ws agent persona.
// forge/rig/render call the free, no-auth /api/mcp-studio server; animate
// calls the paid, x402-gated /api/mcp server and never pays on the caller's
// behalf (see `createAnimateTool`'s doc comment); agentChat calls the public
// /api/chat SSE endpoint.

import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { callThreeWsTool, callThreeWsChat, toolResultText } from './client.js';

/**
 * Build all five three.ws tools bound to one configuration, ready to pass
 * into `createAgent({ tools })` / `.bindTools(tools)`.
 * @param {object} [config]
 * @param {string} [config.baseUrl] override for self-hosted / staging deployments
 * @param {string} [config.apiKey] three.ws API key, only needed for the animate tool
 */
export function createThreeWsTools(config = {}) {
	return [createForgeTool(config), createRigTool(config), createRenderTool(config), createAnimateTool(config), createAgentChatTool(config)];
}

export function createForgeTool({ baseUrl } = {}) {
	return tool(
		async ({ prompt, tier }) => {
			const res = await callThreeWsTool({ baseUrl, surface: 'free', tool: 'forge_free', args: { prompt, ...(tier ? { tier } : {}) } });
			if (!res.ok) return [`forge failed: ${res.error}`, { ok: false, error: res.error }];
			return [toolResultText(res.result), { ok: true, raw: res.result.structuredContent ?? null }];
		},
		{
			name: 'three_ws_forge',
			description:
				'Generate a textured, downloadable 3D model (GLB) from a text prompt. Free, no API key required. ' +
				'Describe a single object, character, or creature.',
			schema: z.object({
				prompt: z.string().min(3).max(1000).describe('What to model, e.g. "a friendly round robot mascot, glossy white plastic".'),
				tier: z.enum(['draft', 'standard', 'high']).optional().describe('Detail level; standard is the default.'),
			}),
			responseFormat: 'content_and_artifact',
		},
	);
}

export function createRigTool({ baseUrl } = {}) {
	return tool(
		async ({ glbUrl }) => {
			const res = await callThreeWsTool({ baseUrl, surface: 'free', tool: 'rig_mesh', args: { glb_url: glbUrl } });
			if (!res.ok) return [`rig failed: ${res.error}`, { ok: false, error: res.error }];
			return [toolResultText(res.result), { ok: true, raw: res.result.structuredContent ?? null }];
		},
		{
			name: 'three_ws_rig',
			description:
				'Auto-rig a static 3D model (GLB) into an animation-ready model: adds a humanoid skeleton and skin ' +
				'weights. Free, no API key required. Provide the GLB URL of a model (e.g. one three_ws_forge just produced).',
			schema: z.object({
				glbUrl: z.string().url().describe('http(s) URL to the static GLB mesh to rig.'),
			}),
			responseFormat: 'content_and_artifact',
		},
	);
}

export function createRenderTool({ baseUrl } = {}) {
	return tool(
		async ({ glbUrl, views, size }) => {
			const res = await callThreeWsTool({
				baseUrl,
				surface: 'free',
				tool: 'look_at_model',
				args: { glb_url: glbUrl, ...(views ? { views } : {}), ...(size ? { size } : {}) },
			});
			if (!res.ok) return [`render failed: ${res.error}`, { ok: false, error: res.error }];
			return [toolResultText(res.result), { ok: true, raw: res.result.structuredContent ?? null }];
		},
		{
			name: 'three_ws_render',
			description:
				'Render a turntable preview of any public .glb: several angles as images, plus its geometry stats and ' +
				'a plain reading of what they mean. Free, no API key required, works on any public https .glb.',
			schema: z.object({
				glbUrl: z.string().url().describe('Public https URL of the .glb to look at.'),
				views: z
					.array(z.enum(['front', 'three-quarter', 'side', 'back', 'top', 'bottom']))
					.max(6)
					.optional()
					.describe('Angles to render. Default: three-quarter, front, side, back.'),
				size: z.number().int().min(128).max(1024).optional().describe('Pixel size of each square frame. Default 512.'),
			}),
			responseFormat: 'content_and_artifact',
		},
	);
}

/**
 * Animate a rigged GLB from a text prompt. This is a PAID, x402-gated tool on
 * three.ws's main MCP server: calling it without a payment returns the raw
 * x402 PaymentRequired challenge as the tool's artifact instead of a model,
 * and this package never signs or sends that payment for you. Resolve the
 * challenge with your own x402 client against your own wallet (e.g. the
 * `x402-fetch` package), then pass the resulting header value in as
 * `xPayment`.
 */
export function createAnimateTool({ baseUrl, apiKey } = {}) {
	return tool(
		async ({ glbUrl, prompt, xPayment }) => {
			const res = await callThreeWsTool({
				baseUrl,
				surface: 'paid',
				tool: 'text_to_animation',
				args: { glb_url: glbUrl, prompt },
				apiKey,
				xPayment,
			});
			if (res.paymentRequired) {
				return [
					'payment required: this is a paid three.ws tool. Resolve res.artifact.challenge with your own x402 client and retry with xPayment set.',
					{ ok: false, paymentRequired: true, challenge: res.challenge },
				];
			}
			if (!res.ok) return [`animate failed: ${res.error}`, { ok: false, error: res.error }];
			return [toolResultText(res.result), { ok: true, raw: res.result.structuredContent ?? null }];
		},
		{
			name: 'three_ws_animate',
			description:
				'Retarget a text-described motion onto a rigged humanoid GLB (e.g. one three_ws_rig just produced). PAID: ' +
				'returns an x402 payment challenge unless a pre-signed X-PAYMENT value is supplied.',
			schema: z.object({
				glbUrl: z.string().url().describe('http(s) URL to a rigged GLB to animate.'),
				prompt: z.string().min(1).max(500).describe('The motion to generate, e.g. "wave hello", "walk forward".'),
				xPayment: z.string().optional().describe('A pre-signed x402 X-PAYMENT header value from your own wallet/x402 client.'),
			}),
			responseFormat: 'content_and_artifact',
		},
	);
}

export function createAgentChatTool({ baseUrl } = {}) {
	return tool(
		async ({ message, agentId }) => {
			const done = await callThreeWsChat({ baseUrl, message, agentId });
			return [done.reply, { ok: true, model: done.model, provider: done.provider }];
		},
		{
			name: 'three_ws_agent_chat',
			description: 'Send a message to a three.ws agent (or the default viewer agent) and get its reply. Free, no API key required.',
			schema: z.object({
				message: z.string().min(1).describe('What to say to the agent.'),
				agentId: z.string().uuid().optional().describe('A specific three.ws agent UUID; omit for the default agent.'),
			}),
			responseFormat: 'content_and_artifact',
		},
	);
}
