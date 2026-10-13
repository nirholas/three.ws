// Vercel AI SDK `tool()` definitions for three.ws's generative 3D pipeline:
// forge a model from text, rig it for animation, render a turntable preview,
// animate it from a text prompt, and chat with a three.ws agent persona.
// forge/rig/render call the free, no-auth /api/mcp-studio server; animate
// calls the paid, x402-gated /api/mcp server and never pays on the caller's
// behalf (see `animateTool`'s doc comment); agentChat calls the public
// /api/chat SSE endpoint.

import { tool } from 'ai';
import { z } from 'zod';
import { callThreeWsTool, callThreeWsChat, toolResultText } from './client.js';

/**
 * Build all five three.ws tools bound to one configuration. Pass the result's
 * values straight into `generateText({ tools })` / `streamText({ tools })`.
 * @param {object} [config]
 * @param {string} [config.baseUrl] override for self-hosted / staging deployments
 * @param {string} [config.apiKey] three.ws API key, only needed for `animateTool`
 */
export function createThreeWsTools(config = {}) {
	return {
		forge: forgeTool(config),
		rig: rigTool(config),
		render: renderTool(config),
		animate: animateTool(config),
		agentChat: agentChatTool(config),
	};
}

export function forgeTool({ baseUrl } = {}) {
	return tool({
		description:
			'Generate a textured, downloadable 3D model (GLB) from a text prompt. Free, no API key required. ' +
			'Describe a single object, character, or creature.',
		inputSchema: z.object({
			prompt: z.string().min(3).max(1000).describe('What to model, e.g. "a friendly round robot mascot, glossy white plastic".'),
			tier: z.enum(['draft', 'standard', 'high']).optional().describe('Detail level; standard is the default.'),
		}),
		execute: async ({ prompt, tier }) => {
			const res = await callThreeWsTool({ baseUrl, surface: 'free', tool: 'forge_free', args: { prompt, ...(tier ? { tier } : {}) } });
			if (!res.ok) return { ok: false, error: res.error || 'forge failed' };
			return { ok: true, text: toolResultText(res.result), raw: res.result.structuredContent ?? null };
		},
	});
}

export function rigTool({ baseUrl } = {}) {
	return tool({
		description:
			'Auto-rig a static 3D model (GLB) into an animation-ready model: adds a humanoid skeleton and skin ' +
			'weights. Free, no API key required. Provide the GLB URL of a model (e.g. one `forge` just produced).',
		inputSchema: z.object({
			glbUrl: z.string().url().describe('http(s) URL to the static GLB mesh to rig.'),
		}),
		execute: async ({ glbUrl }) => {
			const res = await callThreeWsTool({ baseUrl, surface: 'free', tool: 'rig_mesh', args: { glb_url: glbUrl } });
			if (!res.ok) return { ok: false, error: res.error || 'rig failed' };
			return { ok: true, text: toolResultText(res.result), raw: res.result.structuredContent ?? null };
		},
	});
}

export function renderTool({ baseUrl } = {}) {
	return tool({
		description:
			'Render a turntable preview of any public .glb: several angles as images, plus its geometry stats and ' +
			'a plain reading of what they mean. Free, no API key required, works on any public https .glb.',
		inputSchema: z.object({
			glbUrl: z.string().url().describe('Public https URL of the .glb to look at.'),
			views: z
				.array(z.enum(['front', 'three-quarter', 'side', 'back', 'top', 'bottom']))
				.max(6)
				.optional()
				.describe('Angles to render. Default: three-quarter, front, side, back.'),
			size: z.number().int().min(128).max(1024).optional().describe('Pixel size of each square frame. Default 512.'),
		}),
		execute: async ({ glbUrl, views, size }) => {
			const res = await callThreeWsTool({
				baseUrl,
				surface: 'free',
				tool: 'look_at_model',
				args: { glb_url: glbUrl, ...(views ? { views } : {}), ...(size ? { size } : {}) },
			});
			if (!res.ok) return { ok: false, error: res.error || 'render failed' };
			return { ok: true, text: toolResultText(res.result), raw: res.result.structuredContent ?? null };
		},
	});
}

/**
 * Animate a rigged GLB from a text prompt. This is a PAID, x402-gated tool on
 * three.ws's main MCP server: calling it without a payment returns the raw
 * x402 PaymentRequired challenge (`paymentRequired: true, challenge: {...}`)
 * instead of a model, and this package never signs or sends that payment for
 * you. Resolve the challenge with your own x402 client against your own
 * wallet (e.g. the `x402-fetch` package), then pass the resulting header
 * value in as `xPayment`.
 */
export function animateTool({ baseUrl, apiKey } = {}) {
	return tool({
		description:
			'Retarget a text-described motion onto a rigged humanoid GLB (e.g. one `rig` just produced). PAID: ' +
			'returns an x402 payment challenge unless a pre-signed X-PAYMENT value is supplied.',
		inputSchema: z.object({
			glbUrl: z.string().url().describe('http(s) URL to a rigged GLB to animate.'),
			prompt: z.string().min(1).max(500).describe('The motion to generate, e.g. "wave hello", "walk forward".'),
			xPayment: z.string().optional().describe('A pre-signed x402 X-PAYMENT header value from your own wallet/x402 client.'),
		}),
		execute: async ({ glbUrl, prompt, xPayment }) => {
			const res = await callThreeWsTool({
				baseUrl,
				surface: 'paid',
				tool: 'text_to_animation',
				args: { glb_url: glbUrl, prompt },
				apiKey,
				xPayment,
			});
			if (res.paymentRequired) return { ok: false, paymentRequired: true, challenge: res.challenge };
			if (!res.ok) return { ok: false, error: res.error || 'animate failed' };
			return { ok: true, text: toolResultText(res.result), raw: res.result.structuredContent ?? null };
		},
	});
}

export function agentChatTool({ baseUrl } = {}) {
	return tool({
		description:
			'Send a message to a three.ws agent (or the default viewer agent) and get its reply. Free, no API ' +
			'key required.',
		inputSchema: z.object({
			message: z.string().min(1).describe('What to say to the agent.'),
			agentId: z.string().uuid().optional().describe('A specific three.ws agent UUID; omit for the default agent.'),
		}),
		execute: async ({ message, agentId }) => {
			const done = await callThreeWsChat({ baseUrl, message, agentId });
			return { ok: true, reply: done.reply, model: done.model, provider: done.provider };
		},
	});
}
