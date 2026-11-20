// What happens after a Grok round that left a render running. three.ws
// answers a slow generation with a pending job instead of blocking, so a turn
// can need several rounds: Grok starts the job, the server follows it with
// get_job (idempotent, never restarts anything), and once it is done Grok is
// asked, through previous_response_id, to collect it with check_job. That
// keeps the finished model in Grok's own history, so "make it chrome" next
// turn knows which model "it" is.

export const MAX_ROUNDS = 6;

/** The jobs a round left running, newest result per job id. */
export function pendingJobs(results) {
	const byId = new Map();
	for (const r of results) {
		if (r && r.kind === 'pending' && r.jobId) byId.set(r.jobId, r);
	}
	for (const r of results) {
		if (r && r.kind === 'model' && r.jobId) byId.delete(r.jobId);
	}
	return [...byId.values()];
}

/**
 * What to do after a round.
 * - { action: 'done' } when nothing is left running, or the round budget is spent
 * - { action: 'wait', job } when a render is still running and should be followed
 */
export function planNextRound({ results, round, maxRounds = MAX_ROUNDS }) {
	const jobs = pendingJobs(results);
	if (!jobs.length) return { action: 'done', reason: 'complete' };
	if (round >= maxRounds) return { action: 'done', reason: 'round_budget', job: jobs[jobs.length - 1] };
	return { action: 'wait', job: jobs[jobs.length - 1] };
}

/** The message that asks Grok to collect a finished job. */
export function continuationPrompt(job) {
	const refine = job.refine ? ` It is a refinement: pass this refine object to check_job unchanged: ${JSON.stringify(job.refine)}` : '';
	return `The render with job_id ${job.jobId} has finished on three.ws. Call check_job with that job_id to collect it.${refine} Then tell me in one short sentence that it is ready. Do not paste links; the page shows them.`;
}

/**
 * How long to wait before the next get_job poll. Follows the job's own
 * estimate when it has one (half the remaining time, so the finish is caught
 * early), otherwise backs off gently. Always between 3 and 15 seconds.
 */
export function pollDelayMs(job, attempt = 0) {
	const eta = typeof job?.etaSeconds === 'number' && job.etaSeconds > 0 ? job.etaSeconds : null;
	const ms = eta ? eta * 500 : 4000 + attempt * 1000;
	return Math.min(15_000, Math.max(3_000, Math.round(ms)));
}
