# microsoft 11: a public trust center and the Microsoft 365 Publisher Attestation answers, sourced from the code

How to run: paste this file's repo path into a fresh Claude Code chat in this repository and say "run this work order". Independent of every other `microsoft-` order, so it can run in parallel with all of them. Dev port: 3111.

## Operating clause (binding)

- Read CLAUDE.md, then [_context/microsoft-00-CONTEXT.md](_context/microsoft-00-CONTEXT.md) (facts, approved wording, parallel-run rules). CLAUDE.md overrides both.
- Finish 100% in this session. Never end with a question, an option list or an unexecuted plan; judgment calls go in one line of the report.
- The only stops are the CLAUDE.md gates. Batch every owner step (Partner Center, store submission, Entra registration, push, deploy) into ONE message at the end. Never contact Microsoft or any third party.
- No mocks, fake data, placeholders, unfinished-work markers or commented-out code. No em-dash or en-dash characters. Bug fixes are test-first.
- Load the `engineering-standards` skill before building. Stage explicit paths, commit promptly, and run `npm run check:rules -- --paths <files>` (exit 0) before each commit.

## Why this matters

Every Microsoft surface three.ws is entering (Marketplace SaaS, the Teams and Copilot app, the Power Platform connector, MCP certification) ends at an enterprise IT reviewer, and Microsoft 365 Publisher Attestation asks the same questions in a questionnaire. Today the answers are scattered across docs and code. A public `/trust` page with true, specific, code-sourced answers shortens every review, and the attestation becomes a copy-paste job for the owner.

## Step 0: re-derive the current state

    ls pages | grep -i -E "trust|security|privacy|terms|dpa|subprocessor"
    curl -s https://three.ws/.well-known/security.txt; curl -sI https://three.ws/privacy | head -3
    sed -n 1,200p marketing/growth/submissions/programs/microsoft-365-publisher-attestation.md
    ls docs | grep -i -E "security|privacy|resilience|custody|retention"
    node scripts/read-service-env.mjs 2>/dev/null | sed 's/=.*//' | sort | head -200

From the env var names and the code, build the real subprocessor list (hosting, database, object storage, email, LLM providers, RPC providers, analytics). Never guess: each entry cites the file that calls it.

## Tasks

1. **`/trust` page** in the house design: overview, then sections each answering with specifics and linking the evidence doc: hosting and regions; encryption in transit and at rest (what the providers actually do); authentication (OAuth 2.1, PKCE, Entra, SAML, passkeys if present); access control and admin access; logging and monitoring; data retention and deletion (find the real purge jobs and their schedules); backups and recovery; wallet custody model stated honestly; AI data use (which providers see prompts, whether they train on them, per their published terms, cited); incident response and status page; vulnerability disclosure.
2. **Subprocessors** at `/trust/subprocessors` from a `data/subprocessors.json` (name, purpose, data categories, region, the file that proves it), with a "last reviewed" date.
3. **`/.well-known/security.txt`** (RFC 9116: contact, expires, policy, preferred languages, canonical) if missing, served with the right content type.
4. **Compliance status, honest.** A table with "in place", "in progress", "not pursued" rows. No SOC 2, ISO or Microsoft certification claim unless it exists; Publisher Attestation reads "in preparation".
5. **Attestation answers.** Fill every question in `microsoft-365-publisher-attestation.md` with an answer and its evidence path, flagging any answer that requires an owner decision.
6. **Wire it in.** Footer link, `/microsoft/activate` and the Teams tab link `/trust`; docs/microsoft.md "Related"; pages.json, STRUCTURE.md, changelog.

## Definition of done

- [ ] Every claim on `/trust` and every subprocessor row cites a file in the repo or a provider's published page; a reviewer can follow each link (spot-check list in the report).
- [ ] `security.txt` validates against RFC 9116 fields.
- [ ] The attestation file has an answer for every question; owner-decision items are listed.
- [ ] Pages render at 1280px and 400px in both themes with no console errors; `npm run audit:docs` and `npm test` pass; changelog landed.

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| A practice does not exist yet (for example a written incident policy) | Write the policy doc in `docs/` matching what the system actually does, mark it in the status table, and list it for owner sign-off. |
| A provider's data-use terms are unclear | Quote the provider's published page and link it; do not paraphrase into a stronger claim. |
| Secret-type env values | Never print values; names only. |
| Microsoft's attestation questions changed | Use the current questionnaire from learn.microsoft.com and cite it. |

## Close out (required)

1. Verify every Definition of done line with the command output in front of you.
2. Commit with explicit paths and a `type(scope): ...` subject that describes the diff.
3. All lines pass: `git rm` this file in the closing commit. An owner step is last: leave the file, put a dated status line under the title naming what remains, and add it to the owner message. Either way append to [_context/microsoft-PROGRESS.md](_context/microsoft-PROGRESS.md).
4. Report: what step 0 measured; files and SHAs; evidence per Definition of done line; the one batched owner message; one-line judgment calls. No trailing questions.
