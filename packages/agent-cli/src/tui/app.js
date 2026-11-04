// The terminal UI: an Ink app over one agent context.
//
//   transcript   <Static> rows (user, assistant, tool, info, error) that scroll
//                into the terminal's own history
//   live area    the text streaming in, running tools, running subagents, an
//                approval prompt, the input, and a status line
//   avatar       optional (--avatar on a terminal at least 110 columns wide):
//                the agent's 3D body rendered in-process by @three-ws/tty-avatar,
//                its mood following the turn (idle, think, work)
//
// Keys: Enter sends; a line ending in \ continues on the next line; Up/Down
// walk history; Tab completes a slash command; Ctrl+C stops the running turn
// (and quits on an empty prompt); typing during a turn redirects it: the turn
// is stopped and the new message is sent with the transcript so far.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Box, Static, Text, useApp, useInput, useStdout } from 'ink';
import { InterruptedError } from '../loop.js';
import { createSession } from '../session.js';
import { createSubagentPool } from '../subagent.js';
import { startScheduler } from '../scheduler.js';
import { cronRunner, printCronEvent } from '../commands/cron.js';
import { financialFacts, summarizeArgs } from '../approval.js';
import { complete, completions, isSlash, runSlash } from './slash.js';
import { usd, truncate } from '../commands/format.js';

const h = React.createElement;
const AVATAR_MIN_COLUMNS = 110;
const AVATAR_COLS = 34;
const AVATAR_ROWS = 17;
const TOOL_RESULT_CHARS = 140;

let itemSeq = 0;
const item = (kind, text, extra = {}) => ({ id: `i${++itemSeq}`, kind, text, ...extra });

function resultPreview(result, error) {
	if (error) return `error: ${truncate(error, TOOL_RESULT_CHARS)}`;
	const text = typeof result === 'string' ? result : JSON.stringify(result ?? null);
	return truncate(text, TOOL_RESULT_CHARS);
}

function TranscriptItem({ it }) {
	switch (it.kind) {
		case 'user':
			return h(Box, { marginTop: 1 }, h(Text, { color: 'cyan', bold: true }, '> '), h(Text, { color: 'cyan' }, it.text));
		case 'assistant':
			return h(Box, { marginTop: 1 }, h(Text, null, it.text));
		case 'tool':
			// One Text, so a long preview wraps instead of squeezing the tool name.
			return h(
				Text,
				null,
				h(Text, { color: it.error ? 'red' : 'green' }, it.error ? '  x ' : '  + '),
				h(Text, { bold: true }, it.name),
				h(Text, { dimColor: true }, ` ${it.ms}ms  ${it.text}`),
			);
		case 'blocked':
			return h(Text, null, h(Text, { color: 'yellow' }, '  - '), h(Text, { bold: true }, it.name), h(Text, { color: 'yellow' }, ` not run: ${it.text}`));
		case 'error':
			return h(Box, { marginTop: 1 }, h(Text, { color: 'red' }, it.text));
		default:
			return h(Box, { marginTop: it.tight ? 0 : 1 }, h(Text, { dimColor: true }, it.text));
	}
}

function Approval({ request }) {
	const { tool, args } = request;
	const financial = tool.toolClass === 'financial';
	const rows = [h(Text, { key: 't', bold: true, color: financial ? 'magenta' : 'yellow' }, `Approve ${tool.toolClass} tool ${tool.name}?`)];
	if (financial) {
		for (const [label, value] of financialFacts(args)) {
			rows.push(h(Text, { key: label }, h(Text, { bold: true }, `${label.padEnd(10)}`), value));
		}
	}
	rows.push(h(Text, { key: 'a', dimColor: true }, summarizeArgs(args, 400)));
	rows.push(h(Text, { key: 'k' }, h(Text, { color: 'green', bold: true }, 'Enter'), ' approve   ', h(Text, { color: 'red', bold: true }, 'Esc'), ' deny'));
	return h(Box, { flexDirection: 'column', borderStyle: 'round', borderColor: financial ? 'magenta' : 'yellow', paddingX: 1 }, ...rows);
}

