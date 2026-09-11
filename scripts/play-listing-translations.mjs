#!/usr/bin/env node
// play-listing-translations - build the file Play Console's "Import translations"
// card takes, with every field inside Play's character limits.
//
// Why this exists: Play's limits are per LOCALE, not per source. The English
// listing sits at 28/30 on the title and 79/80 on the short description, and
// almost every language runs longer than English, so a machine translation that
// reads perfectly still lands at 94 characters and Play flags the locale with
// "Some languages have errors". Length is a hard constraint of the job here, not
// a formatting detail, so every field is measured and re-asked until it fits.
//
// The app name is deliberately NOT translated. It is a brand followed by a
// three-word descriptor, it already uses 28 of its 30 characters, and there is
// no language in which a translated version reliably fits. Play accepts the same
// name in every locale.
//
// Usage:
//   node scripts/play-listing-translations.mjs                  # every locale
//   node scripts/play-listing-translations.mjs --locales=de-DE,ja-JP
//   node scripts/play-listing-translations.mjs --provider=groq  # default: nvidia
//   node scripts/play-listing-translations.mjs --concurrency=3

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LISTING = path.join(ROOT, 'solana-mobile/publish-play/listing');
const OUT = path.join(LISTING, 'translations.csv');

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const m = a.match(/^--([^=]+)(?:=(.*))?$/);
  return m ? [m[1], m[2] ?? true] : [a, true];
}));

/** Play's published ceilings. Exceeding one is exactly what the console flags. */
const LIMITS = { title: 30, short: 80, full: 4000 };

const read = (f) => readFileSync(path.join(LISTING, f), 'utf8').trim();
const TITLE = read('title.txt');
const SHORT = read('short-description.txt');
const FULL = read('full-description.txt');

if (TITLE.length > LIMITS.title) throw new Error(`[play-i18n] the English title is already ${TITLE.length}/${LIMITS.title}`);

/* Play's own locale codes, as the console spells them. */
const LOCALES = [
  ['es-ES', 'Spanish (Spain)'], ['es-419', 'Spanish (Latin America)'],
  ['pt-BR', 'Portuguese (Brazil)'], ['pt-PT', 'Portuguese (Portugal)'],
  ['fr-FR', 'French'], ['de-DE', 'German'], ['it-IT', 'Italian'], ['nl-NL', 'Dutch'],
  ['pl-PL', 'Polish'], ['ru-RU', 'Russian'], ['uk', 'Ukrainian'], ['tr-TR', 'Turkish'],
  ['ar', 'Arabic'], ['hi-IN', 'Hindi'], ['id', 'Indonesian'], ['th', 'Thai'],
  ['vi', 'Vietnamese'], ['ja-JP', 'Japanese'], ['ko-KR', 'Korean'],
  ['zh-CN', 'Chinese (Simplified)'], ['zh-TW', 'Chinese (Traditional)'],
];

/* Terms that must survive translation byte for byte: product names, chain and
   format names, the support URLs. A translated "glTF" or a localised domain is
   a broken listing, not a localised one. */
const KEEP = [
  'three.ws', 'glTF', 'GLB', 'HTML', 'Solana', 'Metaplex Core', 'Mobile Wallet Adapter',
  'SOL', 'Android', 'Google Play', 'Notion', 'support@three.ws',
  'https://three.ws/docs', 'github.com/nirholas/three.ws', 'github.com/nirholas/three.ws/issues',
];

const PROVIDERS = {
  nvidia: { envKey: 'NVIDIA_API_KEY', url: 'https://integrate.api.nvidia.com/v1/chat/completions', model: 'nvidia/nemotron-3-ultra-550b-a55b' },
  groq: { envKey: 'GROQ_API_KEY', url: 'https://api.groq.com/openai/v1/chat/completions', model: 'qwen/qwen3.8-27b' },
  mistral: { envKey: 'MISTRAL_API_KEY', url: 'https://api.mistral.ai/v1/chat/completions', model: 'mistral-small-latest' },
  openai: { envKey: 'OPENAI_API_KEY', url: 'https://api.openai.com/v1/chat/completions', model: 'gpt-4o-mini' },
};

