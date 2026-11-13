// Owner-only "Browse" panel on the agent screen: send the agent to a public
// site with a goal, watch its steps as they happen, and take over at any time.
//
//   start   POST /api/agent-screen-browse {op:'start'}   (session + CSRF)
//   status  POST /api/agent-screen-browse {op:'status'}  polled while a run is live
//
// The live pixels already arrive on the stage through the screen stream; this
// panel adds the goal form, a step strip and the Take over button, which drives
// the existing control toggle so there is one lease flow, not two.

const API = '/api/agent-screen-browse';
const POLL_MS = 2000;
const FINAL = new Set(['done', 'yielded', 'step_cap', 'time_cap', 'token_cap', 'policy_stop', 'denied', 'aborted', 'error']);

const STATUS_TEXT = {
	queued: 'Waiting for a browser',
	running: 'Browsing',
	done: 'Finished',
	yielded: 'You took over',
	step_cap: 'Stopped at the step limit',
	time_cap: 'Stopped at the time limit',
	token_cap: 'Stopped at the token limit',
	policy_stop: 'Stopped by the safety policy',
	denied: 'Start page refused',
	aborted: 'Stopped',
	error: 'Run failed',
};

const REASON_TEXT = {
	domain_not_allowed: 'outside the allowed sites',
	financial_page: 'payment and banking pages are off limits',
	credential_entry_needs_vault: 'entering passwords or codes is not allowed',
	url_not_public_http: 'not a public web address',
	owner_took_over: 'you took the wheel',
	unknown_element: 'that element is not on the page',
};

function describe(step) {
	if (step.type === 'yield') return 'Paused: you took the wheel';
	if (step.type === 'denied') return `Blocked: ${REASON_TEXT[step.reason] || step.reason}`;
	if (step.type === 'stop') return `Stopped: ${step.reason.replace('_', ' ')}`;
	if (step.type === 'error' && step.reason === 'model_unavailable') return 'No model could answer right now. Start the run again in a minute.';
	if (step.type === 'error' && step.action === 'run') return `The browser stopped unexpectedly (${step.reason}). Start the run again.`;
	if (step.type === 'error') return `Could not ${step.action}: ${step.reason}`;
	if (step.type === 'invalid') return 'The model gave an unusable answer, retrying';
	if (step.action === 'done') return `Done: ${step.result || step.note || ''}`;
	return step.note || ({ click: 'Clicked a link or button', type: 'Typed into a field', scroll: 'Scrolled', goto: `Opened ${step.url || 'a page'}`, extract: 'Read the page' }[step.action] || step.action);
}

async function csrf() {
	try {
		const r = await fetch('/api/csrf-token', { credentials: 'include' });
		if (!r.ok) return null;
		const j = await r.json().catch(() => null);
		return j?.token || j?.csrfToken || null;
	} catch {
		return null;
	}
}

async function call(body) {
	const token = await csrf();
	if (!token) throw new Error('Sign in to send this agent browsing');
	const r = await fetch(API, {
		method: 'POST', credentials: 'include',
		headers: { 'content-type': 'application/json', 'x-csrf-token': token },
		body: JSON.stringify(body),
	});
	const j = await r.json().catch(() => ({}));
	if (!r.ok) throw new Error(j?.error_description || j?.message || (r.status === 409 ? 'This agent is already on a browse run' : 'The request failed, try again'));
	return j.job;
}

