// Anchor IDL -> skill bundle (specs/SKILL_SPEC.md), the Solana counterpart of
// the OpenAPI importer. For one program IDL it generates:
//
//   read_<account>     decode an account of that type by address (read-only)
//   preview_<ix>       build the unsigned instruction: accounts, data, summary,
//                      risk. Never signs.
//   send_<ix>          the same payload plus status "confirmation_required",
//                      for the host's confirm-gated wallet flow. Marked
//                      destructiveHint; the skill never holds or requests a key.
//
// The handlers are self-contained (IDL embedded as a JSON literal, codec from
// anchor-runtime.js appended as text) because the skill sandbox allows no
// imports. Every string taken from the IDL lands in JSON literals or in the
// SKILL.md prose, never in executable positions.

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { PublicKey } from '@solana/web3.js';
import { assertValidBundle } from './validate.js';

export class AnchorIdlError extends Error {}

const RUNTIME_SRC = readFileSync(new URL('./anchor-runtime.js', import.meta.url), 'utf8');
const BASE58_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

const snake = (s) =>
	String(s)
		.replace(/([a-z0-9])([A-Z])/g, '$1_$2')
		.replace(/[^A-Za-z0-9]+/g, '_')
		.replace(/^_+|_+$/g, '')
		.toLowerCase();

const sha8 = (text) => [...createHash('sha256').update(text).digest().subarray(0, 8)];

function normalizeType(t) {
	if (t === 'publicKey') return 'pubkey';
	if (!t || typeof t !== 'object') return t;
	if (t.vec) return { vec: normalizeType(t.vec) };
	if (t.option) return { option: normalizeType(t.option) };
	if (t.coption) return { coption: normalizeType(t.coption) };
	if (t.array) return { array: [normalizeType(t.array[0]), t.array[1]] };
	if (t.defined) return { defined: { name: typeof t.defined === 'string' ? t.defined : t.defined.name } };
	return t;
}

function normalizeFields(fields) {
	if (!fields) return fields;
	return fields.map((f) => (f && typeof f === 'object' && f.name ? { ...f, type: normalizeType(f.type) } : normalizeType(f)));
}

function normalizeTypeDef(def) {
	const type = { ...def.type };
	if (type.fields) type.fields = normalizeFields(type.fields);
	if (type.variants) type.variants = type.variants.map((v) => ({ ...v, fields: normalizeFields(v.fields) }));
	return { ...def, type };
}

function normalizeAccountItems(items) {
	return items.map((a) => {
		if (a.accounts) return { ...a, accounts: normalizeAccountItems(a.accounts) };
		const out = { name: snake(a.name) };
		if (a.writable ?? a.isMut) out.writable = true;
		if (a.signer ?? a.isSigner) out.signer = true;
		if (a.address) out.address = a.address;
		if (a.docs) out.docs = a.docs;
		return out;
	});
}

/**
 * Accepts the Anchor >=0.30 IDL shape (explicit discriminators, `address`) and
 * the legacy shape (isMut/isSigner, `metadata.address`, accounts that embed
 * their struct), and returns the 0.30 shape the generated runtime reads.
 */
