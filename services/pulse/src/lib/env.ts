// Environment loading and typed config. Node 24 reads .env natively, so there
// is no dotenv dependency: .env.local wins over .env, real env wins over both.
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

for (const file of ['.env.local', '.env']) {
  const path = resolve(process.cwd(), file);
  if (existsSync(path)) process.loadEnvFile(path);
}

function str(name: string, fallback = ''): string {
  const v = process.env[name];
  return v === undefined || v.trim() === '' ? fallback : v.trim();
}

function int(name: string, fallback: number): number {
  const n = Number(str(name));
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

function list(name: string, fallback: string[]): string[] {
  const v = str(name);
  return v ? v.split(',').map((s) => s.trim()).filter(Boolean) : fallback;
}

export const config = {
  databaseUrl: str('DATABASE_URL'),
  pgliteDir: str('PGLITE_DIR', resolve(process.cwd(), 'data/pglite')),
  port: int('PORT', 8787),
  publicUrl: str('PUBLIC_URL'),
  timezone: str('REPORT_TIMEZONE', 'UTC'),
  reportHour: Math.min(23, Math.max(0, Number(str('REPORT_HOUR', '13')) || 0)),
  snapshotEveryMin: int('SNAPSHOT_EVERY_MIN', 5),
  solanaRpcHttp: list('SOLANA_RPC_URLS', ['https://api.mainnet-beta.solana.com']),
  solanaRpcWs: list('SOLANA_WS_URLS', ['wss://api.mainnet-beta.solana.com']),
  robinhoodRpc: list('ROBINHOOD_RPC_URLS', ['https://rpc.mainnet.chain.robinhood.com']),
  telegramBotToken: str('TELEGRAM_BOT_TOKEN'),
  telegramChatId: str('TELEGRAM_CHAT_ID'),
  anthropicApiKey: str('ANTHROPIC_API_KEY'),
  anthropicModel: str('ANTHROPIC_MODEL', 'claude-sonnet-5-5'),
  streams: str('STREAMS', 'on') !== 'off',
};

export type Config = typeof config;
