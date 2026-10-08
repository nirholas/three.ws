#!/usr/bin/env node
// Regenerates the three.ws Agent Skills pack manifest from the skill files
// themselves, so the registry-facing index can never drift from what ships:
//
//   .agents/skills/skills-pack.json  : machine-readable pack manifest
//   .agents/skills/SKILLS.md         : human-readable index (same data)
//   public/skill.md                  : the entry-point skill (any agent runtime)
//   public/grok-skill.md             : the same platform, written for Grok and Grok Bot
//
// Usage: node scripts/build-skills-pack.mjs [--check]
//   --check  exit 1 if the generated output differs from what is on disk
//            (use before committing skill changes)
//
// Native three.ws skills carry their category in SKILL.md frontmatter
// (metadata.category / metadata.cross-platform-safe / metadata.pack).
// Vendored partner skills (okx-*, metamask-*) are left byte-identical to the
// vendor drop; their categories live only in VENDORED_CATEGORIES below.

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { renderFacts, skillFacts } from './lib/skill-md-facts.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const SKILLS_DIR = path.join(ROOT, '.agents', 'skills');

const PACK = {
	name: 'three-ws-skills',
	version: '1.0.0',
	description:
		'The three.ws Agent Skills pack: 3D creation, building and monetizing on the three.ws platform, the wallet/x402 agent economy, and vendored partner skills, for any Claude surface (Claude Code, the Claude apps, the Agent SDK).',
	spec: 'https://agentskills.io/specification',
	homepage: 'https://three.ws',
};

// One source of truth for what each category means. Both outputs render from this
// map, so a new category cannot land in the counts while the prose still omits it
// (which is exactly how ops/production ended up counted but undescribed). The
// `bundle` line is the one-liner the human index prints.
const CATEGORY_DESCRIPTIONS = {
	'3d/creative': {
		json: '3D generation & rigging. Cross-platform-safe: no coin, wallet, or payment-protocol content - reusable on non-Claude tracks.',
		md: '3D generation & rigging. The cross-platform-safe subset: zero coin/wallet/payment strings, reusable outside Claude.',
	},
	'platform/agents': {
		json: 'Build on three.ws itself: create agents, author and sell agent skills, hire other agents, and connect a client to the MCP servers.',
		md: 'Build on three.ws itself: create agents, author and sell agent skills, hire other agents, connect MCP clients.',
	},
	'wallet/payments': {
		json: 'Wallet auth, funding, transfers, and the x402 paid-API economy.',
		md: 'wallet auth, funding, transfers, and the x402 paid-API economy. Never bundle on the OpenAI track.',
	},
	'intel/trading': {
		json: 'Market data, trading signals, DEX/DeFi execution.',
		md: 'market data, signals, DEX/DeFi execution. Never bundle on the OpenAI track.',
	},
	'ops/production': {
		json: 'Operating the three.ws production fleet. For maintainers, not for end users of the platform.',
		md: 'operating the three.ws production fleet. For maintainers, not platform users.',
	},
};

