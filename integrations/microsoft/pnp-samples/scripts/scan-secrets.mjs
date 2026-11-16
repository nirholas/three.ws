#!/usr/bin/env node
// Scans every file staged under integrations/microsoft/pnp-samples for
// material that must never reach a public gallery pull request:
//   - three.ws API keys (sk_live_ / sk_test_) and the key in THREEWS_API_KEY
//   - JSON Web Tokens, private keys, Azure storage connection strings
//   - tenant ids, client ids and subscription ids written into env files
//   - any non-empty SECRET_ value in an env file
//
// Usage: node integrations/microsoft/pnp-samples/scripts/scan-secrets.mjs
// Exit code 0 means nothing was found.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const SKIP_DIRS = new Set(['node_modules', '.git', 'lib', 'temp', 'dist']);
const BINARY = /\.(png|jpe?g|gif|ico|zip|sppkg|woff2?)$/i;

const GUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

const PATTERNS = [
	{ name: 'three.ws API key', re: /\bsk_(live|test)_[A-Za-z0-9]{8,}/ },
	{ name: 'JSON Web Token', re: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/ },
	{ name: 'private key', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
	{ name: 'Azure storage connection string', re: /AccountKey=[A-Za-z0-9+/=]{20,}/ },
	{ name: 'GitHub token', re: /\bgh[pousr]_[A-Za-z0-9]{30,}/ },
	{ name: 'OpenAI or Anthropic key', re: /\bsk-(ant-|proj-)?[A-Za-z0-9_-]{24,}/ },
];

// Env keys whose value identifies a tenant, an app registration or a secret.
const ENV_IDENTITY_KEY = /(TENANT_ID|CLIENT_ID|SUBSCRIPTION_ID|BOT_ID|TEAMS_APP_ID|APP_ID|PASSWORD|SECRET|_KEY|REGISTRATION_ID|RESOURCE_ID)$/;

function walk(dir) {
	const out = [];
	for (const name of readdirSync(dir)) {
		if (SKIP_DIRS.has(name)) continue;
		const full = join(dir, name);
		if (statSync(full).isDirectory()) out.push(...walk(full));
		else if (!BINARY.test(name)) out.push(full);
	}
	return out;
}

export function scanText(path, text, liveKey) {
	const findings = [];
	const lines = text.split('\n');
	const isEnv = /(^|\/)(\.env[^/]*|[^/]*\.env)$/.test(path);
	lines.forEach((line, i) => {
		const at = `${path}:${i + 1}`;
		if (liveKey && line.includes(liveKey)) findings.push(`${at} contains the THREEWS_API_KEY value`);
		for (const p of PATTERNS) if (p.re.test(line)) findings.push(`${at} looks like a ${p.name}`);
		if (isEnv) {
			const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
			if (m && m[2].trim() && ENV_IDENTITY_KEY.test(m[1])) findings.push(`${at} sets ${m[1]}; leave it empty for the Toolkit to fill in`);
		}
		if (/tenant/i.test(line) && GUID.test(line)) findings.push(`${at} pairs "tenant" with a GUID`);
	});
	return findings;
}

function main() {
	const liveKey = (process.env.THREEWS_API_KEY || '').trim() || null;
	const files = walk(root);
	const findings = files.flatMap((f) => scanText(relative(root, f).split('\\').join('/'), readFileSync(f, 'utf8'), liveKey));
	if (findings.length) {
		console.log(`Found ${findings.length} possible secret(s):`);
		for (const f of findings) console.log(`  - ${f}`);
		process.exit(1);
	}
	console.log(`Scanned ${files.length} files under ${relative(process.cwd(), root) || '.'}: no secrets, keys or tenant ids.${liveKey ? ' The THREEWS_API_KEY value appears nowhere.' : ''}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