export function normalizeIdl(raw, { programId } = {}) {
	if (!raw || typeof raw !== 'object' || !Array.isArray(raw.instructions)) {
		throw new AnchorIdlError('not an Anchor IDL: missing instructions array');
	}
	const address = raw.address || raw.metadata?.address || programId;
	if (!address || !BASE58_RE.test(address)) {
		throw new AnchorIdlError('IDL has no program address; pass program_id alongside idl_url');
	}
	if (programId && raw.address && raw.address !== programId) {
		throw new AnchorIdlError(`IDL address ${raw.address} does not match program_id ${programId}`);
	}
	const name = raw.metadata?.name || raw.name;
	if (!name) throw new AnchorIdlError('IDL has no program name');

	const legacy = !raw.instructions.every((i) => Array.isArray(i.discriminator));
	const types = (raw.types || []).map(normalizeTypeDef);
	const accounts = [];
	for (const a of raw.accounts || []) {
		if (a.type && !types.some((t) => t.name === a.name)) types.push(normalizeTypeDef({ name: a.name, type: a.type }));
		accounts.push({ name: a.name, discriminator: a.discriminator || sha8(`account:${a.name}`) });
	}

	return {
		address,
		metadata: {
			name: snake(name),
			version: raw.metadata?.version || raw.version || '0.1.0',
			description: raw.metadata?.description || raw.docs?.[0] || '',
		},
		instructions: raw.instructions.map((i) => ({
			name: snake(i.name),
			discriminator: i.discriminator || sha8(`global:${snake(i.name)}`),
			docs: i.docs || [],
			accounts: normalizeAccountItems(i.accounts || []),
			args: (i.args || []).map((a) => ({ name: a.name, type: normalizeType(a.type) })),
		})),
		accounts,
		types,
		legacy,
	};
}

function flatten(list, prefix = '') {
	return list.flatMap((a) => (a.accounts ? flatten(a.accounts, `${prefix}${a.name}.`) : [{ ...a, name: prefix + a.name }]));
}

const TOKEN_PROGRAMS = new Set([
	'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
	'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb',
]);
const AUTHORITY_IX = /(^|_)(set|update|change|transfer|propose|accept|renounce|revoke|grant)_(authority|admin|owner|minter|delegate|upgrade_authority|ownership|freeze|operator|manager)(_|$)|^(set|update)_.*(authority|admin|owner|minter)$/;
const MOVES_IX = /(^|_)(transfer|withdraw|deposit|pay|swap|stake|unstake|claim|redeem|mint|burn|buy|sell|send|fund|invoke|settle|refund|distribute)(_|$)/;
const CLOSE_IX = /(^|_)(close|burn|delete|destroy|revoke|reclaim)(_|$)/;

/**
 * Static risk read of one instruction from the IDL alone. IDLs do not carry
 * Anchor constraints (`close`, `has_one`), so this is name- and shape-based
 * and says so in the panel: a flag is a prompt to read the program, and the
 * absence of a flag is not an audit.
 */
export function analyzeInstructionRisk(ix) {
	const accounts = flatten(ix.accounts);
	const flags = [];
	const usesTokenProgram =
		accounts.some((a) => TOKEN_PROGRAMS.has(a.address)) || accounts.some((a) => /token_program/.test(a.name));
	if (usesTokenProgram || MOVES_IX.test(ix.name)) {
		flags.push({
			code: 'moves_tokens',
			severity: 'medium',
			label: usesTokenProgram ? 'invokes the token program (mints, burns or moves tokens)' : 'name suggests it moves value',
		});
	}
	if (accounts.some((a) => a.address === '11111111111111111111111111111111') && accounts.some((a) => a.signer && a.writable)) {
		flags.push({ code: 'spends_lamports', severity: 'medium', label: 'a writable signer pays through the system program (SOL leaves that wallet)' });
	}
	if (CLOSE_IX.test(ix.name) || accounts.some((a) => /(^|_)(close|rent_receiver|destination)(_|$)/.test(a.name))) {
		flags.push({ code: 'closes_accounts', severity: 'high', label: 'may close or invalidate accounts and release their lamports' });
	}
	const authorityArg = ix.args.some((a) => a.type === 'pubkey' && /(authority|admin|owner|minter|delegate|^new_)/.test(a.name));
	if (AUTHORITY_IX.test(ix.name) || authorityArg) {
		flags.push({ code: 'changes_authority', severity: 'high', label: 'can change who controls the program state or a privileged role' });
	}
	const level = flags.some((f) => f.severity === 'high') ? 'high' : flags.length ? 'medium' : 'low';
	return { level, flags };
}

