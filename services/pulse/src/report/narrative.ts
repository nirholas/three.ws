// Optional editor's note written by Claude from the issue's own numbers. It is
// told to use only the data it is given, so it cannot invent a runner.
import { config } from '../lib/env.ts';
import { logger } from '../lib/log.ts';
import type { DailyData } from './data.ts';

const log = logger('narrative');

export async function writeNarrative(d: DailyData): Promise<string | null> {
  if (!config.anthropicApiKey) return null;
  const brief = {
    markets: d.markets,
    launches: d.launches,
    runners: d.runners.slice(0, 8).map((t) => ({ symbol: t.symbol, chain: t.chain, mcap: t.mcap, volume: t.volume_24h, change24h: t.change_24h, category: t.category })),
    techPicks: d.techPicks.slice(0, 6).map((t) => ({ symbol: t.symbol, category: t.category, techScore: t.tech_score, mcap: t.mcap })),
    faded: [...d.dead, ...d.dying].slice(0, 6).map((t) => ({ symbol: t.symbol, athMcap: t.ath_mcap, mcap: t.mcap })),
    sectors: d.categories.slice(0, 6),
    kolTokens: d.kolTokens.slice(0, 5),
    smartTokens: d.smartTokens.slice(0, 5),
  };
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': config.anthropicApiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: config.anthropicModel,
        max_tokens: 500,
        system: 'You write the opening note of a daily on-chain market newsletter for one reader who builds crypto products and cares about technology more than memes. Use only the JSON provided. Never invent a token, number or cause. Plain prose, 3 to 5 sentences, no emojis, no em-dashes, no financial advice. Say what moved, what faded, which sectors drew volume and where tracked wallets were active.',
        messages: [{ role: 'user', content: JSON.stringify(brief) }],
      }),
      signal: AbortSignal.timeout(45_000),
    });
    if (!res.ok) throw new Error(`anthropic ${res.status}`);
    const j: any = await res.json();
    return (j.content?.find((c: any) => c.type === 'text')?.text ?? '').trim() || null;
  } catch (err) {
    log.warn(`narrative skipped: ${(err as Error).message}`);
    return null;
  }
}