// Category + origin for skills whose SKILL.md we do not edit (vendor drops).
const VENDORED_CATEGORIES = {
	'metamask-agent-wallet': { category: 'wallet/payments', origin: 'metamask' },
	'metamask-agent-workflows': { category: 'wallet/payments', origin: 'metamask' },
	'okx-agent-chat': { category: 'wallet/payments', origin: 'okx' },
	'okx-agent-identity': { category: 'wallet/payments', origin: 'okx' },
	'okx-agent-payments-protocol': { category: 'wallet/payments', origin: 'okx' },
	'okx-agent-task': { category: 'wallet/payments', origin: 'okx' },
	'okx-agentic-wallet': { category: 'wallet/payments', origin: 'okx' },
	'okx-ai-guide': { category: 'wallet/payments', origin: 'okx' },
	'okx-ai-support': { category: 'wallet/payments', origin: 'okx' },
	'okx-audit-log': { category: 'wallet/payments', origin: 'okx' },
	'okx-onchain-gateway': { category: 'wallet/payments', origin: 'okx' },
	'okx-security': { category: 'wallet/payments', origin: 'okx' },
	'okx-task-watch': { category: 'wallet/payments', origin: 'okx' },
	'okx-wallet-portfolio': { category: 'wallet/payments', origin: 'okx' },
	'okx-how-to-play': { category: 'wallet/payments', origin: 'okx' },
	'okx-dapp-discovery': { category: 'intel/trading', origin: 'okx' },
	'okx-defi-invest': { category: 'intel/trading', origin: 'okx' },
	'okx-defi-portfolio': { category: 'intel/trading', origin: 'okx' },
	'okx-dex-bridge': { category: 'intel/trading', origin: 'okx' },
	'okx-dex-market': { category: 'intel/trading', origin: 'okx' },
	'okx-dex-signal': { category: 'intel/trading', origin: 'okx' },
	'okx-dex-social': { category: 'intel/trading', origin: 'okx' },
	'okx-dex-strategy': { category: 'intel/trading', origin: 'okx' },
	'okx-dex-swap': { category: 'intel/trading', origin: 'okx' },
	'okx-dex-token': { category: 'intel/trading', origin: 'okx' },
	'okx-dex-trenches': { category: 'intel/trading', origin: 'okx' },
	'okx-dex-ws': { category: 'intel/trading', origin: 'okx' },
	'okx-growth-competition': { category: 'intel/trading', origin: 'okx' },
};

// Minimal frontmatter reader for the fields this manifest needs. Handles the
// three scalar forms present across the pack: plain, quoted, and block (| / >).
// Deliberately dependency-free — js-yaml is only a transitive dep of hardhat.
function readFrontmatter(text) {
	const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
	if (!m) return null;
	const lines = m[1].split(/\r?\n/);
	const out = {};
	let i = 0;
	while (i < lines.length) {
		const line = lines[i];
		const key = line.match(/^([A-Za-z0-9_-]+):(.*)$/);
		if (!key) {
			i += 1;
			continue;
		}
		const name = key[1];
		let value = key[2].trim();
		if (value === '|' || value === '>' || value === '|-' || value === '>-') {
			const block = [];
			i += 1;
			while (i < lines.length && (/^\s+\S/.test(lines[i]) || lines[i].trim() === '')) {
				block.push(lines[i].replace(/^\s+/, ''));
				i += 1;
			}
			out[name] = block.join(value.startsWith('|') ? '\n' : ' ').trim();
			continue;
		}
		if (value === '') {
			// nested map (e.g. metadata:) — collect "  key: value" children
			const child = {};
			i += 1;
			while (i < lines.length && /^\s+\S/.test(lines[i])) {
				const cm = lines[i].match(/^\s+([A-Za-z0-9_-]+):\s*(.*)$/);
				if (cm) child[cm[1]] = stripQuotes(cm[2].trim());
				i += 1;
			}
			out[name] = child;
			continue;
		}
		out[name] = stripQuotes(value);
		i += 1;
	}
	return out;
}

