#!/usr/bin/env node
// Push one empty (no-diff) commit to every public repo an owner has, walking
// them from the FEWEST stars to the MOST. Ordering is the point: the run touches
// the quiet repos first and the flagship ones last, so the account's activity
// surfaces refresh from the bottom up instead of in whatever order the API
// happened to page.
//
// It never clones. Each repo takes four Git Data API calls: read the default
// branch ref, read that commit's tree, create a new commit pointing at the SAME
// tree with the old head as its only parent, then fast-forward the ref onto it.
// A commit with a tree identical to its parent's IS an empty commit, so nothing
// in any working tree changes and no history is rewritten.
//
// Auth: needs a token that can write Contents on the owner's repos. It reads
// GH_PAT, then GH_TOKEN, then GITHUB_TOKEN. A Codespace's ambient `ghu_`
// installation token is NOT enough: it is scoped to a single repo and every
// other one answers `Resource not accessible by integration (HTTP 403)`, even
// though `repos/<owner>/<repo>.permissions` reports push=true (that field
// reports the USER's access, not the token's). Export a classic/fine-grained PAT
// with Contents:write instead.
//
// Usage:
//   node scripts/empty-commit-all-repos.mjs                  # plan only (default)
//   node scripts/empty-commit-all-repos.mjs --execute        # actually commit
//   node scripts/empty-commit-all-repos.mjs --execute --limit 5
//   node scripts/empty-commit-all-repos.mjs --owner someone --skip-forks
//   node scripts/empty-commit-all-repos.mjs --execute --state run.json  # resumable
//
// Flags:
//   --owner <login>     account to sweep (default: nirholas)
//   --execute           perform the writes; without it nothing is sent
//   --limit <n>         stop after n repos (in sorted order)
//   --only <a,b,c>      restrict to these repo names
//   --skip-forks        leave forked repos alone
//   --include-archived  archived repos are skipped unless this is passed
//   --message <text>    commit subject (default below)
//   --state <path>      JSON progress file; finished repos are skipped on re-run
//   --delay <ms>        pause between repos (default 250)

const API = process.env.GITHUB_API_URL || 'https://api.github.com';
const TOKEN = process.env.GH_PAT || process.env.GH_TOKEN || process.env.GITHUB_TOKEN;

const DEFAULT_MESSAGE = 'chore: record a no-op maintenance commit across the account';

function parseArgs(argv) {
  const args = {
    owner: 'nirholas',
    execute: false,
    limit: Infinity,
    only: null,
    skipForks: false,
    includeArchived: false,
    message: DEFAULT_MESSAGE,
    state: null,
    delay: 250,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => {
      const value = argv[i + 1];
      if (value === undefined) throw new Error(`${arg} needs a value`);
      i += 1;
      return value;
    };
    if (arg === '--owner') args.owner = next();
    else if (arg === '--execute') args.execute = true;
    else if (arg === '--dry-run') args.execute = false;
    else if (arg === '--limit') args.limit = Number(next());
    else if (arg === '--only') args.only = new Set(next().split(',').map((s) => s.trim()).filter(Boolean));
    else if (arg === '--skip-forks') args.skipForks = true;
    else if (arg === '--include-archived') args.includeArchived = true;
    else if (arg === '--message') args.message = next();
    else if (arg === '--state') args.state = next();
    else if (arg === '--delay') args.delay = Number(next());
    else if (arg === '--help' || arg === '-h') args.help = true;
    else throw new Error(`unknown flag: ${arg}`);
  }
  if (!Number.isFinite(args.delay) || args.delay < 0) throw new Error('--delay must be a non-negative number');
  return args;
}

