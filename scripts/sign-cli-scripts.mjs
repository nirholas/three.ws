#!/usr/bin/env node
// Checksums and detached ed25519 signatures for the hosted CLI scripts
// (public/cli/*.sh), so anyone piping them to a shell can verify first.
//
//   node scripts/sign-cli-scripts.mjs --init [--out <dir>]   make a keypair; the public half lands in public/cli/signing-key.pem
//   node scripts/sign-cli-scripts.mjs                        sign every script (key: THREE_WS_CLI_SIGNING_KEY pem text, or --key <file>)
//   node scripts/sign-cli-scripts.mjs --check                verify checksums and signatures against the committed public key (no secret needed)
//
// For each public/cli/<name>.sh this writes <name>.sh.sha256 (sha256sum format) and
// <name>.sh.sig (the raw 64-byte signature of the file's exact bytes). The private
// key never lives in the repo; keep it in Secret Manager or the release machine.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIR = path.join(ROOT, 'public', 'cli');
const PUB = path.join(DIR, 'signing-key.pem');

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const value = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : null);

const scripts = () => fs.readdirSync(DIR).filter((f) => f.endsWith('.sh')).sort();
const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

export function fingerprint(pubPem) {
	const der = crypto.createPublicKey(pubPem).export({ type: 'spki', format: 'der' });
	return sha256(der);
}

function init() {
	const outDir = path.resolve(value('--out') || path.join(process.env.HOME || '.', '.config', 'three-ws-release'));
	const keyFile = path.join(outDir, 'cli-signing-key.pem');
	if (fs.existsSync(keyFile) || fs.existsSync(PUB)) {
		console.error(`refusing to replace an existing key (${fs.existsSync(keyFile) ? keyFile : PUB}); rotate on purpose by deleting it first`);
		return 1;
	}
	const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
	fs.mkdirSync(outDir, { recursive: true, mode: 0o700 });
	fs.writeFileSync(keyFile, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
	fs.writeFileSync(PUB, publicKey.export({ type: 'spki', format: 'pem' }));
	console.log(`private key: ${keyFile} (keep it out of the repo)\npublic key:  ${path.relative(ROOT, PUB)}\nfingerprint: ${fingerprint(fs.readFileSync(PUB, 'utf8'))}`);
	return 0;
}

function sign() {
	const pem = process.env.THREE_WS_CLI_SIGNING_KEY || (value('--key') && fs.readFileSync(value('--key'), 'utf8'));
	if (!pem) {
		console.error('no signing key: set THREE_WS_CLI_SIGNING_KEY to the PEM text, or pass --key <file>');
		return 1;
	}
	const key = crypto.createPrivateKey(pem);
	const pub = fs.readFileSync(PUB, 'utf8');
	if (fingerprint(crypto.createPublicKey(key).export({ type: 'spki', format: 'pem' })) !== fingerprint(pub)) {
		console.error('that private key does not match public/cli/signing-key.pem');
		return 1;
	}
	for (const name of scripts()) {
		const bytes = fs.readFileSync(path.join(DIR, name));
		fs.writeFileSync(path.join(DIR, `${name}.sha256`), `${sha256(bytes)}  ${name}\n`);
		fs.writeFileSync(path.join(DIR, `${name}.sig`), crypto.sign(null, bytes, key));
		console.log(`signed ${name}`);
	}
	return 0;
}

/** Problems with the committed checksums and signatures; an empty list means all good. */
export function verifyAll(dir = DIR) {
	const problems = [];
	let pub;
	try {
		pub = crypto.createPublicKey(fs.readFileSync(path.join(dir, 'signing-key.pem')));
	} catch (err) {
		return [`cannot read signing-key.pem: ${err.message}`];
	}
	const names = fs.readdirSync(dir).filter((f) => f.endsWith('.sh')).sort();
	if (!names.length) problems.push('no scripts found');
	for (const name of names) {
		const bytes = fs.readFileSync(path.join(dir, name));
		let sum = '';
		try { sum = fs.readFileSync(path.join(dir, `${name}.sha256`), 'utf8').trim(); } catch { problems.push(`${name}.sha256 is missing`); }
		if (sum && sum !== `${sha256(bytes)}  ${name}`) problems.push(`${name}.sha256 does not match the file; re-run npm run sign:cli`);
		let sig = null;
		try { sig = fs.readFileSync(path.join(dir, `${name}.sig`)); } catch { problems.push(`${name}.sig is missing`); }
		if (sig && !crypto.verify(null, bytes, pub, sig)) problems.push(`${name}.sig is not a valid signature of the file; re-run npm run sign:cli`);
	}
	return problems;
}

function check() {
	const problems = verifyAll();
	for (const p of problems) console.error(p);
	if (!problems.length) console.log(`${scripts().length} script(s) verified, key ${fingerprint(fs.readFileSync(PUB, 'utf8')).slice(0, 16)}`);
	return problems.length ? 1 : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	process.exitCode = flag('--init') ? init() : flag('--check') ? check() : sign();
}
