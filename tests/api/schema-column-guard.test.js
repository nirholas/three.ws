// Schema column guard — catches the class of bug where a JS handler queries a
// column that was renamed or never existed in any applied migration.
//
// Strategy:
//   1. Parse every migration file in api/_lib/migrations/ (in sort order) to
//      build a table→column map from CREATE TABLE and ALTER TABLE ADD COLUMN.
//   2. Scan all api/**/*.js handler files for tagged-template sql`` calls and
//      extract bare column-name tokens (word after SELECT/WHERE/SET/ON/AND/OR).
//   3. For each table-qualified reference like `asp.skill_name`, flag it if
//      `skill_name` is not a known column on `agent_skill_prices`.
//
// The list of (table, column) pairs to guard is the PRIMARY focus — these are
// the ones that bit production (skill_name vs skill, etc.).
//
// This test DOES NOT parse SQL perfectly — it's a heuristic guard, not a
// compiler. Column references inside string literals or comments may produce
// false positives; add them to the ALLOWLIST if needed.

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(process.cwd(), 'api');
const MIG_DIR = join(ROOT, '_lib', 'migrations');

// ── Parse migrations ─────────────────────────────────────────────────────────

function parseMigrations() {
	const tables = new Map(); // tableName → Set<columnName>

	const files = readdirSync(MIG_DIR)
		.filter((f) => f.endsWith('.sql'))
		.sort();

	for (const fname of files) {
		const sql = readFileSync(join(MIG_DIR, fname), 'utf-8');

		// CREATE TABLE ... (col type, ...)
		const createRe = /create\s+table\s+(?:if\s+not\s+exists\s+)?(\w+)\s*\(([^;]+)/gi;
		let m;
		while ((m = createRe.exec(sql)) !== null) {
			const table = m[1].toLowerCase();
			if (!tables.has(table)) tables.set(table, new Set());
			const body = m[2];
			// Each line starting with a word that's not a SQL keyword is a column def
			const colRe = /^\s+(\w+)\s+(?!PRIMARY|UNIQUE|CHECK|FOREIGN|CONSTRAINT|INDEX)/gim;
			let cm;
			while ((cm = colRe.exec(body)) !== null) {
				tables.get(table).add(cm[1].toLowerCase());
			}
		}

		// ALTER TABLE tbl ADD COLUMN — find all such statements (may span multiple lines).
		// Scan for each `alter table <name>` then collect all `add column <name>` within
		// a 2000-char window after the table name to handle multi-column forms.
		const alterRe = /alter\s+table\s+(\w+)/gi;
		while ((m = alterRe.exec(sql)) !== null) {
			const table = m[1].toLowerCase();
			const window = sql.slice(m.index, m.index + 2000);
			const addColRe = /add\s+column\s+(?:if\s+not\s+exists\s+)?(\w+)/gi;
			let cm2;
			while ((cm2 = addColRe.exec(window)) !== null) {
				if (!tables.has(table)) tables.set(table, new Set());
				tables.get(table).add(cm2[1].toLowerCase());
			}
		}
	}

	return tables;
}

// ── The canonical guards ──────────────────────────────────────────────────────
// Explicit (table, column) pairs that MUST exist, derived from the history of
// production regressions in this codebase. This is the source of truth — add
// a row here when you add a migration column that handlers depend on.

const REQUIRED = [
	// agent_skill_prices (2026-04-30-agent-monetization.sql)
	['agent_skill_prices', 'skill'],
	['agent_skill_prices', 'is_active'],
	['agent_skill_prices', 'chain'],
	['agent_skill_prices', 'amount'],
	['agent_skill_prices', 'currency_mint'],
	// skill_purchases (2026-05-10-skill-purchases.sql)
	['skill_purchases', 'skill'],
	['skill_purchases', 'reference'],
	['skill_purchases', 'status'],
	['skill_purchases', 'amount'],
	// monetization-v2 additions
	['skill_purchases', 'expires_at'],
	['skill_purchases', 'tipped_amount'],
	['skill_purchases', 'referrer_user_id'],
	['agent_skill_prices', 'mint_decimals'],
	// purchase_receipts
	['purchase_receipts', 'purchase_id'],
	['purchase_receipts', 'receipt_json'],
	['purchase_receipts', 'signature'],
	// purchase_events
	['purchase_events', 'purchase_id'],
	['purchase_events', 'event'],
	// csrf_tokens
	['csrf_tokens', 'token'],
	['csrf_tokens', 'user_id'],
	['csrf_tokens', 'expires_at'],
	// agent_revenue_events (2026-04-30-agent-monetization.sql)
	['agent_revenue_events', 'agent_id'],
	['agent_revenue_events', 'skill'],
	['agent_revenue_events', 'gross_amount'],
	['agent_revenue_events', 'net_amount'],
	// agent_payout_wallets
	['agent_payout_wallets', 'user_id'],
	['agent_payout_wallets', 'address'],
	['agent_payout_wallets', 'chain'],
	['agent_payout_wallets', 'is_default'],
];

// ── Banned patterns ───────────────────────────────────────────────────────────
// Column references that must NOT appear in any handler (they were names in
// old/wrong schemas). If you legitimately add one of these, remove it here.

const BANNED_COLUMN_REFS = [
	// skill_purchases must use `skill`, not these legacy names:
	{ pattern: /skill_purchases[^`]*\bskill_name\b/,    label: 'skill_purchases.skill_name (renamed to .skill)' },
	{ pattern: /skill_purchases[^`]*\bskill_id\b/,      label: 'skill_purchases.skill_id (renamed to .skill)' },
	// agent_skill_prices must use `skill`, not these:
	{ pattern: /agent_skill_prices[^`]*\bskill_name\b/, label: 'agent_skill_prices.skill_name (column is .skill)' },
	{ pattern: /agent_skill_prices[^`]*\bskill_id\b/,   label: 'agent_skill_prices.skill_id (column is .skill)' },
	// Old table names that don't exist:
	{ pattern: /\buser_skill_purchases\b/,              label: 'user_skill_purchases (use skill_purchases)' },
];

// ── Scan handlers ─────────────────────────────────────────────────────────────

function* walkHandlers(dir) {
	for (const name of readdirSync(dir)) {
		const path = join(dir, name);
		try {
			const st = { isDirectory: () => false };
			if (name.endsWith('.js') && !['_lib'].includes(name)) yield path;
			// Recurse into subdirs (except _lib and node_modules)
			if (!name.endsWith('.js') && name !== 'node_modules' && name !== '_lib') {
				try { yield* walkHandlers(path); } catch {}
			}
		} catch {}
	}
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('schema column guard', () => {
	const tables = parseMigrations();

	describe('migrations define all required columns', () => {
		for (const [table, col] of REQUIRED) {
			it(`${table}.${col} exists in migrations`, () => {
				const cols = tables.get(table);
				expect(
					cols,
					`table '${table}' not found in any migration`,
				).toBeTruthy();
				expect(
					cols.has(col),
					`column '${col}' not found on table '${table}'. Known columns: ${[...(cols || [])].join(', ')}`,
				).toBe(true);
			});
		}
	});

	describe('handlers do not reference banned column names', () => {
		// Collect all handler source (lazy — only read when describing)
		let allSource;
		function getSource() {
			if (!allSource) {
				allSource = '';
				for (const path of walkHandlers(ROOT)) {
					try { allSource += readFileSync(path, 'utf-8') + '\n'; } catch {}
				}
			}
			return allSource;
		}

		for (const { pattern, label } of BANNED_COLUMN_REFS) {
			it(`no handler references ${label}`, () => {
				const src = getSource();
				expect(
					pattern.test(src),
					`Found banned reference: ${label}. Grep for pattern: ${pattern}`,
				).toBe(false);
			});
		}
	});
});