const accountToolName = (name) => `read_${snake(name)}`;
const previewToolName = (name) => `preview_${name}`;
const sendToolName = (name) => `send_${name}`;

function pubkeySchema(description) {
	return { type: 'string', pattern: '^[1-9A-HJ-NP-Za-km-z]{32,44}$', description };
}

const CLUSTER_PROP = {
	type: 'string',
	enum: ['mainnet-beta', 'devnet'],
	description: 'Cluster to read from. Defaults to mainnet-beta.',
};

function argSchema(type) {
	if (typeof type === 'string') {
		if (type === 'bool') return { type: 'boolean' };
		if (type === 'string') return { type: 'string' };
		if (type === 'pubkey') return pubkeySchema('Base58 address');
		if (type === 'bytes') return { type: 'string', description: 'Hex string' };
		if (type === 'f32' || type === 'f64') return { type: 'number' };
		return { type: ['integer', 'string'], description: `${type} (use a string above 2^53)` };
	}
	if (type.vec) return { type: 'array', items: argSchema(type.vec) };
	if (type.option) return { ...argSchema(type.option), description: 'Optional; omit or null for none' };
	if (type.array) {
		return type.array[0] === 'u8'
			? { type: 'string', description: `Hex string of ${type.array[1]} bytes` }
			: { type: 'array', items: argSchema(type.array[0]), minItems: type.array[1], maxItems: type.array[1] };
	}
	return { description: `${type.defined?.name || 'custom'} value, shaped as in the IDL` };
}

function instructionSchema(ix) {
	const accountProps = {};
	const accountRequired = [];
	for (const a of flatten(ix.accounts)) {
		if (a.address) continue;
		accountProps[a.name] = pubkeySchema(`${a.signer ? 'Signer. ' : ''}${a.writable ? 'Writable. ' : ''}${(a.docs || []).join(' ')}`.trim() || 'Account address');
		accountRequired.push(a.name);
	}
	const argProps = {};
	for (const a of ix.args) argProps[a.name] = argSchema(a.type);
	const properties = {
		accounts: { type: 'object', properties: accountProps, required: accountRequired, additionalProperties: false },
		args: { type: 'object', properties: argProps, required: ix.args.map((a) => a.name), additionalProperties: false },
	};
	return { type: 'object', properties, required: ['accounts', 'args'] };
}

function describe(ix, risk) {
	const doc = ix.docs.join(' ').trim();
	const flagText = risk.flags.length ? ` Risk ${risk.level}: ${risk.flags.map((f) => f.label).join('; ')}.` : '';
	return { doc, flagText };
}

export function generateAnchorTools(idl) {
	const risks = Object.fromEntries(idl.instructions.map((ix) => [ix.name, analyzeInstructionRisk(ix)]));
	const tools = [];
	for (const acct of idl.accounts) {
		tools.push({
			name: accountToolName(acct.name),
			description: `Fetch and decode a ${acct.name} account of program ${idl.address} by address.`,
			input_schema: {
				type: 'object',
				properties: { address: pubkeySchema(`Address of the ${acct.name} account`), cluster: CLUSTER_PROP },
				required: ['address'],
			},
			annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
		});
	}
	for (const ix of idl.instructions) {
		const { doc, flagText } = describe(ix, risks[ix.name]);
		tools.push({
			name: previewToolName(ix.name),
			description: `Preview ${ix.name} without signing: returns the accounts, instruction data, a plain summary and a risk read. ${doc}${flagText}`.trim(),
			input_schema: instructionSchema(ix),
			annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
		});
		tools.push({
			name: sendToolName(ix.name),
			description: `Prepare ${ix.name} for the wallet owner's confirmation. Returns the unsigned instruction and a confirmation summary; it signs and sends nothing. ${doc}${flagText}`.trim(),
			input_schema: instructionSchema(ix),
			annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
		});
	}
	return { tools, risks };
}

