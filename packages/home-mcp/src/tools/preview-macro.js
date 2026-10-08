// `preview_macro`: resolve a phrase to the scene or script run_macro would fire,
// without firing it. This is run_macro's own dry run exposed as a read-only
// tool, so a client that only grants read-only tools can still show the person
// what a phrase would do before anything moves in the house.

import { z } from 'zod';

import { def as runMacro } from './run-macro.js';

export const def = {
	name: 'preview_macro',
	title: 'Preview which scene a phrase would run (nothing runs)',
	annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
	description:
		'Resolve a phrase like "good night" to the scene or script this house would run, with the match confidence ' +
		'and a reason, and run NOTHING. A phrase with no match returns match:null. Show the match to the person and, ' +
		'once they agree, call run_macro with the same phrase. A macro that would open the house is still refused ' +
		'there, because confirming a guarded action takes a person on the hosted three.ws surface.',
	inputSchema: {
		phrase: z.string().min(1).describe('What the person said, e.g. "good night".'),
	},
	handler: (args = {}) => runMacro.handler({ phrase: args.phrase, dry_run: true }),
};
