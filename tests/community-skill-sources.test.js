// External community skill sources: env parsing, validation, the merged API
// response, failure isolation and the unset-means-unchanged guarantee. The
// "GitHub" here is a local HTTP server serving a synthetic repository, so no
// test touches the network or names a real third-party repository.

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { createServer } from 'node:http';
import handler from '../api/skills/community.js';
import { parseSources, loadExternalSkills, resetExternalCache, validateExternalSkill } from '../api/_lib/community-skill-sources.js';

const SHA = 'a'.repeat(40);
const OTHER_SHA = 'b'.repeat(40);
const GOOD_BODY = 'Follow these steps carefully. '.repeat(12);

const skillMd = (name, description, body = GOOD_BODY, extra = '') => `---\nname: ${name}\ndescription: ${description}\n${extra}---\n${body}\n`;

const FILES = {
	'skills/alpha-skill/SKILL.md': skillMd('alpha-skill', 'Does the alpha thing for an agent in a careful way.', GOOD_BODY, 'tags: [alpha, demo]\nversion: 2.1.0\n'),
	'skills/beta-skill/SKILL.md': skillMd('beta-skill', 'Does the beta thing for an agent in a careful way.'),
	'skills/wrong-name/SKILL.md': skillMd('something-else', 'Frontmatter name does not match the directory.'),
	'skills/tiny-body/SKILL.md': skillMd('tiny-body', 'This skill has a body that is far too short.', 'short'),
	'skills/agent-hiring/SKILL.md': skillMd('agent-hiring', 'Clashes with a skill that ships in the repo registry.'),
};

let server;
let base;
const hits = [];
let mode = 'ok';

beforeAll(async () => {
	server = createServer((req, res) => {
		hits.push(req.url);
		if (mode === 'down') {
			res.statusCode = 503;
			return res.end('unavailable');
		}
		const treeMatch = req.url.match(/^\/repos\/fixture-org\/skills-repo\/git\/trees\/([0-9a-f]{40})\?recursive=1$/);
		if (treeMatch && treeMatch[1] === SHA) {
			res.setHeader('content-type', 'application/json');
			return res.end(JSON.stringify({ truncated: false, tree: Object.keys(FILES).map((path) => ({ path, type: 'blob' })) }));
		}
		const rawMatch = req.url.match(/^\/fixture-org\/skills-repo\/([0-9a-f]{40})\/(.+)$/);
		if (rawMatch && rawMatch[1] === SHA && FILES[rawMatch[2]]) return res.end(FILES[rawMatch[2]]);
		res.statusCode = 404;
		res.end('not found');
	});
	await new Promise((r) => server.listen(0, '127.0.0.1', r));
	base = `http://127.0.0.1:${server.address().port}`;
});

afterAll(() => new Promise((r) => server.close(r)));

const ENV_KEYS = ['COMMUNITY_SKILL_SOURCES', 'COMMUNITY_SKILL_GITHUB_API', 'COMMUNITY_SKILL_RAW_BASE'];
const saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));

function setSources(list) {
	process.env.COMMUNITY_SKILL_SOURCES = JSON.stringify(list);
	process.env.COMMUNITY_SKILL_GITHUB_API = base;
	process.env.COMMUNITY_SKILL_RAW_BASE = base;
}

beforeEach(() => {
	for (const k of ENV_KEYS) {
		if (saved[k] === undefined) delete process.env[k];
		else process.env[k] = saved[k];
	}
	delete process.env.COMMUNITY_SKILL_SOURCES;
	resetExternalCache();
	hits.length = 0;
	mode = 'ok';
	vi.restoreAllMocks();
});

function makeRes() {
	return {
		statusCode: 0,
		body: '',
		headers: {},
		setHeader(k, v) { this.headers[String(k).toLowerCase()] = v; },
		getHeader(k) { return this.headers[String(k).toLowerCase()]; },
		removeHeader(k) { delete this.headers[String(k).toLowerCase()]; },
		get headersSent() { return false; },
		get writableEnded() { return false; },
		end(chunk) { if (chunk) this.body += chunk; return this; },
	};
}

async function get(url) {
	const res = makeRes();
	await handler({ method: 'GET', url, headers: { origin: 'https://three.ws' } }, res);
	return { status: res.statusCode, json: res.body && res.headers['content-type']?.includes('json') ? JSON.parse(res.body) : null, text: res.body };
}

describe('parseSources', () => {
	it('treats unset and empty as no sources', () => {
		expect(parseSources(undefined)).toEqual({ sources: [], problems: [] });
		expect(parseSources('  ')).toEqual({ sources: [], problems: [] });
	});
	it('accepts a pinned source and defaults the path', () => {
		const { sources, problems } = parseSources(JSON.stringify([{ repo: 'fixture-org/skills-repo', ref: SHA, license: 'MIT' }]));
		expect(problems).toEqual([]);
		expect(sources).toEqual([{ repo: 'fixture-org/skills-repo', ref: SHA, path: 'skills', license: 'MIT' }]);
	});
	it('rejects an unpinned ref, a traversal path, a bad repo and a missing license', () => {
		const { sources, problems } = parseSources(
			JSON.stringify([
				{ repo: 'o/r', ref: 'main', license: 'MIT' },
				{ repo: 'o/r', ref: SHA, path: '../x', license: 'MIT' },
				{ repo: 'not a repo', ref: SHA, license: 'MIT' },
				{ repo: 'o/r', ref: SHA },
			]),
		);
		expect(sources).toEqual([]);
		expect(problems).toHaveLength(4);
		expect(problems[0]).toMatch(/commit sha/);
	});
	it('reports invalid JSON and non-arrays without throwing', () => {
		expect(parseSources('{').problems[0]).toMatch(/not valid JSON/);
		expect(parseSources('{}').problems[0]).toMatch(/array/);
	});
});

