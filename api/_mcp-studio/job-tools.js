// three.ws 3D Studio (free): get_job, the job status tool for agents.
//
// A generation that outlives its tool call comes back as a job_id. get_job
// reads that job any time, as often as needed: status (pending, done, failed),
// phase, progress (0 to 1), eta_seconds and elapsed_seconds while it runs; the
// four asset links (viewer_url, glb_url, poster_png_url, embed_html) once it is
// done; and a plain reason plus a remedy if it failed. It answers from the same
// core as check_job (./tools.js collectJob), so the two always agree.
//
// It is listed on the full and Grok surfaces, beside the catalog tools, and
// not on the ChatGPT listing, whose inline viewer collects jobs through
// check_job by itself. Never counted against the generation quota
// (./handler.js isGenerationTool).

import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { collectJob, toolError } from './tools.js';
import { originFromReq } from './gpt-forge-client.js';

async function handleGetJob(args, _auth, req, ctx = {}) {
	const jobId = String(args.job_id || '').trim();
	if (!jobId) return toolError('Provide the job_id a generation returned.');
	return collectJob(originFromReq(req), jobId, args.refine ? { refine: args.refine } : {}, { jobTool: ctx.jobTool || 'get_job' });
}

const DEFS = [
	{
		name: 'get_job',
		title: 'Get a 3D generation job',
		description:
			'Status of a 3D generation job. Pass the job_id any generation tool returned with status "pending". ' +
			'Returns status (pending, done or failed), phase, progress from 0 to 1, eta_seconds and elapsed_seconds ' +
			'while it runs; when done, the model with its viewer_url, glb_url, poster_png_url and embed_html; when ' +
			'failed, the reason and what to do next. Call it as often as you like: it never starts or repeats a ' +
			'generation. Between calls, wait about the eta_seconds it reports, or 15 seconds when it reports none.',
		inputSchema: {
			type: 'object',
			additionalProperties: false,
			required: ['job_id'],
			properties: {
				job_id: {
					type: 'string',
					minLength: 8,
					maxLength: 4096,
					description: 'The job_id (or jobId) a generation tool returned.',
				},
				refine: {
					type: 'object',
					additionalProperties: true,
					description:
						'Optional: the refine object a pending refine_model result carried, passed back unchanged so the ' +
						'finished model joins that version history.',
				},
			},
		},
		annotations: {
			readOnlyHint: false, // the first check of a finished job saves the model
			destructiveHint: false,
			idempotentHint: true, // it never starts a generation
			openWorldHint: true,
		},
		handler: handleGetJob,
	},
];

export const JOB_TOOL_CATALOG = DEFS.map(({ handler: _h, ...schema }) => schema);

const ajv = new Ajv({ allErrors: true, useDefaults: true, coerceTypes: true, strict: false });
addFormats(ajv);

export const JOB_TOOLS = Object.fromEntries(
	DEFS.map(({ name, handler, inputSchema }) => [name, { handler, validate: ajv.compile(inputSchema) }]),
);
