// `preview_macro`: resolve a phrase to the scene or script run_macro would fire,
// without firing it. This is run_macro's own dry run exposed as a read-only
// tool, so it stays callable while run_macro itself is off by default.

import { z } from 'zod';

import { def as runMacro } from './run-macro.js';

export const def = {
	name: 'preview_macro',
	title: 'Preview which scene a phrase would run (nothing runs)',
	annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
	description:
		'Resolve a phrase like "good night" to the scene or script this house would run, with the match confidence ' +
		'and a reason, and run NOTHING. A phrase with no match returns match:null. Show the match to the person, get ' +
		'a clear yes, then call run_macro with the same phrase, the returned preview_id and confirm_run: true.',
	inputSchema: {
		phrase: z.string().min(1).describe('What the person said, e.g. "good night".'),
	},
	handler: (args = {}) => runMacro.handler({ phrase: args.phrase, dry_run: true }),
};