export function mountBrowsePanel({ stage, agentId, takeOver }) {
	if (!stage || !agentId) return { destroy() {} };
	const root = document.createElement('section');
	root.className = 'asc-brw';
	root.setAttribute('aria-label', 'Send the agent browsing');
	root.innerHTML = `
		<button type="button" class="asc-brw-toggle" aria-expanded="false">Browse</button>
		<div class="asc-brw-body" hidden>
			<form class="asc-brw-form">
				<label class="asc-brw-field"><span>Goal</span>
					<input class="asc-brw-goal" required minlength="5" maxlength="500" placeholder="Find the latest release name on the project page" /></label>
				<label class="asc-brw-field"><span>Start page</span>
					<input class="asc-brw-url" type="url" required placeholder="https://example.com" inputmode="url" /></label>
				<button type="submit" class="asc-brw-go">Start</button>
			</form>
			<p class="asc-brw-empty">Give the agent a goal and a public page. It stays on that site, never enters passwords or payment details, and you can take over at any moment.</p>
			<div class="asc-brw-run" hidden>
				<div class="asc-brw-head"><span class="asc-brw-chip" role="status"></span><button type="button" class="asc-brw-take">Take over</button></div>
				<ol class="asc-brw-steps" aria-live="polite"></ol>
				<p class="asc-brw-result"></p>
			</div>
			<p class="asc-brw-err" role="alert" hidden></p>
		</div>`;
	stage.appendChild(root);

	const $ = (s) => root.querySelector(s);
	const toggle = $('.asc-brw-toggle'), body = $('.asc-brw-body'), form = $('.asc-brw-form');
	const go = $('.asc-brw-go'), empty = $('.asc-brw-empty'), run = $('.asc-brw-run');
	const chip = $('.asc-brw-chip'), take = $('.asc-brw-take'), list = $('.asc-brw-steps');
	const result = $('.asc-brw-result'), err = $('.asc-brw-err');
	let timer = null, jobId = null;

	const showError = (m) => { err.textContent = m; err.hidden = !m; };

	function skeleton() {
		list.innerHTML = '<li class="asc-brw-skel"></li><li class="asc-brw-skel"></li><li class="asc-brw-skel"></li>';
	}

	function render(job) {
		run.hidden = false;
		empty.hidden = true;
		chip.textContent = STATUS_TEXT[job.status] || job.status;
		chip.dataset.state = FINAL.has(job.status) ? (job.status === 'done' ? 'ok' : 'stop') : 'live';
		const steps = (job.steps || []).slice(-8);
		list.innerHTML = '';
		for (const s of steps) {
			const li = document.createElement('li');
			li.textContent = describe(s);
			if (s.type === 'denied' || s.type === 'error') li.className = 'is-warn';
			list.appendChild(li);
		}
		if (!steps.length) skeleton();
		result.textContent = job.result ? `Result: ${job.result}` : '';
		take.hidden = FINAL.has(job.status);
		go.disabled = !FINAL.has(job.status);
		go.textContent = FINAL.has(job.status) ? 'Start' : 'Running';
	}

	async function poll() {
		if (!jobId) return;
		try {
			const job = await call({ op: 'status', jobId });
			render(job);
			if (FINAL.has(job.status)) { jobId = null; return; }
		} catch (e) {
			showError(e.message);
		}
		timer = setTimeout(poll, POLL_MS);
	}

	toggle.addEventListener('click', () => {
		const open = body.hidden;
		body.hidden = !open;
		toggle.setAttribute('aria-expanded', String(open));
	});

	take.addEventListener('click', () => takeOver?.());

	form.addEventListener('submit', async (ev) => {
		ev.preventDefault();
		showError('');
		go.disabled = true;
		go.textContent = 'Starting';
		run.hidden = false;
		empty.hidden = true;
		chip.textContent = STATUS_TEXT.queued;
		chip.dataset.state = 'live';
		take.hidden = false;
		result.textContent = '';
		skeleton();
		try {
			const job = await call({ op: 'start', agentId, goal: $('.asc-brw-goal').value.trim(), startUrl: $('.asc-brw-url').value.trim() });
			jobId = job.id;
			clearTimeout(timer);
			poll();
		} catch (e) {
			showError(e.message);
			run.hidden = true;
			empty.hidden = false;
			go.disabled = false;
			go.textContent = 'Start';
		}
	});

	return { destroy() { clearTimeout(timer); root.remove(); } };
}
