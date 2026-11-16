// scripts/lib/microsoft-store-validation.mjs
// The Teams Store and Microsoft 365 Copilot validation preflight for the three.ws
// 3D Studio app package. Every check reports problems tagged with a rule id from
// integrations/microsoft/copilot-teams/validation/rules.json, so a failure names the
// guideline it breaks. Run through:
//
//   npm run package:microsoft-app -- --check --store   all checks, live ones included
//
// Pure checks read the assembled package files; live checks fetch every URL the
// package and listing carry from production (three.ws only, never a Microsoft host);
// atkValidate runs Microsoft's own validator (Microsoft 365 Agents Toolkit CLI) in its
// offline manifest mode, which needs no Microsoft 365 sign-in.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import tls from 'node:tls';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const RULES_FILE = join(root, 'integrations', 'microsoft', 'copilot-teams', 'validation', 'rules.json');
export const loadRules = () => JSON.parse(readFileSync(RULES_FILE, 'utf8'));

const issue = (rule, message) => ({ rule, message });

/** Microsoft product names an app name may not contain. */
const MICROSOFT_PRODUCTS = /\b(microsoft|teams|office|outlook|copilot|sharepoint|onedrive|skype|azure|windows|bing|excel|powerpoint|word|viva|dynamics)\b/i;
const PRERELEASE = /\b(beta|alpha|dev|development|preview|test|testing|demo|staging|trial)\b/i;
/** Wording Microsoft's listing rules forbid in descriptions. */
const FORBIDDEN_TERMS = [
	[/\bMS\b|\bMSFT\b/, 'the MS or MSFT abbreviation'],
	[/\bOffice 365\b|\bO365\b/i, 'Office 365 (use Microsoft 365)'],
	[/certified for/i, '"certified for"'],
	[/powered by/i, '"powered by"'],
	[/appsource/i, 'an AppSource reference'],
];
const SUPERLATIVES = /(#1\b|\bnumber one\b|\bamazing\b|\bbest\b|\bultimate\b|\bworld'?s (first|leading)\b|\bunrivaled\b|\bincredible\b|\brevolutionary\b|\bmost (powerful|advanced)\b)/i;
const INSTRUCTIONAL = /(\bignore\b|new instructions|\bif the user says\b|\bdo not print\b|\bdon't print\b|answer in bold|\breset\b|\bsystem prompt\b|\byou must\b|\balways respond\b)/i;
const URL_RE = /https?:\/\/|www\./i;
const EMOJI_RE = /\p{Extended_Pictographic}/u;
const HIDDEN_RE = /[\u200B-\u200F\u202A-\u202E\u2060-\u2064\uFEFF\u00AD]/;

export const SHORT_DESCRIPTION_MAX = 80;
export const FULL_DESCRIPTION_MAX = 4000;
export const FULL_DESCRIPTION_WORDS = 500;
export const TEAMSJS_MIN = [2, 22, 0];
export const RESPONSE_BUDGET_MS = 2000;

/**
 * Hosts Microsoft lists for frame-ancestors on a tab that runs in Teams, Outlook,
 * the Microsoft 365 app and Microsoft 365 Copilot. A wildcard in the page's policy
 * covers a host it matches.
 * https://learn.microsoft.com/en-us/microsoftteams/platform/m365-apps/extend-m365-teams-personal-tab#update-content-security-policy-headers
 */
export const REQUIRED_FRAME_ANCESTORS = [
	'teams.microsoft.com',
	'teams.cloud.microsoft',
	'outlook.office.com',
	'outlook.office365.com',
	'outlook-sdf.office.com',
	'outlook-sdf.office365.com',
	'www.office.com',
	'www.microsoft365.com',
	'm365.cloud.microsoft',
	'copilot.microsoft.com',
	'edgeservices.bing.com',
	'www.bing.com',
	'fa000000124.resources.office.net',
	'fa000000125.resources.office.net',
	'fa000000128.resources.office.net',
	'fa000000129.resources.office.net',
];

const MICROSOFT_DOMAINS = /(^|\.)(microsoft\.com|office\.com|office365\.com|microsoft365\.com|cloud\.microsoft|sharepoint\.com|live\.com|bing\.com|skype\.com)$/i;

/** The listing name: the first level-one heading of intro.md. */
export function listingName(intro) {
	return /^#\s+(.+)$/m.exec(intro)?.[1].trim() ?? '';
}

export function checkName(manifest, intro, { botName } = {}) {
	const out = [];
	for (const [label, value] of [['short', manifest.name?.short], ['full', manifest.name?.full]]) {
		const v = String(value ?? '');
		const product = MICROSOFT_PRODUCTS.exec(v);
		if (product) out.push(issue('name.no-microsoft-products', `name.${label} "${v}" contains the Microsoft product name "${product[0]}"`));
		const pre = PRERELEASE.exec(v);
		if (pre) out.push(issue('name.no-prerelease', `name.${label} "${v}" contains the prerelease word "${pre[0]}"`));
	}
	const listed = listingName(intro);
	if (listed !== manifest.name?.short) out.push(issue('name.matches-listing', `intro.md is titled "${listed}" but name.short is "${manifest.name?.short}"`));
	if (botName !== undefined && botName !== manifest.name?.short) {
		out.push(issue('name.matches-listing', `the bot calls itself "${botName}" but name.short is "${manifest.name?.short}"`));
	}
	return out;
}

const words = (text) => text.split(/\s+/).filter(Boolean).length;

/** The first mention of Teams must read "Microsoft Teams"; no mention at all passes. */
export function firstTeamsReferenceOk(text) {
	const m = /\bTeams\b/.exec(text);
	if (!m) return true;
	return text.slice(Math.max(0, m.index - 10), m.index) === 'Microsoft ';
}

export function checkDescriptions(manifest, intro) {
	const out = [];
	const short = String(manifest.description?.short ?? '');
	const full = String(manifest.description?.full ?? '');
	if (short.length > SHORT_DESCRIPTION_MAX) out.push(issue('desc.short-length', `description.short is ${short.length} characters (limit ${SHORT_DESCRIPTION_MAX})`));
	if (/\bapps?\b/i.test(short)) out.push(issue('desc.short-no-app-word', 'description.short uses the word "app"'));
	if (manifest.name?.short && short.toLowerCase().includes(manifest.name.short.toLowerCase())) {
		out.push(issue('desc.short-no-app-word', 'description.short repeats the app name'));
	}
	if (full.length > FULL_DESCRIPTION_MAX) out.push(issue('desc.full-length', `description.full is ${full.length} characters (limit ${FULL_DESCRIPTION_MAX})`));
	if (words(full) > FULL_DESCRIPTION_WORDS) out.push(issue('desc.full-length', `description.full is ${words(full)} words (limit ${FULL_DESCRIPTION_WORDS})`));
	for (const [label, text] of [['description.short', short], ['description.full', full], ['intro.md', intro]]) {
		for (const [re, what] of FORBIDDEN_TERMS) if (re.test(text)) out.push(issue('desc.forbidden-terms', `${label} uses ${what}`));
		const sup = SUPERLATIVES.exec(text);
		if (sup) out.push(issue('desc.forbidden-terms', `${label} uses the superlative "${sup[0]}"`));
		if (!firstTeamsReferenceOk(text)) out.push(issue('desc.first-teams-reference', `${label} first mentions Teams without "Microsoft Teams"`));
	}
	if (!/limitation/i.test(intro) || !/rate limit/i.test(intro)) {
		out.push(issue('desc.states-limitations', 'intro.md needs a limitations section that states the rate limits'));
	}
	if (!/\d+\s*(to|-)\s*\d+\s*seconds/i.test(full)) out.push(issue('desc.states-limitations', 'description.full does not state how long generation takes'));
	if (!/Microsoft 365 Copilot/.test(full)) out.push(issue('desc.copilot-compatibility', 'description.full does not say it works with Microsoft 365 Copilot'));
	if (!/for example,?\s+(ask|try|say)\b[^.]*"[^"]{8,}"/i.test(full)) {
		out.push(issue('desc.copilot-compatibility', 'description.full has no sample prompt (for example, ask "...")'));
	}
	return out;
}

/** Every description Copilot reads as model context, labelled by where it lives. */
export function copilotTexts({ manifest, tools, agent, plugin }) {
	const texts = [];
	for (const c of manifest.agentConnectors ?? []) texts.push([`agentConnectors ${c.id}`, c.description]);
	for (const ext of manifest.composeExtensions ?? []) {
		for (const cmd of ext.commands ?? []) {
			texts.push([`command ${cmd.id}`, cmd.description]);
			for (const p of cmd.parameters ?? []) texts.push([`command ${cmd.id} parameter ${p.name}`, p.description]);
		}
	}
	for (const bot of manifest.bots ?? []) {
		for (const list of bot.commandLists ?? []) for (const cmd of list.commands ?? []) texts.push([`bot command ${cmd.title}`, cmd.description]);
	}
	for (const t of tools?.tools ?? []) texts.push([`tool ${t.name}`, t.description]);
	if (agent) texts.push(['declarative agent description', agent.description]);
	if (plugin) {
		texts.push(['plugin description_for_model', plugin.description_for_model]);
		texts.push(['plugin description_for_human', plugin.description_for_human]);
	}
	return texts.filter(([, text]) => typeof text === 'string');
}

export function checkCopilotText({ manifest, tools, agent, plugin }) {
	const out = [];
	for (const [label, text] of copilotTexts({ manifest, tools, agent, plugin })) {
		const ins = INSTRUCTIONAL.exec(text);
		if (ins) out.push(issue('copilot.no-instructional-phrases', `${label} contains the instructional phrase "${ins[0]}"`));
		if (URL_RE.test(text)) out.push(issue('copilot.no-urls-emoji-hidden', `${label} contains a URL`));
		if (EMOJI_RE.test(text)) out.push(issue('copilot.no-urls-emoji-hidden', `${label} contains an emoji`));
		if (HIDDEN_RE.test(text)) out.push(issue('copilot.no-urls-emoji-hidden', `${label} contains a hidden character`));
		const sup = SUPERLATIVES.exec(text);
		if (sup) out.push(issue('copilot.no-superlatives', `${label} contains the superlative "${sup[0]}"`));
	}
	for (const t of tools?.tools ?? []) {
		if (typeof t.annotations?.readOnlyHint !== 'boolean') out.push(issue('copilot.mcp-readonly-hint', `tool ${t.name} does not declare readOnlyHint`));
		else if (t.annotations.readOnlyHint && t.annotations.destructiveHint) {
			out.push(issue('copilot.mcp-readonly-hint', `tool ${t.name} is marked both read-only and destructive`));
		}
	}
	return out;
}

const semver = (v) => String(v).replace(/^[^\d]*/, '').split('.').map((n) => Number.parseInt(n, 10) || 0);
export function versionAtLeast(version, min) {
	const v = semver(version);
	for (let i = 0; i < min.length; i++) {
		if ((v[i] ?? 0) !== min[i]) return (v[i] ?? 0) > min[i];
	}
	return true;
}

export function checkTeamsJs(pkg) {
	const range = pkg.dependencies?.['@microsoft/teams-js'] ?? pkg.devDependencies?.['@microsoft/teams-js'];
	if (!range) return [issue('copilot.teamsjs-version', '@microsoft/teams-js is not a dependency')];
	if (!versionAtLeast(range, TEAMSJS_MIN)) return [issue('copilot.teamsjs-version', `@microsoft/teams-js ${range} is older than ${TEAMSJS_MIN.join('.')}`)];
	return [];
}

/** color.png's background (its border ring) must be one solid colour or fully transparent. */
export async function checkColorIcon(buffer) {
	const { data, info } = await sharp(buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
	const { width, height, channels } = info;
	const px = (x, y) => {
		const i = (y * width + x) * channels;
		return [data[i], data[i + 1], data[i + 2], data[i + 3]];
	};
	const ring = [];
	for (let x = 0; x < width; x++) ring.push(px(x, 0), px(x, height - 1));
	for (let y = 1; y < height - 1; y++) ring.push(px(0, y), px(width - 1, y));
	const transparent = ring.every((p) => p[3] === 0);
	const [r, g, b] = ring[0];
	const solid = ring.every((p) => p[3] === 255 && Math.abs(p[0] - r) <= 2 && Math.abs(p[1] - g) <= 2 && Math.abs(p[2] - b) <= 2);
	if (!transparent && !solid) return [issue('icons.color', 'color.png background is neither one solid colour nor fully transparent')];
	return [];
}

/** developer.name must equal the Partner Center publisher display name. */
export function checkDeveloperName(manifest, env, { check }) {
	const publisher = String(env.MS_PARTNER_CENTER_PUBLISHER_NAME ?? '').trim();
	if (check && !publisher) return { problems: [], note: 'developer.publisher-name: not checked (MS_PARTNER_CENTER_PUBLISHER_NAME is an owner value)' };
	if (!publisher) return { problems: [issue('developer.publisher-name', 'MS_PARTNER_CENTER_PUBLISHER_NAME is not set')], note: null };
	if (check) return { problems: [], note: 'developer.publisher-name: not checked (--check uses a check-only developer name)' };
	if (manifest.developer?.name !== publisher) {
		return { problems: [issue('developer.publisher-name', `developer.name "${manifest.developer?.name}" differs from the Partner Center publisher "${publisher}"`)], note: null };
	}
	return { problems: [], note: null };
}

export function introLinks(intro) {
	return [...intro.matchAll(/https:\/\/[^\s)>"]+/g)].map((m) => m[0].replace(/[.,]$/, ''));
}

export function checkListingLinks(manifest, intro) {
	const out = [];
	const links = introLinks(intro);
	for (const [field, url] of [['privacyUrl', manifest.developer?.privacyUrl], ['termsOfUseUrl', manifest.developer?.termsOfUseUrl], ['websiteUrl', manifest.developer?.websiteUrl]]) {
		if (!links.includes(url)) out.push(issue('links.listing-matches-manifest', `intro.md does not carry developer.${field} ${url}`));
	}
	return out;
}

/** Every origin a tab loads inside the Teams frame. */
export function framedUrls(manifest) {
	const urls = [];
	for (const t of manifest.staticTabs ?? []) if (t.contentUrl) urls.push(t.contentUrl);
	for (const t of manifest.configurableTabs ?? []) if (t.configurationUrl) urls.push(t.configurationUrl);
	return urls;
}

const hostCovered = (host, domains) =>
	domains.some((d) => d === host || (d.startsWith('*.') && host.endsWith(d.slice(1)) && host.split('.').length === d.split('.').length));

export function checkValidDomains(manifest, { extraOrigins = [] } = {}) {
	const out = [];
	const domains = manifest.validDomains ?? [];
	for (const d of domains) {
		if (/[/:]/.test(d)) out.push(issue('domains.valid-entries', `validDomains entry "${d}" has a scheme, port or path`));
		if (/^\*\.[^.]+$/.test(d) || d === '*') out.push(issue('domains.valid-entries', `validDomains entry "${d}" wildcards a top-level domain`));
		if (MICROSOFT_DOMAINS.test(d.replace(/^\*\./, ''))) out.push(issue('domains.valid-entries', `validDomains entry "${d}" is a Microsoft domain`));
	}
	const hosts = new Set([...framedUrls(manifest), ...extraOrigins].map((u) => new URL(u.replace(/\{[^}]+\}/g, 'x')).hostname));
	for (const host of hosts) if (!hostCovered(host, domains)) out.push(issue('domains.cover-loaded-origins', `${host} is loaded in a tab but is not in validDomains`));
	if (manifest.webApplicationInfo?.resource) {
		const host = new URL(manifest.webApplicationInfo.resource).hostname;
		if (!hostCovered(host, domains)) out.push(issue('domains.cover-loaded-origins', `webApplicationInfo.resource ${host} is not in validDomains`));
	}
	return out;
}

export function checkBot(manifest) {
	const out = [];
	for (const bot of manifest.bots ?? []) {
		const covered = new Set((bot.commandLists ?? []).flatMap((l) => l.scopes));
		for (const s of bot.scopes) if (!covered.has(s)) out.push(issue('bot.scopes-match', `bot scope ${s} has no command list`));
		for (const s of covered) if (!bot.scopes.includes(s)) out.push(issue('bot.scopes-match', `command list scope ${s} is not a bot scope`));
		const titles = (bot.commandLists ?? []).flatMap((l) => l.commands.map((c) => c.title));
		for (const t of titles) if (t.startsWith('/')) out.push(issue('bot.no-slash-commands', `bot command "${t}" starts with a slash`));
		if (!titles.some((t) => t.toLowerCase() === 'help')) out.push(issue('bot.help-command', 'the bot command list has no help command'));
	}
	return out;
}

/** Fill a manifest URL template the way a Teams host would. */
export const resolveTemplate = (url) => url.replace('{theme}', 'default').replace(/\{[^}]+\}/g, '');

/** Every URL the package and listing carry, de-duplicated, templates resolved. */
export function packageUrls(manifest, intro) {
	const urls = new Set();
	const walk = (node, key) => {
		if (typeof node === 'string') {
			if (/^https?:\/\//.test(node) && key !== '$schema' && key !== 'referenceId') urls.add(resolveTemplate(node));
		} else if (Array.isArray(node)) node.forEach((n) => walk(n, key));
		else if (node && typeof node === 'object') for (const [k, v] of Object.entries(node)) walk(v, k);
	};
	walk(manifest, '');
	for (const u of introLinks(intro)) urls.add(u);
	return [...urls];
}

/** Parse a CSP header's frame-ancestors sources. */
export function frameAncestors(csp) {
	const dir = String(csp ?? '')
		.split(';')
		.map((d) => d.trim())
		.find((d) => d.startsWith('frame-ancestors'));
	return dir ? dir.split(/\s+/).slice(1) : null;
}

/** Hosts from REQUIRED_FRAME_ANCESTORS a CSP does not allow. */
export function missingFrameAncestors(csp) {
	const sources = frameAncestors(csp);
	if (sources === null) return [];
	if (sources.includes('*')) return [];
	const allows = (host) =>
		sources.some((s) => {
			const m = /^(https:\/\/)?(\*\.)?([^/:]+)/.exec(s);
			if (!m || s.startsWith("'")) return false;
			return m[2] ? host.endsWith(`.${m[3]}`) : host === m[3];
		});
	return REQUIRED_FRAME_ANCESTORS.filter((h) => !allows(h));
}

const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

/** TLS protocol a host negotiates, e.g. "TLSv1.3". */
export function tlsProtocol(host) {
	return new Promise((resolve, reject) => {
		const socket = tls.connect({ host, port: 443, servername: host, timeout: 10_000 }, () => {
			const proto = socket.getProtocol();
			socket.end();
			resolve(proto);
		});
		socket.on('timeout', () => {
			socket.destroy();
			reject(new Error(`TLS handshake with ${host} timed out`));
		});
		socket.on('error', reject);
	});
}

/**
 * The live checks: every URL over HTTPS with 200 and no redirect, TLS 1.2+, the tab
 * pages' frame-ancestors, the MCP server's initialize, and tab response time.
 */
export async function checkLive(manifest, intro, { fetchImpl = fetch, tlsImpl = tlsProtocol, timeoutMs = 15_000 } = {}) {
	const out = [];
	const notes = [];
	const framed = new Set(framedUrls(manifest).map(resolveTemplate));
	const hosts = new Set();
	for (const url of packageUrls(manifest, intro)) {
		if (!url.startsWith('https://')) {
			out.push(issue('links.https-200', `${url} is not HTTPS`));
			continue;
		}
		hosts.add(new URL(url).hostname);
		const isMcp = manifest.agentConnectors?.some((c) => c.toolSource?.remoteMcpServer?.mcpServerUrl === url);
		try {
			const res = isMcp
				? await fetchImpl(url, {
						method: 'POST',
						redirect: 'manual',
						signal: AbortSignal.timeout(timeoutMs),
						headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
						body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'three-ws-store-preflight', version: '1' } } }),
					})
				: await fetchImpl(url, { redirect: 'manual', signal: AbortSignal.timeout(timeoutMs) });
			const rule = isMcp ? 'copilot.https-no-redirect' : 'links.https-200';
			if (res.status !== 200) out.push(issue(rule, `${url} answered HTTP ${res.status}${res.headers.get('location') ? ` -> ${res.headers.get('location')}` : ''}`));
			if (framed.has(url)) {
				const missing = missingFrameAncestors(res.headers.get('content-security-policy'));
				if (missing.length) out.push(issue('copilot.frame-ancestors', `${url} frame-ancestors does not allow ${missing.join(', ')}`));
				if (/deny|sameorigin/i.test(res.headers.get('x-frame-options') ?? '')) out.push(issue('copilot.frame-ancestors', `${url} sends X-Frame-Options ${res.headers.get('x-frame-options')}`));
			}
			await res.arrayBuffer().catch(() => null);
		} catch (err) {
			out.push(issue(isMcp ? 'copilot.https-no-redirect' : 'links.https-200', `${url} did not answer: ${err.message}`));
		}
	}
	for (const host of hosts) {
		try {
			const proto = await tlsImpl(host);
			if (!/^TLSv1\.[23]$/.test(proto)) out.push(issue('copilot.https-no-redirect', `${host} negotiated ${proto}, below TLS 1.2`));
		} catch (err) {
			out.push(issue('copilot.https-no-redirect', `${host} TLS check failed: ${err.message}`));
		}
	}
	for (const url of framed) {
		const times = [];
		for (let i = 0; i < 3; i++) {
			const t0 = performance.now();
			try {
				const res = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs) });
				await res.arrayBuffer();
				times.push(performance.now() - t0);
			} catch (err) {
				times.push(Number.POSITIVE_INFINITY);
			}
		}
		const ms = median(times);
		if (ms > RESPONSE_BUDGET_MS) out.push(issue('response.time', `${url} took ${Math.round(ms)} ms (median of 3, budget ${RESPONSE_BUDGET_MS} ms)`));
		else notes.push(`${url}: ${Math.round(ms)} ms`);
	}
	return { problems: out, notes };
}

