// image_generate: text to image on the platform's forge lanes.
//
// Rides api/_mcp3d/text-to-image.js (Vertex Imagen first, NIM FLUX and the
// Replicate backstop behind it), which persists the render to object storage and
// returns a durable URL. A refusal, an unconfigured deployment and a busy lane
// each map to their own typed error, and every one of them is refunded by the
// meter because the call throws.

import { textToImage } from '../../_mcp3d/text-to-image.js';
import { SUPPORTED_ASPECT_RATIOS, providerLabel, isProviderRefusal, refusalReason, missingLaneEnv } from '../ai-image-lanes.js';
import { isInlineImageRef } from '../image-persist.js';
import { GatewayError } from './errors.js';

export const IMAGE_MAX_PROMPT = 2000;
export const IMAGE_MIN_PROMPT = 3;

function readImageArgs(args) {
	const prompt = String(args?.prompt ?? '').trim();
	if (prompt.length < IMAGE_MIN_PROMPT) throw new GatewayError(400, 'bad_request', `"prompt" must be at least ${IMAGE_MIN_PROMPT} characters.`);
	if (prompt.length > IMAGE_MAX_PROMPT) throw new GatewayError(413, 'too_large', `"prompt" must be at most ${IMAGE_MAX_PROMPT} characters.`);
	const aspectRatio = args?.aspect_ratio == null ? '1:1' : String(args.aspect_ratio);
	if (!SUPPORTED_ASPECT_RATIOS.includes(aspectRatio)) {
		throw new GatewayError(400, 'bad_request', `"aspect_ratio" must be one of: ${SUPPORTED_ASPECT_RATIOS.join(', ')}.`);
	}
	let seed;
	if (args?.seed != null) {
		seed = Number(args.seed);
		if (!Number.isInteger(seed) || seed < 0 || seed > 4_294_967_295) throw new GatewayError(400, 'bad_request', '"seed" must be an integer from 0 to 4294967295.');
	}
	return { prompt, aspectRatio, seed };
}

/** Validates the arguments and returns the unit count charged up front (one image). */
export function estimateImage(args) {
	readImageArgs(args);
	return 1;
}

export async function imageGenerate(args) {
	const { prompt, aspectRatio, seed } = readImageArgs(args);
	let out;
	try {
		out = await textToImage(prompt, { aspectRatio, seed });
	} catch (err) {
		if (isProviderRefusal(err)) throw new GatewayError(422, 'content_refused', refusalReason(err));
		if (err?.code === 'unconfigured') {
			throw new GatewayError(503, 'not_configured', `No image lane is configured on this deployment. Set one of: ${missingLaneEnv().join(', ')}.`);
		}
		if (err?.code === 'rate_limited') throw new GatewayError(429, 'rate_limited', 'Image generation is briefly busy. Retry shortly.');
		if (err?.code === 'provider_unreachable' || err?.code === 'billing') {
			throw new GatewayError(503, 'lane_unavailable', 'The image lane is temporarily unavailable. Retry shortly.');
		}
		throw new GatewayError(502, 'generation_failed', String(err?.message || 'Image generation failed.').slice(0, 300));
	}
	const url = out?.imageUrl;
	if (!url || isInlineImageRef(url) || !/^https?:\/\//.test(url)) {
		throw new GatewayError(503, 'storage_unavailable', 'The image was generated but could not be stored. Retry shortly.');
	}
	return {
		result: { url, prompt, aspect_ratio: aspectRatio, provider: providerLabel(out), model: out.model || null },
		units: 1,
		provider: providerLabel(out),
	};
}
