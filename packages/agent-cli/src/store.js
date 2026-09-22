// The local database: sessions, their full transcripts, a full-text index over
// what was said, subagent and cron runs, and local cron schedules.
//
// node:sqlite (built into Node 22.13+, no native addon to compile, so the same
// install works on Linux, macOS, Windows, WSL and Termux). WAL mode and a busy
// timeout let the TUI, the scheduler daemon and the gateway share one file.
//
// The transcript is stored message by message exactly as the model saw it
// (tool calls and tool results included) so a resumed session continues with
// full fidelity. Only user and assistant text is indexed for /search.

import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

const SCHEMA_VERSION = 1;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS sessions (
	id          TEXT PRIMARY KEY,
	title       TEXT,
	kind        TEXT NOT NULL DEFAULT 'chat',
	parent_id   TEXT,
	agent_id    TEXT,
	model       TEXT,
	cwd         TEXT,
	channel     TEXT,
	created_at  TEXT NOT NULL,
	updated_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_updated_idx ON sessions (updated_at DESC);
CREATE INDEX IF NOT EXISTS sessions_channel_idx ON sessions (channel);

CREATE TABLE IF NOT EXISTS messages (
	id            INTEGER PRIMARY KEY AUTOINCREMENT,
	session_id    TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
	role          TEXT NOT NULL,
	content       TEXT,
	tool_calls    TEXT,
	tool_call_id  TEXT,
	created_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS messages_session_idx ON messages (session_id, id);

CREATE VIRTUAL TABLE IF NOT EXISTS message_index USING fts5(
	body,
	session_id UNINDEXED,
	message_id UNINDEXED,
	role UNINDEXED,
	tokenize = 'porter unicode61'
);

CREATE TABLE IF NOT EXISTS runs (
	id                 TEXT PRIMARY KEY,
	kind               TEXT NOT NULL,
	session_id         TEXT,
	parent_session_id  TEXT,
	goal               TEXT,
	status             TEXT NOT NULL,
	result             TEXT,
	error              TEXT,
	prompt_tokens      INTEGER NOT NULL DEFAULT 0,
	completion_tokens  INTEGER NOT NULL DEFAULT 0,
	billed_usd         REAL NOT NULL DEFAULT 0,
	started_at         TEXT NOT NULL,
	finished_at        TEXT
);
CREATE INDEX IF NOT EXISTS runs_started_idx ON runs (started_at DESC);

CREATE TABLE IF NOT EXISTS crons (
	id                    TEXT PRIMARY KEY,
	schedule_text         TEXT NOT NULL,
	cron                  TEXT NOT NULL,
	tz                    TEXT NOT NULL,
	description           TEXT,
	prompt                TEXT NOT NULL,
	mode                  TEXT NOT NULL CHECK (mode IN ('local', 'server')),
	server_automation_id  TEXT,
	agent_id              TEXT,
	cwd                   TEXT,
	enabled               INTEGER NOT NULL DEFAULT 1,
	created_at            TEXT NOT NULL,
	last_run_at           TEXT,
	next_run_at           TEXT,
	last_status           TEXT,
	last_run_id           TEXT,
	running_since         TEXT
);

CREATE TABLE IF NOT EXISTS kv (
	key    TEXT PRIMARY KEY,
	value  TEXT NOT NULL,
	updated_at TEXT NOT NULL
);
`;

export function newId(prefix) {
	return `${prefix}_${randomBytes(5).toString('hex')}`;
}

const nowIso = () => new Date().toISOString();

function rowMessage(r) {
	const m = { role: r.role, content: r.content };
	if (r.tool_calls) m.tool_calls = JSON.parse(r.tool_calls);
	if (r.tool_call_id) m.tool_call_id = r.tool_call_id;
	return m;
}

/** Turn free text into a safe FTS5 query: every word must match, prefix-matched. */
export function ftsQuery(text) {
	const words = String(text || '')
		.toLowerCase()
		.match(/[\p{L}\p{N}_]+/gu);
	if (!words?.length) return null;
	return words.slice(0, 12).map((w) => `"${w}"*`).join(' ');
}

export function openStore(file) {
	if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
	const db = new DatabaseSync(file);
	db.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON; PRAGMA synchronous = NORMAL;');
	db.exec(SCHEMA);
	db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);

	const st = {
		insertSession: db.prepare('INSERT INTO sessions (id, title, kind, parent_id, agent_id, model, cwd, channel, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'),
		getSession: db.prepare('SELECT * FROM sessions WHERE id = ?'),
		findSession: db.prepare('SELECT * FROM sessions WHERE id LIKE ? ORDER BY updated_at DESC LIMIT 2'),
		byChannel: db.prepare('SELECT * FROM sessions WHERE channel = ? ORDER BY updated_at DESC LIMIT 1'),
		touch: db.prepare('UPDATE sessions SET updated_at = ? WHERE id = ?'),
		setTitle: db.prepare('UPDATE sessions SET title = ? WHERE id = ?'),
		listSessions: db.prepare(`
			SELECT s.*, (SELECT count(*) FROM messages m WHERE m.session_id = s.id AND m.role IN ('user','assistant') AND m.content IS NOT NULL) AS message_count
			FROM sessions s WHERE (? IS NULL OR s.kind = ?) ORDER BY s.updated_at DESC LIMIT ?`),
		insertMessage: db.prepare('INSERT INTO messages (session_id, role, content, tool_calls, tool_call_id, created_at) VALUES (?, ?, ?, ?, ?, ?)'),
		indexMessage: db.prepare('INSERT INTO message_index (body, session_id, message_id, role) VALUES (?, ?, ?, ?)'),
		messages: db.prepare('SELECT * FROM messages WHERE session_id = ? ORDER BY id'),
		search: db.prepare(`
			SELECT i.session_id, i.message_id, i.role, snippet(message_index, 0, '[', ']', '...', 12) AS snippet, bm25(message_index) AS rank,
			       s.title, s.kind, s.updated_at, m.created_at
			FROM message_index i
			JOIN sessions s ON s.id = i.session_id
			JOIN messages m ON m.id = i.message_id
			WHERE message_index MATCH ?
			ORDER BY rank LIMIT ?`),
		deleteSession: db.prepare('DELETE FROM sessions WHERE id = ?'),
		deleteIndex: db.prepare('DELETE FROM message_index WHERE session_id = ?'),
		insertRun: db.prepare('INSERT INTO runs (id, kind, session_id, parent_session_id, goal, status, started_at) VALUES (?, ?, ?, ?, ?, ?, ?)'),
		finishRun: db.prepare('UPDATE runs SET status = ?, result = ?, error = ?, prompt_tokens = ?, completion_tokens = ?, billed_usd = ?, finished_at = ? WHERE id = ?'),
		getRun: db.prepare('SELECT * FROM runs WHERE id = ?'),
		listRuns: db.prepare('SELECT * FROM runs ORDER BY started_at DESC LIMIT ?'),
		insertCron: db.prepare(`INSERT INTO crons (id, schedule_text, cron, tz, description, prompt, mode, server_automation_id, agent_id, cwd, enabled, created_at, next_run_at)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`),
		listCrons: db.prepare('SELECT * FROM crons ORDER BY created_at'),
		getCron: db.prepare('SELECT * FROM crons WHERE id = ?'),
		deleteCron: db.prepare('DELETE FROM crons WHERE id = ?'),
		claimCron: db.prepare("UPDATE crons SET running_since = ? WHERE id = ? AND (running_since IS NULL OR running_since < ?)"),
		finishCron: db.prepare('UPDATE crons SET running_since = NULL, last_run_at = ?, next_run_at = ?, last_status = ?, last_run_id = ? WHERE id = ?'),
		setCronNext: db.prepare('UPDATE crons SET next_run_at = ? WHERE id = ?'),
		setCronMode: db.prepare('UPDATE crons SET mode = ?, server_automation_id = ?, next_run_at = ? WHERE id = ?'),
		setCronEnabled: db.prepare('UPDATE crons SET enabled = ? WHERE id = ?'),
		kvGet: db.prepare('SELECT value FROM kv WHERE key = ?'),
		kvSet: db.prepare('INSERT INTO kv (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at'),
		kvDelete: db.prepare('DELETE FROM kv WHERE key = ?'),
	};

	const tx = (fn) => {
		db.exec('BEGIN IMMEDIATE');
		try {
			const out = fn();
			db.exec('COMMIT');
			return out;
		} catch (err) {
			db.exec('ROLLBACK');
			throw err;
		}
	};

	return {
		db,
		close: () => db.close(),

		createSession({ title = null, kind = 'chat', parentId = null, agentId = null, model = null, cwd = null, channel = null } = {}) {
			const id = newId('s');
			const t = nowIso();
			st.insertSession.run(id, title, kind, parentId, agentId, model, cwd, channel, t, t);
			return st.getSession.get(id);
		},
		getSession(id) {
			return st.getSession.get(id) || null;
		},
		/** Exact id, or a unique prefix of one. */
		resolveSession(idOrPrefix) {
			const exact = st.getSession.get(idOrPrefix);
			if (exact) return exact;
			const rows = st.findSession.all(`${String(idOrPrefix).replace(/[%_]/g, '')}%`);
			return rows.length === 1 ? rows[0] : null;
		},
		sessionForChannel(channel) {
			return st.byChannel.get(channel) || null;
		},
		setTitle(id, title) {
			st.setTitle.run(title, id);
		},
		listSessions({ kind = null, limit = 20 } = {}) {
			return st.listSessions.all(kind, kind, limit);
		},
		deleteSession(id) {
			tx(() => {
				st.deleteIndex.run(id);
				st.deleteSession.run(id);
			});
		},

		/** Append transcript messages; user and assistant text is indexed for search. */
		appendMessages(sessionId, messages) {
			if (!messages.length) return;
			tx(() => {
				const t = nowIso();
				for (const m of messages) {
					const content = m.content == null ? null : typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
					const r = st.insertMessage.run(sessionId, m.role, content, m.tool_calls ? JSON.stringify(m.tool_calls) : null, m.tool_call_id || null, t);
					if ((m.role === 'user' || m.role === 'assistant') && content) {
						st.indexMessage.run(content, sessionId, Number(r.lastInsertRowid), m.role);
					}
				}
				st.touch.run(t, sessionId);
			});
		},
		messages(sessionId) {
			return st.messages.all(sessionId).map(rowMessage);
		},
		search(text, { limit = 20 } = {}) {
			const q = ftsQuery(text);
			if (!q) return [];
			return st.search.all(q, limit);
		},
		exportSession(sessionId) {
			const session = st.getSession.get(sessionId);
			if (!session) return null;
			return {
				format: 'three-ws-agent-session',
				version: 1,
				exported_at: nowIso(),
				session,
				messages: st.messages.all(sessionId).map((r) => ({ ...rowMessage(r), created_at: r.created_at })),
			};
		},

		startRun({ kind, sessionId = null, parentSessionId = null, goal = null }) {
			const id = newId('r');
			st.insertRun.run(id, kind, sessionId, parentSessionId, goal, 'running', nowIso());
			return id;
		},
		finishRun(id, { status, result = null, error = null, usage = {}, billedUsd = 0 }) {
			st.finishRun.run(status, result, error, usage.prompt_tokens || 0, usage.completion_tokens || 0, billedUsd || 0, nowIso(), id);
		},
		getRun(id) {
			return st.getRun.get(id) || null;
		},
		listRuns({ limit = 20 } = {}) {
			return st.listRuns.all(limit);
		},

		addCron(c) {
			const id = newId('c');
			st.insertCron.run(id, c.scheduleText, c.cron, c.tz, c.description || null, c.prompt, c.mode, c.serverAutomationId || null, c.agentId || null, c.cwd || null, nowIso(), c.nextRunAt || null);
			return st.getCron.get(id);
		},
		listCrons() {
			return st.listCrons.all();
		},
		getCron(id) {
			return st.getCron.get(id) || null;
		},
		deleteCron(id) {
			return st.deleteCron.run(id).changes > 0;
		},
		/** Atomically mark a cron running; false if another process holds it (stale after staleMs). */
		claimCron(id, staleMs = 3 * 60 * 60 * 1000) {
			const t = new Date();
			return st.claimCron.run(t.toISOString(), id, new Date(t.getTime() - staleMs).toISOString()).changes > 0;
		},
		finishCron(id, { lastRunAt, nextRunAt, status, runId }) {
			st.finishCron.run(lastRunAt, nextRunAt, status, runId || null, id);
		},
		setCronNext(id, nextRunAt) {
			st.setCronNext.run(nextRunAt, id);
		},
		setCronMode(id, mode, serverAutomationId, nextRunAt) {
			st.setCronMode.run(mode, serverAutomationId || null, nextRunAt || null, id);
		},
		setCronEnabled(id, enabled) {
			st.setCronEnabled.run(enabled ? 1 : 0, id);
		},

		kvGet(key) {
			const r = st.kvGet.get(key);
			return r ? JSON.parse(r.value) : null;
		},
		kvSet(key, value) {
			st.kvSet.run(key, JSON.stringify(value), nowIso());
		},
		kvDelete(key) {
			st.kvDelete.run(key);
		},
	};
}
