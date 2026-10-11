// `npx three-ws --claude` (and --cursor, --codex, --vscode, --windsurf, --gemini,
// --bob, --hermes): the whole setup for the named clients, no prompts.
//
// It is `setup --clients <ids> --yes` with two guarantees the one-line install
// path needs: client config files never hold a secret (every entry goes through
// the local proxy, which reads the owner-only credential store), and Claude Code
// also gets the three.ws skill so the assistant knows how to use the tools.

import { setup } from './setup.js';
import { installClaudeSkills } from '../claude-skills.js';
import { c, line, sym } from '../ui.js';

// flag name -> client id in clients/index.js
export const CLIENT_FLAGS = {
	claude: 'claude-code',
	cursor: 'cursor',
	codex: 'codex',
	vscode: 'vscode',
	windsurf: 'windsurf',
	gemini: 'gemini',
	bob: 'bob',
	hermes: 'hermes',
};

/** Client ids named by per-client flags, in a stable order. */
export function clientsFromFlags(flags) {
	return Object.entries(CLIENT_FLAGS).filter(([flag]) => flags[flag]).map(([, id]) => id);
}

export async function quick(ctx) {
	const ids = clientsFromFlags(ctx.flags);
	ctx.flags.clients = [...new Set([...(ctx.flags.clients ? ctx.flags.clients.split(',') : []), ...ids])].join(',');
	ctx.flags.yes = true;
	ctx.flags.proxy = true;
	ctx.flags.secretless = true;
	const code = await setup(ctx);
	if (code !== 0 || !ids.includes('claude-code')) return code;

	const result = await installClaudeSkills({ origin: ctx.origin, env: ctx.env, project: Boolean(ctx.flags.project) });
	if (!ctx.flags.json) {
		if (result.error) line(`${c.yellow(sym.warn)} Claude skill not installed: ${result.error}`);
		else line(`${c.green(sym.ok)} Claude skill ${result.changed ? 'installed' : 'already up to date'}: ${result.file}`);
		line(c.dim('  Restart Claude Code, then try: claude "launch my agent"'));
	}
	return result.error ? 1 : 0;
}
