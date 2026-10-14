# 406. Fix dead links left behind by retired work orders, found by `audit:docs`

How to run: paste this file's repo path into a fresh Claude Code chat in this repository and
say "run this work order". Runnable now, no gate. Written by the evolve scout lane on
2026-10-14 from a live `npm run audit:docs` run.

## Operating clause (binding)

- Read CLAUDE.md first. CLAUDE.md overrides everything, including this file.
- Finish 100% in this session. Never end the turn with a question, an option list, or an
  unexecuted plan. A judgment call goes in one line of the final report; it never becomes a
  question that halts work.
- The only permitted stops are the CLAUDE.md stop-and-ask gates: spending real funds or any
  irreversible on-chain write, `git push` or a production deploy, posting to an external
  channel, committing content that names a crypto project other than $THREE, and destroying
  unrecoverable data. This order touches none of them.
- No mocks, no TODO markers, no commented-out code, no stub functions. These are prose/doc
  fixes; every link you touch must resolve to something real, not a placeholder.
- The em-dash and en-dash characters are banned in everything you write.
- Concurrent agents share this worktree: stage explicit paths only (never `git add -A` or
  `git add .`), re-check `git status` and `git diff --staged` before each commit.
- Before committing, run `npm run check:rules -- --paths <files you touched>`. It must exit 0.

## Why this matters (measured 2026-10-14)

`npm run audit:docs` fails today with, among other findings, these dead relative links:

```
docs/partners/outreach-plan.md:82  ../../prompts/finish/072-best3d-06-engine-bridges.md
docs/partners/outreach-plan.md:85  ../../prompts/finish/075-best3d-09-three-vrm.md
docs/partners/prospects.md:82      ../../prompts/finish/075-best3d-09-three-vrm.md
docs/partners/prospects.md:100     ../../prompts/finish/075-best3d-09-three-vrm.md
docs/partners/tripo.md:142         ../../prompts/finish/084-partners-01-tripo-v3-house-lane.md
apps/hq/README.md:50               CLAUDE.md
apps/hq/docs/DOCUMENTATION.md:3476 ROADMAP.md
apps/hq/docs/DOCUMENTATION.md:3529 ROADMAP.md
apps/hq/docs/deploy-cloud-run.md:52 ../.env.example
```

All three `prompts/finish/*.md` targets are gone because the orders they named shipped and
were retired in their own closing commits:

