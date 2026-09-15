#!/usr/bin/env node

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BASELINE_PATH = resolve(ROOT, 'data/pump-upstream-baseline.json');
const args = new Set(process.argv.slice(2));
const accept = args.has('--accept');
const asJson = args.has('--json');
const githubToken = process.env.PUMP_WATCH_GITHUB_TOKEN || process.env.GITHUB_TOKEN || '';

const OFFICIAL_NPM_SCOPE = '@pump-fun/';
const KNOWN_PACKAGES = [
	'@pump-fun/pump-sdk',
	'@pump-fun/pump-swap-sdk',
	'@pump-fun/agent-payments-sdk',
	'@pump-fun/shared-contracts',
];

async function fetchJson(url, { github = false } = {}) {
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), 15_000);
	try {
		const headers = { accept: 'application/json', 'user-agent': 'three-ws-pump-upstream-watch' };
		if (github) {
			headers.accept = 'application/vnd.github+json';
			headers['x-github-api-version'] = '2022-11-28';
			if (githubToken) headers.authorization = `Bearer ${githubToken}`;
		}
		const response = await fetch(url, { headers, signal: controller.signal });
		if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
		return response.json();
	} finally {
		clearTimeout(timeout);
	}
}

async function npmState() {
	const search = await fetchJson('https://registry.npmjs.org/-/v1/search?text=scope%3Apump-fun&size=250');
	const packages = [
		...new Set([
			...KNOWN_PACKAGES,
			...(search.objects ?? [])
				.map((entry) => entry.package?.name)
				.filter((name) => typeof name === 'string' && name.startsWith(OFFICIAL_NPM_SCOPE)),
		]),
	].sort((a, b) => a.localeCompare(b));
	const entries = await Promise.all(
		packages.map(async (name) => {
			const encoded = name.replace('/', '%2f');
			const metadata = await fetchJson(`https://registry.npmjs.org/${encoded}`);
			const version = metadata['dist-tags']?.latest;
			return [name, { version, publishedAt: metadata.time?.[version] ?? null }];
		}),
	);
	return Object.fromEntries(entries);
}

async function officialRepoState() {
	const repos = await fetchJson('https://api.github.com/orgs/pump-fun/repos?per_page=100&type=public', {
		github: true,
	});
	return Object.fromEntries(
		repos
			.sort((a, b) => a.name.localeCompare(b.name))
			.map((repo) => [
				repo.name,
				{
					pushedAt: repo.pushed_at,
					defaultBranch: repo.default_branch,
					archived: repo.archived,
					url: repo.html_url,
				},
			]),
	);
}

async function nirholasCandidates() {
	const repos = [];
	for (let page = 1; page <= 4; page += 1) {
		const batch = await fetchJson(
			`https://api.github.com/users/nirholas/repos?per_page=100&page=${page}&type=public`,
			{ github: true },
		);
		repos.push(...batch);
		if (batch.length < 100) break;
	}
	const relevant = /pump|memecoin|solana launch|creator reward/i;
	return repos
		.filter((repo) => repo.name === 'three.ws' || relevant.test(`${repo.name} ${repo.description ?? ''} ${(repo.topics ?? []).join(' ')}`))
		.map((repo) => ({
			name: repo.name,
			url: repo.html_url,
			updatedAt: repo.updated_at,
			archived: repo.archived,
		}))
		.sort((a, b) => a.name.localeCompare(b.name));
}

async function nirholasCodeConsumers() {
	if (!githubToken) return [];
	const queries = [
		'user:nirholas "@pump-fun/"',
		'user:nirholas "@nirholas/pump-sdk"',
		'user:nirholas "pump.fun"',
	];
	const found = new Map();
	for (const query of queries) {
		try {
			const result = await fetchJson(
				`https://api.github.com/search/code?per_page=100&q=${encodeURIComponent(query)}`,
				{ github: true },
			);
			for (const item of result.items ?? []) {
				const repo = item.repository;
				if (repo?.owner?.login === 'nirholas' && !repo.private) {
					found.set(repo.name, {
						name: repo.name,
						url: repo.html_url,
						updatedAt: repo.updated_at,
						archived: repo.archived,
					});
				}
			}
		} catch (error) {
			process.stderr.write(`pump:watch: GitHub code search skipped (${error.message})\n`);
		}
	}
	return [...found.values()];
}

