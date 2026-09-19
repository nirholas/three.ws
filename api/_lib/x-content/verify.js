// Live verification of a queue item: the facts, not the phrasing.
//
// A post that is well written and wrong is worse than no post. This module
// checks every declared claim against the thing it cites, at the moment of
// review:
//
//   page           the live page, rendered in a real browser, contains the text
//   file           a repo file contains the text or matches the pattern
//   module         a repo module's export has the stated length or value
//   github-issue   an issue has the stated state and label
//   github-issues  a repository has at least N issues matching state and label
//
// It also resolves every link in the copy, confirms every @mention is a real,
// public account, and spellchecks the prose. The CLI runs it before the editor
// (editor.js) and records the result; production re-checks links right before
// a post goes out (linkChecks).

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { mentionsIn } from './editorial.js';
import { urlRe, urlsIn } from './quality.js';

const UA = 'three.ws editorial verifier (+https://three.ws)';
const normalize = (text) => String(text || '').replace(/\s+/g, ' ').trim().toLowerCase();

export function itemTexts(item) {
	return [item.kind === 'article' ? item.article?.title : null, ...(item.posts || []).map((post) => post.text)].filter(Boolean);
}

export function linksIn(texts) {
	const links = new Set();
	for (const text of texts) for (const match of urlsIn(text)) links.add(/^https?:/i.test(match) ? match : `https://${match}`);
	return [...links].map((link) => link.replace(/[).,;:!?]+$/, ''));
}

async function fetchWithTimeout(url, init = {}, ms = 20_000) {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), ms);
	try {
		return await fetch(url, { redirect: 'follow', ...init, headers: { 'user-agent': UA, ...(init.headers || {}) }, signal: controller.signal });
	} finally {
		clearTimeout(timer);
	}
}

// Links must answer 2xx after redirects. Runs in production too, right before
// a post is sent, because a page can break between review and publish.
export async function linkChecks(texts) {
	const checks = [];
	for (const url of linksIn(texts)) {
		try {
			const response = await fetchWithTimeout(url);
			const ok = response.status >= 200 && response.status < 300;
			checks.push({ kind: 'link', target: url, ok, detail: ok ? `HTTP ${response.status}${response.url !== url ? ` via ${response.url}` : ''}` : `HTTP ${response.status}` });
		} catch (err) {
			checks.push({ kind: 'link', target: url, ok: false, detail: `unreachable: ${err.message}` });
		}
	}
	return checks;
}

export function createPageReader() {
	// One launch shared by every caller, so parallel reads never start two browsers.
	let launching = null;
	const cache = new Map();
	return {
		async text(url) {
			if (cache.has(url)) return cache.get(url);
			launching ||= import('playwright').then(({ chromium }) => chromium.launch());
			const browser = await launching;
			const page = await browser.newPage({ userAgent: UA });
			try {
				const response = await page.goto(url, { waitUntil: 'networkidle', timeout: 60_000 }).catch(() => null);
				const status = response?.status() ?? 0;
				// Client-rendered pages (AWS Builder Center, most SPAs) can still be
				// empty at network idle. Wait until the text stops growing, so a
				// claim is never failed by a page that had not finished rendering.
				await page
					.waitForFunction(
						() => {
							const length = document.body.innerText.length;
							const previous = window.__verifyLength || 0;
							window.__verifyLength = length;
							return length > 200 && length === previous;
						},
						null,
						{ polling: 1000, timeout: 30_000 },
					)
					.catch(() => {});
				const text = await page.evaluate(() => document.body.innerText);
				// `text` is normalized for substring checks; `raw` keeps the line
				// breaks and casing the announcement brief harvests facts from.
				const result = { status, text: normalize(text), raw: text };
				cache.set(url, result);
				return result;
			} finally {
				await page.close();
			}
		},
		async close() {
			if (launching) await (await launching).close();
		},
	};
}

async function github(path) {
	const headers = { accept: 'application/vnd.github+json' };
	const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
	if (token) headers.authorization = `Bearer ${token}`;
	const response = await fetchWithTimeout(`https://api.github.com/${path}`, { headers });
	if (!response.ok) throw new Error(`GitHub ${path} answered HTTP ${response.status}`);
	return response.json();
}

const hasLabel = (issue, label) => !label || issue.labels.some((row) => row.name.toLowerCase() === label.toLowerCase());

