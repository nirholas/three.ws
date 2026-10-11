// Tech-versus-meme classification from a token's own words: name, symbol,
// description, website and tags. Pure so it can be unit tested; the DB pass
// at the bottom applies it to every token that has new metadata.
import { db } from '../db/client.ts';

export type Category = 'ai' | 'agents' | 'defi' | 'infra' | 'depin' | 'data' | 'gaming' | 'social' | 'payments' | 'rwa' | 'privacy' | 'launchpad' | 'tools' | 'meme' | 'animal' | 'culture' | 'politics' | 'celebrity' | 'unclassified';

const TECH: Record<Exclude<Category, 'meme' | 'animal' | 'culture' | 'politics' | 'celebrity' | 'unclassified'>, RegExp> = {
  ai: /\b(ai|artificial intelligence|llm|gpt|neural|machine learning|inference|model|claude|gemini|grok|openai|deepseek|transformer)\b/i,
  agents: /\b(agent|agents|agentic|autonomous|swarm|mcp|a2a|bot framework|copilot)\b/i,
  defi: /\b(defi|dex|swap|amm|yield|lending|borrow|vault|staking|stake|liquidity|perp|perps|perpetual|derivatives|stablecoin|lst|restaking|treasury|options)\b/i,
  infra: /\b(infra|infrastructure|rpc|validator|rollup|l2|layer 2|bridge|oracle|indexer|node|protocol|network|chain|sdk|api|compute|gpu|cloud|hosting|zk|zero.knowledge)\b/i,
  depin: /\b(depin|wireless|sensor|iot|bandwidth|energy|solar|mapping|mobility|helium|storage network)\b/i,
  data: /\b(data|analytics|dataset|intel|intelligence|terminal|dashboard|signals|research|tracker|scanner|screener)\b/i,
  gaming: /\b(game|gaming|gamefi|play|metaverse|esports|rpg|mmo|arcade|casino|poker|bet|betting|prediction market)\b/i,
  social: /\b(social|socialfi|creator|community platform|messaging|chat app|fans|streaming|content)\b/i,
  payments: /\b(payment|payments|pay|checkout|remittance|card|wallet|x402|invoice|merchant|commerce)\b/i,
  rwa: /\b(rwa|real world asset|tokenized|tokenised|real estate|commodity|bond|equity|t-bill|gold)\b/i,
  privacy: /\b(privacy|private|anonymous|zk|mixer|confidential|encrypted)\b/i,
  launchpad: /\b(launchpad|launch pad|fair launch|bonding curve|ido|incubator|accelerator)\b/i,
  tools: /\b(tool|tools|toolkit|extension|plugin|automation|sniper|trading bot|copy trading|telegram bot)\b/i,
};

const MEME: Record<'meme' | 'animal' | 'culture' | 'politics' | 'celebrity', RegExp> = {
  meme: /\b(meme|memecoin|pepe|wojak|doge|shib|inu|moon|wen|lambo|degen|ape|pump|rug|send it|based|chad|gm|wagmi|ngmi|lol|lmao|hodl|vibe|vibes)\b/i,
  animal: /\b(cat|dog|frog|pepe|bear|bull|monkey|ape|hamster|penguin|duck|goat|bonk|wif|hat|capybara|snake|owl|pig|cow|rat|mouse|fish|whale|shark|dragon|lion|tiger|fox|wolf|bird|bunny|rabbit|kitten|puppy)\b/i,
  culture: /\b(tiktok|viral|trend|trending|meme of|anime|waifu|chan|kun|quantum cat|skibidi|rizz|sigma|gyatt|ohio|npc|brainrot|goon|cope)\b/i,
  politics: /\b(trump|biden|maga|elon|musk|president|election|vote|democrat|republican|kamala|obama|putin|xi|tariff|white house|doge gov)\b/i,
  celebrity: /\b(kanye|ye|drake|taylor swift|messi|ronaldo|lebron|celebrity|influencer|streamer|kol|andrew tate|logan paul|mrbeast|kai cenat|ishowspeed)\b/i,
};

export type Classification = { category: Category; categories: Category[]; techScore: number };

export type Describable = { name?: string | null; symbol?: string | null; description?: string | null; website?: string | null; twitter?: string | null; tags?: string[] | null; verified?: boolean | null };

export function classify(t: Describable): Classification {
  const text = [t.name, t.symbol, t.description, t.website ? new URL(t.website).hostname.replace(/^www\./, '').split('.').slice(0, -1).join(' ') : '', ...(t.tags ?? [])]
    .filter(Boolean)
    .join(' \n ');
  const techHits: Category[] = [];
  const memeHits: Category[] = [];
  for (const [cat, re] of Object.entries(TECH)) if (re.test(text)) techHits.push(cat as Category);
  for (const [cat, re] of Object.entries(MEME)) if (re.test(text)) memeHits.push(cat as Category);

  let score = 0;
  score += Math.min(3, techHits.length) * 0.2;
  score -= Math.min(3, memeHits.length) * 0.2;
  if (t.website) score += 0.15;
  if ((t.description ?? '').length > 120) score += 0.1;
  if ((t.description ?? '').length > 300) score += 0.05;
  if (t.verified) score += 0.1;
  if (/\b(whitepaper|docs|documentation|github|roadmap|mainnet|testnet|open source|open-source)\b/i.test(text)) score += 0.15;
  if ((t.tags ?? []).some((x) => /verified|strict|lst|community/i.test(x))) score += 0.05;
  const techScore = Math.max(0, Math.min(1, 0.4 + score));

  const categories: Category[] = techScore >= 0.5 ? [...techHits, ...memeHits] : [...memeHits, ...techHits];
  const category: Category = categories[0] ?? (techScore >= 0.6 ? 'tools' : 'unclassified');
  return { category, categories, techScore: Number(techScore.toFixed(3)) };
}

export function safeClassify(t: Describable): Classification {
  try {
    return classify(t);
  } catch {
    return classify({ ...t, website: null });
  }
}

/** Classify every token whose metadata changed since it was last classified (or never was). */
export async function classifyPending(limit = 2000): Promise<number> {
  const d = await db();
  const rows = await d.query<{ chain: string; address: string; name: string | null; symbol: string | null; description: string | null; website: string | null; twitter: string | null; tags: string[]; verified: boolean | null }>(
    `select chain, address, name, symbol, description, website, twitter, tags, verified from tokens
      where (category = 'unclassified' and (name is not null or description is not null))
         or classified_at is null or classified_at < last_seen - interval '6 hours'
      order by last_seen desc limit $1`,
    [limit],
  );
  for (const r of rows) {
    const c = safeClassify(r);
    await d.query(`update tokens set category = $3, categories = $4, tech_score = $5, classified_at = now() where chain = $1 and address = $2`, [r.chain, r.address, c.category, c.categories, c.techScore]);
  }
  return rows.length;
}
