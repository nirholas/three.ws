// Community skills registry validator (community-skills/tools/registry.mjs).
//
// This is the gate a contributor's pull request goes through: the same module
// runs as `node tools/validate.mjs` in the public mirror and inside
// `npm run build:pages` here. Each case builds a throwaway registry tree on disk
// and asserts the verdict, so a malformed skill can never reach
// /skills/community and a well-formed one always does.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import {
	buildRegistry,
	serializeRegistry,
	parseSkillMarkdown,
	findTokenReferences,
	estimateTokens,
	PROMOTED_COIN,
	LIMITS,
} from '../community-skills/tools/registry.mjs';

const BODY = `# Example skill

When the user asks for a position check, read the wallet first, then state the
three numbers that matter: size, stop and the loss at the stop. Never recommend
a trade the numbers do not support, and say so plainly when they do not.
Close with one line naming the next safe action.`;

const GOOD_META = {
	name: 'Example Skill',
	description: 'A worked example that reads a wallet and states size, stop and loss at the stop.',
	author: 'three.ws',
	tags: ['example', 'risk'],
	version: '1.0.0',
	license: 'MIT',
};

let root;

function addSkill(slug, { meta = GOOD_META, skillMd, files = {} } = {}) {
	const dir = join(root, 'skills', slug);
	mkdirSync(dir, { recursive: true });
	const md = skillMd ?? `---\nname: ${slug}\ndescription: Use when the user asks whether a position is sized safely.\n---\n\n${BODY}\n`;
	writeFileSync(join(dir, 'SKILL.md'), md);
	if (meta !== null) writeFileSync(join(dir, 'metadata.json'), typeof meta === 'string' ? meta : JSON.stringify(meta, null, '\t'));
	for (const [rel, content] of Object.entries(files)) {
		mkdirSync(join(dir, rel, '..'), { recursive: true });
		writeFileSync(join(dir, rel), content);
	}
}

function messages(result) {
	return result.errors.map((e) => `${e.slug}: ${e.message}`);
}

beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), 'community-skills-'));
	mkdirSync(join(root, 'skills'));
});

afterEach(() => {
	rmSync(root, { recursive: true, force: true });
});

describe('a well-formed skill', () => {
	it('passes and becomes a registry entry with a stable hash and token count', () => {
		addSkill('example-skill', { files: { 'scripts/run.mjs': 'console.log(1);\n', 'references/notes.md': 'Plain notes.\n' } });
		const result = buildRegistry(root);
		expect(messages(result)).toEqual([]);
		expect(result.ok).toBe(true);
		expect(result.registry.count).toBe(1);
		const [entry] = result.registry.skills;
		expect(entry).toMatchObject({
			slug: 'example-skill',
			name: 'Example Skill',
			author: 'three.ws',
			tags: ['example', 'risk'],
			version: '1.0.0',
			path: 'skills/example-skill',
			files: ['SKILL.md', 'metadata.json', 'references/notes.md', 'scripts/run.mjs'],
		});
		expect(entry.sha256).toMatch(/^[0-9a-f]{64}$/);
		expect(entry.tokens).toBe(estimateTokens(parseSkillMarkdown(readFileSync(join(root, 'skills/example-skill/SKILL.md'), 'utf8')).body));
		expect(result.registry.tags).toEqual([{ tag: 'example', count: 1 }, { tag: 'risk', count: 1 }]);
	});

	it('serializes byte-identically on every build, so --check can detect a stale index', () => {
		addSkill('example-skill');
		addSkill('second-skill', { meta: { ...GOOD_META, name: 'Second Skill' } });
		const a = serializeRegistry(buildRegistry(root).registry);
		const b = serializeRegistry(buildRegistry(root).registry);
		expect(a).toBe(b);
		expect(JSON.parse(a).skills.map((s) => s.slug)).toEqual(['example-skill', 'second-skill']);
	});

	it('allows the promoted coin, the chain rails and shell variables inside code', () => {
		const md = `---\nname: rails-skill\ndescription: Use when paying for a service with the chain rails.\n---\n\n${BODY}\n\nPay in $USDC, fees in $SOL, hold $THREE (${PROMOTED_COIN.mint}).\n\n\`\`\`sh\necho $HOME $PATH\n\`\`\`\n`;
		addSkill('rails-skill', { skillMd: md });
		expect(messages(buildRegistry(root))).toEqual([]);
	});
});

