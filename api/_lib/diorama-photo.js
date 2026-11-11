// Diorama: rebuild a scene from one photo.
//
// The vision chain (api/_lib/vision.js: the free OpenRouter routes lead for this
// caller, then the NIM lane, Vertex Gemini, and the paid OpenAI backstop) reads the photo as a set
// designer would: it lists the separable physical objects, boxes each one,
// estimates its real size and distance, and says what it rests on.
// src/diorama/photo-layout.js turns that report into a placed plan; the browser
// then forges every object (from its crop of the photo where it is fully
// visible, from its description otherwise) and the world assembles live.
//
// No mocks: a vision outage surfaces as a typed error the route maps to a
// designed 503, never as an invented room.

import { describeImageJson, visionConfigured } from './vision.js';
import { planFromPhotoAnalysis } from '../../src/diorama/photo-layout.js';
import { normalizeDiorama, MAX_OBJECTS, MOODS, GROUNDS } from '../../src/diorama/schema.js';

export { visionConfigured as photoComposerConfigured };

/** Max decoded size of an inline (base64) photo the route accepts. */
export const MAX_INLINE_PHOTO_BYTES = 700_000;

export const PHOTO_SET_DESIGNER_PROMPT = `You are a 3D set designer rebuilding this photo as a miniature 3D diorama. Every object you list is generated as its own 3D model and placed where it is in the photo.

List the distinct, separable physical objects, at most ${MAX_OBJECTS}, most important first. Include large furniture that other things rest on (a desk, a table, a bed, a shelf) because it carries them. Skip walls, floors, ceilings, windows, curtains, wall art, sky, ground, people's body parts, and anything cut off by more than half the frame edge. Merge tiny clutter into its container (a pen cup with pens is one object).

Reply ONLY with JSON, no prose, exactly this shape:
{
  "title": "2-4 word evocative title for the scene",
  "scene": "one sentence describing the scene, under 30 words",
  "mood": one of ${MOODS.map((m) => `"${m}"`).join(' | ')} (the light in the photo),
  "ground": one of ${GROUNDS.map((g) => `"${g}"`).join(' | ')} ("stone" for any indoor floor),
  "palette": { "sky": ["#RRGGBB top", "#RRGGBB horizon"], "ground": "#RRGGBB", "fog": "#RRGGBB", "accent": "#RRGGBB" } taken from the photo's own colors (sky = the wall or sky behind the scene, ground = the floor),
  "objects": [
    {
      "label": "2-3 word name",
      "prompt": "ONE isolated object exactly as it looks here: subject, shape, material, color, under 16 words",
      "box": { "left": L, "top": T, "right": R, "bottom": B },
      "distance_m": metres from the camera to the object,
      "footprint_m": its larger horizontal dimension (width or depth) in metres,
      "height_m": its height in metres,
      "on": the index (0-based, in this list) of the object it rests on, or null if it stands on the floor,
      "occluded": true if another object hides a significant part of it,
      "facing": "camera" | "left" | "right" | "away" (where its front points, from the viewer's side)
    }
  ]
}

box is the object's tight bounding box: each edge a whole number from 0 to 1000, measured from the image's top-left corner (left and right as thousandths of the image width, top and bottom as thousandths of its height). Use realistic real-world sizes (a laptop is about 0.33 m wide, a desk about 1.2 m). Output MUST be valid JSON.`;

/**
 * Read a photo and return a normalized, renderable Diorama plan whose layout
 * mirrors it. Pass exactly one of `imageUrl` (public https) or `imageBase64`.
 * `sourceImage`, when given, is stored on the plan so the world keeps a link
 * to the photo it came from.
 *
 * Throws `{ code: 'composer_unavailable' }` when no vision provider answers and
 * `{ code: 'photo_unreadable' }` when the photo yields no placeable object.
 */
