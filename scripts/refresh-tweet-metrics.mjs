#!/usr/bin/env node
// Refresh live X (Twitter) metrics for every tweet referenced in the launch-week case study.
// Reads tweet IDs from threews-launch-week-case-study.html, batches calls to X API v2,
// writes results to tweet-metrics.json which the HTML page reads at load time.
//
// Usage: node scripts/refresh-tweet-metrics.mjs
// Requires: X_API_BEARER in .env

import fs from 'node:fs/promises';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const HTML_PATH = path.join(ROOT, 'threews-launch-week-case-study.html');
const OUT_PATH = path.join(ROOT, 'tweet-metrics.json');
const ENV_PATH = path.join(ROOT, '.env');

async function loadEnv() {
  const raw = await fs.readFile(ENV_PATH, 'utf8');
  for (const line of raw.split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}

function extractTweetIds(html) {
  const ids = new Set();
  const re = /(?:twitter\.com|x\.com)\/[^/]+\/status\/(\d+)/g;
  let m;
  while ((m = re.exec(html)) !== null) ids.add(m[1]);
  return [...ids];
}

async function fetchBatch(ids, bearer) {
  const url = new URL('https://api.x.com/2/tweets');
  url.searchParams.set('ids', ids.join(','));
  url.searchParams.set('tweet.fields', 'public_metrics,created_at,author_id,note_tweet');
  url.searchParams.set('expansions', 'author_id');
  url.searchParams.set('user.fields', 'username,name,profile_image_url');

  const res = await fetch(url, { headers: { Authorization: `Bearer ${bearer}` } });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`X API ${res.status}: ${body.slice(0, 400)}`);
  }
  return res.json();
}

async function main() {
  await loadEnv();
  const bearer = process.env.X_API_BEARER;
  if (!bearer) throw new Error('X_API_BEARER missing in .env');

  const html = await fs.readFile(HTML_PATH, 'utf8');
  const ids = extractTweetIds(html);
  console.log(`Found ${ids.length} unique tweet IDs in case study HTML.`);

  const metrics = {};
  const authors = {};

  // X v2 allows up to 100 IDs per call.
  for (let i = 0; i < ids.length; i += 100) {
    const batch = ids.slice(i, i + 100);
    console.log(`Fetching batch ${i / 100 + 1} (${batch.length} tweets)...`);
    const data = await fetchBatch(batch, bearer);
    for (const u of data.includes?.users ?? []) authors[u.id] = u;
    for (const t of data.data ?? []) {
      const author = authors[t.author_id];
      metrics[t.id] = {
        id: t.id,
        created_at: t.created_at,
        author: author ? { username: author.username, name: author.name } : null,
        metrics: t.public_metrics,
      };
    }
    for (const err of data.errors ?? []) {
      console.warn(`  skipped ${err.resource_id ?? err.value}: ${err.title} — ${err.detail ?? ''}`);
    }
  }

  const out = {
    refreshed_at: new Date().toISOString(),
    count: Object.keys(metrics).length,
    tweets: metrics,
  };
  await fs.writeFile(OUT_PATH, JSON.stringify(out, null, 2));
  console.log(`Wrote ${Object.keys(metrics).length} tweet metrics to ${path.relative(ROOT, OUT_PATH)}`);

  const top = Object.values(metrics)
    .sort((a, b) => (b.metrics?.impression_count ?? 0) - (a.metrics?.impression_count ?? 0))
    .slice(0, 5);
  console.log('\nTop 5 by impressions:');
  for (const t of top) {
    const m = t.metrics || {};
    console.log(`  ${m.impression_count ?? '-'} views · ${m.like_count ?? '-'} likes · ${m.retweet_count ?? '-'} RTs · @${t.author?.username ?? '?'} · ${t.id}`);
  }
}

main().catch((e) => {
  console.error('FAILED:', e.message);
  process.exit(1);
});
