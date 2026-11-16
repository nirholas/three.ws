# microsoft 39: a Microsoft 365 Certification evidence pack, with every control gap that code can close closed

How to run: paste this file's repo path into a fresh Claude Code chat in this repository and say "run this work order". Independent of every other `microsoft-` order, so it can run in parallel with all of them. Dev port: 3139.

## Operating clause (binding)

- Read CLAUDE.md, then [_context/microsoft-00-CONTEXT.md](_context/microsoft-00-CONTEXT.md) (facts, approved wording, parallel-run rules). CLAUDE.md overrides both.
- Finish 100% in this session. Never end with a question, an option list or an unexecuted plan; judgment calls go in one line of the report.
- The only stops are the CLAUDE.md gates. Batch every owner step (Partner Center, store submission, Entra registration, push, deploy) into ONE message at the end. Never contact Microsoft or any third party.
- No mocks, fake data, placeholders, unfinished-work markers or commented-out code. No em-dash or en-dash characters. Bug fixes are test-first.
- Load the `engineering-standards` skill before building. Stage explicit paths, commit promptly, and run `npm run check:rules -- --paths <files>` (exit 0) before each commit.

## Why this matters

Publisher Attestation (answers drafted in `marketing/growth/submissions/programs/microsoft-365-publisher-attestation.md`) is the self-assessment tier. Microsoft 365 Certification is the audited tier that shows a badge on the Teams and Copilot listings, and enterprise IT teams often require it before approving an app. Its control specification covers application security, operational security and data handling and privacy, and the analyst asks for evidence per control. Most of the evidence is producible from the repo and Google Cloud; the rest are written policies. Doing this ahead of the audit makes the certification a scheduling exercise instead of a remediation project.

## Step 0: re-derive the current state

    cat marketing/growth/submissions/programs/microsoft-365-publisher-attestation.md | head -80
    ls docs/security docs | grep -i -E "security|incident|retention|privacy|policy|backup|dr\b|access"
    ls pages | grep -i trust; curl -sI https://three.ws | grep -i -E "strict-transport|content-security|x-frame|x-content|referrer|permissions"
    ls scripts | grep -i -E "audit|scan|security|deps"

Read Microsoft's current Microsoft 365 Certification control specification and the App Compliance program docs (scope definition, evidence types, sampling, penetration testing requirement, the domains and each control's evidence ask). Build the full control list from the source; do not work from memory.

## Tasks

1. **Control matrix** `docs/compliance/m365-certification/controls.md` (split into linked parts if long): every control id, the requirement in short, three.ws's implementation, the evidence artifact (file path, command output, screenshot to capture, or policy doc), its status (met, partially met, gap) and the owner of any gap.
2. **Policies** that are missing, written to match how three.ws actually operates (never aspirational): information security policy, access control and least privilege (GCP IAM, service accounts, database access), change management (git, review, Cloud Build), vulnerability and patch management (dependency scanning cadence), logging and monitoring (Cloud Logging, retention), incident response (link the existing doc), backup and recovery (Neon and GCS, with real RPO and RTO measured), data retention and deletion (link account deletion), secure development, and supplier management (subprocessors). Each policy states its review cadence and approver as the owner.
3. **Evidence automation** `npm run compliance:m365-evidence`: produces a dated evidence folder outside git (or in GCS) with dependency audit output, TLS and security header scans of production, IAM role bindings for the runtime and build service accounts, Cloud Run config without secret values, log retention settings, backup settings, and the list of admin users with MFA status where available. Read-only against production.
4. **Close code-closable gaps** found in the matrix (for example missing security headers, an admin action without an audit log entry, a session without idle timeout, a dependency with a known critical vulnerability), each test-first where it is logic, each in its own commit.
5. **Owner pack** in the matrix doc: what the owner must provide (penetration test by an approved third party if required, signed policies, the certification analyst booking) in order.

## Definition of done

- [ ] Every control in Microsoft's current specification has a row with evidence or a named gap (count in the report).
- [ ] `npm run compliance:m365-evidence` runs read-only and produces the evidence folder (file list in the report, no secrets in it, verified by a scan).
- [ ] Each code-closable gap is fixed with its test; `npm test` passes.
- [ ] Policies landed under `docs/compliance/`; `/trust` links the public subset; `npm run audit:docs` passes.

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| A control needs a third-party pen test | Owner item in the pack; run an automated passive baseline scan (for example OWASP ZAP baseline) against production as supporting evidence only. |
| A real RPO or RTO is unknown | Measure it: restore the latest Neon branch or backup into an isolated branch and time it; never write a guessed number. |
| A policy would describe something not true | Fix the practice if it is code or config; otherwise record the gap honestly. |

## Close out (required)

1. Verify every Definition of done line with the command output in front of you.
2. Commit with explicit paths and a `type(scope): ...` subject that describes the diff.
3. All lines pass: `git mv` this file to `prompts/archive/` in its own closing commit and repoint inbound links. If an owner step is last: leave the file, put a dated status line under the title naming what remains, and add it to the owner message. Either way append to [_context/microsoft-PROGRESS.md](_context/microsoft-PROGRESS.md).
4. Report: what step 0 measured; files and SHAs; evidence per Definition of done line; the one batched owner message; one-line judgment calls. No trailing questions.