export function generateAnchorHandlers(idl, risks) {
	const exported = [
		...idl.accounts.map(
			(a) => `export async function ${accountToolName(a.name)}(args, ctx) {\n\treturn readAccountTool(${JSON.stringify(a.name)}, args, ctx);\n}`
		),
		...idl.instructions.flatMap((ix) => [
			`export async function ${previewToolName(ix.name)}(args) {\n\treturn previewTool(${JSON.stringify(ix.name)}, args);\n}`,
			`export async function ${sendToolName(ix.name)}(args) {\n\treturn sendTool(${JSON.stringify(ix.name)}, args);\n}`,
		]),
	].join('\n\n');

	const slim = {
		address: idl.address,
		instructions: idl.instructions.map(({ docs, ...rest }) => rest),
		accounts: idl.accounts,
		types: idl.types,
	};
	return `// Generated by @three-ws/skill-import from an Anchor IDL. Do not hand-edit: regenerate from the IDL instead.

const IDL = ${JSON.stringify(slim)};

const RISK = ${JSON.stringify(risks)};

${RUNTIME_SRC}
${exported}
`;
}

function riskPanel(idl, risks) {
	const rows = idl.instructions.map((ix) => {
		const r = risks[ix.name];
		return `| \`${ix.name}\` | ${r.level} | ${r.flags.map((f) => f.label).join('; ') || 'none detected'} |`;
	});
	return [
		'## Risk panel',
		'',
		'Static read of the IDL: names, account shapes and well-known programs. Anchor constraints are not in an IDL, so a flag is a prompt to read the program and a clean row is not an audit.',
		'',
		'| Instruction | Risk | Flags |',
		'| --- | --- | --- |',
		...rows,
	].join('\n');
}

function generateAnchorSkillMd(manifest, idl, tools, risks) {
	const lines = [
		'---',
		`name: ${manifest.name}`,
		`description: ${JSON.stringify(manifest.description)}`,
		'---',
		'',
		`# ${manifest.name}`,
		'',
		manifest.description,
		'',
		`Program: \`${idl.address}\``,
		'',
		'## How to use',
		'',
		'- `read_*` tools fetch and decode an account by address.',
		'- `preview_*` tools build the instruction without signing. Always preview first and show the summary and risk to the user.',
		'- `send_*` tools return the unsigned instruction for the confirm-gated wallet flow. They never sign or send, and need the wallet owner\'s explicit yes.',
		'',
		'## Tools',
		'',
		...tools.tools.map((t) => `- \`${t.name}\`${t.annotations.destructiveHint ? ' (destructive, needs confirmation)' : ''}`),
		'',
		riskPanel(idl, risks),
		'',
	];
	return lines.join('\n');
}

/**
 * @param {object} rawIdl Anchor IDL (parsed JSON)
 * @param {{sourceUrl?: string, programId?: string}} opts
 */
export function generateAnchorBundle(rawIdl, { sourceUrl, programId } = {}) {
	const idl = normalizeIdl(rawIdl, { programId });
	if (!idl.instructions.length && !idl.accounts.length) throw new AnchorIdlError('IDL declares no instructions or accounts');

	const tools = generateAnchorTools(idl);
	const description = (idl.metadata.description || `Read accounts and prepare instructions for Solana program ${idl.address}.`).slice(0, 500);
	const manifest = {
		spec: 'skill/0.1',
		name: idl.metadata.name.replace(/_/g, '-').slice(0, 64),
		version: idl.metadata.version,
		description,
		author: 'imported',
		license: 'unknown',
		tags: ['imported', 'anchor', 'solana'],
		requires: { rig: ['any'], runtime: '>=0.1.0', tools: [], secrets: [] },
		dependencies: {},
		provides: {
			tools: tools.tools.map((t) => t.name),
			triggers: ['imported', idl.metadata.name],
		},
		source: { type: 'anchor-idl', url: sourceUrl || null, program_id: idl.address },
		risk: tools.risks,
	};
	const handlersSrc = generateAnchorHandlers(idl, tools.risks);
	const skillMd = generateAnchorSkillMd(manifest, idl, { tools: tools.tools }, tools.risks);
	const toolsJson = { tools: tools.tools };
	assertValidBundle(
		{ manifest, skillMd, tools: toolsJson, handlersSrc },
		{ allowAddresses: [idl.address, ...idl.instructions.flatMap((ix) => flatten(ix.accounts).map((a) => a.address).filter(Boolean))] }
	);
	return { manifest, skillMd, tools: toolsJson, handlersSrc, sourceUrl: sourceUrl || `solana:${idl.address}` };
}