describe('validateExternalSkill', () => {
	const source = { repo: 'fixture-org/skills-repo', ref: SHA, path: 'skills', license: 'MIT' };
	it('applies the registry SKILL.md rules', () => {
		expect(validateExternalSkill({ slug: 'ok-skill', text: skillMd('ok-skill', 'A description that is long enough.'), source }).entry.origin).toBe('external');
		expect(validateExternalSkill({ slug: 'ok-skill', text: skillMd('other', 'A description that is long enough.'), source }).reason).toMatch(/must equal/);
		expect(validateExternalSkill({ slug: 'ok-skill', text: 'no frontmatter at all', source }).reason).toMatch(/frontmatter/);
		expect(validateExternalSkill({ slug: 'Bad_Slug', text: skillMd('Bad_Slug', 'A description that is long enough.'), source }).reason).toMatch(/slug/);
		expect(validateExternalSkill({ slug: 'ok-skill', text: skillMd('ok-skill', 'short'), source }).reason).toMatch(/too short/);
	});
});

describe('the API with COMMUNITY_SKILL_SOURCES unset', () => {
	it('behaves as before: no external key, no network', async () => {
		const { status, json } = await get('/api/skills/community');
		expect(status).toBe(200);
		expect(json).not.toHaveProperty('external');
		expect(json.count).toBe(json.total);
		expect(hits).toEqual([]);
		const miss = await get('/api/skills/community/alpha-skill');
		expect(miss.status).toBe(404);
	});
});

describe('the API with a synthetic external source', () => {
	const source = () => [{ repo: 'fixture-org/skills-repo', ref: SHA, path: 'skills', license: 'Apache-2.0' }];

	it('lists valid skills as external with source, ref and license, and omits the invalid ones', async () => {
		setSources(source());
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const { status, json } = await get('/api/skills/community');
		expect(status).toBe(200);
		expect(json.external.skills.map((s) => s.slug)).toEqual(['alpha-skill', 'beta-skill']);
		for (const s of json.external.skills) {
			expect(s).toMatchObject({ origin: 'external', source: 'fixture-org/skills-repo', ref: SHA, license: 'Apache-2.0', not_reviewed: true });
			expect(s.tree_url).toContain(`/tree/${SHA}/skills/`);
			expect(s).not.toHaveProperty('content');
		}
		expect(json.external.skills[0]).toMatchObject({ tags: ['alpha', 'demo'], version: '2.1.0' });
		const reasons = json.external.sources[0].dropped.map((d) => `${d.slug}: ${d.reason}`);
		expect(reasons.some((r) => r.startsWith('wrong-name'))).toBe(true);
		expect(reasons.some((r) => r.startsWith('tiny-body'))).toBe(true);
		expect(reasons.some((r) => r.startsWith('agent-hiring') && /already used/.test(r))).toBe(true);
		expect(warn).toHaveBeenCalled();
		expect(json.skills.every((s) => s.origin === undefined)).toBe(true);
	});

	it('serves one external skill with its body and as markdown, and filters by query', async () => {
		setSources(source());
		const one = await get('/api/skills/community/alpha-skill');
		expect(one.status).toBe(200);
		expect(one.json.skill).toMatchObject({ slug: 'alpha-skill', origin: 'external', ref: SHA });
		expect(one.json.skill.body).toContain('Follow these steps');
		const md = await get('/api/skills/community/alpha-skill?format=md');
		expect(md.text.startsWith('---\nname: alpha-skill')).toBe(true);
		const q = await get('/api/skills/community?q=beta');
		expect(q.json.external.skills.map((s) => s.slug)).toEqual(['beta-skill']);
	});

	it('caches the merge within the TTL', async () => {
		setSources(source());
		vi.spyOn(console, 'warn').mockImplementation(() => {});
		await get('/api/skills/community');
		const first = hits.length;
		await get('/api/skills/community');
		expect(hits.length).toBe(first);
	});

	it('keeps the in-repo registry intact when a source fails, and logs it', async () => {
		setSources([...source(), { repo: 'fixture-org/missing-repo', ref: OTHER_SHA, path: 'skills', license: 'MIT' }]);
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const { json } = await get('/api/skills/community');
		expect(json.count).toBe(json.total);
		expect(json.skills.length).toBeGreaterThan(0);
		const bad = json.external.sources.find((s) => s.repo === 'fixture-org/missing-repo');
		expect(bad).toMatchObject({ loaded: false, count: 0 });
		expect(bad.error).toMatch(/404/);
		expect(json.external.skills.map((s) => s.slug)).toEqual(['alpha-skill', 'beta-skill']);
		expect(warn.mock.calls.some(([m]) => /missing-repo.*failed to load/.test(m))).toBe(true);
	});

	it('survives every source being down', async () => {
		mode = 'down';
		setSources(source());
		vi.spyOn(console, 'warn').mockImplementation(() => {});
		const { status, json } = await get('/api/skills/community');
		expect(status).toBe(200);
		expect(json.external.count).toBe(0);
		expect(json.external.sources[0].loaded).toBe(false);
		expect(json.skills.length).toBe(json.total);
	});
});

describe('loadExternalSkills', () => {
	it('is disabled and does no work when unset', async () => {
		const r = await loadExternalSkills({ env: {} });
		expect(r).toEqual({ enabled: false, count: 0, skills: [], sources: [] });
	});
});
