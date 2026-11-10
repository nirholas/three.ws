---
name: ship-feed
description: Build a readable release feed from a GitHub repo's commit history, classify commits by audience, and link changelog entries to the commits that produced them. Use for release notes, changelog coverage checks, or explaining why a commit was classified a certain way.
---

# Ship feed

`@three-ws/shipfeed` parses commits (Conventional Commits 1.0.0, reverts, GitHub merge subjects), scores who each is for, and matches changelog entries to commits with no extra metadata. Zero dependencies, Node 18+.

## CLI

```bash
npx @three-ws/shipfeed                          # current repo (from the git origin remote), read from GitHub
npx @three-ws/shipfeed --local                  # read commits from the local clone with git log
npx @three-ws/shipfeed --repo owner/name --limit 300 --branch main
npx @three-ws/shipfeed --changelog https://example.com/changelog.json
npx @three-ws/shipfeed explain <sha>            # why one commit was classified and linked as it was
npx @three-ws/shipfeed stats                    # velocity, audience mix, changelog coverage
npx @three-ws/shipfeed post --telegram --chat <id> --token <t>   # dry run; add --send to deliver
```

Other flags: `--site <url>` (permalink base), `--scopes a,b,c` (scopes that count as product when scoring), `--min-audience holder|developer|internal`, and output modes `--json`, `--markdown`, `--rss`, `--no-color`.

Unauthenticated GitHub allows 60 requests an hour per IP. Pass a token (or set `GITHUB_TOKEN`) to raise it. Never print the token.

## Library

```js
import { shipfeed, parseCommitMessage, classify, linkCommits } from '@three-ws/shipfeed';

const feed = await shipfeed({
  repo: 'owner/name',
  changelogUrl: 'https://example.com/changelog.json',
  siteUrl: 'https://example.com',
  limit: 200,
  productScopes: ['checkout', 'editor'],
});
feed.releases;  // each with .commits (shortSha, headline, confidence, why)
feed.stats;     // includes coverage, 0..1
feed.ships;     // bursts of work never written up
```

## Audiences

`holder` (uses the product), `developer` (builds against it), `internal` (works on it). Merge commits, `chore(deps):` bumps and lockfile-only changes come back `noise: true`.

## Linking

An explicit `Changelog: <slug>` trailer always wins. Otherwise a time window, IDF-weighted term overlap, tag agreement (a `fix` entry prefers `fix:` commits) and proximity decide. Every link carries a score and reasons, so a wrong link is visible. Use `explain <sha>` when a link looks wrong.

## Worked example

To find what shipped but was never announced: run `npx @three-ws/shipfeed stats --repo owner/name --changelog <url>`, read the coverage figure, then run the default report and look at the unlinked `ships`.