async function gh(path, { method = 'GET', body } = {}) {
  const res = await fetch(path.startsWith('http') ? path : `${API}${path}`, {
    method,
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${TOKEN}`,
      'x-github-api-version': '2022-11-28',
      'user-agent': 'three-ws-empty-commit-sweep',
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let payload = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = { raw: text };
    }
  }
  if (!res.ok) {
    const detail = payload?.message || `HTTP ${res.status}`;
    const err = new Error(`${method} ${path} failed: ${detail} (HTTP ${res.status})`);
    err.status = res.status;
    throw err;
  }
  return { payload, res };
}

async function listPublicRepos(owner) {
  const repos = [];
  for (let page = 1; ; page += 1) {
    const { payload } = await gh(`/users/${owner}/repos?type=owner&per_page=100&page=${page}`);
    if (!Array.isArray(payload) || payload.length === 0) break;
    repos.push(...payload.filter((r) => !r.private));
    if (payload.length < 100) break;
  }
  return repos;
}

async function emptyCommit(owner, repo, branch, message) {
  const ref = `heads/${branch}`;
  const { payload: refPayload } = await gh(`/repos/${owner}/${repo}/git/ref/${ref}`);
  const head = refPayload.object.sha;
  const { payload: headCommit } = await gh(`/repos/${owner}/${repo}/git/commits/${head}`);
  const { payload: created } = await gh(`/repos/${owner}/${repo}/git/commits`, {
    method: 'POST',
    body: { message, tree: headCommit.tree.sha, parents: [head] },
  });
  await gh(`/repos/${owner}/${repo}/git/refs/${ref}`, {
    method: 'PATCH',
    body: { sha: created.sha, force: false },
  });
  return { parent: head, sha: created.sha };
}

async function readState(path) {
  if (!path) return {};
  const { readFile } = await import('node:fs/promises');
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return {};
    throw err;
  }
}

async function writeState(path, state) {
  if (!path) return;
  const { writeFile } = await import('node:fs/promises');
  await writeFile(path, `${JSON.stringify(state, null, 2)}\n`);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(await import('node:fs').then((fs) => fs.readFileSync(new URL(import.meta.url), 'utf8').split('\n').filter((l) => l.startsWith('//')).map((l) => l.replace(/^\/\/ ?/, '')).join('\n')));
    return;
  }
  if (!TOKEN) {
    console.error('No token. Export GH_PAT (or GH_TOKEN) with Contents:write on the owner\'s repos.');
    process.exit(2);
  }

  const all = await listPublicRepos(args.owner);
  const eligible = all
    .filter((r) => (args.includeArchived ? true : !r.archived))
    .filter((r) => (args.skipForks ? !r.fork : true))
    .filter((r) => (args.only ? args.only.has(r.name) : true))
    .filter((r) => Boolean(r.default_branch))
    .sort((a, b) => a.stargazers_count - b.stargazers_count || a.name.localeCompare(b.name));

  const targets = Number.isFinite(args.limit) ? eligible.slice(0, args.limit) : eligible;
  const state = await readState(args.state);

  console.log(`${args.owner}: ${all.length} public repos, ${eligible.length} eligible, ${targets.length} in this run`);
  console.log(`order: fewest stars first (ties by name), message: "${args.message}"`);
  console.log(args.execute ? 'mode: EXECUTE\n' : 'mode: dry run (pass --execute to write)\n');

  let done = 0;
  let skipped = 0;
  const failures = [];

  for (const [index, repo] of targets.entries()) {
    const position = `${String(index + 1).padStart(String(targets.length).length)}/${targets.length}`;
    const label = `${position} ${repo.name} (${repo.stargazers_count}★, ${repo.default_branch})`;
    if (state[repo.name]?.sha) {
      skipped += 1;
      console.log(`${label}: already done ${state[repo.name].sha.slice(0, 7)}`);
      continue;
    }
    if (!args.execute) {
      console.log(`${label}: would commit`);
      continue;
    }
    try {
      const result = await emptyCommit(args.owner, repo.name, repo.default_branch, args.message);
      state[repo.name] = { sha: result.sha, parent: result.parent, at: new Date().toISOString() };
      await writeState(args.state, state);
      done += 1;
      console.log(`${label}: ${result.parent.slice(0, 7)} -> ${result.sha.slice(0, 7)}`);
    } catch (err) {
      failures.push({ repo: repo.name, error: err.message });
      console.log(`${label}: FAILED ${err.message}`);
    }
    if (args.delay) await sleep(args.delay);
  }

  if (args.execute) {
    console.log(`\ncommitted ${done}, already done ${skipped}, failed ${failures.length}`);
    for (const f of failures) console.log(`  ${f.repo}: ${f.error}`);
    if (failures.length) process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
