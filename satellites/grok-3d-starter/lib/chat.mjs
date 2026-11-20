// One chat turn, end to end: Grok rounds over the xAI Responses API, the
// three.ws tool results they produce, and the follow-up of any render that
// outlives a round. Everything the page shows arrives through `emit`, as it
// happens; nothing is timed or simulated.
//
// Events emitted (name, data):
//   response   { id }                         conversation id for the next turn
//   round      { round }                      a Grok round started
//   thinking   {}                             Grok is reasoning (once per round)
//   text       { delta }                      reply text
//   tool       { id, name, arguments, status } a tool call started or finished
//   tool_result{ id, name, kind, summary }    what that call produced
//   job        { jobId, phase, progress, etaSeconds, elapsedSeconds, viewerUrl, source }
//   model      { glbUrl, viewerUrl, posterUrl, label, prompt, instruction, tool }
//   catalog    { items }
//   notice     { message }                    non-fatal note
//   error      AppError JSON                  the turn stopped
//   done       { responseId }

import { callTool } from './mcp.mjs';
import { MAX_ROUNDS, continuationPrompt, planNextRound, pollDelayMs } from './continuation.mjs';
import { mapToolProblem, renderFailed, renderTimeout } from './errors.mjs';
import { interpretToolResult, modelFromText } from './tool-results.mjs';
import { buildRequest, streamRound, userTurnText } from './xai.mjs';

export function abortableSleep(ms, signal) {
	return new Promise((resolve, reject) => {
		if (signal?.aborted) return reject(signal.reason);
		const timer = setTimeout(() => {
			signal?.removeEventListener('abort', onAbort);
			resolve();
		}, ms);
		function onAbort() {
			clearTimeout(timer);
			reject(signal.reason);
		}
		signal?.addEventListener('abort', onAbort, { once: true });
	});
}

function jobPayload(job, source) {
	return {
		jobId: job.jobId,
		phase: job.phase,
		progress: job.progress,
		etaSeconds: job.etaSeconds,
		elapsedSeconds: job.elapsedSeconds,
		viewerUrl: job.viewerUrl,
		source,
	};
}

function modelPayload(model) {
	return {
		glbUrl: model.glbUrl,
		viewerUrl: model.viewerUrl,
		posterUrl: model.posterUrl,
		label: model.label,
		prompt: model.prompt,
		instruction: model.instruction,
		tool: model.tool,
	};
}

function summarize(result) {
	switch (result.kind) {
		case 'model':
			return result.tool === 'refine_model' ? 'Refined model ready' : 'Model ready';
		case 'pending':
			return 'Render started; following it';
		case 'catalog':
			return `${result.items.length} catalog match${result.items.length === 1 ? '' : 'es'}`;
		case 'sign_in_required':
			return 'three.ws asked for a signed-in account';
		case 'bad_key':
			return 'three.ws rejected the API key';
		case 'failed':
			return result.message;
		default:
			return 'Done';
	}
}

/**
 * Follow a running render with get_job until it finishes, fails, or the wait
 * budget runs out. get_job never restarts work, so polling it is safe.
 */
export async function followJob({ config, job, emit, signal, fetchImpl = fetch, sleep = abortableSleep, now = Date.now }) {
	const deadline = now() + config.maxRenderWaitSeconds * 1000;
	let current = job;
	let attempt = 0;
	while (now() < deadline) {
		await sleep(pollDelayMs(current, attempt), signal);
		attempt += 1;
		let result;
		try {
			const raw = await callTool({
				url: config.mcpUrl,
				apiKey: config.threeWsApiKey,
				name: 'get_job',
				args: { job_id: current.jobId, ...(current.refine ? { refine: current.refine } : {}) },
				signal,
				fetchImpl,
			});
			result = { ...interpretToolResult({ name: 'get_job', output: raw }), jobId: current.jobId };
		} catch (err) {
			if (signal?.aborted || err?.code === 'three_ws_bad_key') throw err;
			emit('notice', { message: `Checking the render failed once (${err.message}). Trying again.` });
			continue;
		}
		if (result.kind === 'pending') {
			current = { ...current, ...result, refine: current.refine || result.refine };
			emit('job', jobPayload(current, 'server'));
			continue;
		}
		if (result.kind === 'model') return { status: 'done', model: result, job: current };
		const blocking = mapToolProblem(result);
		if (blocking && blocking.code !== 'render_failed') throw blocking;
		if (result.kind === 'failed') {
			if (result.retryable) continue;
			return { status: 'failed', message: result.message, job: current };
		}
	}
	return { status: 'timeout', job: current };
}

