// @ts-check
// The account data export: GDPR Article 15 (right of access) and Article 20
// (right to data portability), served by GET /api/auth/export.
//
// Coverage comes from the same ownership walk the 30-day purge deletes by
// (api/_lib/account-purge.js, loadOwnershipPlan), read from the live catalog on
// every export. Anything the purge would remove or unlink is something this
// export lists, so a new table that hangs off users or off anything the account
// owns shows up here the day it is created, with no list to keep in sync.
//
// Three rules shape each row:
//   1. Credentials are withheld, never exported: password and key hashes,
//      session, refresh and API tokens, encrypted wallet keys, one-time codes,
//      and every binary column. The field stays in the row as
//      {"withheld":"credential"} so the owner can see it exists.
//   2. Another account's id is masked. A row in this account's tree can name
//      someone else (a follower, a buyer, the author of a comment on one of its
//      avatars); that id becomes "another-account".
//   3. Another person's record is skipped when it only points at this account's
//      content (somebody else's fork of one of its avatars).
//
// Files the account owns (avatar bodies, clips, profile images) are listed with
// a signed download link valid for FILE_LINK_TTL_S.
//
// The body is streamed: tables are read one page at a time and written as they
// arrive, so a heavy account never sits in memory. If a read fails midway the
// stream still ends as valid JSON, with "complete": false and an error code.

import { sql } from './db.js';
import { loadOwnershipPlan, identifiersFor, collectStorageKeys, OWNED_WITHOUT_FK } from './account-purge.js';
import { objectStorageConfigured, presignGet } from './r2.js';

export const EXPORT_FORMAT = 'three.ws/account-export';
export const EXPORT_VERSION = 1;
// The longest a SigV4 presigned URL may live.
export const FILE_LINK_TTL_S = 7 * 24 * 60 * 60;
const PAGE_ROWS = 1000;

export const MASKED_ACCOUNT = 'another-account';
export const WITHHELD = Object.freeze({ withheld: 'credential' });

// Name parts that mark a credential on their own (password_hash, totp_secret,
// key_salt, encrypted_secret_key, recovery_codes, ciphertext).
const CREDENTIAL_PARTS = new Set([
	'password', 'passwd', 'secret', 'secrets', 'salt', 'pepper', 'nonce', 'iv', 'mnemonic',
	'ciphertext', 'encrypted', 'enc', 'totp', 'otp', 'passphrase', 'credential', 'credentials',
]);
// A hash is a credential when it hashes one (token_hash, code_hash, ip_hash), not
// when it names a public value (tx_hash, content_hash, glb_hash).
const HASHED_SECRETS = new Set(['password', 'token', 'key', 'code', 'session', 'refresh', 'ip', 'recovery', 'api', 'pin', 'secret', 'otp', 'email']);
// "<x>_key" is a credential for these x (api_key, private_key, signing_key), not
// for storage_key or thumbnail_key, which are file names.
const KEY_PREFIXES = new Set(['api', 'private', 'secret', 'signing', 'encryption', 'session', 'master', 'wrapped', 'data', 'access', 'auth', 'webhook', 'client']);

/**
 * Whether a column holds a credential the export must withhold. Name-based, by
 * underscore-separated part, so token_mint, storage_key, tx_hash and seed stay
 * readable while refresh_token, api_key, code_hash and seed_phrase do not.
 * @param {string} name
 * @param {string} [type] information_schema data_type
 */
export function isCredentialColumn(name, type) {
	if (type === 'bytea') return true;
	const parts = String(name).toLowerCase().split('_').filter(Boolean);
	if (parts.some((p) => CREDENTIAL_PARTS.has(p))) return true;
	if ((parts.includes('hash') || parts.includes('hashed')) && parts.some((p) => HASHED_SECRETS.has(p))) return true;
	if (parts.includes('seed') && parts.includes('phrase')) return true;
	if (parts.includes('recovery') && parts.includes('codes')) return true;
	const last = parts[parts.length - 1];
	// access_token, refresh_token, confirm_token, token; not token_mint, tokens_used.
	if (last === 'token' || last === 'jwt' || last === 'cookie') return true;
	if (last === 'key' && parts.length > 1 && KEY_PREFIXES.has(parts[parts.length - 2])) return true;
	if (parts.includes('private') && parts.includes('key')) return true;
	return false;
}