export async function composePlanFromPhoto({ imageUrl = null, imageBase64 = null, mimeType = 'image/jpeg', sourceImage = null }) {
	let result;
	try {
		result = await describeImageJson({
			prompt: PHOTO_SET_DESIGNER_PROMPT,
			imageUrl,
			imageBase64,
			mimeType,
			maxTokens: 2000,
			timeoutMs: 30_000,
			deadlineMs: 60_000,
			track: { tool: 'diorama-photo' },
		});
	} catch (err) {
		// A reply that was not JSON is a bad read of this photo, not an outage.
		if (err?.code === 'vision_bad_json') {
			throw Object.assign(new Error('Could not make out the objects in that photo. Try a clearer, well-lit shot.'), {
				code: 'photo_unreadable',
			});
		}
		const lanes = Array.isArray(err?.lanes)
			? err.lanes.map((l) => `${l.provider}/${l.model || '-'}:${l.status ?? 'x'}`).join(' ')
			: '';
		console.error('[diorama-photo] vision failed:', err?.code || '', String(err?.message || '').slice(0, 200), lanes);
		throw Object.assign(new Error('The scene reader is busy. Try again in a moment.'), {
			code: 'composer_unavailable',
		});
	}

	const { plan } = planFromPhotoAnalysis(result.json);
	if (!plan.objects.length) {
		throw Object.assign(
			new Error('No separate objects stood out in that photo. Try one with a few distinct things in view: a desk, a shelf, a tabletop.'),
			{ code: 'photo_unreadable' },
		);
	}
	if (sourceImage) plan.sourceImage = sourceImage;

	const { ok, diorama } = normalizeDiorama(plan);
	if (!ok || !diorama.objects.length) {
		throw Object.assign(new Error('Could not place the objects from that photo. Try another shot.'), {
			code: 'photo_unreadable',
		});
	}
	return { diorama, provider: result.provider, model: result.model };
}

/**
 * True when `url` lives on this deployment's own public object storage (where
 * /api/forge-upload puts photos). Only those URLs are persisted on a world as
 * its `sourceImage`; any other public URL is read once and never republished.
 */
export function isOwnStorageUrl(url, publicDomain = process.env.S3_PUBLIC_DOMAIN) {
	if (typeof url !== 'string' || !publicDomain) return false;
	try {
		const u = new URL(url);
		const own = new URL(/^https?:\/\//i.test(publicDomain) ? publicDomain : `https://${publicDomain}`);
		return u.protocol === 'https:' && u.host === own.host;
	} catch {
		return false;
	}
}

/**
 * Validate an inline photo: a bare base64 string or a data: URL of a png/jpeg/webp
 * no larger than MAX_INLINE_PHOTO_BYTES. Returns `{ base64, mimeType }` or `{ error }`.
 */
export function parseInlinePhoto(raw) {
	if (typeof raw !== 'string' || !raw) return { error: 'imageBase64 must be a base64 string or data URL.' };
	let mimeType = 'image/jpeg';
	let base64 = raw.trim();
	const m = base64.match(/^data:(image\/(?:png|jpeg|webp));base64,(.*)$/s);
	if (m) {
		mimeType = m[1];
		base64 = m[2];
	} else if (base64.startsWith('data:')) {
		return { error: 'The photo must be a PNG, JPEG or WebP image.' };
	}
	if (!/^[A-Za-z0-9+/=\s]+$/.test(base64)) return { error: 'imageBase64 is not valid base64.' };
	const bytes = Math.floor((base64.replace(/[\s=]/g, '').length * 3) / 4);
	if (bytes < 1024) return { error: 'That photo is too small to read.' };
	if (bytes > MAX_INLINE_PHOTO_BYTES) {
		return { error: `Inline photos are capped at ${Math.round(MAX_INLINE_PHOTO_BYTES / 1000)} KB. Downscale it or send imageUrl.` };
	}
	return { base64: base64.replace(/\s/g, ''), mimeType };
}

/**
 * Copy of a world about to be saved with every photo link that is not on our
 * own storage removed (`sourceImage`, each object's `refImage`). A saved world
 * is republished to every visitor, so it may only point at photos this
 * deployment stored itself, never at an arbitrary third-party URL.
 */
export function stripForeignPhotos(diorama, publicDomain = process.env.S3_PUBLIC_DOMAIN) {
	if (!diorama || typeof diorama !== 'object') return diorama;
	const out = { ...diorama };
	if ('sourceImage' in out && !isOwnStorageUrl(out.sourceImage, publicDomain)) delete out.sourceImage;
	if (Array.isArray(out.objects)) {
		out.objects = out.objects.map((o) => {
			if (!o || typeof o !== 'object' || !('refImage' in o) || isOwnStorageUrl(o.refImage, publicDomain)) return o;
			const { refImage: _drop, ...rest } = o;
			return rest;
		});
	}
	return out;
}