function readDeclaredVersions() {
	const manifests = [
		'package.json',
		'agent-payments-sdk/package.json',
		'character-studio/package.json',
		'multiplayer/package.json',
		'packages/agent-sniper/package.json',
	];
	const rows = [];
	for (const path of manifests) {
		const manifest = JSON.parse(readFileSync(resolve(ROOT, path), 'utf8'));
		const dependencies = { ...manifest.dependencies, ...manifest.devDependencies };
		for (const [name, range] of Object.entries(dependencies)) {
			if (name.startsWith(OFFICIAL_NPM_SCOPE)) rows.push({ path, name, range });
		}
	}
	return rows;
}

function diffState(baseline, current) {
	const changes = [];
	for (const [name, value] of Object.entries(current.packages)) {
		const previous = baseline.packages?.[name]?.version;
		if (previous !== value.version) changes.push(`npm ${name}: ${previous ?? 'new'} -> ${value.version}`);
	}
	for (const name of Object.keys(baseline.packages ?? {})) {
		if (!current.packages[name]) changes.push(`npm ${name}: removed or made private`);
	}
	for (const [name, value] of Object.entries(current.repositories)) {
		const previous = baseline.repositories?.[name]?.pushedAt;
		if (previous !== value.pushedAt) changes.push(`GitHub pump-fun/${name}: ${previous ?? 'new'} -> ${value.pushedAt}`);
	}
	for (const name of Object.keys(baseline.repositories ?? {})) {
		if (!current.repositories[name]) changes.push(`GitHub pump-fun/${name}: removed or made private`);
	}
	return changes;
}

function markdown(report) {
	const lines = ['# Pump.fun upstream watch', '', `Checked: ${report.checkedAt}`, ''];
	lines.push('## Official npm packages', '', '| Package | Latest | Published |', '|---|---:|---|');
	for (const [name, value] of Object.entries(report.packages)) {
		lines.push(`| \`${name}\` | \`${value.version}\` | ${value.publishedAt ?? 'unknown'} |`);
	}
	lines.push('', '## Local direct consumers', '', '| Manifest | Package | Declared |', '|---|---|---:|');
	for (const row of report.localConsumers) {
		lines.push(`| \`${row.path}\` | \`${row.name}\` | \`${row.range}\` |`);
	}
	lines.push('', '## Official public repositories', '', '| Repository | Last push | Status |', '|---|---|---|');
	for (const [name, value] of Object.entries(report.repositories)) {
		lines.push(`| [pump-fun/${name}](${value.url}) | ${value.pushedAt} | ${value.archived ? 'archived' : 'active'} |`);
	}
	lines.push('', `## nirholas public Pump.fun surface (${report.nirholasCandidates.length} candidates)`, '');
	lines.push(report.nirholasCandidates.map((repo) => `[${repo.name}](${repo.url})`).join(', ') || 'None found.');
	lines.push('', '## Drift', '');
	lines.push(...(report.changes.length ? report.changes.map((change) => `- ${change}`) : ['No upstream drift detected.']));
	return `${lines.join('\n')}\n`;
}

const [packages, repositories, candidates, codeConsumers] = await Promise.all([
	npmState(),
	officialRepoState(),
	nirholasCandidates(),
	nirholasCodeConsumers(),
]);
const candidateMap = new Map(candidates.map((repo) => [repo.name, repo]));
for (const repo of codeConsumers) candidateMap.set(repo.name, repo);
const allCandidates = [...candidateMap.values()].sort((a, b) => a.name.localeCompare(b.name));
const current = { packages, repositories };
let baseline = { packages: {}, repositories: {} };
try {
	baseline = JSON.parse(readFileSync(BASELINE_PATH, 'utf8'));
} catch {
	if (!accept) throw new Error('Missing baseline. Run npm run pump:watch -- --accept once.');
}
const report = {
	checkedAt: new Date().toISOString(),
	packages,
	repositories,
	localConsumers: readDeclaredVersions(),
	nirholasCandidates: allCandidates,
	changes: diffState(baseline, current),
};

if (accept) {
	writeFileSync(
		BASELINE_PATH,
		`${JSON.stringify({ acceptedAt: report.checkedAt, ...current }, null, '\t')}\n`,
	);
}

process.stdout.write(asJson ? `${JSON.stringify(report, null, '\t')}\n` : markdown(report));
if (!accept && report.changes.length) process.exitCode = 2;
