// `get_pose_seed` — paid MCP tool that maps a natural-language pose prompt to
// a deterministic seed + a complete joint-rotation map for the three.ws
// pose-studio mannequin.
//
// Pricing: $0.001 USDC, settled `exact` in USDC on Solana mainnet.
//
// Output (real, not synthetic): the picked preset's full Euler rotation set
// from src/pose-presets.js (the same data the public /pose page renders),
// plus a stable seed derived from sha256(prompt|presetId), and a previewUrl
// pointing at /pose with the seed param so the user can open the result.
//
// Selection algorithm: score every PRESET by token overlap against the
// prompt, fall back to label/group substring containment, then to a
// deterministic-by-seed pick across all presets. Always returns a real
// preset — there is no synthetic-pose codepath.

import { createHash } from 'node:crypto';
import { z } from 'zod';

import { paid } from '../payments.js';
import { jsonSchemaFromZod } from './_shared.js';
import { PRESETS, PRESET_GROUPS } from '../lib/pose-presets.js';

const TOOL_NAME = 'get_pose_seed';
const TOOL_DESCRIPTION =
	'Deterministic pose-studio seed + complete joint rotations for the three.ws mannequin, picked from the in-repo preset library by matching natural-language prompt tokens against preset labels, IDs, and groups. Returns the preset id, the full Euler-rotation pose map (radians), a sha256-derived seed, and a previewUrl on three.ws/pose. Use this to turn a pose description such as "warrior pose" or "waving" into exact joint rotations and a pose-studio link. Paid: $0.001 USDC.';

const PREVIEW_BASE = process.env.MCP_POSE_PREVIEW_BASE || 'https://three.ws/pose';

function tokensOf(s) {
	return String(s || '')
		.toLowerCase()
		.split(/[^a-z0-9]+/g)
		.filter(Boolean);
}

// Build a stable token set per preset once. ID, label words, and group all
// contribute to the scoreable vocabulary so prompts like "running" hit `run`,
// "wave" hits `wave`, "warrior pose" hits the `warrior` action preset, etc.
const PRESET_INDEX = PRESETS.map((p) => {
	const idTokens = tokensOf(p.id);
	const labelTokens = tokensOf(p.label);
	const groupTokens = tokensOf(p.group);
	return {
		preset: p,
		all: new Set([...idTokens, ...labelTokens, ...groupTokens]),
		idTokens,
		labelTokens,
	};
});

function scorePreset(promptTokens, entry) {
	let score = 0;
	for (const t of promptTokens) {
		if (entry.all.has(t)) score += 3;
		else {
			// substring containment in id or label gives partial credit so
			// "wav" hits "wave", "punch" hits "punch (right)".
			for (const tok of [...entry.idTokens, ...entry.labelTokens]) {
				if (tok.includes(t) || t.includes(tok)) {
					score += 1;
					break;
				}
			}
		}
	}
	return score;
}

function pickPreset(prompt) {
	const tokens = tokensOf(prompt);
	if (tokens.length === 0) {
		// Empty prompt is still legal — we deterministically pick a preset
		// keyed off the prompt string (which may be whitespace) so the same
		// caller gets the same result.
		const hash = createHash('sha256').update(prompt).digest();
		const idx = hash.readUInt32BE(0) % PRESETS.length;
		return { entry: PRESET_INDEX[idx], score: 0, reason: 'no-match-deterministic-pick' };
	}
	let best = null;
	let bestScore = -1;
	for (const entry of PRESET_INDEX) {
		const s = scorePreset(tokens, entry);
		if (s > bestScore) {
			best = entry;
			bestScore = s;
		}
	}
	if (bestScore <= 0) {
		const hash = createHash('sha256').update(prompt).digest();
		const idx = hash.readUInt32BE(0) % PRESETS.length;
		return { entry: PRESET_INDEX[idx], score: 0, reason: 'no-match-deterministic-pick' };
	}
	return { entry: best, score: bestScore, reason: 'token-match' };
}

function deriveSeed(prompt, presetId) {
	return createHash('sha256').update(`${prompt}|${presetId}`).digest('hex').slice(0, 16);
}

// Single source of truth: declare the args once as a Zod shape (with the
// human-facing descriptions + bounds), and derive the JSON Schema the MCP
// client / bazaar sees from it. The previous hand-written JSON Schema had no
// length bounds; the Zod (min 1, max 500) is stricter and now wins.
const inputZodShape = {
	prompt: z
		.string()
		.min(1)
		.max(500)
		.describe('Natural-language description of the pose, e.g. "warrior stance", "wave hello", "sitting cross-legged".'),
};

const inputJsonSchema = jsonSchemaFromZod(inputZodShape);

export async function buildPoseSeedTool() {
	const handler = await paid(
		{
			toolName: TOOL_NAME,
			description: TOOL_DESCRIPTION,
			scheme: 'exact',
			priceUsd: '$0.001',
			inputSchema: inputJsonSchema,
			example: { prompt: 'wave hello' },
			outputExample: {
				seed: '8c12...e0f9',
				presetId: 'wave',
				presetLabel: 'Wave hello',
				group: 'Standing',
				parameters: {
					shoulderL: { x: 0, y: 0, z: 0.1 },
					shoulderR: { x: 0, y: 0, z: -2.45 },
					elbowR: { x: -1.2, y: 0, z: 0 },
				},
				previewUrl: 'https://three.ws/pose?seed=8c12...e0f9&preset=wave',
				match: { score: 3, reason: 'token-match' },
				groups: PRESET_GROUPS,
			},
		},
		async ({ prompt }) => {
			const picked = pickPreset(prompt);
			const seed = deriveSeed(prompt, picked.entry.preset.id);
			const previewUrl = `${PREVIEW_BASE}?seed=${encodeURIComponent(seed)}&preset=${encodeURIComponent(picked.entry.preset.id)}`;
			return {
				seed,
				presetId: picked.entry.preset.id,
				presetLabel: picked.entry.preset.label,
				group: picked.entry.preset.group,
				parameters: picked.entry.preset.pose,
				previewUrl,
				match: { score: picked.score, reason: picked.reason },
				groups: PRESET_GROUPS,
			};
		},
	);
	return {
		name: TOOL_NAME,
		title: 'Pose seed ($0.001)',
		description: TOOL_DESCRIPTION,
		inputSchema: inputZodShape,
		// Pure deterministic local compute: same prompt → same pose preset,
		// no external interaction.
		annotations: {
			readOnlyHint: true,
			destructiveHint: false,
			idempotentHint: true,
			openWorldHint: false,
		},
		handler,
	};
}