/** Run one turn. Resolves when the turn is finished; throws an AppError when it stops early. */
export async function runTurn({ config, input, emit, signal, fetchImpl = fetch, sleep = abortableSleep, now = Date.now, safetyIdentifier = null }) {
	let previousResponseId = input.previousResponseId || null;
	let text = userTurnText(input.message, input.stage);
	const shown = new Set();
	let collected = null;

	function showModel(model) {
		if (!model?.glbUrl || shown.has(model.glbUrl)) return;
		shown.add(model.glbUrl);
		emit('model', modelPayload(model));
	}

	for (let round = 1; round <= MAX_ROUNDS; round += 1) {
		emit('round', { round });
		const body = buildRequest({ config, text, previousResponseId, safetyIdentifier });
		const results = [];
		let roundText = '';
		let thinking = false;

		try {
			for await (const evt of streamRound({ config, body, signal, fetchImpl })) {
				if (evt.type === 'response') {
					previousResponseId = evt.id;
					emit('response', { id: evt.id });
				} else if (evt.type === 'text') {
					roundText += evt.delta;
					emit('text', { delta: evt.delta });
				} else if (evt.type === 'thinking') {
					if (!thinking) emit('thinking', {});
					thinking = true;
				} else if (evt.type === 'tool') {
					emit('tool', { id: evt.id, name: evt.name, arguments: evt.arguments, status: evt.status });
				} else if (evt.type === 'tool_output') {
					const result = interpretToolResult(evt);
					results.push(result);
					emit('tool_result', { id: evt.id, name: result.tool, kind: result.kind, summary: summarize(result) });
					if (result.kind === 'model') showModel(result);
					else if (result.kind === 'pending') emit('job', jobPayload(result, 'grok'));
					else if (result.kind === 'catalog') emit('catalog', { items: result.items });
				}
			}
		} catch (err) {
			// The model already reached the page; a failed courtesy round must not
			// turn a finished turn into an error.
			if (collected && !signal?.aborted) {
				emit('notice', { message: `The model is ready. Grok could not be told about it (${err.title || err.message}), but follow-ups still work: the page tells Grok which model is on the stage.` });
				break;
			}
			throw err;
		}

		const madeModel = results.some((r) => r.kind === 'model');
		if (!madeModel && !collected) {
			const blocking = results.map(mapToolProblem).find(Boolean);
			if (blocking) throw blocking;
			const fromText = !results.some((r) => r.kind === 'pending' || r.kind === 'catalog') ? modelFromText(roundText) : null;
			if (fromText) showModel(fromText);
		}

		const plan = planNextRound({ results, round });
		if (plan.action === 'done') {
			if (plan.reason === 'round_budget' && !collected) throw renderTimeout(Math.round(config.maxRenderWaitSeconds / 60), plan.job?.viewerUrl);
			break;
		}

		const outcome = await followJob({ config, job: plan.job, emit, signal, fetchImpl, sleep, now });
		if (outcome.status === 'failed') throw renderFailed(outcome.message);
		if (outcome.status === 'timeout') throw renderTimeout(Math.round(config.maxRenderWaitSeconds / 60), outcome.job.viewerUrl);
		collected = outcome.model;
		showModel(outcome.model);
		text = continuationPrompt(plan.job);
	}

	emit('done', { responseId: previousResponseId });
	return { responseId: previousResponseId };
}
