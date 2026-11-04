// agent-browse.js: the observe, decide, act loop behind the browse_web tool.
//
// Pure orchestration with injected dependencies so the safety properties are
// testable without a browser: the loop yields within one step when the owner
// takes the wheel, enforces the step, time and token budgets, refuses actions
// the policy denies, and logs every action it takes or declines.
//
// Dependencies (all async unless noted):
//   observe()           -> { url, text, elements: [{id, ...}], tokens? }
//   decide(ctx)         -> { text, tokens }   model reply for the next action
//   act(action, obs)    -> { note?, extracted? }   performs one validated action
//   currentUrl()        -> string, sync or async   url after the act
//   goBack()            -> returns the page to the previous url
//   isManual()          -> boolean, sync   owner holds the control lease
//   signal              -> AbortSignal
//   log(entry)          -> records one step entry
//   now()               -> ms clock

import { parseAction } from './browse-policy.js';

const MAX_CONSECUTIVE_DENIALS = 3;
const MAX_PARSE_FAILURES = 2;

export async function runBrowseLoop({ goal, startUrl, policy, observe, decide, act, currentUrl, goBack, isManual, signal, log, now = Date.now }) {
	const startedAt = now();
	const steps = [];
	let tokens = 0;
	let denials = 0;
	let parseFailures = 0;
	let feedback = '';
	let result = null;

	const record = (entry) => {
		const full = { n: steps.length + 1, at: now(), ...entry };
		steps.push(full);
		try { log?.(full); } catch { /* logging never breaks the loop */ }
		return full;
	};
	const finish = (status, extra = {}) => ({ status, steps, tokens, result, elapsedMs: now() - startedAt, ...extra });

	const first = policy.checkUrl(startUrl);
	if (!first.ok) {
		record({ type: 'denied', action: 'goto', url: startUrl, reason: first.reason });
		return finish('denied', { reason: first.reason });
	}

	let acted = 0;
	for (;;) {
		if (signal?.aborted) return finish('aborted');
		if (isManual()) { record({ type: 'yield', reason: 'owner_took_over' }); return finish('yielded'); }
		if (acted >= policy.maxSteps) { record({ type: 'stop', reason: 'step_cap' }); return finish('step_cap'); }
		if (now() - startedAt >= policy.maxMs) { record({ type: 'stop', reason: 'time_cap' }); return finish('time_cap'); }
		if (tokens >= policy.maxTokens) { record({ type: 'stop', reason: 'token_cap' }); return finish('token_cap'); }

		const obs = await observe();
		const elements = new Map((obs.elements || []).map((e) => [e.id, e]));
		tokens += obs.tokens || 0;

		const reply = await decide({ goal, obs, feedback, stepsTaken: acted, stepsLeft: policy.maxSteps - acted });
		tokens += reply.tokens || 0;

		// The owner may have grabbed the wheel while the model was thinking. Check
		// again before touching the page so a decision never lands on a driver.
		if (isManual()) { record({ type: 'yield', reason: 'owner_took_over' }); return finish('yielded'); }
		if (signal?.aborted) return finish('aborted');

		const action = parseAction(reply.text);
		if (!action) {
			parseFailures++;
			record({ type: 'invalid', reason: 'unparseable_action' });
			if (parseFailures > MAX_PARSE_FAILURES) return finish('error', { reason: 'model_output_unusable' });
			feedback = 'Your last reply was not a single valid JSON action. Reply with exactly one JSON object.';
			continue;
		}

		const verdict = policy.checkAction(action, { elements });
		if (!verdict.ok) {
			denials++;
			record({ type: 'denied', action: action.action, id: action.id, url: action.url, reason: verdict.reason });
			if (denials >= MAX_CONSECUTIVE_DENIALS) return finish('policy_stop', { reason: verdict.reason });
			feedback = `That action was refused by policy (${verdict.reason}). Choose a different action.`;
			continue;
		}
		denials = 0;
		feedback = '';

		if (action.action === 'done') {
			result = action.result;
			record({ type: 'action', action: 'done', note: action.note, result });
			return finish('done');
		}

		acted++;
		let outcome;
		try {
			outcome = await act(action, obs);
		} catch (err) {
			record({ type: 'error', action: action.action, id: action.id, reason: String(err?.message || err).slice(0, 160) });
			feedback = `That action failed: ${String(err?.message || err).slice(0, 120)}. Try something else.`;
			continue;
		}
		record({ type: 'action', action: action.action, id: action.id, url: action.url, note: action.note, extracted: outcome?.extracted });
		if (outcome?.extracted) feedback = `Extracted text: ${String(outcome.extracted).slice(0, 600)}`;

		// A click can redirect somewhere the run may not go. Check where the page
		// actually is and step back out when it left the allowlist.
		const landed = await currentUrl();
		const where = policy.checkUrl(landed);
		if (!where.ok) {
			record({ type: 'denied', action: 'navigate', url: landed, reason: where.reason });
			await goBack();
			feedback = `The page moved to a location the policy refuses (${where.reason}). It was reverted.`;
		}
	}
}

// Ask the model for the next action through /api/brain/chat, the same free
// default provider the narration code uses. Resolves to { text, tokens }.
export function brainDecider({ baseUrl, fetchImpl = fetch, provider = 'gpt-oss-120b', drain }) {
	return async ({ goal, obs, feedback, stepsLeft }) => {
		const system =
			'You operate a web browser to achieve a goal. Each turn you see the page and a numbered list of elements. ' +
			'Reply with exactly ONE JSON object and nothing else, choosing from: ' +
			'{"action":"click","id":N} {"action":"type","id":N,"text":"...","submit":false} {"action":"scroll","direction":"down"} ' +
			'{"action":"goto","url":"https://..."} {"action":"extract","id":N} {"action":"done","result":"answer for the user"}. ' +
			'Add a short "note" saying why. Never enter passwords, codes or payment details. Use done as soon as the goal is met or cannot be met.';
		const elementLines = (obs.elements || []).map((e) => `${e.id}: ${e.tag}${e.type ? `[${e.type}]` : ''} ${e.name || ''}`.trim()).join('\n');
		const user =
			`Goal: ${goal}\nSteps left: ${stepsLeft}\nURL: ${obs.url}\n\nElements:\n${elementLines || '(none)'}\n\nPage text:\n${String(obs.text || '').slice(0, 2500)}` +
			(feedback ? `\n\nNote: ${feedback}` : '');
		const res = await fetchImpl(`${baseUrl}/api/brain/chat`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ provider, system, messages: [{ role: 'user', content: user }], maxTokens: 300 }),
			signal: AbortSignal.timeout(30_000),
		});
		if (!res.ok || !res.body) throw new Error(`brain ${res.status}`);
		const text = await drain(res.body);
		return { text, tokens: Math.ceil((system.length + user.length + text.length) / 4) };
	};
}
