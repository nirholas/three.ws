// `pulse` command. Subcommands: start (default), collect, report, migrate, mcp.
const [, , sub = 'start', ...rest] = process.argv;

const commands: Record<string, { args: string[]; load: () => Promise<unknown> }> = {
  start: { args: rest, load: () => import('./main.ts') },
  collect: { args: ['--once', ...rest], load: () => import('./main.ts') },
  migrate: { args: ['--migrate', ...rest], load: () => import('./main.ts') },
  report: { args: rest, load: () => import('./report/cli.ts') },
  mcp: { args: rest, load: () => import('./mcp/server.ts') },
};

const cmd = commands[sub];
if (!cmd || sub === '--help' || sub === '-h') {
  console.log(`pulse <command>

  start     collector, firehose, API and dashboard (default)
  collect   run one collection cycle and exit (add --jobs for wallet import + scoring)
  report    build the daily newsletter (--day YYYY-MM-DD --no-send --print)
  migrate   apply database migrations and exit
  mcp       MCP server over the Pulse API (set PULSE_URL)

Docs: https://nirholas.github.io/pulse/`);
  process.exit(cmd ? 0 : 1);
}
process.argv = [process.argv[0]!, process.argv[1]!, ...cmd.args];
await cmd.load();
