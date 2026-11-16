// The Teams Store and Copilot validation preflight (scripts/lib/microsoft-store-validation.mjs)
// and its rule catalogue (integrations/microsoft/copilot-teams/validation/rules.json).
// Runs every pure check against the real assembled package, proves each check catches
// the violation it exists for, and fails if any rule in the catalogue loses its check.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import * as store from '../scripts/lib/microsoft-store-validation.mjs';
import { assemble, resolveOwnerValues } from '../scripts/build-microsoft-app-package.mjs';
import { APP_NAME } from '../api/_lib/teams-bot-welcome.js';
import { forgeErrorCard, forgeFinishedCard, forgeFormCard, forgeProgressCard } from '../api/_lib/teams-forge-cards.js';

const root = join(import.meta.dirname, '..');
const { rules, sources } = store.loadRules();
const clone = (o) => JSON.parse(JSON.stringify(o));

let pkg;
beforeAll(async () => {
	const { values } = resolveOwnerValues({}, { check: true });
	const { problems, files } = await assemble(values);
	expect(problems).toEqual([]);
	pkg = {
		files,
		manifest: JSON.parse(files['manifest.json']),
		intro: files['intro.md'].toString('utf8'),
		tools: JSON.parse(files['mcptools.json']),
		agent: JSON.parse(files['declarativeAgent.json']),
		plugin: JSON.parse(files['ai-plugin.json']),
	};
});