/**
 * Fetch the IDL Anchor publishes on chain for a program: the account at
 * createWithSeed(base, "anchor:idl", program) holding a zlib-compressed JSON
 * document after a 44-byte header.
 *
 * @param {string} programId
 * @param {{rpc: (method: string, params: unknown[]) => Promise<any>}} opts
 */
export async function fetchOnchainIdl(programId, { rpc }) {
	if (!BASE58_RE.test(programId || '')) throw new AnchorIdlError('program_id must be a base58 address');
	const program = new PublicKey(programId);
	const [base] = PublicKey.findProgramAddressSync([], program);
	const idlAddress = await PublicKey.createWithSeed(base, 'anchor:idl', program);
	const result = await rpc('getAccountInfo', [idlAddress.toBase58(), { encoding: 'base64', commitment: 'confirmed' }]);
	if (!result?.value) {
		throw new AnchorIdlError(`no on-chain IDL for ${programId}: the program has not published one, pass idl_url instead`);
	}
	const data = Buffer.from(result.value.data[0], 'base64');
	if (data.length < 44) throw new AnchorIdlError('on-chain IDL account is truncated');
	const len = data.readUInt32LE(40);
	try {
		return JSON.parse(inflateSync(data.subarray(44, 44 + len)).toString('utf8'));
	} catch {
		throw new AnchorIdlError('on-chain IDL account does not hold a valid compressed IDL');
	}
}

/**
 * @param {{idl_url?: string, program_id?: string, cluster?: string}} input
 * @param {{fetchUrl: typeof fetch, rpcUrls: Record<string,string>}} opts
 */
export async function importFromAnchorIdl({ idl_url: idlUrl, program_id: programId, cluster = 'mainnet-beta' }, { fetchUrl, rpcUrls }) {
	if (typeof fetchUrl !== 'function') throw new Error('importFromAnchorIdl requires opts.fetchUrl');
	if (idlUrl) {
		const res = await fetchUrl(idlUrl);
		if (!res.ok) throw new AnchorIdlError(`failed to fetch ${idlUrl}: ${res.status}`);
		let raw;
		try {
			raw = JSON.parse(await res.text());
		} catch {
			throw new AnchorIdlError(`${idlUrl} is not valid JSON`);
		}
		return generateAnchorBundle(raw, { sourceUrl: idlUrl, programId });
	}
	if (!programId) throw new AnchorIdlError('idl_url or program_id is required');
	const endpoint = rpcUrls?.[cluster];
	if (!endpoint) throw new AnchorIdlError(`cluster must be one of ${Object.keys(rpcUrls || {}).join(', ')}`);
	const rpc = async (method, params) => {
		const res = await fetchUrl(endpoint, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
		});
		if (!res.ok) throw new AnchorIdlError(`Solana RPC returned ${res.status}`);
		const body = JSON.parse(await res.text());
		if (body.error) throw new AnchorIdlError(`Solana RPC error: ${body.error.message}`);
		return body.result;
	};
	const raw = await fetchOnchainIdl(programId, { rpc });
	return generateAnchorBundle(raw, { sourceUrl: `solana:${cluster}:${programId}`, programId });
}
