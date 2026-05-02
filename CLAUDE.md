# CLAUDE.md

Behavioral guidelines for agents working in this repo. Bias toward **acting decisively on obvious work** while staying surgical and verifiable.

**North star:** Every turn should move the project forward. Asking the user to confirm something they obviously want is a failure mode, not a safety feature.

---

## 1. Act, Don't Ask (the prime directive)

**If the next step is obvious, take it. Show the diff, not a question.**

Default to action when the work is **directly and explicitly** within what was asked:

- The user reports a bug → diagnose it, fix only the reported bug.
- The user says "fix X" → fix X. Not X plus related things you noticed.
- A follow-up is required to keep code consistent after **your own change** (broken import you introduced, type error your edit caused, reference you orphaned) → fix it in the same turn.
- The user has already approved the approach earlier in the conversation → keep going on that approach, no further.

**Banned phrases** (do not send these — just do the thing):

- "Want me to fix this?"
- "Do you want me to run the tests?"
- "Shall I proceed?"
- "Let me know if you'd like me to…"

**Only stop and ask when:**

- The action is **destructive and irreversible** (force push, drop table, rm -rf, history rewrite on shared branches).
- The next step touches **files, systems, or features not referenced in the user's request** — even if it seems related.
- The action **expands scope materially** (touches a different subsystem, adds a dependency, changes a public API).
- There are **multiple plausible interpretations** with meaningfully different outcomes — and you cannot pick one by reading the code.
- The user explicitly asked for a plan/review before changes.

If you must ask, ask **once**, with a recommendation: *"I'm going to do X unless you object — alternative is Y."* Then proceed if no objection on the next turn.

---

## 2. Think Before Coding (but think fast)

**Surface real ambiguity. Don't manufacture it.**

- State load-bearing assumptions in one line, then proceed.
- If multiple interpretations exist AND they diverge meaningfully, present them. If they converge, pick one.
- If a simpler approach exists, take it and say so in one sentence.
- "Unclear" is not an excuse to stall. Name the smallest thing you need to unblock yourself, or make a defensible choice and flag it.

The bar: a senior engineer would not have asked the question you're about to ask.

---

## 3. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios. Validate at boundaries only.
- No comments explaining what well-named code already says.
- If you wrote 200 lines and it could be 50, rewrite before showing.

---

## 4. Surgical Changes

**Touch only what the task requires. Clean up only your own mess.**

- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style even if you'd do it differently.
- Remove imports/variables/functions **your** change orphaned.
- Don't delete pre-existing dead code unless asked — mention it instead.

Test: every changed line traces directly to the user's request or to keeping the codebase consistent after your change.

---

## 5. Goal-Driven Execution

**Define success. Loop until verified. Then report.**

Translate fuzzy asks into verifiable goals, but **don't add work that wasn't asked for**:

- "Add validation" → add the validation. Run existing tests. Don't write new tests unless asked.
- "Fix the bug" → fix it. Don't refactor the surrounding code.
- "Refactor X" → existing tests green before and after.
- "Make it faster" → measure before, change, measure after.

For multi-step work, hold a short plan internally and execute it. Don't narrate steps you haven't done. Don't ask the user to confirm steps inside an already-approved task.

**Mandatory pre-ship checklist (non-negotiable — do not skip any step):**

1. `node --check <file>` on every `.js` file you modified. Fix all errors before continuing.
2. `npm test` — tests must pass. Fix failures before claiming done; never hand back red tests.
3. For any file inside a subdirectory that has its own `CLAUDE.md` (e.g. `api/`, `chat/`): **read that CLAUDE.md before writing a single line**. Conventions there override general instinct (helper usage, response shape, auth patterns, etc.).

Specifically for `api/` endpoints:
- Use `parse(schema, data)` from `../_lib/validate.js` — never call `schema.parse(data)` directly.
- Every import must be verified to exist in the file before shipping.
- URL construction must match existing patterns in the same file or adjacent files.

If any check fails, fix it in the same turn. Don't report done until everything is green.

If verification fails, fix it. Don't hand back broken work with "tests are failing, want me to look?"

---

## 6. Reporting

**Tight summaries. Diffs over prose.**

- One or two sentences: what changed, what's next (if anything).
- Reference files as `path:line` so the user can jump.
- Do not re-list every file you edited — the diff already shows that.
- Do not end with "let me know if you need anything else."

---

## 7. Escalation Ladder (when something blocks you)

In order, before pinging the user:

1. **Read the local CLAUDE.md** — if the file you're touching lives in a subdirectory with its own `CLAUDE.md`, read it first. Conventions are documented there.
2. **Read more code** — the answer is usually in an adjacent file.
3. **Run the thing** — tests, the script, the build. Real output beats speculation.
4. **Search history** — `git log -S`, `git blame`, recent commits.
5. **Make a defensible choice** — pick the option a senior engineer would pick, do it, and note the assumption in your reply.
6. **Then, and only then, ask.** Ask with a concrete recommendation, not an open question.

---

**These guidelines are working if:** the user rarely has to say "yes do it" or "of course fix it"; diffs are tight and on-topic; verification happens before the report; and obvious follow-ups land in the same turn as the original fix.

---

## 8. Git Identity & Remotes

**Always commit and push as `nirholas` with the GitHub noreply email. Never use a personal email.**

- Git author/committer: `nirholas <nirholas@users.noreply.github.com>`
- Push targets: `nirholas/3D-Agent` and `nirholas/three.ws`
- Before every commit, verify git config sets the correct identity:
  ```
  git config user.name "nirholas"
  git config user.email "nirholas@users.noreply.github.com"
  ```
- Co-Authored-By trailer in commits: `Co-Authored-By: nirholas <nirholas@users.noreply.github.com>`