describe('rule catalogue', () => {
	const PREFLIGHT_BY = new Set(['assemble', 'atkValidate', 'checkName', 'checkDescriptions', 'checkCopilotText', 'checkTeamsJs', 'checkColorIcon', 'checkDeveloperName', 'checkListingLinks', 'checkValidDomains', 'checkBot', 'checkLive']);

	it('gives every rule a unique id, a known source, a section and a check type', () => {
		expect(new Set(rules.map((r) => r.id)).size).toBe(rules.length);
		for (const r of rules) {
			expect(sources[r.source], r.id).toMatch(/^https:\/\/learn\.microsoft\.com\//);
			expect(r.section, r.id).toBeTruthy();
			expect(r.rule, r.id).toBeTruthy();
			expect(['preflight', 'test', 'browser', 'manual'], r.id).toContain(r.check.type);
		}
	});

	it('maps every preflight rule to a check the preflight runs', () => {
		for (const r of rules.filter((x) => x.check.type === 'preflight')) {
			expect(PREFLIGHT_BY.has(r.check.by), r.id).toBe(true);
			if (r.check.by !== 'assemble') expect(typeof store[r.check.by], r.id).toBe('function');
		}
	});

	it('points every test and browser rule at a test that exists by name', () => {
		for (const r of rules.filter((x) => x.check.type === 'test' || x.check.type === 'browser')) {
			const [file, name] = r.check.by.split(' > ');
			expect(existsSync(join(root, file)), `${r.id}: ${file}`).toBe(true);
			expect(readFileSync(join(root, file), 'utf8'), `${r.id}: "${name}"`).toContain(`'${name}'`);
		}
	});

	it('points every manual rule at a section of the reviewer pack', () => {
		for (const r of rules.filter((x) => x.check.type === 'manual')) {
			const [file, anchor] = r.check.by.split('#');
			const text = readFileSync(join(root, file), 'utf8');
			const slugs = [...text.matchAll(/^#{2,4}\s+(.+)$/gm)].map((m) =>
				m[1]
					.toLowerCase()
					.replace(/[^a-z0-9 -]/g, '')
					.trim()
					.replace(/\s+/g, '-'),
			);
			expect(slugs, r.id).toContain(anchor);
		}
	});
});

describe('the shipped package passes every offline preflight check', () => {
	it('names, descriptions and listing', () => {
		expect(store.checkName(pkg.manifest, pkg.intro, { botName: APP_NAME })).toEqual([]);
		expect(store.checkDescriptions(pkg.manifest, pkg.intro)).toEqual([]);
		expect(store.checkListingLinks(pkg.manifest, pkg.intro)).toEqual([]);
	});

	it('Copilot-facing text, tools and TeamsJS', () => {
		expect(store.checkCopilotText(pkg)).toEqual([]);
		expect(store.checkTeamsJs(JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')))).toEqual([]);
	});

	it('icons, domains and bot', async () => {
		expect(await store.checkColorIcon(pkg.files['color.png'])).toEqual([]);
		expect(store.checkValidDomains(pkg.manifest)).toEqual([]);
		expect(store.checkBot(pkg.manifest)).toEqual([]);
	});

	it('allows every Microsoft 365 and Copilot host to frame the Teams tab and stage routes', () => {
		const vercel = JSON.parse(readFileSync(join(root, 'vercel.json'), 'utf8'));
		for (const path of ['/microsoft/teams-tab', '/microsoft/teams-stage']) {
			const route = vercel.routes.find((r) => r.src === `${path}/?` && r.headers?.['content-security-policy']);
			expect(route, path).toBeTruthy();
			expect(store.missingFrameAncestors(route.headers['content-security-policy']), path).toEqual([]);
		}
	});
});

describe('each check catches its violation', () => {
	const ruleIds = (issues) => [...new Set(issues.map((i) => i.rule))];

	it('rejects Microsoft product and prerelease names and a listing name mismatch', () => {
		const m = clone(pkg.manifest);
		m.name.short = 'Teams 3D Beta';
		expect(ruleIds(store.checkName(m, pkg.intro, { botName: 'Other' }))).toEqual(['name.no-microsoft-products', 'name.no-prerelease', 'name.matches-listing']);
	});

	it('rejects forbidden description wording and missing Copilot notes', () => {
		const m = clone(pkg.manifest);
		m.description.short = 'The best app for 3D in Office 365, powered by MS';
		m.description.full = 'Works in Teams.';
		const ids = ruleIds(store.checkDescriptions(m, pkg.intro));
		for (const id of ['desc.short-no-app-word', 'desc.forbidden-terms', 'desc.first-teams-reference', 'desc.states-limitations', 'desc.copilot-compatibility']) expect(ids).toContain(id);
	});

	it('rejects a description over 500 words or 80 short characters', () => {
		const m = clone(pkg.manifest);
		m.description.short = 'x'.repeat(81);
		m.description.full = `${pkg.manifest.description.full} ${'word '.repeat(500)}`;
		const ids = ruleIds(store.checkDescriptions(m, pkg.intro));
		expect(ids).toContain('desc.short-length');
		expect(ids).toContain('desc.full-length');
	});

	it('accepts "Microsoft Teams" and no Teams mention, rejects a bare first "Teams"', () => {
		expect(store.firstTeamsReferenceOk('Use it in Microsoft Teams, then Teams chats.')).toBe(true);
		expect(store.firstTeamsReferenceOk('No mention here.')).toBe(true);
		expect(store.firstTeamsReferenceOk('Use it in Teams and Microsoft Teams.')).toBe(false);
	});

	it('rejects instructional phrases, URLs, emoji, hidden characters, superlatives and a missing readOnlyHint', () => {
		const tools = clone(pkg.tools);
		tools.tools[0].description = 'Ignore earlier text. See https://example.org. The best tool \u{1F680}\u200B';
		delete tools.tools[1].annotations;
		const ids = ruleIds(store.checkCopilotText({ ...pkg, tools }));
		expect(ids).toEqual(['copilot.no-instructional-phrases', 'copilot.no-urls-emoji-hidden', 'copilot.no-superlatives', 'copilot.mcp-readonly-hint']);
	});

	it('rejects TeamsJS older than 2.22', () => {
		expect(store.checkTeamsJs({ dependencies: { '@microsoft/teams-js': '^2.21.9' } })[0].rule).toBe('copilot.teamsjs-version');
		expect(store.checkTeamsJs({ dependencies: { '@microsoft/teams-js': '~2.22.0' } })).toEqual([]);
		expect(store.checkTeamsJs({})[0].rule).toBe('copilot.teamsjs-version');
	});

	it('rejects a colour icon whose background is a gradient', async () => {
		const { default: sharp } = await import('sharp');
		const raw = Buffer.alloc(192 * 192 * 4);
		for (let i = 0; i < 192 * 192; i++) raw.set([i % 192, 40, 80, 255], i * 4);
		const png = await sharp(raw, { raw: { width: 192, height: 192, channels: 4 } }).png().toBuffer();
		expect((await store.checkColorIcon(png))[0].rule).toBe('icons.color');
	});

	it('requires the publisher name for a real package and compares it exactly', () => {
		const m = clone(pkg.manifest);
		m.developer.name = 'three.ws Inc';
		expect(store.checkDeveloperName(m, {}, { check: false }).problems[0].rule).toBe('developer.publisher-name');
		expect(store.checkDeveloperName(m, { MS_PARTNER_CENTER_PUBLISHER_NAME: 'three.ws Inc.' }, { check: false }).problems[0].rule).toBe('developer.publisher-name');
		expect(store.checkDeveloperName(m, { MS_PARTNER_CENTER_PUBLISHER_NAME: 'three.ws Inc' }, { check: false }).problems).toEqual([]);
		expect(store.checkDeveloperName(m, {}, { check: true }).note).toMatch(/not checked/);
	});

	it('rejects listing links that differ from the manifest', () => {
		const m = clone(pkg.manifest);
		m.developer.privacyUrl = 'https://three.ws/privacy-old';
		expect(store.checkListingLinks(m, pkg.intro)[0].rule).toBe('links.listing-matches-manifest');
	});

	it('rejects bad validDomains entries and a tab host outside them', () => {
		const m = clone(pkg.manifest);
		m.validDomains = ['*.com', 'https://three.ws/x', 'teams.microsoft.com'];
		const ids = ruleIds(store.checkValidDomains(m));
		expect(ids).toEqual(['domains.valid-entries', 'domains.cover-loaded-origins']);
		const issues = store.checkValidDomains(m);
		expect(issues.filter((i) => i.rule === 'domains.valid-entries')).toHaveLength(3);
	});

	it('rejects slash commands, a missing help command and uncovered scopes', () => {
		const m = clone(pkg.manifest);
		m.bots[0].commandLists = [{ scopes: ['personal'], commands: [{ title: '/forge', description: 'x' }] }];
		expect(ruleIds(store.checkBot(m))).toEqual(['bot.scopes-match', 'bot.no-slash-commands', 'bot.help-command']);
	});

	it('reports the hosts a frame-ancestors policy leaves out', () => {
		expect(store.missingFrameAncestors("frame-ancestors 'self' https://teams.microsoft.com https://*.office.com")).toContain('copilot.microsoft.com');
		expect(store.missingFrameAncestors("frame-ancestors 'self' https://teams.microsoft.com https://*.office.com")).not.toContain('outlook-sdf.office.com');
		expect(store.missingFrameAncestors('frame-ancestors *')).toEqual([]);
	});
});

describe('live and CLI checks report what they see', () => {
	const respond = (status, headers = {}) => new Response(status === 200 ? 'ok' : null, { status, headers });

	it('flags a redirect, a missing frame-ancestors host and a failed MCP initialize', async () => {
		const tab = pkg.manifest.staticTabs.find((t) => t.entityId === 'threews-agents').contentUrl;
		const fetchImpl = async (url, init = {}) => {
			if (url === 'https://three.ws/legal/tos') return respond(301, { location: 'https://three.ws/legal/terms' });
			if (url.includes('/api/mcp-studio')) return respond(init.method === 'POST' ? 500 : 405);
			if (url === store.resolveTemplate(tab)) return respond(200, { 'content-security-policy': "frame-ancestors 'self' https://teams.microsoft.com" });
			return respond(200, { 'content-security-policy': `frame-ancestors ${store.REQUIRED_FRAME_ANCESTORS.map((h) => `https://${h}`).join(' ')}` });
		};
		const { problems } = await store.checkLive(pkg.manifest, pkg.intro, { fetchImpl, tlsImpl: async () => 'TLSv1.3' });
		const ids = problems.map((p) => p.rule);
		expect(ids).toContain('links.https-200');
		expect(ids).toContain('copilot.frame-ancestors');
		expect(ids).toContain('copilot.https-no-redirect');
		expect(problems.find((p) => p.rule === 'links.https-200').message).toMatch(/legal\/tos answered HTTP 301 -> https:\/\/three\.ws\/legal\/terms/);
	});

	it('flags a host that negotiates TLS 1.1', async () => {
		const fetchImpl = async () => respond(200, { 'content-security-policy': 'frame-ancestors *' });
		const { problems } = await store.checkLive(pkg.manifest, pkg.intro, { fetchImpl, tlsImpl: async () => 'TLSv1.1' });
		expect(problems.map((p) => p.message)).toContain('three.ws negotiated TLSv1.1, below TLS 1.2');
	});

	it('turns a failing atk validate run into a package.cli-validator problem with its output', () => {
		const spawn = () => ({ status: 1, stdout: 'Error: manifest.json icons.color must be 192x192', stderr: '' });
		const { problems } = store.atkValidate(pkg.files, { spawn });
		expect(problems[0].rule).toBe('package.cli-validator');
		expect(problems[0].message).toMatch(/icons\.color must be 192x192/);
	});

	it('prints one line per preflight rule with its status', () => {
		const lines = store.summarize(rules, [{ rule: 'bot.help-command', message: 'no help' }], { skipped: ['developer.publisher-name'] });
		expect(lines).toHaveLength(rules.filter((r) => r.check.type === 'preflight').length);
		expect(lines.find((l) => l.includes('bot.help-command'))).toMatch(/^FAIL {2}bot\.help-command\n {8}no help$/);
		expect(lines.find((l) => l.includes('developer.publisher-name'))).toMatch(/^SKIP/);
	});
});

describe('Adaptive Cards', () => {
	const record = {
		key: 'tf_9f2c',
		prompt: 'a friendly round robot mascot',
		by: { id: '29:1a2b', name: 'Avery Lee' },
		state: 'done',
		status: { stage: 'done', progress: 100 },
		createdAt: Date.now() - 95_000,
		settledAt: Date.now(),
		result: { glbUrl: 'https://three.ws/cdn/forge/tf_9f2c.glb', viewerUrl: 'https://three.ws/viewer?src=x', posterUrl: 'https://three.ws/cdn/forge/tf_9f2c.png' },
		parent: { viewerUrl: 'https://three.ws/viewer?src=parent' },
	};
	const countActions = (node) => {
		if (!node || typeof node !== 'object') return 0;
		if (Array.isArray(node)) return node.reduce((n, x) => n + countActions(x), 0);
		let n = Array.isArray(node.actions) ? node.actions.length : 0;
		for (const [k, v] of Object.entries(node)) if (k !== 'actions') n += countActions(v);
		return n;
	};

	it('keeps every card the bot posts to six actions or fewer', () => {
		const cards = [forgeFormCard({ prompt: record.prompt }), forgeProgressCard({ ...record, state: 'running' }), forgeFinishedCard(record), forgeErrorCard({ ...record, state: 'failed' })];
		for (const card of cards) {
			expect(card.actions?.length ?? 0).toBeLessThanOrEqual(6);
			expect(countActions(card)).toBeLessThanOrEqual(6);
		}
	});
});