function InputLine({ value, busy, queued, approval }) {
	const lines = value.split('\n');
	const prompt = approval ? '  ' : busy ? '~ ' : '> ';
	const hint = completions(value);
	return h(
		Box,
		{ flexDirection: 'column' },
		...lines.map((line, i) =>
			h(Box, { key: `l${i}` }, h(Text, { color: busy ? 'yellow' : 'cyan', bold: true }, i === 0 ? prompt : '. '), h(Text, null, line), i === lines.length - 1 && !approval ? h(Text, { inverse: true }, ' ') : null),
		),
		hint.length > 1 || (hint.length === 1 && `/${hint[0].name}` !== value)
			? h(Text, { key: 'hint', dimColor: true }, hint.map((c) => `/${c.name}`).join('  '))
			: null,
		queued ? h(Text, { key: 'q', color: 'yellow' }, `redirecting with: ${truncate(queued, 80)}`) : null,
	);
}

function StatusLine({ ctx, session, totals, busy, subagents, cwdLabel }) {
	const running = subagents.filter((s) => s.status === 'running').length;
	const queued = subagents.filter((s) => s.status === 'queued').length;
	// The busy hint leads and the line truncates rather than wraps, so on a
	// narrow terminal the part that tells you how to stop a turn stays visible.
	const parts = [
		...(busy ? ['Ctrl+C stops'] : []),
		ctx.modelLabel,
		`session ${session.id}`,
		`${totals.prompt_tokens + totals.completion_tokens} tokens`,
		usd(totals.billedUsd),
		cwdLabel,
	];
	if (running || queued) parts.push(`subagents ${running} running${queued ? `, ${queued} queued` : ''}`);
	return h(Text, { dimColor: true, wrap: 'truncate-end' }, parts.join('  |  '));
}

function AvatarPane({ mesh, snapshot, mood }) {
	const [frame, setFrame] = useState('');
	useEffect(() => {
		let t = 0;
		const draw = () => {
			t += 0.12;
			try {
				setFrame(snapshot(mesh, { columns: AVATAR_COLS, rows: AVATAR_ROWS, mood, t }));
			} catch (err) {
				setFrame(`avatar error: ${err.message}`);
			}
		};
		draw();
		const timer = setInterval(draw, 120);
		return () => clearInterval(timer);
	}, [mesh, snapshot, mood]);
	return h(Box, { width: AVATAR_COLS + 2, flexShrink: 0, marginRight: 1 }, h(Text, null, frame));
}

/**
 * @param {object} props
 * @param {object} props.ctx         createAgentContext()
 * @param {object} props.session     the first createSession()
 * @param {{ mesh: object, snapshot: Function } | null} [props.avatar]
 * @param {boolean} [props.scheduler]  run local cron schedules while open (default true)
 * @param {object} [props.overrides]   the --model / --agent values, dropped once /model or /agent changes them
 * @param {(o: object) => void} [props.onExit]
 */