async function evidenceCheck(evidence, { root, pages }) {
	const target = evidence.url || evidence.path || (evidence.repo ? `${evidence.repo}${evidence.number ? `#${evidence.number}` : ''}` : '');
	const base = { kind: `evidence:${evidence.type}`, target };
	switch (evidence.type) {
		case 'page': {
			const { status, text } = await pages.text(evidence.url);
			if (status < 200 || status >= 300) return { ...base, ok: false, detail: `page answered HTTP ${status}` };
			const found = text.includes(normalize(evidence.contains));
			return { ...base, ok: found, detail: found ? `live page shows "${evidence.contains}"` : `live page does not show "${evidence.contains}"` };
		}
		case 'file': {
			const path = resolve(root, evidence.path);
			if (!existsSync(path)) return { ...base, ok: false, detail: 'file is missing' };
			const body = readFileSync(path, 'utf8');
			const found = evidence.matches ? new RegExp(evidence.matches, 'm').test(body) : body.includes(evidence.contains);
			return { ...base, ok: found, detail: found ? 'file supports the claim' : `file does not contain ${evidence.matches ? `/${evidence.matches}/` : `"${evidence.contains}"`}` };
		}
		case 'module': {
			const module = await import(pathToFileURL(resolve(root, evidence.path)).href);
			const value = module[evidence.export];
			if (value === undefined) return { ...base, ok: false, detail: `export ${evidence.export} is missing` };
			if ('length' in evidence) {
				const ok = value?.length === evidence.length;
				return { ...base, ok, detail: `${evidence.export} has ${value?.length} entries; the claim needs ${evidence.length}` };
			}
			const ok = JSON.stringify(value) === JSON.stringify(evidence.equals);
			return { ...base, ok, detail: ok ? `${evidence.export} matches` : `${evidence.export} is ${JSON.stringify(value)}` };
		}
		case 'github-issue': {
			const issue = await github(`repos/${evidence.repo}/issues/${evidence.number}`);
			const stateOk = !evidence.state || issue.state === evidence.state;
			const labelOk = hasLabel(issue, evidence.label);
			return { ...base, ok: stateOk && labelOk, detail: `#${evidence.number} is ${issue.state}${evidence.label ? `, ${labelOk ? 'has' : 'lacks'} label "${evidence.label}"` : ''}` };
		}
		case 'github-issues': {
			const params = new URLSearchParams({ state: evidence.state || 'open', per_page: '100' });
			if (evidence.label) params.set('labels', evidence.label);
			const issues = (await github(`repos/${evidence.repo}/issues?${params}`)).filter((row) => !row.pull_request);
			const min = evidence.min ?? 1;
			return { ...base, ok: issues.length >= min, detail: `${issues.length} ${evidence.state || 'open'} issue(s)${evidence.label ? ` labelled "${evidence.label}"` : ''}; the claim needs ${min}` };
		}
		default:
			return { ...base, ok: false, detail: `unknown evidence type ${evidence.type}` };
	}
}

async function mentionChecks(texts, env) {
	const handles = mentionsIn(texts.join('\n'));
	if (!handles.length) return [];
	if (!(env.X_API_KEY && env.X_API_SECRET)) {
		return handles.map((handle) => ({ kind: 'mention', target: handle, ok: false, detail: 'X_API_KEY and X_API_SECRET are needed to confirm the account exists' }));
	}
	const { TwitterApi } = await import('twitter-api-v2');
	const client = await new TwitterApi({ appKey: env.X_API_KEY, appSecret: env.X_API_SECRET }).appLogin();
	const checks = [];
	for (const handle of handles) {
		try {
			const { data, errors } = await client.v2.userByUsername(handle.slice(1), { 'user.fields': ['name', 'protected', 'verified_type'] });
			if (!data) checks.push({ kind: 'mention', target: handle, ok: false, detail: errors?.[0]?.detail || 'account not found' });
			else if (data.protected) checks.push({ kind: 'mention', target: handle, ok: false, detail: `${data.name} is a protected account` });
			else checks.push({ kind: 'mention', target: handle, ok: true, detail: `${data.name}${data.verified_type && data.verified_type !== 'none' ? ` (${data.verified_type} verified)` : ''}` });
		} catch (err) {
			checks.push({ kind: 'mention', target: handle, ok: false, detail: `lookup failed: ${err.message}` });
		}
	}
	return checks;
}

async function spellingChecks(item, texts, glossary) {
	const { spellCheckDocument } = await import('cspell-lib');
	const handles = mentionsIn(texts.join('\n')).map((handle) => handle.slice(1));
	const prose = texts.join('\n').replace(urlRe('gi'), ' ').replace(/\$THREE\b/g, ' ');
	const altTexts = (item.posts || []).flatMap((post) => (post.media || []).map((media) => media.alt)).filter(Boolean);
	const result = await spellCheckDocument(
		{ uri: 'file:///x-content.txt', text: [prose, ...altTexts].join('\n'), languageId: 'plaintext', locale: 'en-US,en-GB' },
		{ generateSuggestions: true, noConfigSearch: true },
		{ words: [...glossary, ...handles], ignoreWords: [] },
	);
	const seen = new Set();
	return result.issues
		.filter((issue) => !seen.has(issue.text.toLowerCase()) && seen.add(issue.text.toLowerCase()))
		.map((issue) => ({
			kind: 'spelling',
			target: issue.text,
			ok: false,
			detail: issue.suggestions?.length ? `did you mean ${issue.suggestions.slice(0, 3).map((s) => (typeof s === 'string' ? s : s.word)).join(', ')}?` : 'not a known word; add it to the queue glossary if it is correct',
		}));
}

// ── Feature probes ──────────────────────────────────────────────────────────
// A claim check proves the page says something. A probe proves the feature
// does it. Every item headed for approval declares at least one, in `probes`:
//
//   api      fetch a URL; expect a status, text, or a JSON value. Cheap and
//            dependency-free, so it runs at review AND seconds before posting.
//   browser  drive the live page in a real browser: goto, click, expect text.
//   command  run a repo test that exercises the exact behavior the post claims
//            (e.g. `node --test packages/three-token-mcp/test/burn-policy.test.mjs`).
// Browser and command probes need a browser and a checkout, so they run at
// review time only; the production pre-flight runs the api probes.

const jsonPath = (value, path) => String(path).split('.').reduce((node, key) => (node == null ? node : node[key]), value);

async function apiProbe(probe) {
	const response = await fetchWithTimeout(probe.url, {
		method: probe.method || 'GET',
		headers: probe.body ? { 'content-type': 'application/json' } : {},
		body: probe.body ? JSON.stringify(probe.body) : undefined,
	}, probe.timeoutMs || 20_000);
	const expect = probe.expect || {};
	const statusOk = expect.status ? response.status === expect.status : response.ok;
	if (!statusOk) return { ok: false, detail: `HTTP ${response.status}` };
	const body = await response.text();
	if (expect.contains && !body.includes(expect.contains)) return { ok: false, detail: `response does not contain "${expect.contains}"` };
	if (expect.json) {
		let parsed;
		try {
			parsed = JSON.parse(body);
		} catch {
			return { ok: false, detail: 'response is not JSON' };
		}
		const value = jsonPath(parsed, expect.json.path);
		if ('equals' in expect.json && JSON.stringify(value) !== JSON.stringify(expect.json.equals)) return { ok: false, detail: `${expect.json.path} is ${JSON.stringify(value)}` };
		if (expect.json.exists && value === undefined) return { ok: false, detail: `${expect.json.path} is missing` };
		if ('min' in expect.json && !(Number(value?.length ?? value) >= expect.json.min)) return { ok: false, detail: `${expect.json.path} is ${JSON.stringify(value)}; needs at least ${expect.json.min}` };
	}
	return { ok: true, detail: `HTTP ${response.status}, expectations met` };
}

async function browserProbe(probe) {
	const { chromium } = await import('playwright');
	const browser = await chromium.launch();
	try {
		const page = await browser.newPage({ userAgent: UA });
		for (const step of probe.steps || []) {
			if (step.goto) await page.goto(step.goto, { waitUntil: 'networkidle', timeout: 60_000 });
			else if (step.click) await page.getByText(step.click, { exact: false }).first().click({ timeout: 20_000 });
			else if (step.expect) await page.getByText(step.expect, { exact: false }).first().waitFor({ timeout: step.timeoutMs || 45_000 });
		}
		return { ok: true, detail: `${(probe.steps || []).length} steps passed` };
	} catch (err) {
		return { ok: false, detail: err.message.split('\n')[0] };
	} finally {
		await browser.close();
	}
}

async function commandProbe(probe, root) {
	const { spawnSync } = await import('node:child_process');
	const [command, ...args] = probe.argv || [];
	if (!command) return { ok: false, detail: 'command probe has no argv' };
	const run = spawnSync(command, args, { cwd: root, encoding: 'utf8', timeout: probe.timeoutMs || 180_000 });
	if (run.status === 0) return { ok: true, detail: 'exit 0' };
	const tail = `${run.stdout || ''}${run.stderr || ''}`.trim().split('\n').slice(-3).join(' | ');
	return { ok: false, detail: `exit ${run.status ?? run.signal}: ${tail}` };
}

// A long-running action, run for real: submit it, then poll until it finishes.
// This is the probe for anything a user waits on (a generation, a render, a
// rig), because "the job was accepted" is exactly the check that passes while
// the worker behind it is down.
//
//   { type: 'job', submit: { url, method, body }, pollUrl: 'json.path.to.url',
//     until: { path, equals }, fail: { path, in: [...] }, expect: { path, exists },
//     intervalMs, timeoutMs }
async function jobProbe(probe) {
	const started = Date.now();
	const deadline = started + (probe.timeoutMs || 600_000);
	const submit = probe.submit || {};
	const first = await fetchWithTimeout(submit.url, {
		method: submit.method || 'POST',
		headers: submit.body ? { 'content-type': 'application/json' } : {},
		body: submit.body ? JSON.stringify(submit.body) : undefined,
	}, Math.max(1_000, deadline - Date.now()));
	if (!first.ok) return { ok: false, detail: `submit answered HTTP ${first.status}` };
	let body = await first.json();
	const pollUrl = probe.pollUrl ? jsonPath(body, probe.pollUrl) : null;
	const done = (value) => JSON.stringify(jsonPath(value, probe.until.path)) === JSON.stringify(probe.until.equals);
	const failed = (value) => probe.fail && probe.fail.in.includes(jsonPath(value, probe.fail.path));
	while (!done(body)) {
		if (failed(body)) return { ok: false, detail: `job ended ${probe.fail.path}=${JSON.stringify(jsonPath(body, probe.fail.path))}` };
		if (!pollUrl) return { ok: false, detail: `job is not done and ${probe.pollUrl} gave no URL to poll` };
		if (Date.now() + (probe.intervalMs || 10_000) > deadline) {
			return { ok: false, detail: `job not done after ${Math.round((Date.now() - started) / 1000)}s (last ${probe.until.path}=${JSON.stringify(jsonPath(body, probe.until.path))})` };
		}
		await new Promise((resolveWait) => setTimeout(resolveWait, probe.intervalMs || 10_000));
		const next = await fetchWithTimeout(pollUrl, {}, 30_000);
		if (!next.ok) return { ok: false, detail: `poll answered HTTP ${next.status}` };
		body = await next.json();
	}
	if (probe.expect?.path && jsonPath(body, probe.expect.path) === undefined) return { ok: false, detail: `finished without ${probe.expect.path}` };
	const seconds = Math.round((Date.now() - started) / 1000);
	const result = probe.expect?.path ? ` ${probe.expect.path}=${String(jsonPath(body, probe.expect.path)).slice(0, 160)}` : '';
	return { ok: true, detail: `finished in ${seconds}s${result}`, seconds };
}

export async function runProbe(probe, root) {
	if (probe.type === 'api') return apiProbe(probe);
	if (probe.type === 'browser') return browserProbe(probe);
	if (probe.type === 'command') return commandProbe(probe, root);
	if (probe.type === 'job') return jobProbe(probe);
	return { ok: false, detail: `unknown probe type ${probe.type}` };
}

export const probeLabel = (probe) => probe.name || probe.url || probe.submit?.url || (probe.argv || []).join(' ');

// `where` is 'review' (every probe) or 'publish' (api probes only).
export async function probeChecks(item, { root, where = 'review' }) {
	const checks = [];
	for (const probe of item.probes || []) {
		if (where === 'publish' && probe.type !== 'api') continue;
		try {
			checks.push({ kind: `probe:${probe.type}`, target: probeLabel(probe), ...(await runProbe(probe, root)) });
		} catch (err) {
			checks.push({ kind: `probe:${probe.type}`, target: probeLabel(probe), ok: false, detail: err.message });
		}
	}
	return checks;
}

export async function verifyItem(item, { root, glossary = [], env = process.env }) {
	const texts = itemTexts(item);
	const pages = createPageReader();
	const checks = [];
	try {
		for (const claim of item.claims || []) {
			for (const evidence of claim.evidence || []) {
				try {
					checks.push({ claim: claim.says, ...(await evidenceCheck(evidence, { root, pages })) });
				} catch (err) {
					checks.push({ claim: claim.says, kind: `evidence:${evidence.type}`, target: evidence.url || evidence.path || evidence.repo, ok: false, detail: err.message });
				}
			}
		}
	} finally {
		await pages.close();
	}
	if (!item.probes?.length) {
		checks.push({ kind: 'probe', target: item.id, ok: false, detail: 'no feature probe declared; add one to `probes` that proves the feature works, not just that its page loads' });
	}
	checks.push(...(await probeChecks(item, { root, where: 'review' })));
	checks.push(...(await linkChecks(texts)));
	checks.push(...(await mentionChecks(texts, env)));
	checks.push(...(await spellingChecks(item, texts, glossary)));
	return { ok: checks.every((check) => check.ok), checks };
}