function qi(name) {
	return `"${String(name).replace(/"/g, '""')}"`;
}

/**
 * Columns in each table that name an account: every single-column foreign key
 * to users, every user-id column the platform writes without one, and any
 * column named *user_id.
 */
function accountColumnsByTable(catalog) {
	/** @type {Map<string, Set<string>>} */
	const out = new Map();
	const add = (table, column) => {
		if (!out.has(table)) out.set(table, new Set());
		out.get(table).add(column);
	};
	for (const fk of catalog.fks) {
		if (fk.parent === 'users' && fk.cols.length === 1) add(fk.child, fk.cols[0]);
	}
	for (const e of OWNED_WITHOUT_FK) add(e.table, e.column);
	for (const [table, cols] of catalog.columns) {
		for (const name of cols.keys()) if (/(^|_)user_id$/.test(name)) add(table, name);
	}
	return out;
}

/**
 * One query source per table: the predicates the walk produced, OR'd together,
 * plus the ownership filter for indirect rows.
 */
function groupSources(exportSources, accountColumns) {
	/** @type {Map<string, { table: string, preds: string[], identifiers: boolean }>} */
	const byTable = new Map();
	for (const src of exportSources) {
		let pred = src.pred;
		if (!src.direct) {
			// Another person's row that only points at this account's content is
			// theirs. Take it only when one of its own account columns is this
			// account (or it has none, so it records a transaction, not a person).
			const own = [...(accountColumns.get(src.table) || [])];
			if (own.length) pred = `(${pred}) and (${own.map((c) => `${qi(c)}::text = $1::uuid::text`).join(' or ')})`;
		}
		if (!byTable.has(src.table)) byTable.set(src.table, { table: src.table, preds: [], identifiers: false });
		const g = byTable.get(src.table);
		if (!g.preds.includes(pred)) g.preds.push(pred);
		g.identifiers = g.identifiers || Boolean(src.identifiers);
	}
	return [...byTable.values()].sort((a, b) => a.table.localeCompare(b.table));
}

/**
 * Shape one row for the export: withhold credentials, mask other accounts.
 * @param {Record<string, unknown>} row
 * @param {{ userId: string, columns: Map<string, { type: string }> | undefined, accountColumns: Set<string> | undefined }} ctx
 */
export function shapeRow(row, { userId, columns, accountColumns }) {
	/** @type {Record<string, unknown>} */
	const out = {};
	for (const [name, value] of Object.entries(row)) {
		if (value != null && isCredentialColumn(name, columns?.get(name)?.type)) {
			out[name] = WITHHELD;
		} else if (value != null && accountColumns?.has(name) && String(value) !== String(userId)) {
			out[name] = MASKED_ACCOUNT;
		} else {
			out[name] = value;
		}
	}
	return out;
}

/**
 * Everything that can fail before the first byte is sent: the account row, the
 * live ownership plan, the identifiers, and the file list. A failure here is a
 * normal error response; once streaming starts, failures end the JSON cleanly.
 * @param {string} userId
 */
export async function prepareAccountExport(userId) {
	const [user] = await sql`select id, email, wallet_address from users where id = ${userId} and deleted_at is null limit 1`;
	if (!user) return null;
	const plan = await loadOwnershipPlan();
	const { columns } = plan.catalog;
	const accountColumns = accountColumnsByTable(plan.catalog);
	const identifiers = await identifiersFor(user, columns);
	const sources = groupSources(plan.exportSources, accountColumns);

	const files = [];
	if (objectStorageConfigured()) {
		const keys = await collectStorageKeys(userId, columns, { includeShared: true });
		for (const key of keys.sort()) files.push({ key, url: await presignGet({ key, expiresIn: FILE_LINK_TTL_S }) });
	}
	return { userId: String(userId), columns, accountColumns, identifiers, sources, files };
}

