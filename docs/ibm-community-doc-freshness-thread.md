---
title: "Your docs are now instructions for AI agents. How do you know which ones to trust?"
venue: IBM Community, Three.ws User Group (discussion thread)
account: nich (nich8)
companion_to: "the group blog post drafted in docs/ibm-community-doc-freshness-post.md (not yet posted; add its URL here once it is live, and link it from the paragraph that mentions the full write-up)"
status: draft, not yet posted. Post after the companion blog post, so the reference to the full write-up resolves.
framing_notes: |
  A self-contained discussion piece, not a link teaser: a reader who never opens the blog
  still gets the model, one runnable snippet, and the lessons. The affiliation line from
  docs/ibm.md stays in. Nothing here touches payments, tokens, or any crypto-cluster topic,
  and IBM had no involvement in the system described. Numbers are dated; re-check them
  against `npm run check:docs-freshness` and https://three.ws/docs-freshness-summary.json
  before posting.
---

# Your docs are now instructions for AI agents. How do you know which ones to trust?

Documentation used to have one kind of reader: a person who could notice that a command failed and go ask someone. On a growing number of teams it now has a second: the AI coding agent. Agents read the README, the runbooks, and the agent instruction file (`AGENTS.md`, `CLAUDE.md`, or whatever your convention is), and they act on what those say.

That changes what a stale doc costs. A human treats an outdated sentence as a hint that something is off. An agent treats it as an instruction.

Our operating file at three.ws says it more bluntly than I can: "agents execute what it says verbatim. A stale line in it does not read as stale, it reads as an instruction, and the cost is a wasted session per drift." The comments in the script that guards that file record real examples. It once described a database migration command as a dry run, while the npm wrapper hardcodes `--apply`, so the "dry run" writes to production immediately. It quoted a scheduled-job count that quietly grew from 89 to 100. It told agents to push to a remote that, on one worktree, did not exist. None of these were dramatic. Each was a small truth that stopped being true, read by a reader that does not second-guess.

So we stopped asking "are our docs good?" and started asking a narrower, answerable question for every doc: **has the code this page describes changed since anyone last checked the page?**

## The idea in a few sentences

A doc already tells you what it is about. It names files, `npm run` commands, and API routes in its own text. Treat every name that resolves to a real source file as a dependency of that doc. Then ask git: was any dependency committed to after the doc was last edited or last reviewed? Code that moved since then is code the page has never been checked against.

You can try the core of it on your own repository right now. This is a portable shell version for a single doc (bash, git, grep; no other dependencies):

```bash
#!/usr/bin/env bash
# drift.sh <doc.md>: which files named in this doc changed after it was last edited?
doc="$1"
since=$(git log -1 --format=%ct -- "$doc")
grep -oE '[A-Za-z0-9_./-]+\.(js|mjs|ts|py|go|java|sh|sql|json|ya?ml)' "$doc" | sort -u |
while read -r f; do
  git ls-files --error-unmatch "$f" >/dev/null 2>&1 || continue
  out=$(git log --since="@$((since + 1))" --format="  %h %cs %s" -- "$f")
  [ -n "$out" ] && printf '%s\n%s\n' "$f" "$out"
done
```

Run from the repository root against one of our docs on 2026-10-08, it printed:

```
$ ./drift.sh docs/avatar-thumbnails.md
scripts/regenerate-avatar-thumbnails.mjs
  309cb37e8 2026-10-01 fix(avatars): give each thumbnail re-render two minutes, so one stuck model cannot stall the regeneration
src/animation-retarget.js
  8561d5c5d 2026-10-03 fix(animation): re-aim limb rest direction so A-pose rigs stop clipping through the torso
```

That is the reading list for refreshing the page: two commits, with their intent in the subject line. I read the first one. It added a two-minute cap per render, and the doc does not mention it. Nothing the doc says is wrong, but an operator would want that fact. That is the typical shape of drift: not a lie, a missing truth.

Our production version (a Node script that runs over the whole corpus of a little over 800 docs in about two seconds) adds the parts that turn this from a curiosity into something a team can live with:

- **Weight by exclusivity.** Our route config file is named by 72 docs. If all 72 went red every time a route changed, nobody would read the dashboard. So each drifted file counts 1/N, where N is how many docs name it, and a doc is "stale" when the total reaches 1.0: the equivalent of one file only this doc documents having changed.
- **A second clock for reviews.** Reading a page and finding it correct is real work with no diff. Without a way to record it, people either make cosmetic edits (a lie in the history) or leave permanent false positives (which teach everyone to ignore the signal). A review stamp records who checked the page against which commit, and freshness is measured from the newer of the last edit and the last review. A stamp that names a commit the repository does not have fails the build, because a fictional baseline silently hides real drift.
- **Records of a moment are exempt.** A dated security review or incident writeup names lots of code and must never be "updated to match." Those are marked as records and never counted as drift. This matters double with agents in the loop: an agent asked to "bring the docs up to date" will happily rewrite an audit unless something tells it the doc is history.
- **It runs inside the deploy build, before the frontend build.** The report is written into the static assets of the commit being shipped, and every published doc page shows a small badge from it: "Verified against the code," "Lightly out of date," or "The code this page describes has changed," with the number of files that moved and a link to the evidence. You can verify the placement from outside: on 2026-10-08 our live version endpoint and our live freshness report named the same commit.

## What we learned (with numbers)

**The signal is good enough to show readers.** Across three cleanup sweeps, 339 docs the tool flagged as stale were read against the code, and 293 of them needed a correction or an addition: about 86 percent. The errors were the kind people act on: environment variables no code reads, a teardown command that now requires `--force`, a command documented as writing two files when it writes four.

**One generated file can hide half your drift.** A concatenated "all docs" file names nearly every file every other doc names, which doubles every share count and halves every weight. On our repository the same measurement reported 58 stale docs with that aggregate included and 122 with it excluded. Find your aggregates before you trust the numbers.

**Drift comes back on a schedule.** We drove the stale count to zero on 2026-09-18. It was 13 three days later and 64 at the next production deploy. A sweep is maintenance, not a fix. (Our sweeps are run by coding agents in parallel, with a strict verdict vocabulary of edited, verified, or record, and a single agent recording the stamps so parallel writers cannot lose each other's work.)

**A gate that is not in the ship path drifts red.** Our budget check lives in an on-demand gate, not in the deploy pipeline. The badges kept telling readers the truth the whole time, but nothing forced anyone to work the queue, and the deploy shipped with the count far over budget. If drift matters, enforce it where things ship, or schedule the sweep like dependency updates.

**A guard keyed to wording stops guarding when the wording changes.** This one surprised us. The script that checks our agent instruction file has an assertion for the claim "README coverage is 100 percent," and it only fires when the file contains the phrase "is currently 100%." A well-intentioned edit replaced stale counts in that sentence with a command, and the phrase became "is 100%." The assertion silently stopped running. Seven directories later landed without a README while the instruction file claimed 100 percent and the guard printed OK. We found it while writing this up and fixed it the same day: the pattern now tolerates the rewording, and a missing claim is an error rather than a skip. The first run after the fix went red. A check that skips itself when its trigger text is missing fails in a way that looks exactly like success.

## The full write-up

The full write-up on the group blog walks through all of it with real command output and source excerpts: the extraction rules, the weighting, the five statuses (verified, watch, stale, conceptual, record), how a review is recorded against a commit, the time series of our documentation health over ten weeks, the honest limits of git-history staleness (it detects movement rather than wrongness, it cannot see claims that name no file, and committer timestamps are not ancestry), and a zero-dependency Node script you can run on your own repository in an afternoon. If you want to see the live result first, our [docs freshness dashboard](https://three.ws/docs/freshness?utm_source=ibm-community) ranks every doc and shows every drifted file and commit.

## Questions for the group

1. **How do you keep agent instruction files true?** If your coding agents read an `AGENTS.md`, a rules file, or a runbook before acting, what checks it, and how often? Has an agent ever followed a stale instruction into a real incident on your team?
2. **Would you put a docs budget in the deploy path?** We regenerate the trust signal on every deploy but only enforce the budget on demand, and you can see where that led. Has anyone made documentation drift a hard gate without it turning into a number everyone just raises?
3. **What do your docs depend on that is not a file?** Environment configuration, infrastructure definitions, third-party API behavior, database schemas. Git history cannot see any of those. If you have bound docs to them some other way, I would love to compare notes.

Run the snippet above against the doc your team trusts most, and post what it finds. I suspect most of us will be surprised.

_three.ws is an IBM Business Partner. The documentation freshness system described here is three.ws's own engineering practice, built on git and Node.js; it is not an IBM product, uses no IBM service, and IBM had no involvement in it._