describe('a malformed skill fails the build', () => {
	it('rejects metadata.json with a missing required field', () => {
		const { author: _drop, ...meta } = GOOD_META;
		addSkill('no-author', { meta });
		const result = buildRegistry(root);
		expect(result.ok).toBe(false);
		expect(messages(result)).toContain('no-author: metadata.json is missing "author"');
		expect(result.registry.skills).toEqual([]);
	});

	it('rejects metadata.json that is not JSON', () => {
		addSkill('bad-json', { meta: '{ "name": "Bad", ' });
		expect(messages(buildRegistry(root)).some((m) => m.startsWith('bad-json: metadata.json is not valid JSON'))).toBe(true);
	});

	it('rejects a missing metadata.json', () => {
		addSkill('no-meta', { meta: null });
		expect(messages(buildRegistry(root))).toContain('no-meta: metadata.json is missing');
	});

	it('rejects unknown metadata fields, bad semver, bad tags and duplicate tags', () => {
		addSkill('loose-meta', { meta: { ...GOOD_META, version: 'v1', tags: ['Risk', 'risk', 'risk'], homepage: 'x' } });
		const m = messages(buildRegistry(root));
		expect(m).toContain('loose-meta: metadata.json has unknown field "homepage" (allowed: name, description, author, tags, version, license)');
		expect(m).toContain('loose-meta: metadata.json "version" must be semver, e.g. "1.0.0"');
		expect(m.some((x) => x.includes('tag "Risk" must be lowercase kebab-case'))).toBe(true);
		expect(m).toContain('loose-meta: tag "risk" is listed twice');
	});

	it('rejects a directory name that is not a URL-safe slug', () => {
		addSkill('Bad_Slug', { skillMd: `---\nname: Bad_Slug\ndescription: Use when the user asks whether a position is sized safely.\n---\n\n${BODY}\n` });
		expect(messages(buildRegistry(root)).some((m) => m.includes('must be a URL-safe slug'))).toBe(true);
	});

	it('rejects slugs that collide case-insensitively and names used twice', () => {
		addSkill('one-skill');
		addSkill('two-skill');
		const m = messages(buildRegistry(root));
		expect(m).toContain('two-skill: name "Example Skill" is already used by one-skill');
	});

	it('rejects SKILL.md without frontmatter, with a mismatched name, or with a thin body', () => {
		addSkill('no-front', { skillMd: `# Heading\n\n${BODY}\n` });
		addSkill('wrong-name', { meta: { ...GOOD_META, name: 'Wrong' }, skillMd: `---\nname: other\ndescription: Use when the user asks whether a position is sized safely.\n---\n\n${BODY}\n` });
		addSkill('thin-body', { meta: { ...GOOD_META, name: 'Thin' }, skillMd: '---\nname: thin-body\ndescription: Use when the user asks whether a position is sized safely.\n---\n\nToo short.\n' });
		const m = messages(buildRegistry(root));
		expect(m).toContain('no-front: SKILL.md must open with a --- frontmatter block holding name and description');
		expect(m).toContain('wrong-name: SKILL.md frontmatter name "other" must equal the directory name "wrong-name"');
		expect(m.some((x) => x.startsWith('thin-body: SKILL.md body is') && x.includes(`at least ${LIMITS.bodyMinChars}`))).toBe(true);
	});

	it('rejects a third-party cashtag in prose and an unknown address anywhere', () => {
		const foreign = 'THREEsynthetic11111111111111111111111111111';
		addSkill('shill-skill', { skillMd: `---\nname: shill-skill\ndescription: Use when the user asks whether a position is sized safely.\n---\n\n${BODY}\n\nBuy $MOON now.\n` });
		addSkill('pinned-skill', { meta: { ...GOOD_META, name: 'Pinned' }, files: { 'scripts/pin.mjs': `const MINT = '${foreign}';\nconsole.log(MINT);\n` } });
		const m = messages(buildRegistry(root));
		expect(m).toContain('shill-skill: SKILL.md: third-party token reference (cashtag $MOON)');
		expect(m).toContain(`pinned-skill: scripts/pin.mjs: third-party token reference (address ${foreign})`);
	});

	it('rejects files outside references/ and scripts/, and scripts that do not parse', () => {
		addSkill('stray-file', { files: { 'notes.txt': 'x' } });
		addSkill('broken-script', { meta: { ...GOOD_META, name: 'Broken' }, files: { 'scripts/run.mjs': 'const = ;\n' } });
		const m = messages(buildRegistry(root));
		expect(m).toContain('stray-file: notes.txt is not allowed; a skill holds SKILL.md, metadata.json, references/ and scripts/ only');
		expect(m.some((x) => x.startsWith('broken-script: scripts/run.mjs does not parse'))).toBe(true);
	});
});

describe('findTokenReferences', () => {
	it('flags foreign cashtags in prose only and ignores long all-letter words', () => {
		expect(findTokenReferences('hold $THREE, pay $USDC')).toEqual([]);
		expect(findTokenReferences('`$FOO` in code')).toEqual([]);
		expect(findTokenReferences('ape into $FOO')).toEqual(['cashtag $FOO']);
		expect(findTokenReferences('Supercalifragilisticexpialidociousness')).toEqual([]);
	});
});

describe('the committed registry', () => {
	it('is valid and up to date with community-skills/skills', () => {
		const r = spawnSync(process.execPath, ['community-skills/tools/validate.mjs', '--check'], { encoding: 'utf8' });
		expect(r.stderr).toBe('');
		expect(r.status).toBe(0);
		const committed = JSON.parse(readFileSync('community-skills/registry.json', 'utf8'));
		expect(committed.count).toBeGreaterThanOrEqual(12);
		expect(committed.skills.map((s) => s.slug)).toContain('risk-manager');
	});
});