async function* readTable(source, prepared) {
	const params = [prepared.userId];
	if (source.identifiers) params.push(prepared.identifiers);
	const cursorAt = params.length + 1;
	const where = source.preds.map((p) => `(${p})`).join(' or ');
	const text = `select to_jsonb(t) as r, t.ctid::text as c from ${qi(source.table)} t
		where (${where}) and t.ctid > $${cursorAt}::tid order by t.ctid limit ${PAGE_ROWS}`;
	let cursor = '(0,0)';
	for (;;) {
		const rows = await sql(text, [...params, cursor]);
		for (const r of rows) yield r.r;
		if (rows.length < PAGE_ROWS) return;
		cursor = rows[rows.length - 1].c;
	}
}

const NOTES = {
	withheld:
		'Fields shown as {"withheld":"credential"} hold a password hash, an access or API token, an encrypted wallet key, a one-time code or other binary secret. They are never exported, for your security; their presence is shown so you know they exist.',
	masked: `Rows that involve another person (a follower, a buyer, the author of a comment on your avatar) show that person as "${MASKED_ACCOUNT}".`,
	files: `Each file link is signed and expires ${FILE_LINK_TTL_S / 86400} days after generated_at. Download what you want to keep before then, or request a new export.`,
	retained:
		'After you delete your account, legal acceptance records are kept and financial records are kept with your identity removed. See https://three.ws/docs/account-deletion.',
	on_chain: 'Blockchain transactions and on-chain registrations are public and permanent; they are not held by three.ws and are not part of this file.',
	analytics:
		'If you accepted analytics cookies, PostHog holds product analytics under your account id. It is erased when your account is purged. To request a copy, email privacy@three.ws.',
};

/**
 * The export body as a stream of JSON text chunks.
 * @param {NonNullable<Awaited<ReturnType<typeof prepareAccountExport>>>} prepared
 * @param {{ now?: Date }} [opts]
 */
export async function* streamAccountExport(prepared, { now = new Date() } = {}) {
	const ctx = (table) => ({
		userId: prepared.userId,
		columns: prepared.columns.get(table),
		accountColumns: prepared.accountColumns.get(table),
	});
	yield `{"format":${JSON.stringify(EXPORT_FORMAT)},"version":${EXPORT_VERSION},"generated_at":${JSON.stringify(now.toISOString())}`;
	yield `,"account_id":${JSON.stringify(prepared.userId)},"notes":${JSON.stringify(NOTES)}`;
	yield `,"files":${JSON.stringify(prepared.files)}`;

	const counts = {};
	let rowsTotal = 0;
	let failed = null;
	yield ',"tables":{';
	let firstTable = true;
	for (const source of prepared.sources) {
		let opened = false;
		try {
			for await (const raw of readTable(source, prepared)) {
				const row = shapeRow(raw, ctx(source.table));
				if (!opened) {
					yield `${firstTable ? '' : ','}${JSON.stringify(source.table)}:[`;
					firstTable = false;
					opened = true;
				} else {
					yield ',';
				}
				yield JSON.stringify(row);
				counts[source.table] = (counts[source.table] || 0) + 1;
				rowsTotal += 1;
			}
		} catch (err) {
			failed = { table: source.table, code: err?.code ? `db_error:${err.code}` : 'read_failed' };
		}
		if (opened) yield ']';
		if (failed) break;
	}
	yield '}';
	yield `,"summary":${JSON.stringify({ tables: Object.keys(counts).length, rows: rowsTotal, files: prepared.files.length, counts })}`;
	yield failed ? `,"complete":false,"error":${JSON.stringify(failed)}}` : ',"complete":true}';
}