/** Where the Microsoft 365 Agents Toolkit CLI is installed, or null to fetch it pinned. */
export const ATK_VERSION = '1.1.18';
function atkCommand(env) {
	const home = env.ATK_HOME || join(process.env.HOME || '', '.cache', 'atk');
	const bin = join(home, 'node_modules', '.bin', 'atk');
	if (existsSync(bin)) return [bin, []];
	return ['npx', ['--yes', `@microsoft/m365agentstoolkit-cli@${ATK_VERSION}`]];
}

/**
 * Run Microsoft's validator on the assembled files in its offline manifest mode
 * (schema and rule checks, no Microsoft 365 sign-in). Returns { problems, output }.
 */
export function atkValidate(files, { env = process.env, spawn = spawnSync } = {}) {
	const dir = mkdtempSync(join(tmpdir(), 'threews-atk-'));
	try {
		const pkgDir = join(dir, 'appPackage');
		mkdirSync(pkgDir);
		for (const [name, buf] of Object.entries(files)) writeFileSync(join(pkgDir, name), buf);
		const [cmd, pre] = atkCommand(env);
		const res = spawn(cmd, [...pre, 'validate', '--manifest-file', join(pkgDir, 'manifest.json'), '--folder', dir, '--telemetry', 'false'], {
			encoding: 'utf8',
			timeout: 300_000,
			env: { ...env, M365_AGENTS_TOOLKIT_TELEMETRY_DISABLED: 'true' },
		});
		const output = `${res.stdout ?? ''}${res.stderr ?? ''}`.trim();
		if (res.error) return { problems: [issue('package.cli-validator', `atk could not run: ${res.error.message}`)], output };
		if (res.status !== 0) return { problems: [issue('package.cli-validator', `atk validate exited ${res.status}:\n${output}`)], output };
		return { problems: [], output };
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

/** Group problems by rule id for the per-rule report. */
export function summarize(rules, problems, { skipped = [] } = {}) {
	const byRule = new Map(rules.map((r) => [r.id, []]));
	for (const p of problems) {
		if (!byRule.has(p.rule)) byRule.set(p.rule, []);
		byRule.get(p.rule).push(p.message);
	}
	const lines = [];
	for (const r of rules) {
		if (r.check.type !== 'preflight') continue;
		const msgs = byRule.get(r.id);
		const status = skipped.includes(r.id) ? 'SKIP' : msgs.length ? 'FAIL' : 'PASS';
		lines.push(`${status}  ${r.id}${msgs.length ? `\n        ${msgs.join('\n        ')}` : ''}`);
	}
	return lines;
}