export function App({ ctx, session: initialSession, avatar = null, scheduler = true, overrides = {}, onExit, initialItems = [] }) {
	const { exit } = useApp();
	const { stdout } = useStdout();
	const [columns, setColumns] = useState(stdout?.columns || 80);
	const [items, setItems] = useState(() => initialItems.map((t) => item('info', t)));
	const [staticKey, setStaticKey] = useState(0);
	const [streaming, setStreaming] = useState('');
	const [tools, setTools] = useState([]);
	const [input, setInput] = useState('');
	const [busy, setBusy] = useState(false);
	const [approval, setApproval] = useState(null);
	const [queued, setQueued] = useState('');
	const [subagents, setSubagents] = useState([]);
	const [session, setSessionState] = useState(initialSession);
	const [totals, setTotals] = useState({ prompt_tokens: 0, completion_tokens: 0, billedUsd: 0 });
	const [mood, setMood] = useState('idle');

	const sessionRef = useRef(initialSession);
	const controllerRef = useRef(null);
	const approvalsRef = useRef([]);
	const queueRef = useRef([]);
	const historyRef = useRef(ctx.store.kvGet('tui.history') || []);
	const historyIndexRef = useRef(-1);
	const streamRef = useRef('');
	const busyRef = useRef(false);
	const exitingRef = useRef(false);
	const overridesRef = useRef({ ...overrides });

	const push = useCallback((...next) => setItems((prev) => [...prev, ...next]), []);
	const info = useCallback((text) => push(item('info', text)), [push]);

	useEffect(() => {
		if (!stdout) return undefined;
		const onResize = () => setColumns(stdout.columns || 80);
		stdout.on('resize', onResize);
		return () => stdout.off('resize', onResize);
	}, [stdout]);

	const pool = useMemo(() => createSubagentPool(ctx), [ctx]);
	useEffect(() => {
		const seen = new Map();
		return pool.subscribe((list) => {
			setSubagents(list);
			for (const j of list) {
				if (seen.get(j.id) === j.status) continue;
				seen.set(j.id, j.status);
				if (j.status === 'done') push(item('info', `Subagent ${j.id} finished (${usd(j.billedUsd)}): ${truncate(j.summary, 200)}\nIts full report is in this session for the next message.`));
				if (j.status === 'error') push(item('error', `Subagent ${j.id} failed: ${j.error}`));
				if (j.status === 'cancelled') push(item('info', `Subagent ${j.id} cancelled.`));
			}
		});
	}, [pool, push]);

	useEffect(() => {
		if (!scheduler) return undefined;
		const s = startScheduler({
			store: ctx.store,
			runPrompt: cronRunner(ctx),
			catchUp: ctx.config.cron?.catchUp !== false,
			onEvent: (e) => {
				const line = printCronEvent(e);
				if (line) push(item(e.kind === 'cron_error' ? 'error' : 'info', line));
			},
		});
		return () => {
			s.stop();
		};
	}, [ctx, scheduler, push]);

	// Approvals: the turn and any subagent may ask; one prompt shows at a time.
	const showNextApproval = useCallback(() => setApproval(approvalsRef.current[0] || null), []);
	const approve = useCallback(
		({ tool, args, subagent }) =>
			new Promise((resolve) => {
				approvalsRef.current.push({ tool, args, subagent, resolve });
				showNextApproval();
			}),
		[showNextApproval],
	);
	const answerApproval = useCallback(
		(ok) => {
			const req = approvalsRef.current.shift();
			if (!req) return;
			push(item('info', `${ok ? 'Approved' : 'Denied'} ${req.tool.name}${req.subagent ? ` for subagent ${req.subagent}` : ''}.`, { tight: true }));
			req.resolve(ok ? { ok: true } : { ok: false });
			showNextApproval();
		},
		[push, showNextApproval],
	);
	/** Deny every prompt that belongs to the main turn (an abort must not leave it waiting). */
	const denyTurnApprovals = useCallback(() => {
		const keep = [];
		for (const req of approvalsRef.current) {
			if (req.subagent) keep.push(req);
			else req.resolve({ ok: false, reason: 'The owner stopped the turn.' });
		}
		approvalsRef.current = keep;
		showNextApproval();
	}, [showNextApproval]);

	const flushStream = useCallback(() => {
		const text = streamRef.current.trim();
		streamRef.current = '';
		setStreaming('');
		if (text) push(item('assistant', text));
	}, [push]);

	const onEvent = useCallback(
		(e) => {
			if (e.kind === 'model_start') setMood('think');
			if (e.kind === 'tool_start') {
				flushStream();
				setMood('work');
				setTools((prev) => [...prev, { id: e.id, name: e.name, args: e.args, startedAt: Date.now() }]);
			}
			if (e.kind === 'tool_end') {
				setTools((prev) => prev.filter((t) => t.id !== e.id));
				push(item('tool', resultPreview(e.result, e.error), { name: e.name, ms: e.ms, error: Boolean(e.error) }));
			}
			if (e.kind === 'tool_blocked') {
				setTools((prev) => prev.filter((t) => t.id !== e.id));
				push(item('blocked', truncate(e.reason, 200), { name: e.name }));
			}
		},
		[flushStream, push],
	);

	const runTurn = useCallback(
		async (text) => {
			const s = sessionRef.current;
			push(item('user', text));
			busyRef.current = true;
			setBusy(true);
			setMood('think');
			const controller = new AbortController();
			controllerRef.current = controller;
			try {
				const result = await s.send(text, {
					approve,
					signal: controller.signal,
					onContent: (d) => {
						streamRef.current += d;
						setStreaming(streamRef.current);
					},
					onEvent,
				});
				if (!streamRef.current.trim() && result.answer) streamRef.current = result.answer;
				flushStream();
				setTotals({ ...s.totals });
			} catch (err) {
				flushStream();
				if (err instanceof InterruptedError) push(item('info', queueRef.current.length ? 'Stopped; redirecting.' : 'Stopped. The partial reply is kept in the session.'));
				else push(item('error', `${err.message || err}`));
			} finally {
				controllerRef.current = null;
				setTools([]);
				denyTurnApprovals();
				busyRef.current = false;
				setBusy(false);
				setMood('idle');
			}
			if (queueRef.current.length && !exitingRef.current) {
				const next = queueRef.current.splice(0).join('\n\n');
				setQueued('');
				await runTurn(next);
			}
		},
		[approve, denyTurnApprovals, flushStream, onEvent, push],
	);

	const quit = useCallback(async () => {
		if (exitingRef.current) return;
		exitingRef.current = true;
		controllerRef.current?.abort();
		denyTurnApprovals();
		await pool.cancelAll();
		onExit?.({ sessionId: sessionRef.current.id });
		exit();
	}, [denyTurnApprovals, exit, onExit, pool]);

	const slashApi = useMemo(
		() => ({
			ctx,
			get session() {
				return sessionRef.current;
			},
			pool,
			approve,
			onSubagentEvent: null,
			newSession() {
				if (busyRef.current) throw new Error('A turn is running; stop it with Ctrl+C first.');
				const s = createSession(ctx);
				sessionRef.current = s;
				setSessionState(s);
				setTotals({ prompt_tokens: 0, completion_tokens: 0, billedUsd: 0 });
				return s;
			},
			resumeSession(id) {
				if (busyRef.current) throw new Error('A turn is running; stop it with Ctrl+C first.');
				const s = createSession(ctx, { resume: id });
				sessionRef.current = s;
				setSessionState(s);
				setTotals({ prompt_tokens: 0, completion_tokens: 0, billedUsd: 0 });
				const lastUser = [...s.messages].reverse().find((m) => m.role === 'user');
				const lastAnswer = [...s.messages].reverse().find((m) => m.role === 'assistant' && m.content);
				if (lastUser) push(item('user', truncate(lastUser.content, 400)));
				if (lastAnswer) push(item('assistant', truncate(lastAnswer.content, 1200)));
				return s;
			},
			reload(key) {
				if (key) delete overridesRef.current[key];
				ctx.reload({ ...overridesRef.current });
				setTotals((t) => ({ ...t }));
			},
			clear() {
				stdout?.write('\x1b[2J\x1b[3J\x1b[H');
				setItems([]);
				setStaticKey((k) => k + 1);
			},
			exit: quit,
		}),
		[approve, ctx, pool, push, quit, stdout],
	);

	const submit = useCallback(
		async (raw) => {
			const text = raw.trim();
			if (!text) return;
			const history = historyRef.current;
			if (history[history.length - 1] !== text) {
				history.push(text);
				if (history.length > 500) history.splice(0, history.length - 500);
				ctx.store.kvSet('tui.history', history);
			}
			historyIndexRef.current = -1;
			if (isSlash(text)) {
				push(item('user', text));
				const out = await runSlash(text, slashApi);
				if (out?.text) push(item('info', out.text, { tight: true }));
				if (out?.error) push(item('error', out.error));
				return;
			}
			if (busyRef.current) {
				queueRef.current.push(text);
				setQueued(queueRef.current.join(' / '));
				controllerRef.current?.abort();
				denyTurnApprovals();
				return;
			}
			await runTurn(text);
		},
		[ctx, denyTurnApprovals, push, runTurn, slashApi],
	);

	useInput((ch, key) => {
		if (key.ctrl && ch === 'c') {
			if (approvalsRef.current.length && !busyRef.current) {
				answerApproval(false);
				return;
			}
			if (busyRef.current) {
				queueRef.current = [];
				setQueued('');
				controllerRef.current?.abort();
				denyTurnApprovals();
				return;
			}
			if (input) {
				setInput('');
				return;
			}
			quit();
			return;
		}
		if (approvalsRef.current.length) {
			if (key.return || ch === 'y') answerApproval(true);
			else if (key.escape || ch === 'n') answerApproval(false);
			return;
		}
		if (key.return) {
			if (input.endsWith('\\')) {
				setInput(`${input.slice(0, -1)}\n`);
				return;
			}
			const text = input;
			setInput('');
			submit(text);
			return;
		}
		if (key.tab) {
			setInput(complete(input));
			return;
		}
		if (key.backspace || key.delete) {
			setInput(input.slice(0, -1));
			return;
		}
		if (key.upArrow || key.downArrow) {
			const history = historyRef.current;
			if (!history.length || input.includes('\n')) return;
			let i = historyIndexRef.current;
			if (key.upArrow) i = i === -1 ? history.length - 1 : Math.max(0, i - 1);
			else i = i === -1 ? -1 : i + 1 >= history.length ? -1 : i + 1;
			historyIndexRef.current = i;
			setInput(i === -1 ? '' : history[i]);
			return;
		}
		if (key.escape) {
			setInput('');
			return;
		}
		if (key.ctrl || key.meta || key.leftArrow || key.rightArrow || key.pageUp || key.pageDown) return;
		if (ch) setInput(input + ch.replace(/\r\n?/g, '\n'));
	});

	const cwdLabel = ctx.cwd.replace(ctx.env.home, '~');
	const showAvatar = Boolean(avatar) && columns >= AVATAR_MIN_COLUMNS;
	const live = h(
		Box,
		{ flexDirection: 'column', flexGrow: 1 },
		streaming ? h(Box, { marginTop: 1 }, h(Text, null, streaming)) : null,
		...tools.map((t) => h(Text, { key: t.id, color: 'yellow' }, `  ~ ${t.name} ${truncate(summarizeArgs(t.args, 120), 100)}`)),
		...subagents.filter((s) => s.status === 'running' || s.status === 'queued').map((s) => h(Text, { key: s.id, color: 'blue' }, `  ${s.status === 'running' ? '>' : '.'} subagent ${s.id} ${s.status}: ${truncate(s.goal, 70)}`)),
		approval ? h(Approval, { request: approval }) : null,
		h(Box, { marginTop: 1 }, h(InputLine, { value: input, busy, queued, approval })),
		h(StatusLine, { ctx, session, totals, busy, subagents, cwdLabel }),
	);
	return h(
		Box,
		{ flexDirection: 'column' },
		h(Static, { key: `s${staticKey}`, items }, (it) => h(TranscriptItem, { key: it.id, it })),
		showAvatar ? h(Box, { flexDirection: 'row' }, h(AvatarPane, { mesh: avatar.mesh, snapshot: avatar.snapshot, mood }), live) : live,
	);
}

/** Load the avatar for --avatar: tty-avatar is an optional dependency. */
export async function loadAvatar(source, { origin }) {
	let lib;
	try {
		lib = await import('@three-ws/tty-avatar');
	} catch {
		throw new Error('--avatar needs @three-ws/tty-avatar: npm i -g @three-ws/tty-avatar');
	}
	const resolved = await lib.resolveSource(source, { origin });
	const mesh = await lib.parseGlb(resolved.bytes);
	return { mesh, snapshot: lib.snapshot, name: resolved.name };
}
