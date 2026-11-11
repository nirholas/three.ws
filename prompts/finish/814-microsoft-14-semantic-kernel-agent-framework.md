# microsoft 14: three.ws plugins for Semantic Kernel and Microsoft Agent Framework, plus a Foundry quickstart

Status 2026-11-11: built and verified (commits cea955c6f, 43ea7ff1d, 8b2d8c99d, 077428ee9, 4371a4b63, d4e057fa4, 2e4e2a1a8, 0a670d97a, 58a0e08be, 42060ab63, cb56fdcb9, 3b37f68c6; STRUCTURE row swept into 9b08be2e2). Both SK suites pass live, both Agent Framework samples returned real GLBs, wheel and nupkg install clean. Waits on the owner: PyPI and NuGet publish, push, deploy (carries the two mcp-studio fixes), run the Foundry quickstart.

How to run: paste this file's repo path into a fresh Claude Code chat in this repository and say "run this work order". Independent of every other `microsoft-` order, so it can run in parallel with all of them. Dev port: 3114.

## Operating clause (binding)

- Read CLAUDE.md, then [_context/microsoft-00-CONTEXT.md](_context/microsoft-00-CONTEXT.md) (facts, approved wording, parallel-run rules). CLAUDE.md overrides both.
- Finish 100% in this session. Never end with a question, an option list or an unexecuted plan; judgment calls go in one line of the report.
- The only stops are the CLAUDE.md gates. Batch every owner step (Partner Center, store submission, Entra registration, push, deploy) into ONE message at the end. Never contact Microsoft or any third party.
- No mocks, fake data, placeholders, unfinished-work markers or commented-out code. No em-dash or en-dash characters. Bug fixes are test-first.
- Load the `engineering-standards` skill before building. Stage explicit paths, commit promptly, and run `npm run check:rules -- --paths <files>` (exit 0) before each commit.

## Why this matters

Microsoft's open-source agent stack (Semantic Kernel, and Microsoft Agent Framework, the successor that unifies Semantic Kernel and AutoGen) is how enterprise .NET and Python teams build agents, and Azure AI Foundry Agent Service is where they host them. three.ws already has integrations for LangChain, LiveKit, Pipecat, Dify and n8n, but nothing for the Microsoft stack. A first-class plugin package and a Foundry quickstart make three.ws the default answer when a Microsoft-stack team asks "how do I give my agent a 3D body or 3D generation".

## Step 0: re-derive the current state

    ls integrations integrations/microsoft packages/langchain
    sed -n 1,80p packages/langchain/README.md
    sed -n 1,60p docs/mcp-tools.md
    curl -s -X POST https://three.ws/api/mcp-studio -H 'content-type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | head -c 1500
    node scripts/read-service-env.mjs 2>/dev/null | grep -i -E "anthropic|openai|gemini|vertex" | sed 's/=.*/=<set>/'

Read the current Semantic Kernel docs (Python and .NET plugins, MCP plugin support), the Microsoft Agent Framework repository README and samples (Python and .NET, MCP tools), and the Foundry Agent Service docs for attaching a remote MCP server. Check each repository's LICENSE and current package names on PyPI and NuGet.

## Tasks

1. **Python package** `integrations/microsoft/semantic-kernel-python/` (`threews-semantic-kernel` or the naming the ecosystem uses): a native plugin class with typed kernel functions (generate model, job status, find asset, list my agents, message an agent) calling the documented three.ws HTTP API, plus a helper that attaches the three.ws MCP server through SK's MCP support. Tests run against the real free endpoints.
2. **.NET package** `integrations/microsoft/semantic-kernel-dotnet/`: the same plugin in C# (`Microsoft.SemanticKernel` functions with descriptions), xUnit tests against the real endpoints.
3. **Agent Framework samples** (Python and .NET) in `integrations/microsoft/agent-framework/`: an agent that uses three.ws tools to design a prop for a described scene, run end to end with whatever LLM provider has a key on this machine or Cloud Run (SK and Agent Framework support several providers; use one already configured, no new paid onboarding).
4. **Foundry quickstart** in docs/mcp-tools.md: attaching `https://three.ws/api/mcp-studio` as a remote MCP tool in Foundry Agent Service, with the exact portal and SDK steps from Microsoft's current docs.
5. **Docs.** README per package with install, auth, examples; `docs/microsoft-agent-stack.md`; link from docs/microsoft.md; STRUCTURE.md row; changelog entry; publishing commands for PyPI and NuGet in each README (owner runs them).

## Definition of done

- [ ] Python tests and .NET tests pass against real endpoints (output in the report).
- [ ] Both Agent Framework samples run end to end and produce a real model URL (transcript in the report).
- [ ] `python -m build` and `dotnet pack` produce installable packages.
- [ ] Docs, STRUCTURE.md, changelog landed; root `npm test` passes.

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| .NET SDK not installed | Install it user-local with Microsoft's `dotnet-install.sh` into `~/.dotnet` (free, no root). |
| No Azure subscription for Foundry | Write the quickstart from the docs, verify the MCP endpoint answers Foundry's expected handshake shape, put "run the Foundry quickstart" in the owner message. |
| No LLM key locally | `node scripts/read-service-env.mjs` for an existing provider key; Vertex Gemini via GCP is pre-approved. |
| Package name taken | Pick the closest clear name, note it in one line. |

## Close out (required)

1. Verify every Definition of done line with the command output in front of you.
2. Commit with explicit paths and a `type(scope): ...` subject that describes the diff.
3. All lines pass: `git rm` this file in the closing commit. An owner step is last: leave the file, put a dated status line under the title naming what remains, and add it to the owner message. Either way append to [_context/microsoft-PROGRESS.md](_context/microsoft-PROGRESS.md).
4. Report: what step 0 measured; files and SHAs; evidence per Definition of done line; the one batched owner message; one-line judgment calls. No trailing questions.
