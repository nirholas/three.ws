// Avatar gallery alt text (Consumer 3 of the shared vision helper).
//
// Accessibility is not optional (CLAUDE.md). Gallery cards previously fell back
// to the avatar's name for the <img alt> — useless to a screen-reader user
// ("Avatar", "untitled-3"). This generates a real, concise visual description of
// the avatar's thumbnail with a free NIM vision lane: written on thumbnail
// upload and backfilled for existing rows.
//
// FAIL-OPEN: generateAltText returns null on any degraded path (vision
// unconfigured, timeout, error, empty reply). A null is stored as "not generated
// yet" and the gallery falls back to the name — alt text generation never blocks
// or breaks an avatar upload.

import { describeImage, visionConfigured, VISION_TASK_LEAD } from './vision.js';

const TIMEOUT_MS = 15_000;
const MAX_LEN = 160; // alt text should be terse; trim hard.

export const PROMPT =
	'Write a short, literal alt-text description of this avatar/character image for a ' +
	'screen reader. One sentence, under 20 words. Describe what is visibly shown — the ' +
	'subject, its appearance, colors, and style. Do NOT start with "Image of" or "A picture ' +
	'of", do not editorialize, and output ONLY the description text with no quotes.';

// Generate alt text for one avatar thumbnail. Pass EITHER an http(s) thumbnail
// URL or the raw PNG/JPEG bytes (base64) you already have in hand (preferred on
// the upload path — no extra round-trip, and no dependency on the object being
// publicly fetchable yet).
//
//   generateAltText({ imageUrl })                       — pass-through URL
//   generateAltText({ imageBase64, mimeType })          — inline bytes
//   + optional { name, track }
//
// Returns a trimmed string (≤160 chars) or null on any degraded path.
export async function generateAltText({ imageUrl = null, imageBase64 = null, mimeType = 'image/png', name = null, track = null } = {}) {
	if (!imageUrl && !imageBase64) return null;
	if (!visionConfigured()) return null;

	let result;
	try {
		result = await describeImage({
			prompt: name ? `${PROMPT}\n\n(The avatar is named "${name}" — for context only; describe what you see.)` : PROMPT,
			imageUrl,
			imageBase64,
			mimeType,
			lead: VISION_TASK_LEAD.caption,
			maxTokens: 60,
			timeoutMs: TIMEOUT_MS,
			track: { tool: 'avatar.alt-text', ...(track || {}) },
		});
	} catch {
		return null;
	}

	return cleanAltText(result.text);
}

// Normalize a model reply into a clean alt string: strip wrapping quotes, a
// leading "Image of"/"A picture of", collapse whitespace, hard-trim to MAX_LEN
// at a word boundary. Returns null for an empty/degenerate reply.
export function cleanAltText(raw) {
	let t = String(raw || '')
		.replace(/\s+/g, ' ')
		.trim()
		.replace(/^["'`]+|["'`]+$/g, '')
		.replace(/^(an?\s+)?(image|picture|photo|illustration|render)\s+(of|showing)\s+/i, '')
		.trim();
	if (!t) return null;
	if (t.length > MAX_LEN) {
		const cut = t.slice(0, MAX_LEN);
		const lastSpace = cut.lastIndexOf(' ');
		t = (lastSpace > 40 ? cut.slice(0, lastSpace) : cut).replace(/[\s,;:.]+$/, '') + '…';
	}
	// Capitalize the first letter — these become standalone alt sentences.
	return t.charAt(0).toUpperCase() + t.slice(1);
}
