// POST /api/x402/node-inference: buy one inference job from the open node network.
//
// The buyer pays USDC (Solana-first, like every x402 route) and the platform
// enqueues the job for a live community node (registered and polled within 60s
// for the capability), waits up to 25s for the result, and re-verifies the
// node's ed25519 receipt against the server's own record of the job. The
// handler runs BEFORE settlement (see api/_lib/x402-paid-endpoint.js), so every
// failure below (no node, node error, timeout, bad receipt) throws and settles
// nothing: the buyer is only billed for a result that verified. After a
// successful settle the `metered` hook accrues one earning for the node.
//
// Body: { capability, model?, input }
// 200:  { output, jobId, node, receipt, capability }
// 400 invalid_json / missing_capability / missing_input / input_too_large
// 503 no_node_available · 502 node_failed / receipt_invalid · 504 node_timeout

import { paidEndpoint } from '../_lib/x402-paid-endpoint.js';
import { readBody } from '../_lib/http.js';
import { buildBazaarSchema } from '../_lib/x402-spec.js';
import { withService } from '../_lib/x402/bazaar-helpers.js';
import { priceFor } from '../_lib/x402-prices.js';
import {
	CAPABILITY_PRICES_ATOMICS,
	enqueueJob,
	expireJob,
	liveNodesFor,
	priceForCapability,
	recordNodeEarning,
	verifyFinishedJob,
	waitForJob,
} from '../_lib/inference-nodes.js';

const ROUTE = '/api/x402/node-inference';
const WAIT_MS = Number(process.env.NODE_INFERENCE_WAIT_MS) || 25_000;
const MAX_INPUT_CHARS = 20_000;
const CAPABILITY_RE = /^[a-z0-9][a-z0-9._-]{1,63}$/;

const MAX_PRICE = Object.values(CAPABILITY_PRICES_ATOMICS).reduce(
	(m, p) => (BigInt(p) > m ? BigInt(p) : m),
	0n,
);

function fail(status, code, message) {
	const err = new Error(message);
	err.status = status;
	err.code = code;
	return err;
}

const INPUT_SCHEMA = {
	type: 'object',
	required: ['capability', 'input'],
	properties: {
		capability: { type: 'string', description: 'Capability a live node advertises, e.g. text-embedding.' },
		model: { type: 'string', description: 'Optional model hint passed to the node.' },
		input: { description: 'A string or an object such as { "text": "..." }.' },
	},
};
const OUTPUT_SCHEMA = {
	type: 'object',
	required: ['output', 'jobId', 'node', 'receipt'],
	properties: {
		output: { description: 'The node result.' },
		jobId: { type: 'string' },
		node: { type: 'string', description: 'base58 public key of the node that ran the job.' },
		receipt: { type: 'object', description: 'ed25519 receipt (threews-node/v1) the platform verified before settling.' },
		capability: { type: 'string' },
	},
};

export default paidEndpoint({
	route: ROUTE,
	method: 'POST',
	priceAtomics: priceFor('node-inference', MAX_PRICE.toString()),
	description:
		'Run one inference job on the open three.ws node network. Pay only for a result whose node receipt verified.',
	bazaar: {
		discoverable: true,
		info: {
			input: { type: 'http', method: 'POST', bodyType: 'json', body: { capability: 'text-embedding', input: { text: 'hello' } } },
			output: { type: 'json', example: { output: { embedding: [0.01], model: 'Xenova/all-MiniLM-L6-v2' }, jobId: 'job_…', node: 'NodePub…', receipt: { algorithm: 'ed25519' }, capability: 'text-embedding' } },
		},
		schema: buildBazaarSchema({ method: 'POST', bodyType: 'json', bodySchema: INPUT_SCHEMA, outputSchema: OUTPUT_SCHEMA }),
	},
	service: withService({
		serviceName: 'three.ws Node Network Inference',
		tags: ['inference', 'nodes', 'embedding', 'decentralized'],
	}),

	async handler({ req }) {
		let body;
		try {
			body = JSON.parse((await readBody(req, 200_000)).toString());
		} catch {
			throw fail(400, 'invalid_json', 'Request body must be valid JSON');
		}
		const capability = String(body?.capability || '');
		if (!CAPABILITY_RE.test(capability)) throw fail(400, 'missing_capability', '"capability" is required');
		const input = body?.input;
		if (input === undefined || input === null || input === '') throw fail(400, 'missing_input', '"input" is required');
		if (JSON.stringify(input).length > MAX_INPUT_CHARS) throw fail(400, 'input_too_large', `"input" must be at most ${MAX_INPUT_CHARS} characters`);
		const model = typeof body?.model === 'string' ? body.model.slice(0, 120) : undefined;

		if ((await liveNodesFor(capability)).length === 0) {
			throw fail(503, 'no_node_available', `No live node advertises "${capability}" right now. Retry shortly.`);
		}

		const queued = await enqueueJob({ capability, model, input });
		const job = await waitForJob(queued.id, { timeoutMs: WAIT_MS });
		if (!job || job.timedOut) {
			await expireJob(queued.id);
			throw fail(504, 'node_timeout', 'The node did not return a result in time. You were not charged.');
		}
		if (job.status === 'failed') throw fail(502, 'node_failed', 'The node reported an error. You were not charged.');
		if (job.status !== 'done') throw fail(502, 'node_failed', 'The job ended without a result. You were not charged.');
		if (!(await verifyFinishedJob(job))) {
			throw fail(502, 'receipt_invalid', 'The node result did not carry a valid signed receipt. You were not charged.');
		}

		return {
			output: job.output,
			jobId: job.id,
			node: job.claimedBy,
			receipt: job.receipt,
			capability,
			model: job.model || null,
		};
	},

	// Runs only after the payment settled: accrue exactly one earning for the node.
	async metered({ result, settled, requirement }) {
		if (!result?.jobId || !result?.node) return null;
		try {
			await recordNodeEarning({
				nodePublicKey: result.node,
				jobId: result.jobId,
				capability: result.capability,
				model: result.model,
				amountAtomics: requirement?.amount ?? priceForCapability(result.capability),
				asset: requirement?.asset,
				payerSignature: settled?.transaction,
			});
		} catch (err) {
			console.error('[node-inference] earning not recorded', result.jobId, err.message);
		}
		return null;
	},
});