- `072-best3d-06-engine-bridges.md`: retired by `f60c5e0a7` ("engine bridges shipped and
  verified").
- `075-best3d-09-three-vrm.md`: retired by `91d2a3779` ("real three-vrm integration shipped
  and verified").
- `084-partners-01-tripo-v3-house-lane.md`: retired by `a196023fb` ("Tripo v3 house lane
  shipped and verified").

This is exactly the failure mode `prompts/README.md`'s "Runtime consumption" section warns
about: "Before retiring a prompt file, grep for inbound references and rewrite them to name
the campaign + work order instead of the path." That step was skipped for these three
retirements, so three partner-facing planning docs now send a reader into a 404 on GitHub (the
path no longer exists) instead of to the shipped feature.

The `apps/hq` findings are a second, unrelated class in the same audit run: that workspace
app's own README and docs reference `CLAUDE.md` and `ROADMAP.md` files that were never created
in `apps/hq/`, and its deploy doc references a `.env.example` one level up that also does not
exist.

Not in scope, verified as false positives this session, do not "fix" them:

- `hubs/awesome-agent-identity/README.md:23`, `hubs/awesome-agent-protocols/README.md:11`,
  `hubs/awesome-solana-agents/README.md:7`: each links `../../issues/new?template=...`. These
  `hubs/` directories are curated lists meant to become standalone GitHub repos (see
  `prompts/README.md`'s promotion-path pattern); the relative link is correct for that future
  repo's own root and only "breaks" inside this monorepo, which has no `issues/` directory.
  Confirm this reading holds (`ls hubs/*/`, check for a repo-promotion note) and leave these
  alone.
- `docs/research/oss-landscape-2026-10-notes/chat-memory-evals.md:3` links an absolute local
  path (`/home/user/projects/three.ws/packages/agent-memory/README.md`). Decide whether to
  make it relative (`../../../packages/agent-memory/README.md`, verify the target exists first)
  while you are in this file class, since it is the same audit run and the same fix shape
  (dead/wrong link), but it is lower priority than the three retired-order links above.

A stray local-only directory this session found and removed, not a repo issue, no action
needed: `workers/model-triposplat/` held nothing but a gitignored `__pycache__/` (confirmed
with `git ls-files workers/model-triposplat`, empty) and caused a false "directory needs a
README" audit finding; it no longer exists on disk in this worktree. If `npm run audit:docs`
still reports it, it has been recreated by something else since this measurement; re-check
before treating it as a real gap.

## Tasks

1. **Fix the three retired-order links.** For each of the three files above, read the
   surrounding paragraph the dead link sits in, then replace the link with prose naming what
   shipped (use the retiring commit's subject line as the fact, not the deleted path). Do not
   link to a commit SHA as a substitute; name the shipped feature and, where one exists, a
   live doc or page that covers it (e.g. three-vrm's shipped state likely has a doc under
   `docs/`; engine bridges and the Tripo v3 house lane likewise; search `git show <sha> --stat`
   for each retiring commit to find what doc, if any, it shipped alongside, and link that
   instead of leaving prose with no link at all).
   - `docs/partners/outreach-plan.md` lines 82 and 85
   - `docs/partners/prospects.md` lines 82 and 100
   - `docs/partners/tripo.md` line 142
2. **Fix the `apps/hq` links.** Read `apps/hq/README.md:50` and `apps/hq/docs/DOCUMENTATION.md`
   around lines 3476 and 3529 to see what a contributor guide (`CLAUDE.md`) and a roadmap
   (`ROADMAP.md`) for that app would need to say. Either write minimal real files at
   `apps/hq/CLAUDE.md` and `apps/hq/ROADMAP.md` (if the content is substantial enough that a
   contributor genuinely needs it and it does not already live elsewhere in `apps/hq/docs/`),
   or repoint the links at the doc that already carries this content (check
   `apps/hq/docs/DOCUMENTATION.md` itself first; it may already be the de facto contributor
   guide and roadmap, in which case the two links should point there instead of to files that
   were never created). For `apps/hq/docs/deploy-cloud-run.md:52`, check whether
   `apps/hq/.env.example` should exist (compare against the root `.env.example` and whatever
   env vars `apps/hq`'s own code reads) and either create it or repoint the link at the correct
   existing example file.
3. **Re-run the audit.** `npm run audit:docs` must report zero findings for every link this
   order touched. Findings this order explicitly left alone (the three `hubs/` links) are
   allowed to remain, but confirm they are the *only* remaining findings before calling this
   done, since a fresh regression elsewhere would mean something else changed the file set
   mid-session.

## Definition of done

- [ ] `npm run audit:docs` no longer lists the nine links named above as dead (the three
      `hubs/` links may remain; nothing else may).
- [ ] Every rewritten link resolves to a real file or a real, live URL; no link points at a
      path that does not exist.
- [ ] No placeholder text ("TBD", "coming soon", a bare commit SHA with no explanation) stands
      in for a real fix.
- [ ] `npm run check:rules -- --paths <files you touched>` exits 0.
- [ ] `git status` shows nothing stray left uncommitted that this order created.
- [ ] Explicit-path commit(s), one topical commit per class of fix (the three partner docs as
      one commit, the `apps/hq` fixes as another, since they are unrelated causes).

## Never blocked (pre-answered)

| Blocker | Do this |
|---|---|
| Can't tell what the three.vrm/engine-bridges/tripo work shipped | `git show <retiring-sha> --stat` lists every file that commit's retirement touched; `git log --all --oneline --grep "three-vrm"` (or the relevant keyword) across the whole history finds the feature commit itself, usually just before the retirement commit. |
| `apps/hq/docs/DOCUMENTATION.md` is too large to read in one pass | It is a single large generated-style doc; use `grep -n` for the sections around the two line numbers given, plus a search for existing "Contributing" or "Roadmap" headings before deciding whether to write new files or repoint links. |
| A link fix would need content naming a crypto project other than $THREE | Everything touched here is three.ws's own partner planning and an internal app's contributor docs; if a specific sentence genuinely needs another project's name to stay truthful, leave that one hunk uncommitted and say so in the report, but commit everything else. |
| `workers/model-triposplat/` exists again when you check | Confirm with `git ls-files workers/model-triposplat`; if it is still untracked `__pycache__` only, delete it the same way this session did and note it in the report rather than writing docs for it. |

## Report format

1. The `audit:docs` output before and after, side by side.
2. What each of the nine fixed links now points at and why.
3. Confirmation the three `hubs/` links are the only findings left, or an explanation if not.
4. Commit SHAs.