const providerName = String(args.provider || 'nvidia');
const provider = PROVIDERS[providerName];
if (!provider) throw new Error(`[play-i18n] --provider must be one of ${Object.keys(PROVIDERS).join(', ')}`);
const apiKey = process.env[provider.envKey];
if (!apiKey) {
  throw new Error(`[play-i18n] ${provider.envKey} is not set. Resolve it with:\n  export ${provider.envKey}="$(node scripts/read-service-env.mjs '^${provider.envKey}$' --raw)"`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* A free lane answers 429 and 503 under load, and both are transient: the first
   smoke run lost a locale to a single "Service temporarily overloaded" that
   succeeded on the retry. Backoff turns that into a slower row instead of a
   missing language, which on this deliverable is the difference between a file
   you can import and one you have to notice is incomplete. */
async function complete(messages, { temperature = 0.2 } = {}) {
  let lastErr;
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    try {
      const res = await fetch(provider.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ model: provider.model, messages, temperature, max_tokens: 16_384 }),
        signal: AbortSignal.timeout(180_000),
      });
      if (res.status === 429 || res.status >= 500) {
        const retryAfter = Number(res.headers.get('retry-after')) * 1000;
        throw Object.assign(new Error(`${providerName} ${res.status}: ${(await res.text()).slice(0, 200)}`), {
          status: res.status,
          retryAfter: Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : 0,
          transient: true,
        });
      }
      if (!res.ok) {
        const body = await res.text();
        throw Object.assign(new Error(`${providerName} ${res.status}: ${body.slice(0, 240)}`), { status: res.status });
      }
      const json = await res.json();
      const text = json?.choices?.[0]?.message?.content;
      if (!text) throw new Error(`${providerName} returned no content`);
      return text;
    } catch (err) {
      lastErr = err;
      if (!err.transient && err.name !== 'TimeoutError') throw err;
      if (attempt === 5) break;
      await sleep(err.retryAfter || Math.min(30_000, 2_000 * 2 ** (attempt - 1)));
    }
  }
  throw lastErr;
}

/**
 * Pull one field out of a plain-text reply.
 *
 * This used to ask for JSON and it was the wrong wire format for the job. A full
 * description is multi-paragraph prose with quotes and newlines in it, so the
 * model has to escape all of it, and any reply cut short by the token ceiling
 * loses its closing brace and takes the whole locale with it: 16 of 21 locales
 * failed that way on the first bulk run, several of them holding a perfectly
 * good translation that simply would not parse. Sentinels survive truncation,
 * need no escaping, and let a short field succeed even when a long one fails.
 */
