# microsoft 42: three.ws agents callable as A2A agents from Copilot Studio and Azure AI Foundry

Status 2026-11-16: code, tests, docs and the live Agent Framework proof (question, streamed GLB, cancel) are done; the remaining owner steps are the deploy and the in-product click-through. See _context/microsoft-PROGRESS.md.

How to run: paste this file's repo path into a fresh Claude Code chat in this repository and say "run this work order". Independent of every other `microsoft-` order, so it can run in parallel with all of them. Dev port: 3142.

## Operating clause (binding)

- Read CLAUDE.md, then [_context/microsoft-00-CONTEXT.md](_context/microsoft-00-CONTEXT.md) (facts, approved wording, parallel-run rules). CLAUDE.md overrides both.
- Finish 100% in this session. Never end with a question, an option list or an unexecuted plan; judgment calls go in one line of the report.
- The only stops are the CLAUDE.md gates. Batch every owner step (Partner Center, store submission, Entra registration, push, deploy) into ONE message at the end. Never contact Microsoft or any third party.
- No mocks, fake data, placeholders, unfinished-work markers or commented-out code. No em-dash or en-dash characters. Bug fixes are test-first.
- Load the `engineering-standards` skill before building. Stage explicit paths, commit promptly, and run `npm run check:rules -- --paths <files>` (exit 0) before each commit.

## Why this matters

MCP gives Microsoft agents three.ws tools. The Agent2Agent (A2A) protocol goes further: a Copilot Studio or Foundry agent can delegate a whole task to a three.ws agent (with its persona, skills, memory and wallet) and get a result back. Microsoft has added A2A support to its agent platforms. three.ws already has an A2A surface ([docs/a2a-agent.md](../../docs/a2a-agent.md)); this order makes it work from Microsoft's side, end to end, and documents it so Microsoft builders can wire it up.

## Step 0: re-derive the current state

    sed -n 1,80p docs/a2a-agent.md
    grep -rn "agent-card\|agent.json\|/a2a" vercel.json api --include=*.js | head
    curl -s https://three.ws/.well-known/agent-card.json | head -c 800; echo; curl -s https://three.ws/.well-known/agent.json | head -c 400
    ls integrations/microsoft/agent-framework integrations/microsoft/semantic-kernel-python 2>/dev/null | head

Read the current A2A specification version, and Microsoft's current docs for connecting A2A agents in Copilot Studio and in Azure AI Foundry Agent Service (and Microsoft Agent Framework's A2A client): the agent card fields they require, auth schemes they support, streaming and task lifecycle expectations.

## Tasks

1. **Spec conformance.** Bring the three.ws A2A server to the current spec version: per-agent agent cards (discoverable at the documented well-known path and per-agent URLs), `message/send`, `message/stream` (SSE), task get and cancel, artifacts for generated files (GLB, images) as file parts with URLs, and correct error codes. Write conformance tests first using the spec's JSON schema (vendored with its source URL).
2. **Auth Microsoft can use.** Support the auth schemes Copilot Studio and Foundry document for A2A (API key header and OAuth 2.0 client credentials or bearer, per their docs), declared accurately in the agent card. Reuse the existing API key and OAuth server; scope tokens to the agent; rate limit.
3. **Live interop proof.** Use Microsoft Agent Framework's A2A client (Python or .NET, installed into a scratch environment) to call a real three.ws agent in production or on the dev server: a plain question, a Forge generation task streamed to completion, and a cancel. Record transcripts in the doc.
4. **Builder docs** `docs/microsoft-a2a.md`: step-by-step for Copilot Studio (add an agent via A2A) and Foundry (A2A tool), with the agent card URL, auth setup and a sample prompt; link from [docs/microsoft.md](../../docs/microsoft.md) and [docs/a2a-agent.md](../../docs/a2a-agent.md). Add a sample under `integrations/microsoft/agent-framework/` if that folder exists, else in the doc.
5. **Changelog** entry and `npm run build:pages`.

## Definition of done

- [ ] Conformance tests pass against the vendored schema (output in the report).
- [ ] Agent Framework's A2A client completed all three live calls (transcripts in the doc).
- [ ] The agent card validates and declares only auth schemes that actually work.
- [ ] `npm test` and `npm run audit:docs` pass; docs and changelog landed.

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| No Copilot Studio or Foundry tenant | Agent Framework's client is Microsoft's own implementation and is the interop bar; the in-product click-through goes in the owner message. |
| Spec version mismatch between Microsoft products | Serve the version Microsoft's products document; keep backward-compatible fields for existing clients and test both. |
| Generation takes minutes | Use streaming with task status updates; wait for the real result. |

## Close out (required)

1. Verify every Definition of done line with the command output in front of you.
2. Commit with explicit paths and a `type(scope): ...` subject that describes the diff.
3. All lines pass: `git mv` this file to `prompts/archive/` in its own closing commit and repoint inbound links. If an owner step is last: leave the file, put a dated status line under the title naming what remains, and add it to the owner message. Either way append to [_context/microsoft-PROGRESS.md](_context/microsoft-PROGRESS.md).
4. Report: what step 0 measured; files and SHAs; evidence per Definition of done line; the one batched owner message; one-line judgment calls. No trailing questions.
