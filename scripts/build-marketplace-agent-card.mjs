// Build the Google Cloud Marketplace copy of the three.ws A2A Agent Card.
//
// The public card (public/.well-known/agent-card.json, written by
// scripts/build-discovery-cards.mjs) is read by every A2A client and must keep
// its own shape. The Marketplace listing instead takes a JSON object uploaded to
// Cloud Storage in the listing project and attached in Producer Portal (owner-run,
// docs/ops/google-marketplace-agent-card.md). Marketplace customers are invoiced
// by Google, so this card:
//   - keeps the same endpoint, protocol versions, interfaces, security and modes;
//   - rewrites the name and description in enterprise wording about the 3D skills;
//   - offers only the registry skills marked `marketplace` (api/_lib/a2a/skills.js);
//   - drops the pay-per-call extension and carries one optional listing extension
//     with the models, competence and billing facts Google's Agent Card doc asks for.
//
// It is derived from the public card, never edited by hand, so the two cannot
// drift apart on anything but those four things (tests/a2a-agent-card.test.js
// pins that).
//
// Run: npm run build:marketplace-card   (writes dist/marketplace/agent-card.json)

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { MARKETPLACE_LISTING_EXTENSION_URI, validateA2ACard } from './lib/a2a-card-rules.mjs';
import { A2A_SKILLS, A2A_SKILL_IDS, cardSkill } from '../api/_lib/a2a/skills.js';
import { IMAGE_MODEL_PRIMARY, IMAGE_MODEL_FALLBACK } from '../api/_lib/image-model.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const MARKETPLACE_CARD_PATH = 'dist/marketplace/agent-card.json';

export const MARKETPLACE_NAME = 'three.ws 3D Agent';

export const MARKETPLACE_DESCRIPTION =
	'Enterprise 3D content agent. Turns a short text description into a textured, embeddable 3D model ' +
	'(GLB), validates and inspects glTF/GLB files with the Khronos glTF-Validator and returns ' +
	'prioritized optimization advice, and searches a public gallery of ready-made 3D characters. ' +
	'Runs on Google Cloud: reference views are drawn with Gemini on Vertex AI and reconstructed into ' +
	'3D on Cloud Run GPUs. Speaks A2A 1.0 and 0.3 over JSON-RPC.';

// The model facts the listing states. The default is the Gemini image model the
// forge pipeline calls first (api/_lib/image-model.js), read from that constant
// so a model change there changes the listing on the next build.
export function marketplaceModels() {
	return [
		{
			name: IMAGE_MODEL_PRIMARY,
			provider: 'Google',
			platform: 'Vertex AI',
			role: 'Draws the reference view a text prompt is reconstructed from',
			fallback: IMAGE_MODEL_FALLBACK,
			default: true,
		},
		{
			name: 'gemini-2.5-flash',
			provider: 'Google',
			platform: 'Vertex AI',
			role: 'Quality-checks each reference view before reconstruction',
			default: false,
		},
		{
			name: 'TRELLIS',
			provider: 'Microsoft Research (open weights)',
			platform: 'NVIDIA NIM',
			role: 'Reconstructs the textured 3D mesh from the reference view',
			default: false,
		},
		{
			name: 'Hunyuan3D',
			provider: 'Tencent (open weights)',
			platform: 'Self-hosted on Google Cloud Run GPUs',
			role: 'High-fidelity reconstruction for the high quality tier',
			default: false,
		},
	];
}

export const MARKETPLACE_COMPETENCE = [
	'Text to textured 3D model (GLB) for one object or character per request, in draft, standard or high tiers',
	'glTF 2.0 and GLB validation with the Khronos glTF-Validator: errors, warnings, infos and hints',
	'Structural inspection: vertices, triangles, meshes, materials, textures, animations, skins and extensions',
	'Prioritized web-delivery optimization advice for a model',
	'Keyword and tag search across a public gallery of 3D characters, returning GLB and page links',
];

export const MARKETPLACE_BILLING = {
	invoicedBy: 'Google Cloud Marketplace',
	note:
		'Marketplace customers are invoiced by Google under their Marketplace subscription. No per-call ' +
		'settlement or separate payment step is needed to use the skills on this card.',
};

/** Derive the Marketplace card from the public card. Pure: no I/O. */
export function buildMarketplaceCard(publicCard) {
	const skills = A2A_SKILLS.filter((s) => s.marketplace).map(cardSkill);
	return {
		...publicCard,
		name: MARKETPLACE_NAME,
		description: MARKETPLACE_DESCRIPTION,
		capabilities: {
			...publicCard.capabilities,
			extensions: [
				{
					uri: MARKETPLACE_LISTING_EXTENSION_URI,
					description: 'Google Cloud Marketplace listing facts: the models used, the competence, and billing.',
					required: false,
					params: {
						models: marketplaceModels(),
						competence: MARKETPLACE_COMPETENCE,
						billing: MARKETPLACE_BILLING,
					},
				},
			],
		},
		skills,
	};
}

function main() {
	const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
	const publicCard = JSON.parse(readFileSync(path.join(root, 'public/.well-known/agent-card.json'), 'utf8'));
	const card = buildMarketplaceCard(publicCard);
	const failures = validateA2ACard(
		card,
		{ expectedVersion: pkg.version, reachableSkillIds: A2A_SKILL_IDS },
		{ profile: 'marketplace' },
	);
	if (failures.length) {
		console.error('[marketplace-card] the card fails the A2A Marketplace rules, not writing it:');
		for (const f of failures) console.error(`  ${f.id}: ${f.problem}`);
		process.exit(1);
	}
	const out = path.join(root, MARKETPLACE_CARD_PATH);
	mkdirSync(path.dirname(out), { recursive: true });
	writeFileSync(out, `${JSON.stringify(card, null, '\t')}\n`);
	console.log(`[marketplace-card] wrote ${MARKETPLACE_CARD_PATH} (${card.skills.length} skills, version ${card.version})`);
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) main();