function extractField(text, tag) {
  const stripped = text.replace(/<think>[\s\S]*?<\/think>/g, '');
  const m = stripped.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`));
  if (!m) throw new Error(`reply carried no <${tag}> block: ${stripped.trim().slice(0, 160)}`);
  return m[1].trim();
}

const SYSTEM = `You localise Google Play store listings. You return ONLY the requested tagged block, with no commentary before or after it and no code fences.
Never translate these terms, reproduce them exactly: ${KEEP.join(', ')}.
Keep the structure of the full description: the same paragraphs and the same section headings in the same order, each heading alone on its line.
TRANSLATE the section headings too. Leaving them in English is wrong: a reader of this listing should see no English section headers. Where the language has capital letters, set the heading in capitals; where it does not, write the heading plainly.
Write natural marketing copy a native speaker would write, not a literal word-for-word rendering.
Never invent a feature, a price, or a claim that is not in the source.
Never use the em-dash or the en-dash, in any language, even where that language's typography normally prefers one. Use a comma, a colon, a period, or parentheses instead.`;

/* The repo bans the em-dash and the en-dash everywhere, and the pre-push check
   enforces it on the generated CSV like any other file. Russian, German and
   Ukrainian copy reaches for a spaced em-dash constantly, so the system prompt
   alone is not enough: the first full run came back with nine of them. A clause
   separator becomes a comma, which every one of these languages accepts in the
   same position; inside an all-caps section heading a comma would read wrong, so
   the dash simply goes away. */
const deDash = (v) => v
  .replace(/[^\S\n]*[\u2014\u2013][^\S\n]*/g, (m, at, full) => {
    const line = full.slice(full.lastIndexOf('\n', at) + 1, (full.indexOf('\n', at) + 1 || full.length + 1) - 1);
    return /\p{Ll}/u.test(line) ? ', ' : ' ';
  })
  .replace(/ +([,.!?:;])/g, '$1')
  .replace(/[ \t]+$/gm, '');

async function translateLocale(code, name) {
  const notes = [];

  /* Each field is its own request. The short description is cheap and almost
     always lands first try; the full description is the expensive one, and
     separating them means a failure on the long field never costs the short. */
  async function field({ tag, source, limit, label, minLength }) {
    let best = null;
    for (let attempt = 1; attempt <= 4 && best === null; attempt += 1) {
      const budget = attempt === 1
        ? `It MUST be at most ${limit} characters, counting spaces and punctuation.`
        : `YOUR PREVIOUS ATTEMPT WAS ${notes[notes.length - 1]?.split(' ').pop() || 'too long'}. It MUST be at most ${limit} characters; aim for ${Math.round(limit * 0.9)}. Shorten it by cutting words, never by abbreviating into something a native speaker would not write.`;

      const reply = await complete([
        { role: 'system', content: SYSTEM },
        {
          role: 'user',
          content: `Translate this Google Play ${label} into ${name} (${code}).\n\n${budget}\n\nReturn it wrapped exactly like this and nothing else:\n<${tag}>\nthe translation\n</${tag}>\n\nSOURCE:\n${source}`,
        },
      ], { temperature: attempt === 1 ? 0.2 : 0.35 });

      let value;
      try {
        value = deDash(extractField(reply, tag));
      } catch (err) {
        notes.push(`${label} attempt ${attempt}: ${err.message.slice(0, 80)}`);
        continue;
      }
      /* A reply that parses but is far shorter than the source is a failure the
         length check alone waves through: the first run produced a pt-BR row
         holding three characters in both fields and reported it as a success. */
      if (value.length < minLength) { notes.push(`${label} attempt ${attempt}: only ${value.length} chars, implausible`); continue; }
      if (value.length > limit) { notes.push(`${label} attempt ${attempt}: ${value.length}/${limit} too long`); continue; }
      best = value;
    }
    return best;
  }

  const short = await field({ tag: 'short', source: SHORT, limit: LIMITS.short, label: 'short description', minLength: 20 });
  const full = await field({ tag: 'full', source: FULL, limit: LIMITS.full, label: 'full description', minLength: Math.round(FULL.length * 0.35) });

  /* A field that will not fit falls back to English rather than to a truncated
     sentence. English is valid in every Play locale; a sentence cut mid-word is
     the kind of thing that ships and is never noticed. */
  const out = { code, title: TITLE, short: short ?? SHORT, full: full ?? FULL, notes };
  if (short === null) notes.push('short: fell back to English');
  if (full === null) notes.push('full: fell back to English');
  return out;
}

/** RFC 4180: quote every field, double the quotes inside. Full descriptions
    carry newlines and commas, so an unquoted CSV would shred them. */
const csvField = (v) => `"${String(v).replace(/"/g, '""')}"`;

const only = args.locales ? String(args.locales).split(',').map((s) => s.trim()) : null;
const targets = LOCALES.filter(([code]) => !only || only.includes(code));
if (!targets.length) throw new Error(`[play-i18n] no locales matched --locales=${args.locales}`);

/* Low by default and on purpose: these keys are the same ones production chat
   uses, and a wide bulk run has taken the live chain down before. */
const concurrency = Math.max(1, Number(args.concurrency || 3));
const results = [];
const queue = [...targets];
await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
  while (queue.length) {
    const [code, name] = queue.shift();
    try {
      const row = await translateLocale(code, name);
      results.push(row);
      const flag = row.notes.some((n) => n.includes('fell back')) ? ' FALLBACK' : '';
      console.log(`[play-i18n] ${code.padEnd(7)} short ${String(row.short.length).padStart(3)}/${LIMITS.short}  full ${String(row.full.length).padStart(4)}/${LIMITS.full}${flag}`);
    } catch (err) {
      console.error(`[play-i18n] ${code}: ${err.message}`);
      results.push({ code, failed: String(err.message) });
    }
  }
}));

const ok = results.filter((r) => !r.failed).sort((a, b) => a.code.localeCompare(b.code));
const rows = [
  ['locale', 'title', 'short_description', 'full_description'].join(','),
  ...ok.map((r) => [r.code, r.title, r.short, r.full].map(csvField).join(',')),
];
writeFileSync(OUT, `${rows.join('\n')}\n`, 'utf8');

console.log(`\n[play-i18n] wrote ${path.relative(ROOT, OUT)}  (${ok.length} locales)`);
const fallbacks = ok.filter((r) => r.notes?.some((n) => n.includes('fell back')));
if (fallbacks.length) console.log(`[play-i18n] left in English because no translation fit: ${fallbacks.map((r) => r.code).join(', ')}`);
const failed = results.filter((r) => r.failed);
if (failed.length) {
  console.log(`[play-i18n] FAILED: ${failed.map((r) => r.code).join(', ')}`);
  process.exitCode = 1;
}
