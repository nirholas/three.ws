// `three-ws-agent cron`: natural-language schedules that run a prompt locally
// (this machine's scheduler) or on the server (a three.ws automation).

import { addSchedule, ACCEPTED_FORMS, removeSchedule, runDue, setScheduleMode, startScheduler } from '../scheduler.js';
import { runHeadless } from '../session.js';
import { ago, table, truncate } from './format.js';

function platformOrNull(ctx) {
	try {
		return ctx.platform;
	} catch {
		return null;
	}
}

export function listCrons({ ctx }) {
	return { crons: ctx.store.listCrons() };
}

export function printCrons({ crons }) {
	if (!crons.length) {
		return `No schedules yet. Add one: cron add "every weekday at 9am" "summarize my wallet activity"\nAccepted forms:\n  ${ACCEPTED_FORMS.join("\n  ")}`;
	}
	return table([
		['ID', 'MODE', 'STATE', 'SCHEDULE', 'NEXT', 'LAST', 'PROMPT'],
		...crons.map((c) => [
			c.id,
			c.mode,
			c.enabled ? c.last_status || 'waiting' : 'off',
			c.description || c.cron,
			c.mode === 'server' ? 'on three.ws' : ago(c.next_run_at),
			ago(c.last_run_at),
			truncate(c.prompt, 50),
		]),
	]);
}

export async function addCron({ ctx, when, prompt, mode }) {
	const cron = await addSchedule({
		store: ctx.store,
		when,
		prompt,
		mode: mode || ctx.config.cron?.defaultMode || 'local',
		platform: platformOrNull(ctx),
		agentId: ctx.config.agentId,
		cwd: ctx.cwd,
	});
	return { cron };
}

export function printCron({ cron }, verb = 'Added') {
	const where = cron.mode === 'server' ? `on three.ws (automation ${cron.server_automation_id})` : `on this machine, next ${ago(cron.next_run_at)}`;
	const local = cron.mode === 'local' ? '\nLocal schedules fire while `three-ws-agent` or `three-ws-agent cron run` is running.' : '';
	return `${verb} ${cron.id}: ${cron.description || cron.cron}, ${where}.${local}`;
}

export async function removeCron({ ctx, id }) {
	return { cron: await removeSchedule({ store: ctx.store, id, platform: platformOrNull(ctx) }) };
}

export async function setCronMode({ ctx, id, mode }) {
	return { cron: await setScheduleMode({ store: ctx.store, id, mode, platform: platformOrNull(ctx), agentId: ctx.config.agentId }) };
}

export function setCronEnabled({ ctx, id, enabled }) {
	const cron = ctx.store.getCron(id);
	if (!cron) throw new Error(`No schedule with id ${id}. List them with \`cron\`.`);
	if (cron.mode === 'server') throw new Error(`${id} runs on three.ws; pause it there, or switch it back with \`cron mode ${id} local\`.`);
	ctx.store.setCronEnabled(id, enabled);
	return { cron: ctx.store.getCron(id) };
}

/** The prompt runner a scheduler uses: one headless turn in the schedule's own session. */
export function cronRunner(ctx, { onEvent } = {}) {
	return (cron) => runHeadless(ctx, { prompt: cron.prompt, kind: 'cron', channel: `cron:${cron.id}`, goal: `cron ${cron.id}: ${cron.prompt}`, onEvent });
}

/** `cron run --once`: fire whatever is due now and return. */
export async function runCronOnce({ ctx, onEvent }) {
	return { fired: await runDue({ store: ctx.store, runPrompt: cronRunner(ctx), catchUp: ctx.config.cron?.catchUp !== false, onEvent }) };
}

/** `cron run`: the foreground scheduler (systemd, Docker, a VPS). Resolves once `signal` aborts. */
export async function runCronDaemon({ ctx, signal, onEvent, intervalMs }) {
	const scheduler = startScheduler({ store: ctx.store, runPrompt: cronRunner(ctx), catchUp: ctx.config.cron?.catchUp !== false, onEvent, intervalMs });
	await new Promise((resolve) => {
		if (signal.aborted) resolve();
		else signal.addEventListener('abort', resolve, { once: true });
	});
	await scheduler.stop();
	return { stopped: true };
}

export function printCronEvent(e) {
	if (e.kind === 'cron_start') return `[${new Date().toISOString()}] ${e.id} started: ${truncate(e.prompt, 80)}`;
	if (e.kind === 'cron_end') return `[${new Date().toISOString()}] ${e.id} ${e.status}${e.runId ? ` (run ${e.runId})` : ''}${e.error ? `: ${e.error}` : ''}`;
	if (e.kind === 'cron_skipped') return `[${new Date().toISOString()}] ${e.id} skipped a run missed while stopped (cron.catchUp is false)`;
	if (e.kind === 'cron_error') return `[${new Date().toISOString()}] scheduler error: ${e.error}`;
	return null;
}
