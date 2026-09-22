// Sandbox limits and pricing, per plan.
//
// Every execution runs under one LIMITS object: CPU and memory (the size of the
// machine it gets), wall time, captured output, workspace size, how many
// executions one run may start, and how many bridge calls one execution may
// make. The plan comes from users.plan; a request can ask for less wall time
// than its plan allows, never more.
//
// Pricing follows what the compute costs the platform: a Cloud Run execution is
// billed per allocated vCPU-second and GiB-second for its whole wall time, so
// that is exactly what is metered, at a published rate, with a floor per
// execution that covers the job start. Backends that run on the user's own
// machine (local, docker, ssh) cost the platform nothing and are recorded at
// zero, so every execution still shows up with its usage.

export const LANGUAGES = Object.freeze({
	python: { label: 'Python 3', file: 'main.py' },
	javascript: { label: 'Node.js', file: 'main.mjs' },
	bash: { label: 'Bash', file: 'main.sh' },
});
export const LANGUAGE_IDS = Object.freeze(Object.keys(LANGUAGES));

/**
 * Cloud Run job sizes. Each size is its own job (a job's CPU and memory are
 * fixed at deploy time; an execution cannot override them), named
 * `${SANDBOX_CLOUDRUN_JOB}-${size}`.
 */
export const JOB_SIZES = Object.freeze({
	s: { cpu: 1, memoryMb: 1024 },
	m: { cpu: 2, memoryMb: 4096 },
	l: { cpu: 4, memoryMb: 8192 },
});

export const PLAN_LIMITS = Object.freeze({
	free: {
		size: 's',
		wallSeconds: 60,
		outputBytes: 64 * 1024,
		fileBytes: 10 * 1024 * 1024,
		workspaceBytes: 50 * 1024 * 1024,
		executionsPerRun: 25,
		bridgeCallsPerExecution: 100,
	},
	pro: {
		size: 'm',
		wallSeconds: 300,
		outputBytes: 256 * 1024,
		fileBytes: 50 * 1024 * 1024,
		workspaceBytes: 500 * 1024 * 1024,
		executionsPerRun: 100,
		bridgeCallsPerExecution: 500,
	},
	team: {
		size: 'l',
		wallSeconds: 900,
		outputBytes: 512 * 1024,
		fileBytes: 100 * 1024 * 1024,
		workspaceBytes: 1024 * 1024 * 1024,
		executionsPerRun: 250,
		bridgeCallsPerExecution: 1000,
	},
	enterprise: {
		size: 'l',
		wallSeconds: 1800,
		outputBytes: 1024 * 1024,
		fileBytes: 250 * 1024 * 1024,
		workspaceBytes: 2 * 1024 * 1024 * 1024,
		executionsPerRun: 500,
		bridgeCallsPerExecution: 2000,
	},
});

/** Published rates, in USD. */
export const SANDBOX_PRICING = Object.freeze({
	vcpuSecondUsd: 0.000036,
	gibSecondUsd: 0.000004,
	minExecutionUsd: 0.0005,
});

const MIN_WALL_SECONDS = 1;

/**
 * The limits an execution runs under.
 * @param {string|null|undefined} plan  users.plan
 * @param {{ timeoutSeconds?: number }} [request]
 */
export function limitsFor(plan, request = {}) {
	const known = Object.hasOwn(PLAN_LIMITS, plan || '');
	const base = known ? PLAN_LIMITS[plan] : PLAN_LIMITS.free;
	const size = JOB_SIZES[base.size];
	const asked = Number(request.timeoutSeconds);
	const wallSeconds =
		Number.isFinite(asked) && asked > 0
			? Math.max(MIN_WALL_SECONDS, Math.min(Math.floor(asked), base.wallSeconds))
			: base.wallSeconds;
	return {
		plan: known ? plan : 'free',
		size: base.size,
		cpu: size.cpu,
		memoryMb: size.memoryMb,
		wallSeconds,
		maxWallSeconds: base.wallSeconds,
		outputBytes: base.outputBytes,
		fileBytes: base.fileBytes,
		workspaceBytes: base.workspaceBytes,
		executionsPerRun: base.executionsPerRun,
		bridgeCallsPerExecution: base.bridgeCallsPerExecution,
	};
}

function round6(n) {
	return Math.round(n * 1e6) / 1e6;
}

/**
 * Price one execution.
 * @param {{ backend: string, wallMs: number, limits: ReturnType<typeof limitsFor> }} o
 */
export function priceExecution({ backend, wallMs, limits }) {
	if (backend !== 'cloudrun') return 0;
	const seconds = Math.max(0, Number(wallMs) || 0) / 1000;
	const usd =
		seconds * limits.cpu * SANDBOX_PRICING.vcpuSecondUsd +
		seconds * (limits.memoryMb / 1024) * SANDBOX_PRICING.gibSecondUsd;
	return round6(Math.max(SANDBOX_PRICING.minExecutionUsd, usd));
}

/** The most one execution under these limits can cost: what the balance must cover up front. */
export function maxExecutionCost(backend, limits) {
	return priceExecution({ backend, wallMs: limits.wallSeconds * 1000, limits });
}

/**
 * Keep the head and the tail of an oversized stream: a traceback lives at the
 * end and the context that explains it at the start.
 * @param {string} text
 * @param {number} maxBytes
 */
export function truncateOutput(text, maxBytes) {
	const s = String(text ?? '');
	const bytes = Buffer.byteLength(s);
	if (bytes <= maxBytes) return { text: s, truncated: false, bytes };
	const buf = Buffer.from(s);
	const head = Math.floor(maxBytes * 0.4);
	const tail = maxBytes - head;
	const dropped = bytes - head - tail;
	return {
		text: `${buf.subarray(0, head).toString()}\n[... ${dropped} bytes omitted ...]\n${buf.subarray(bytes - tail).toString()}`,
		truncated: true,
		bytes,
	};
}
