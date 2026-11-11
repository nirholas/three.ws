# microsoft 15: an official .NET SDK for three.ws (NuGet, Unity-compatible)

How to run: paste this file's repo path into a fresh Claude Code chat in this repository and say "run this work order". Independent of every other `microsoft-` order, so it can run in parallel with all of them. Dev port: 3115.

## Operating clause (binding)

- Read CLAUDE.md, then [_context/microsoft-00-CONTEXT.md](_context/microsoft-00-CONTEXT.md) (facts, approved wording, parallel-run rules). CLAUDE.md overrides both.
- Finish 100% in this session. Never end with a question, an option list or an unexecuted plan; judgment calls go in one line of the report.
- The only stops are the CLAUDE.md gates. Batch every owner step (Partner Center, store submission, Entra registration, push, deploy) into ONE message at the end. Never contact Microsoft or any third party.
- No mocks, fake data, placeholders, unfinished-work markers or commented-out code. No em-dash or en-dash characters. Bug fixes are test-first.
- Load the `engineering-standards` skill before building. Stage explicit paths, commit promptly, and run `npm run check:rules -- --paths <files>` (exit 0) before each commit.

## Why this matters

Every three.ws SDK today is JavaScript or TypeScript. Microsoft's enterprise customers build in C#, and so does most of the game industry through Unity. A typed, async .NET SDK targeting `net8.0` and `netstandard2.1` serves both: an ASP.NET line-of-business app can generate product models, and a Unity game can pull a generated, rigged character at runtime. It is also a prerequisite-quality signal for a Microsoft Marketplace listing aimed at .NET shops.

## Step 0: re-derive the current state

    ls sdk sdk/src; sed -n 1,120p sdk/README.md
    ls sdk/types; sed -n 1,80p sdk/src/index.* 2>/dev/null
    ls public/.well-known; head -60 public/.well-known/3d-studio-openapi.yaml
    sed -n 1,60p docs/api-reference.md
    which dotnet || ls ~/.dotnet 2>/dev/null

Map the JS SDK's public surface and the documented HTTP API (OpenAPI under `public/.well-known/` and docs/api-reference.md). The .NET SDK covers the same surface; where the JS SDK has client-only features (DOM, WebGL), skip them and say so.

## Tasks

1. **Project** `sdk-dotnet/` with `ThreeWs.Sdk` (`net8.0;netstandard2.1`), nullable enabled, `System.Text.Json` source-generated serialization (no Newtonsoft), `HttpClient` via `IHttpClientFactory`-friendly constructor, `CancellationToken` everywhere, retries with jittered backoff on 429 and 5xx honouring `Retry-After`, typed exceptions carrying the API's error code.
2. **Surface:** Forge (create on each lane, poll or await job, download GLB to a stream), assets catalog search, rigging, agents (list, get, message with streaming via `IAsyncEnumerable`), auth (API key and OAuth token), and the MCP tool list call for parity. Idempotency keys on create calls.
3. **Unity notes.** A `unity/` sample folder with a MonoBehaviour that generates a model and loads it with an open-source glTF loader (glTFast, verify license), and the README notes on `netstandard2.1` and IL2CPP stripping (link.xml).
4. **Tests** with xUnit against the real production free endpoints for the free lane and catalog; authenticated calls tested with a real key if one is readable, otherwise asserting the documented 401 shape.
5. **Docs.** `sdk-dotnet/README.md` (install, quickstart in 10 lines, every method), CHANGELOG, a page in `docs/` linked from docs/start-here.md and docs/microsoft.md, STRUCTURE.md row, changelog entry. `dotnet pack` produces the `.nupkg` with icon, license expression, repository URL and README; the `dotnet nuget push` command goes in the owner message.

## Definition of done

- [ ] `dotnet build` and `dotnet test` pass on both targets (test output in the report).
- [ ] A real model is generated and downloaded through the SDK in a test run; file size and URL in the report.
- [ ] `dotnet pack` produces a valid `.nupkg` (inspect its nuspec in the report).
- [ ] Docs, STRUCTURE.md, changelog landed; root `npm test` passes.

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| .NET SDK not installed | Install user-local with Microsoft's `dotnet-install.sh` into `~/.dotnet`. |
| No Unity install | Verify the sample compiles against `netstandard2.1` reference assemblies; put "open the sample in Unity" in the owner message. |
| API surface undocumented for an endpoint | Read the handler in `api/` and document it in docs/api-reference.md in the same commit. |
| Missing API key | `node scripts/read-service-env.mjs`; if none for a test account exists, assert the documented auth error and name what is needed. |

## Close out (required)

1. Verify every Definition of done line with the command output in front of you.
2. Commit with explicit paths and a `type(scope): ...` subject that describes the diff.
3. All lines pass: `git rm` this file in the closing commit. An owner step is last: leave the file, put a dated status line under the title naming what remains, and add it to the owner message. Either way append to [_context/microsoft-PROGRESS.md](_context/microsoft-PROGRESS.md).
4. Report: what step 0 measured; files and SHAs; evidence per Definition of done line; the one batched owner message; one-line judgment calls. No trailing questions.
