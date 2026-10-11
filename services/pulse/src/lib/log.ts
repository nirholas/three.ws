// Tiny structured logger: one line per event, scoped, with an ISO timestamp.
type Level = 'info' | 'warn' | 'error';

function line(level: Level, scope: string, msg: string, extra?: unknown): void {
  const tail = extra === undefined ? '' : ` ${extra instanceof Error ? extra.message : JSON.stringify(extra)}`;
  const out = `${new Date().toISOString()} ${level.toUpperCase().padEnd(5)} [${scope}] ${msg}${tail}`;
  if (level === 'info') console.log(out);
  else console.error(out);
}

export function logger(scope: string) {
  return {
    info: (msg: string, extra?: unknown) => line('info', scope, msg, extra),
    warn: (msg: string, extra?: unknown) => line('warn', scope, msg, extra),
    error: (msg: string, extra?: unknown) => line('error', scope, msg, extra),
  };
}
