// `three-ws-agent sessions`: list, full-text search and export of the local
// session store. Each operation returns a plain result; the print* functions
// turn it into text, so the TUI's /sessions, /search and /export reuse them.

import fs from 'node:fs';
import path from 'node:path';
import { ago, table, truncate } from './format.js';

export function listSessions({ store, limit = 20, kind = null }) {
	return { sessions: store.listSessions({ kind, limit }) };
}

export function printSessions({ sessions }) {
	if (!sessions.length) return 'No sessions yet. Start one with `three-ws-agent` and it is saved here automatically.';
	return table([
		['ID', 'KIND', 'MESSAGES', 'UPDATED', 'TITLE'],
		...sessions.map((s) => [s.id, s.kind, s.message_count ?? '', ago(s.updated_at), truncate(s.title || '(untitled)', 60)]),
	]);
}

export function searchSessions({ store, query, limit = 20 }) {
	const q = String(query || '').trim();
	if (!q) throw new Error('Search needs words to look for: `sessions search <words>`.');
	return { query: q, hits: store.search(q, { limit }) };
}

export function printSearch({ query, hits }) {
	if (!hits.length) return `Nothing in your sessions matches "${query}". Search matches whole words from your messages and the agent's replies.`;
	return hits.map((h) => `${h.session_id}  ${h.role.padEnd(9)} ${ago(h.created_at)}  ${truncate(h.title || '(untitled)', 40)}\n    ${truncate(h.snippet, 160)}`).join('\n');
}

/**
 * Export a session as JSON (format `three-ws-agent-session`, version 1).
 * With `out`, writes the file (`-` means stdout and is left to the printer).
 */
export function exportSession({ store, id, out = null, cwd = process.cwd() }) {
	const row = store.resolveSession(String(id || ''));
	if (!row) throw new Error(`No session matches "${id}". List them with \`three-ws-agent sessions\`.`);
	const data = store.exportSession(row.id);
	if (out === '-') return { id: row.id, data, file: null };
	const file = path.resolve(cwd, out || `three-ws-session-${row.id}.json`);
	fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
	return { id: row.id, data, file };
}

export function printExport({ id, data, file }) {
	if (!file) return JSON.stringify(data, null, 2);
	return `Exported session ${id} (${data.messages.length} messages) to ${file}`;
}
