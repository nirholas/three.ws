#!/usr/bin/env node
// Validate the A2A Agent Cards against the shared rules in
// scripts/lib/a2a-card-rules.mjs (the same rules tests/a2a-agent-card.test.js
// runs), so an edit that reverts `url`, `securitySchemes`, the version or the
// optional extension fails locally before it ships.
//
//   public       public/.well-known/agent-card.json (always checked)
//   marketplace  the Marketplace copy derived from it by
//                scripts/build-marketplace-agent-card.mjs (built in memory and
//                checked; dist/marketplace/agent-card.json too when it exists)
//
// Run: npm run validate:a2a-card     Exit code 1 on any failure.

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { validateA2ACard } from './lib/a2a-card-rules.mjs';
import { A2A_SKILL_IDS } from '../api/_lib/a2a/skills.js';
import { buildMarketplaceCard, MARKETPLACE_CARD_PATH } from './build-marketplace-agent-card.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const readJson = (rel) => JSON.parse(readFileSync(path.join(root, rel), 'utf8'));

const pkg = readJson('package.json');
const ctx = { expectedVersion: pkg.version, reachableSkillIds: A2A_SKILL_IDS };
const publicCard = readJson('public/.well-known/agent-card.json');

const targets = [
	{ label: 'public/.well-known/agent-card.json', card: publicCard, profile: 'public' },
	{ label: 'Marketplace card (derived)', card: buildMarketplaceCard(publicCard), profile: 'marketplace' },
];
if (existsSync(path.join(root, MARKETPLACE_CARD_PATH))) {
	targets.push({ label: MARKETPLACE_CARD_PATH, card: readJson(MARKETPLACE_CARD_PATH), profile: 'marketplace' });
}

let failed = 0;
for (const { label, card, profile } of targets) {
	const failures = validateA2ACard(card, ctx, { profile });
	if (!failures.length) {
		console.log(`ok    ${label} (${profile})`);
		continue;
	}
	failed += 1;
	console.error(`FAIL  ${label} (${profile})`);
	for (const f of failures) console.error(`        ${f.id}: ${f.problem}`);
}

if (failed) process.exit(1);