function stripQuotes(v) {
	if (
		(v.startsWith('"') && v.endsWith('"') && v.length > 1) ||
		(v.startsWith("'") && v.endsWith("'") && v.length > 1)
	) {
		return v
			.slice(1, -1)
			.replace(/\\"/g, '"')
			.replace(/''/g, "'");
	}
	return v;
}

export function collectSkills() {
	const skills = [];
	for (const entry of fs.readdirSync(SKILLS_DIR, { withFileTypes: true })) {
		if (!entry.isDirectory()) continue;
		const skillPath = path.join(SKILLS_DIR, entry.name, 'SKILL.md');
		if (!fs.existsSync(skillPath)) {
			throw new Error(`${entry.name}: missing SKILL.md`);
		}
		const fm = readFrontmatter(fs.readFileSync(skillPath, 'utf8'));
		if (!fm || !fm.name || !fm.description) {
			throw new Error(`${entry.name}: SKILL.md frontmatter missing name/description`);
		}
		if (fm.name !== entry.name) {
			throw new Error(`${entry.name}: frontmatter name "${fm.name}" != directory name`);
		}

		const vendored = VENDORED_CATEGORIES[entry.name];
		const meta = typeof fm.metadata === 'object' && fm.metadata ? fm.metadata : {};
		const category = meta.category || vendored?.category;
		if (!category) {
			throw new Error(
				`${entry.name}: no category — add metadata.category to its frontmatter (native) or an entry to VENDORED_CATEGORIES (vendored)`,
			);
		}

		skills.push({
			name: fm.name,
			description: fm.description,
			...(fm.when_to_use ? { whenToUse: fm.when_to_use } : {}),
			category,
			origin: vendored?.origin || 'three.ws',
			crossPlatformSafe: meta['cross-platform-safe'] === 'true' || meta['cross-platform-safe'] === true,
			path: `.agents/skills/${entry.name}`,
		});
	}
	skills.sort(
		(a, b) => a.category.localeCompare(b.category) || a.origin.localeCompare(b.origin) || a.name.localeCompare(b.name),
	);
	return skills;
}

function renderJson(skills) {
	const byCategory = {};
	for (const s of skills) byCategory[s.category] = (byCategory[s.category] || 0) + 1;
	return `${JSON.stringify(
		{
			...PACK,
			categories: Object.fromEntries(
				Object.entries(CATEGORY_DESCRIPTIONS)
					.filter(([name]) => byCategory[name])
					.map(([name, copy]) => [name, copy.json]),
			),
			counts: byCategory,
			skills,
		},
		null,
		'\t',
	)}\n`;
}

function renderMarkdown(skills) {
	const lines = [
		'# three.ws Agent Skills pack',
		'',
		`> Generated by \`scripts/build-skills-pack.mjs\` — do not edit by hand. Version **${PACK.version}**.`,
		'',
		PACK.description,
		'',
		'Every skill is a portable folder per the [Agent Skills spec](https://agentskills.io/specification):',
		'a `SKILL.md` (frontmatter `description` is the load trigger) plus optional scripts and',
		'references. Install paths and authoring rules: [docs/agent-skills.md](../../docs/agent-skills.md).',
		'',
		'Categories:',
		'',
		...[...new Set(skills.map((s) => s.category))]
			.sort()
			.map((name) => `- **${name}**: ${CATEGORY_DESCRIPTIONS[name]?.md || 'uncategorized.'}`),
		'',
	];
	let current = '';
	for (const s of skills) {
		if (s.category !== current) {
			current = s.category;
			lines.push(`## ${current}`, '', '| Skill | Origin | Trigger |', '| --- | --- | --- |');
		}
		const trigger = s.description.replace(/\|/g, '\\|').replace(/\s+/g, ' ');
		const safe = s.crossPlatformSafe ? ' ✅ cross-platform-safe' : '';
		lines.push(`| [\`${s.name}\`](${s.name}/SKILL.md)${safe} | ${s.origin} | ${trigger} |`);
		if (skills[skills.indexOf(s) + 1]?.category !== current) lines.push('');
	}
	return `${lines.join('\n').trimEnd()}\n`;
}

// public/skill.md: the one skill an agent loads first (served at
// https://three.ws/skill.md, the URL skill directories list). Its prose lives in
// data/skill-md.template.md; the index of focused skills is generated here from
// the same collectSkills() pass, so a skill added, renamed or removed shows up
// in the entry point on the next build and --check fails until it does. Only
// three.ws's own product skills are listed: vendored partner skills and the
// maintainer-only ops skill are not how an outside agent uses the platform.
const ROOT_SKILL_CATEGORIES = [
	['3d/creative', '3D models and avatars'],
	['platform/agents', 'Agents on three.ws'],
];
const RAW_BASE = 'https://raw.githubusercontent.com/nirholas/three.ws/main/.agents/skills';

// The opening sentence of a skill's description says what it does; the rest is
// trigger phrasing for the loader, which an index reader does not need.
function firstSentence(text) {
	const flat = String(text).replace(/\s+/g, ' ').trim();
	const end = flat.search(/[.!?](\s|$)/);
	return end === -1 ? flat : flat.slice(0, end + 1);
}

export function renderRootSkill(skills, template, facts) {
	const sections = ROOT_SKILL_CATEGORIES.map(([category, heading]) => {
		const rows = skills
			.filter((s) => s.category === category && s.origin === 'three.ws')
			.map((s) => `- [\`${s.name}\`](${RAW_BASE}/${s.name}/SKILL.md): ${firstSentence(s.description)}`);
		return [`### ${heading}`, '', ...rows].join('\n');
	});
	if (!template.includes('{{SKILL_INDEX}}')) throw new Error('data/skill-md.template.md is missing its {{SKILL_INDEX}} marker');
	const filled = renderFacts(template, facts, 'data/skill-md.template.md');
	return `${filled.replace('{{SKILL_INDEX}}', sections.join('\n\n')).trimEnd()}\n`;
}

// public/grok-skill.md: the Grok variant (served at https://three.ws/grok-skill.md).
// It renders from the same facts as public/skill.md (scripts/lib/skill-md-facts.mjs),
// so a server URL, tool name or free limit cannot say one thing in one file and
// another in the other.
export function renderGrokSkill(template, facts) {
	return `${renderFacts(template, facts, 'data/grok-skill-md.template.md').trimEnd()}\n`;
}

// Only run the generator when this file is the entry point: other scripts import
// collectSkills() so a second copy of the frontmatter parser never has to exist.
const invokedDirectly =
	process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (!invokedDirectly) {
	// Imported as a library: nothing to write.
} else {
	await main();
}

async function main() {
const skills = collectSkills();
const facts = await skillFacts();
const jsonOut = renderJson(skills);
const mdOut = renderMarkdown(skills);
const jsonPath = path.join(SKILLS_DIR, 'skills-pack.json');
const mdPath = path.join(SKILLS_DIR, 'SKILLS.md');
const rootSkillPath = path.join(ROOT, 'public', 'skill.md');
const rootSkillOut = renderRootSkill(skills, fs.readFileSync(path.join(ROOT, 'data', 'skill-md.template.md'), 'utf8'), facts);
const grokSkillPath = path.join(ROOT, 'public', 'grok-skill.md');
const grokSkillOut = renderGrokSkill(fs.readFileSync(path.join(ROOT, 'data', 'grok-skill-md.template.md'), 'utf8'), facts);

if (process.argv.includes('--check')) {
	const same =
		fs.existsSync(jsonPath) &&
		fs.existsSync(mdPath) &&
		fs.existsSync(rootSkillPath) &&
		fs.existsSync(grokSkillPath) &&
		fs.readFileSync(jsonPath, 'utf8') === jsonOut &&
		fs.readFileSync(mdPath, 'utf8') === mdOut &&
		fs.readFileSync(rootSkillPath, 'utf8') === rootSkillOut &&
		fs.readFileSync(grokSkillPath, 'utf8') === grokSkillOut;
	if (!same) {
		console.error('skills-pack manifest, public/skill.md or public/grok-skill.md is stale: run node scripts/build-skills-pack.mjs');
		process.exit(1);
	}
	console.log(`skills-pack manifest, public/skill.md and public/grok-skill.md up to date (${skills.length} skills).`);
	process.exit(0);
}

fs.writeFileSync(jsonPath, jsonOut);
fs.writeFileSync(mdPath, mdOut);
fs.writeFileSync(rootSkillPath, rootSkillOut);
fs.writeFileSync(grokSkillPath, grokSkillOut);
console.log(`Wrote ${[jsonPath, mdPath, rootSkillPath, grokSkillPath].map((p) => path.relative(ROOT, p)).join(', ')} (${skills.length} skills).`);
}
