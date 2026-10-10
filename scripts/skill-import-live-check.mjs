#!/usr/bin/env node
// Live check for external skill import (docs/skill-import.md).
//
// Reads the real public registries the importer ships with, exactly as
// /skills/import and the MCP tools do: indexes each at its current commit,
// checks every licence, fetches a sample of SKILL.md bodies at their pinned
// blob and verifies the bytes, and scans each one. Then scans the deliberately
// hostile fixture (tests/fixtures/skill-import/hostile/SKILL.md) through the
// same scanner and fails unless it is refused.
//
//   node --env-file=.env.local scripts/skill-import-live-check.mjs
//   node --env-file=.env.local scripts/skill-import-live-check.mjs --sample 6
//   node --env-file=.env.local scripts/skill-import-live-check.mjs --hostile-registry nirholas/three.ws/tests/fixtures/skill-import
//
// --hostile-registry reads the hostile skill from a real GitHub registry
// instead of the local file, so the refusal is proven end to end (index, pin,
// integrity check, scan). Exits 1 when a registry lists no skills, a body fails
// its integrity check, or the hostile skill is not refused.

import { readFileSync } from 'node:fs';
import {
	BUILTIN_REGISTRY_INPUTS,
	parseRegistryInput,
	registryIndex,
	fetchSkillBody,
	licensePolicy,
	parseSkillFile,
	skillManifest,
	classifyLicense,
	categorize,
} from '../api/_lib/skill-import-sources.js';
import { scanSkill } from '../api/_lib/skill-import-scan.js';

const args = process.argv.slice(2);
const opt = (name, fallback) => {
	const i = args.indexOf(name);
	return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const SAMPLE = Number(opt('--sample', 4));
const HOSTILE_REGISTRY = opt('--hostile-registry', null);

let failed = false;
const fail = (msg) => {
	failed = true;
	console.log(`  FAIL ${msg}`);
};

function summarize(report) {
	const blocks = report.findings.filter((f) => f.severity === 'block').map((f) => f.rule);
	const warns = report.findings.filter((f) => f.severity === 'warn').map((f) => f.rule);
	const caps = Object.entries(report.capabilities).filter(([, c]) => c.requested).map(([k]) => k);
	return `${report.verdict}${report.gated ? ' gated' : ''} tokens=${report.tokens} guardian=${report.guardian.status === 'ok' ? report.guardian.decision : report.guardian.status}` +
		`${blocks.length ? ` block=[${blocks.join(',')}]` : ''}${warns.length ? ` warn=[${warns.join(',')}]` : ''}${caps.length ? ` asks=[${caps.join(',')}]` : ''}`;
}

async function checkRegistry(input) {
	const reg = parseRegistryInput(input);
	console.log(`\n== ${reg.label} (${reg.key})`);
	const index = await registryIndex(reg, { fresh: true });
	const listed = index.skills.filter((s) => licensePolicy(s.license).listed);
	const excluded = index.skills.filter((s) => !licensePolicy(s.license).listed);
	console.log(`  commit ${index.commit}  skills ${index.skills.length}  listed ${listed.length}  excluded ${excluded.length}  errors ${index.errors.length}${index.truncated ? '  (truncated)' : ''}`);
	const byLicense = {};
	for (const s of index.skills) byLicense[s.license.spdx || s.license.class] = (byLicense[s.license.spdx || s.license.class] || 0) + 1;
	console.log(`  licences ${JSON.stringify(byLicense)}`);
	const byCategory = {};
	for (const s of listed) byCategory[s.category] = (byCategory[s.category] || 0) + 1;
	console.log(`  categories ${JSON.stringify(byCategory)}`);
	for (const s of excluded) console.log(`  excluded ${s.slug}: ${licensePolicy(s.license).reason}`);
	for (const e of index.errors) console.log(`  unreadable ${e.path}: ${e.error}`);
	if (!listed.length) fail(`${reg.label} lists no installable skills`);

	for (const entry of listed.slice(0, SAMPLE)) {
		try {
			const body = await fetchSkillBody(reg, entry);
			const report = await scanSkill(entry, body);
			console.log(`  ${entry.slug.padEnd(28)} ${entry.license.spdx || '-'} pin ${String(entry.pin.blob_sha || entry.pin.sha256).slice(0, 12)}  ${summarize(report)}`);
		} catch (err) {
			fail(`${entry.slug}: ${err.code || ''} ${err.message}`);
		}
	}
	return { reg, index };
}

async function hostileFromFile() {
	const path = new URL('../tests/fixtures/skill-import/hostile/SKILL.md', import.meta.url);
	const text = readFileSync(path, 'utf8');
	const parsed = parseSkillFile(text);
	const m = skillManifest({ frontmatter: parsed?.data || {}, fallbackSlug: 'hostile' });
	const entry = { ...m, slug: 'portfolio-rebalancer', parse_ok: !!parsed, license: classifyLicense(m.license_text), files: [] };
	entry.category = categorize(entry);
	return { entry, text, where: 'tests/fixtures/skill-import/hostile/SKILL.md' };
}

async function hostileFromRegistry(input) {
	const reg = parseRegistryInput(input);
	const index = await registryIndex(reg, { fresh: true });
	const entry = index.skills.find((s) => s.slug === 'hostile' || s.name === 'portfolio-rebalancer');
	if (!entry) throw new Error(`no hostile skill found in ${reg.label}`);
	return { entry, text: await fetchSkillBody(reg, entry), where: `${reg.label} @ ${index.commit}` };
}

async function checkHostile() {
	console.log('\n== hostile skill');
	const { entry, text, where } = HOSTILE_REGISTRY ? await hostileFromRegistry(HOSTILE_REGISTRY) : await hostileFromFile();
	const report = await scanSkill(entry, text);
	console.log(`  source ${where}`);
	console.log(`  ${summarize(report)}`);
	for (const f of report.findings.filter((x) => x.severity === 'block')) console.log(`  block ${f.rule.padEnd(22)} line ${f.line ?? '-'}: ${f.message}`);
	if (report.verdict !== 'refused') fail('the hostile skill was not refused');
	else console.log('  ok: refused, it cannot be installed');
	if (!report.gated) fail('the hostile skill was not flagged for the spend gate');
}

for (const r of BUILTIN_REGISTRY_INPUTS.filter((x) => x.input !== 'published')) {
	try {
		await checkRegistry(r.input);
	} catch (err) {
		fail(`${r.label}: ${err.code || ''} ${err.message}`);
	}
}
await checkHostile();
console.log(failed ? '\nskill-import live check FAILED' : '\nskill-import live check passed');
process.exit(failed ? 1 : 0);
